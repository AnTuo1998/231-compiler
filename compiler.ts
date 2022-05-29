import { StringifyOptions } from 'querystring';
import wabt from 'wabt';
import { BinOp, ClsDef, CondBody, Expr, FunDef, Literal, MemberExpr, Program, Stmt, Type, VarDef, getTypeStr, TypedVar } from "./ast";
import { parseProgram } from './parser';
import { tcProgram } from './tc';

type Env = Map<string, boolean>;
type ClsEnv = Map<string, [ClsDef<Type>, number]>;
let wabtApi: any = null;
let selfVar = 0;
let selfVarMax = 0;
let for_label = 0;
let max_for_label = 0;
let leftParen = /(\()/g;
let rightParen = /(\))/g;



function addIndent(s: string, indent: number = 0): string {
  return "  ".repeat(indent) + s;
}

function addBlockIndent(block: string[], indent: number = 0): string[] {
  return block.map(s => {
    const newS = addIndent(s, indent);
    if (s.startsWith("(block") || s.startsWith("(func") || s.startsWith("(loop")) {
      indent += 1;
    } else if(s.startsWith(")")) {
      indent -= 1
    } 
    // else {
    //   indent += [...s.match(leftParen)].length - [...s.match(rightParen)].length;
    // }
    return newS
  })
}



function variableNames(vardefs: VarDef<Type>[]): string[] {
  const vars: Array<string> = [];
  const var_set = new Set();

  vardefs.forEach((vardef) => {
    if (!var_set.has(vardef.typedvar.name)) {
      vars.push(vardef.typedvar.name);
      var_set.add(vardef.typedvar.name);
    }
  });
  return vars;
}

function varsFunsStmts(p: Program<Type>): [string[], FunDef<Type>[], ClsDef<Type>[], Stmt<Type>[]] {
  return [variableNames(p.vardefs), p.fundefs, p.clsdefs, p.stmts];
}

export async function run(watSource: string, config: any): Promise<any> {
  if (wabtApi === null) {
    wabtApi = await wabt();
  }
  const parsed = wabtApi.parseWat("example", watSource);
  const binary = parsed.toBinary({});
  const wasmModule = await WebAssembly.instantiate(binary.buffer, config);
  return (wasmModule.instance.exports as any)._start();
}

export function opStmts(op: BinOp) {
  switch (op) {
    case "+": return [`(i32.add)`];
    case "-": return [`(i32.sub)`];
    case "*": return [`(i32.mul)`];
    case "//": return [`(i32.div_s)`];
    case "%": return [`(i32.rem_s)`];
    case ">": return [`(i32.gt_s)`];
    case "<": return [`(i32.lt_s)`];
    case ">=": return [`(i32.ge_s)`];
    case "<=": return [`(i32.le_s)`];
    case "==": return [`(i32.eq)`];
    case "!=": return [`(i32.ne)`];
    // case "and": return [`i32.and`];
    // case "or": return [`i32.or`];
    case "is": return [`i32.eq`];
    default:
      throw new Error(`Unhandled or unknown op: ${op}`);
  }
}

export function codeGenLit(lit: Literal<Type>): Array<string> {
  if (lit.tag === "number")
    return [`(i32.const ${lit.value})`];
  else if (lit.tag === "bool") {
    if (lit.value)
      return [`(i32.const 1)`];
    else
      return [`(i32.const 0)`];
  } else if (lit.tag === "none") {
    return [`(i32.const 0)`];  // none
  } else if (lit.tag === "string") {
    return codeGenStrLit(lit.value);  // none
  }
}

export function codeGenStrLit(value: string): string[] {
  const stmts: string[] = [];
  stmts.push(
    `(global.get $heap)`,
    `(i32.const ${value.length})`,
    `(i32.store)`
  );
  value.split("").slice().forEach((c, i) => {
    stmts.push(
      `(global.get $heap)`,
      `(i32.add (i32.mul (i32.const ${i + 1}) (i32.const 4)))`,
      `(i32.const ${c.charCodeAt(0)})`,
      `(i32.store)`,
    )
  });
  stmts.push(
    `(global.get $heap) ;; addr of str`,
    `(global.get $heap)`,
    `(i32.add (i32.mul (i32.const ${value.length + 1}) (i32.const 4)))`,
    `(global.set $heap)`
  );
  return stmts;
}


export function codeGenArgs(args: Expr<Type>[], locals: Env, clsEnv: ClsEnv): Array<string> {
  return args.map(arg => {
    if (arg.tag === "id") {
      if (locals.has(arg.name))
        return `(local.get $${arg.name})`;
      else
        return `(global.get $${arg.name})`;
    }
    else
      return codeGenExpr(arg, locals, clsEnv);
  }).flat();
}

export function codeGenMemberExpr(expr: MemberExpr<Type>, locals: Env, clsEnv: ClsEnv): Array<string> {
  const objStmt = codeGenExpr(expr.obj, locals, clsEnv);
  const [cls, tableIdx] = clsEnv.get(getTypeStr(expr.obj.a));

  objStmt.push(
    `(call $check_init)`,
    `(i32.add (i32.const ${cls.indexOfField.get(expr.field) * 4 + 4}))`
  );
  return objStmt;
}

export function codeGenExpr(expr: Expr<Type>, locals: Env, clsEnv: ClsEnv): Array<string> {
  switch (expr.tag) {
    case "literal":
      return codeGenLit(expr.value);
    case "id":
      // Since we type-checked for making sure all variable exist, here we
      // just check if it's a local variable and assume it is global if not
      if (locals.has(expr.name)) { 
        if (locals.get(expr.name)) {
          return [`(local.get $${expr.name})`, `(i32.load)`];
        }
        return [`(local.get $${expr.name})`];
       }
      else { return [`(global.get $${expr.name})`]; }
    case "binop": {
      const lhsExprs = codeGenExpr(expr.lhs, locals, clsEnv);
      const rhsExprs = codeGenExpr(expr.rhs, locals, clsEnv);
      let opstmts = opStmts(expr.op);
      if ((expr.lhs.a.tag === "list" || expr.lhs.a.tag === "string") && expr.op === "+") {
        opstmts = [`call $concat_list_string`];
      }
      return [...lhsExprs, ...rhsExprs, ...opstmts,];
    }
    case "unop":
      const unaryStmts = codeGenExpr(expr.expr, locals, clsEnv);
      switch (expr.op) {
        case "-": return ["(i32.const 0)", ...unaryStmts, "(i32.sub)"];
        case "not": return ["(i32.const 1)", ...unaryStmts, "(i32.sub)"];
      }
    case "call":
      var valStmts = codeGenArgs(expr.args, locals, clsEnv);
      let toCall = expr.name;
      if (clsEnv.has(expr.name)) { // this is an object constructor
        const initstmts: Array<string> = [];
        const [clsdef, tableIdx] = clsEnv.get(expr.name);
        initstmts.push(
          `(global.get $heap)`, 
          `(i32.const ${tableIdx})`,
          `(i32.store)`
        );
        clsdef.fields.map((f, i) => {
          let litStmt:string[];
          if (f.init.tag === "string") {
            litStmt = [`global.get $${clsdef.name}$${f.typedvar.name}`];
          } else {
            litStmt = codeGenLit(f.init);
          }
          initstmts.push(
            `(global.get $heap)`,
            `(i32.add (i32.const ${4 * i + 4}))`,
            ...litStmt,
            `(i32.store)`
          );
        });
        initstmts.push(
          `(global.get $heap) ;; return value of the object`, 
          `(global.get $heap) ;; the param self of __init__`, 
          `(global.get $heap)`,
          `(i32.add (i32.const ${clsdef.fields.length * 4 + 4}))`,
          `(global.set $heap)`,
        );
        let toCallIdx = clsdef.indexOfMethod.get("__init__");
        valStmts.push(
          `(i32.add (i32.const ${tableIdx}) (i32.const ${toCallIdx})) ;; get the index of the function in table`, 
          `(call_indirect (type ${clsdef.ptrOfMethod.get("__init__")}$type))`,
          `(local.set $scratch)`
        );
        return [...initstmts, ...valStmts];
      }
      if (expr.name === "print") {
        const arg = expr.args[0];
        switch (arg.a.tag) {
          case "bool": toCall = "print_bool"; break;
          case "int": toCall = "print_num"; break;
          case "none": toCall = "print_none"; break;
          case "string": toCall = "print_string"; break;
        }
        if (arg.tag === "id" && locals.get(arg.name))
          valStmts.push(`(i32.load)`);
      } else if (expr.name === "len") {
        valStmts.push(
          `(call $check_init)`,
          `(i32.load)`
        );
        return valStmts;
      }
      valStmts.push(`(call $${toCall})`);
      return valStmts;
    case "getfield":
      var fieldStmts = codeGenMemberExpr(expr, locals, clsEnv);
      fieldStmts.push(`(i32.load)`);
      return fieldStmts;
    case "method":
      const clsName = getTypeStr(expr.obj.a);
      const [cls, tableIdx] = clsEnv.get(clsName);
      const objStmt = codeGenExpr(expr.obj, locals, clsEnv);
      selfVar += 1;
      selfVarMax = selfVar > selfVarMax ? selfVar : selfVarMax;
      const argInstrs = codeGenArgs(expr.args, locals, clsEnv).flat();
      selfVar -= 1
      let toCallIdx = cls.indexOfMethod.get(expr.name);
      return [...objStmt, // self
        `(global.set $self${selfVar})`, 
        `(global.get $self${selfVar})`, 
        `(call $check_init)`,
        ...argInstrs, 
        `(global.get $self${selfVar})`, 
        `(i32.load) ;; vtable`, 
        `(i32.add (i32.const ${toCallIdx}))`, 
        `(call_indirect (type ${cls.ptrOfMethod.get(expr.name)}$type))`
      ];
    case "index": {
      const objStmts = codeGenExpr(expr.obj, locals, clsEnv);
      const idxStmts = codeGenExpr(expr.idx, locals, clsEnv);
      // now the type is list or string
      const indexStmts = [
        ...objStmts, ...idxStmts, `(call $get_${expr.obj.a.tag}_index)`
      ];
      return indexStmts;
    }

    case "array": {
      const eleStmt = expr.eles.slice().reverse().map((ele, i) => codeGenExpr(ele, locals, clsEnv)).flat();
      eleStmt.push(`(global.get $heap)`,
        `(i32.const ${expr.eles.length})`,
        `(i32.store)`);
      expr.eles.slice().reverse().forEach((ele, i) => {
        eleStmt.push(
          `(local.set $scratch)`,
          `(global.get $heap)`,
          `(i32.add (i32.mul (i32.const ${i + 1}) (i32.const 4)))`,
          `(local.get $scratch)`,
          `(i32.store)`
        )
      })
      eleStmt.push(
        `(global.get $heap) ;; addr of the list`,
        `(global.get $heap)`,
        `(i32.const ${expr.eles.length})`,
        `(i32.add (i32.const 1))`,
        `(i32.mul (i32.const 4))`,
        `(i32.add)`,
        `(global.set $heap)`,
      )
      return eleStmt;
    }
  }
}

export function codeGenCondBody(condbody: CondBody<Type>, locals: Env, clsEnv: ClsEnv, indent: number, tag = "if"): Array<string> {
  const cond = codeGenExpr(condbody.cond, locals, clsEnv).map(s => addIndent(s, indent));
  const body = condbody.body.map(s => codeGenStmt(s, locals, clsEnv, indent + 2)).flat();

  let stmt = [...cond,
    addIndent(`(if`, indent),
    addIndent(`(then`, indent + 1),
    ...body,
  ]
  if (tag === "elif") {
    stmt = stmt.concat([
      addIndent(`(br 1)`, indent + 2),
      addIndent(`)`, indent + 1),
      addIndent(`)`, indent)
    ]);
  }
  else if (tag === "while") {
    stmt = stmt.concat([
      addIndent(`(br 1)`, indent + 2),
      addIndent(`)`, indent + 1),
    ]);
  }
  else {
    stmt = stmt.concat([addIndent(`)`, indent + 1)]);
  }
  return stmt;
}


export function codeGenStmt(stmt: Stmt<Type>, locals: Env, clsEnv: ClsEnv, indent: number): Array<string> {
  switch (stmt.tag) {
    case "return":
      var valStmts = codeGenExpr(stmt.value, locals, clsEnv);
      valStmts.push("return");
      return valStmts.map(s => addIndent(s, indent));
    case "assign":
      var valStmts: Array<string> = codeGenExpr(stmt.value, locals, clsEnv);
      if (stmt.target.tag === "id") {
        if (locals.has(stmt.target.name)) { 
          if (locals.get(stmt.target.name)) {
            valStmts.unshift(`(local.get $${stmt.target.name})`);
            valStmts.push(`(i32.store)`); 
          }
          else
            valStmts.push(`(local.set $${stmt.target.name})`); 
        }
        else { valStmts.push(`(global.set $${stmt.target.name})`); }
      }
      else if (stmt.target.tag === "getfield") {
        var tarStmts = codeGenMemberExpr(stmt.target, locals, clsEnv);
        valStmts = tarStmts.concat(valStmts);
        valStmts.push(`(i32.store)`)
      }
      else {
        throw new Error("not implemented");
      }
      return valStmts.map(s => addIndent(s, indent));
    case "expr":
      const result = codeGenExpr(stmt.expr, locals, clsEnv);
      result.push("(local.set $scratch)");
      return result.map(s => addIndent(s, indent));
    case "pass":
      return [];
    case "if":
      const ifcondbody = codeGenCondBody(stmt.ifstmt, locals, clsEnv, indent).flat();
      const elifcondbody = stmt.elifstmt.map(p => codeGenCondBody(p, locals, clsEnv, indent + 2, "elif")).flat();
      const elsestmt = stmt.elsestmt.map(p => codeGenStmt(p, locals, clsEnv, indent + 2)).flat();
      if (elifcondbody.length !== 0 || elsestmt.length !== 0) 
        return [
          ...ifcondbody,
          addIndent(`(else`, indent + 1),
          ...elifcondbody,
          ...elsestmt,
          addIndent(`)`, indent + 1),
          addIndent(`)`, indent)
        ];
      return [...ifcondbody,
        addIndent(`)`, indent)
      ];
    case "while":
      const whilecondbody = codeGenCondBody(stmt.whilestmt, locals, clsEnv, indent + 2, "while");
      return [addIndent(`(block`, indent),
        addIndent(`(loop`, indent + 1),
        ...whilecondbody,
        addIndent(`)))`, indent)];
    case "for": {
      const arrExpr = codeGenExpr(stmt.iter, locals, clsEnv);
      const forLabel = for_label;
      for_label += 1;
      max_for_label = for_label > max_for_label ? for_label : max_for_label;
      const bodyStmts = stmt.body.map((s) => codeGenStmt(s, locals, clsEnv, indent)).flat();
      for_label -= 1
      const loopVarUpdate = (locals.has(stmt.loopVar.name)) ? `(local.set $${stmt.loopVar.name})` : `(global.set $${stmt.loopVar.name})`;
      const loadVal = [];
      if (stmt.iter.a.tag === "list") {
        loadVal.push(
          `(i32.add (i32.const 1) (global.get $ForLoopCnt${forLabel}))`,
          `(i32.mul (i32.const 4))`,
          `(i32.add (global.get $ForLoopIter${forLabel}))`,
          `(i32.load)`,
          loopVarUpdate);
      }
      if (stmt.iter.a.tag === "string") {
        loadVal.push(
          `(global.get $ForLoopIter${forLabel})`,
          `(global.get $ForLoopCnt${forLabel})`,
          `(call $get_string_index)`,
          loopVarUpdate);
      }
      return [...arrExpr,
      `(global.set $ForLoopIter${forLabel})`,
      `(global.get $ForLoopIter${forLabel})`,
        `(call $check_init)`,
        `(i32.load)`,
      `(global.set $ForLoopLen${forLabel})`,
      `(global.set $ForLoopCnt${forLabel} (i32.const 0))`,
        `(block`,
        `(loop`,
      `(i32.ge_s (global.get $ForLoopCnt${forLabel}) (global.get $ForLoopLen${forLabel}))`,
        `(br_if 1)`,
      ...loadVal,
      ...bodyStmts,
      `(global.set $ForLoopCnt${forLabel} (i32.add (global.get $ForLoopCnt${forLabel}) (i32.const 1)))`,
        `(br 0)`,
        `)`,
        `)`];
    }
    
  }
}

export function codeGenFun(f: FunDef<Type>, locals: Env, clsEnv: ClsEnv, indent: number, methodName: string = null): Array<string> {
  const withParamsAndVariables = new Map<string, boolean>(locals.entries());

  // Construct the environment for the function body
  /*
  |-------------------------------------------------------------------------------------------------------|
  | CodeGen    |    params:    |     vardef       |      params      |      params     |      global      |
  |            |   original    |     original     |   nonlocal decl  |   nonlocal use  |   use or decls   |
  |-------------------------------------------------------------------------------------------------------|
  | ref        |   undefined   |   undefined      |       True       |     False       |         /        | ref is whether this var is nonlocal
  | refed      |   true/false  |   True / False   |   True / False   |     False       |         /        | refed is whether this var is used in the nested function
  | in funcdef |     wrap if refed is true        |  already wrapped |   don't wrap    |         /        | wrap means putting the var in the heap and use load store to access it
  |            |    add in locals with refed      |         add in locals with ref     |   not in locals  | locals with T/F means whether the var is wrapped
  | use by id  | load if refed is true, else get  |       load       |      get        |    global.get    | => if true in locals, load; else get  
  | assign tar | store if refed is true, else set |       store      |       /         |    global.set    | => if true in locals, store; else set  
  | as arg     |                      directly local.get                               |    global.get    |  
  |-------------------------------------------------------------------------------------------------------|
 */
  const variables = variableNames(f.body.vardefs);
  f.body.vardefs.forEach(v => withParamsAndVariables.set(v.typedvar.name, v.typedvar.refed));
  f.params.forEach(p => {
    let flag = p.ref ? p.ref : p.refed;
    withParamsAndVariables.set(p.name, flag);
  });

  // Construct the code for params and variable declarations in the body
  let params = f.params.map(p => `(param $${p.name} i32)`).join(" ");
  const paramWrap = f.params.map(p => {
    const paramStmt = [];
    if (!p.ref && p.refed) {
      paramStmt.push(
        `(global.get $heap)`, 
        `(local.get $${p.name})`, 
        `(i32.store)`,
        `(global.get $heap) ;; addr of param ${p.name}`, 
        `(local.set $${p.name})`,
        `(global.get $heap)`, 
        `(i32.add (i32.const 4))`,
        `(global.set $heap)`, 
      )
    }
    return paramStmt.map(s => addIndent(s, indent + 1));
  }).flat().join("\n");

  const varDecls = f.body.vardefs.map(v => {
    return addIndent(`(local $${v.typedvar.name} i32)`, indent + 1)
  }).join("\n");

  const varAssign = f.body.vardefs.map(v => {
    if (v.init.tag === "string") {
      return [ 
        `(global.get $${f.name}$${v.typedvar.name})`,
        `(local.set $${v.typedvar.name})`
      ].map(s => addIndent(s, indent + 1)).join("\n");
    } else {
      return codeGenVars(v, withParamsAndVariables, indent + 1);
    }
  }).join("\n");

  const stmts = f.body.stmts.map(s => codeGenStmt(s, withParamsAndVariables, clsEnv, indent + 1)).flat();

  const stmtsBody = stmts.join("\n");
  const fname = methodName ? methodName : f.name;
  return [`(func $${fname} ${params} (result i32)`,
  addIndent(`(local $scratch i32)`, indent + 1),
  varDecls,
  paramWrap,
  varAssign,
  stmtsBody,
  addIndent(`(i32.const 0))`, indent + 1)].filter(s => s.length !== 0);
}

export function codeGenVars(v: VarDef<Type>, locals: Env, indent: number): string {
  var valStmts: Array<string> = codeGenLit(v.init).flat();
  if (locals.has(v.typedvar.name)) {
    if (v.typedvar.refed) {
      // put on the heap
      valStmts.unshift(`(global.get $heap)`)
      valStmts.push(
        `(i32.store)`,
        `(global.get $heap) ;; addr of the value`,
        `(global.get $heap)`,
        `(i32.add (i32.const 4))`,
        `(global.set $heap)`
      );
    }
    valStmts.push(`(local.set $${v.typedvar.name})`);
  }
  else { valStmts.push(`(global.set $${v.typedvar.name})`); }
  return valStmts.map(s => addIndent(s, indent)).join("\n");
}

export function codeGenCls(c: ClsDef<Type>, locals: Env, clsEnv: ClsEnv, indent: number): Array<string> {
  locals.set("self", true);
  const methods = c.methods.map(m => {
    if (c.indexOfMethod.has(m.name)) {
      return codeGenFun(m, locals, clsEnv, indent, `${c.name}$${m.name}`);
    } else { // a lifted nested function
      return codeGenFun(m, locals, clsEnv, indent);
    }
  }).flat();
  locals.delete("self");
  return methods.flat();
}

export function codeGenTable(classes: ClsDef<Type>[], clsEnv: ClsEnv, indent: number): Array<string> {
  let funcNums = 0
  const tableContents: string[] = [];
  const typeSigSet = new Set<string>();
  
  classes.forEach(c => {
    clsEnv.set(c.name, [c, funcNums]);
    funcNums += c.indexOfMethod.size;
    tableContents.push(addIndent(`;; start for class ${c.name}`, 1));
    c.ptrOfMethod.forEach((fullName, shortName) => {
      tableContents.push(addIndent(fullName, 1));
    });
  });
  
  classes.forEach(c => {
    c.methods.forEach(m => {
      if (!c.ptrOfMethod.has(m.name)) { // if not a method, a nested func
        return
      }
      const paramsStr = m.params.map(p => `(param i32)`).join(" ");
      const name = `${c.ptrOfMethod.get(m.name)}$type`;
      typeSigSet.add(`(type ${name} (func ${paramsStr} (result i32)))`)
    });
  });
  const typeSigStmts = Array.from(typeSigSet);

  const tableStmts = [
    ...typeSigStmts,
    `(table ${funcNums} funcref)`, 
    `(elem (i32.const 0)`,
    ...tableContents, 
    `)`
  ];

  return tableStmts.map(stmt => addIndent(stmt, indent));
}


export function codeGenAllGlobalVar(vars: string[], indent: number): string[] {
  const varSelf = [];
  for (let i = 0; i < selfVarMax; i++) {
    varSelf.push(`(global $self${i} (mut i32) (i32.const 0))`);
  }
  var varUser = vars.map(v => `(global $${v} (mut i32) (i32.const 0))`);
  const varHelper = []
  for (let i = 0; i < for_label; i++) {
    varHelper.push(
      `(global $ForLoopIter${i} (mut i32) (i32.const 0))`,
      `(global $ForLoopCnt${i} (mut i32) (i32.const 0))`,
      `(global $ForLoopLen${i} (mut i32) (i32.const 0))`
    );
  }
  return [...varSelf, ...varHelper, ...varUser].map(f => addIndent(f, indent));
}

export function compile(source: string): string {
  let ast = parseProgram(source);
  ast = tcProgram(ast);
  let basicIndent = 1;
  const emptyEnv = new Map<string, boolean>();
  const clsEnv = new Map<string, [ClsDef<Type>, number]>();
  const [vars, funs, classes, stmts] = varsFunsStmts(ast);
  // classes.map(c => clsEnv.set(c.name, c)); //move into table
  // ast.string.forEach(str => emptyEnv.set(str, true)); // Conflict with local nonlocal
  // const builtinCode = builtinGen(basicIndent).join("\n");
  const tableStmts = codeGenTable(classes, clsEnv, basicIndent).join("\n");
  const clsCode: string[] = classes.map(c => codeGenCls(c, emptyEnv, clsEnv, basicIndent)).map(f => f.join("\n"));
  const allCls = clsCode.join("\n\n");
  const funsCode: string[] = funs.map(f => codeGenFun(f, emptyEnv, clsEnv, basicIndent)).map(f => f.join("\n"));
  const allFuns = funsCode.join("\n\n");
  const varAssign = ast.vardefs.map(v => codeGenVars(v, emptyEnv, basicIndent + 1));
  const allStmts = stmts.map(s => codeGenStmt(s, emptyEnv, clsEnv, basicIndent + 1)).flat();
  const varDecls = codeGenAllGlobalVar(vars, basicIndent);
  const varCode = [
    // `(global $heap (mut i32) (i32.const 4))`,
    ...varDecls
  ].join("\n");
  const main = [`(local $scratch i32)`, ...varAssign, ...allStmts].join("\n");

  const lastStmt = ast.stmts[ast.stmts.length - 1];
  const isExpr = (lastStmt && lastStmt.tag === "expr");
  var retType = "";
  var retVal = "";
  if (isExpr) {
    retType = "(result i32)";
    retVal = "(local.get $scratch)"
  }

  return `(module
  (import "js" "memory" (memory $0 1))
  (import "js" "heap" (global $heap (mut i32)))
  (func $print_num (import "imports" "print_num") (param i32) (result i32))
  (func $print_bool (import "imports" "print_bool") (param i32) (result i32))
  (func $print_none (import "imports" "print_none") (param i32) (result i32))
  (func $print_string (import "imports" "print_string") (param i32) (result i32))
  (func $check_init (import "check" "check_init") (param i32) (result i32))
  (func $check_index (import "check" "check_index") (param i32) (param i32) (result i32))
  (func $concat_list_string (import "builtin" "$concat_list_string") (param i32) (param i32) (result i32))
  (func $get_string_index (import "builtin" "$get_string_index") (param i32) (param i32) (result i32))
  (func $get_list_index (import "builtin" "$get_list_index") (param i32) (param i32) (result i32))
  (func $abs(import "imports" "abs") (param i32) (result i32))
  (func $min(import "imports" "min") (param i32) (param i32) (result i32))
  (func $max(import "imports" "max") (param i32) (param i32) (result i32))
  (func $pow(import "imports" "pow") (param i32) (param i32) (result i32))
  ${tableStmts}
  ${varCode}
  ${allFuns}
  ${allCls}
  
  (func (export "_start") ${retType}
    ${main}
    ${retVal}
  )
) 
  `;
}
