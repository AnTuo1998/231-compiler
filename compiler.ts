import wabt from 'wabt';
import {Stmt, Expr, Type, BinOp, CondBody} from './ast';
import {parseProgram} from './parser';
import { tcProgram } from './tc';
import { stringifyTree } from './test';

type Env = Map<string, boolean>;

function variableNames(stmts: Stmt<Type>[]) : string[] {
  const vars : Array<string> = [];
  const var_set = new Set();

  stmts.forEach((stmt) => {
    if (stmt.tag === "assign" && !var_set.has(stmt.name) && stmt?.typ) { 
      vars.push(stmt.name); 
      var_set.add(stmt.name);
    }
  });
  return vars;
}
function funs(stmts: Stmt<Type>[]) : Stmt<Type>[] {
  return stmts.filter(stmt => stmt.tag === "define");
}
function nonFuns(stmts: Stmt<Type>[]) : Stmt<Type>[] {
  return stmts.filter(stmt => stmt.tag !== "define");
}
function varsFunsStmts(stmts: Stmt<Type>[]) : [string[], Stmt<Type>[], Stmt<Type>[]] {
  return [variableNames(stmts), funs(stmts), nonFuns(stmts)];
}

export async function run(watSource : string, config: any) : Promise<number> {
  const wabtApi = await wabt();

  const parsed = wabtApi.parseWat("example", watSource);
  const binary = parsed.toBinary({});
  const wasmModule = await WebAssembly.instantiate(binary.buffer, config);
  return (wasmModule.instance.exports as any)._start();
}

export function opStmts(op : BinOp) {
  switch(op) {
    case "+": return [`i32.add`];
    case "-": return [`i32.sub`];
    case "*": return [`i32.mul`];
    case "//": return [`i32.div_s`];
    case "%": return [`i32.rem_s`];
    case ">": return [`i32.gt_s`];
    case "<": return [`i32.lt_s`];
    case ">=": return [`i32.ge_s`];
    case "<=": return [`i32.le_s`];
    case "==": return [`i32.eq`];
    case "!=": return [`i32.ne`];
    // case "and": return [`i32.and`];
    // case "or": return [`i32.or`];
    // TODO: case "is": return [`i32.and`];
    default:
      throw new Error(`Unhandled or unknown op: ${op}`);
  }
}

export function codeGenExpr(expr : Expr<Type>, locals : Env) : Array<string> {
  switch(expr.tag) {
    case "literal": 
      if (expr.value.tag === "number")
        return [`(i32.const ${expr.value.value})`];
      else if (expr.value.tag === "bool"){
        if (expr.value.value)
          return [`(i32.const 1)`];
        else
          return [`(i32.const 0)`];
      }
      else {
        // none
        return [`(i32.const 0)`];
      }
    // case "true": return [`(i32.const 1)`];
    // case "false": 
    case "id":
      // Since we type-checked for making sure all variable exist, here we
      // just check if it's a local variable and assume it is global if not
      if(locals.has(expr.name)) { return [`(local.get $${expr.name})`]; }
      else { return [`(global.get $${expr.name})`]; }
    case "binop": {
      const lhsExprs = codeGenExpr(expr.lhs, locals);
      const rhsExprs = codeGenExpr(expr.rhs, locals);
      const opstmts = opStmts(expr.op);
      return [...lhsExprs, ...rhsExprs, ...opstmts];
    }
    case "unop":
      const unaryStmts = codeGenExpr(expr.expr, locals);
      switch(expr.op) {
        case "-": return ["(i32.const 0)", ...unaryStmts, "(i32.sub)"];
        case "not": return ["(i32.const 1)", ...unaryStmts, "(i32.sub)"];
        // default:
        //   throw new Error(`Unhandled or unknown op: ${expr.op}`);
      }
    case "call":
      const valStmts = expr.args.map(e => codeGenExpr(e, locals)).flat();
      let toCall = expr.name;
      if(expr.name === "print") {
        switch(expr.args[0].a) {
          case "bool": toCall = "print_bool"; break;
          case "int": toCall = "print_num"; break;
          case "none": toCall = "print_none"; break;
        }
      }
      valStmts.push(`(call $${toCall})`);
      return valStmts;
  }
}


export function codeGenCondBody(condbody: CondBody<Type>, locals: Env, tag = "if"): Array<string> {
  const body = condbody.body.map(s => codeGenStmt(s, locals)).flat();
  const cond = codeGenExpr(condbody.cond, locals);
  // let stmt = cond.concat([`(if`, `(then`, ...body]);
  let stmt = [`
    ${cond.join("\n")}
    (if
    (then
      ${body.join("\n")}
  `];
  if (tag === "elif") {
    stmt = stmt.concat([`br 1`, `)`]);
  }
  stmt = stmt.concat([`)`]);
  return stmt;
}


export function codeGenStmt(stmt : Stmt<Type>, locals : Env) : Array<string> {
  switch(stmt.tag) {
    case "define":
      const withParamsAndVariables = new Map<string, boolean>(locals.entries());

      // Construct the environment for the function body
      const variables = variableNames(stmt.body);
      variables.forEach(v => withParamsAndVariables.set(v, true));
      stmt.params.forEach(p => withParamsAndVariables.set(p.name, true));

      // Construct the code for params and variable declarations in the body
      const params = stmt.params.map(p => `(param $${p.name} i32)`).join(" ");
      const varDecls = variables.map(v => `(local $${v} i32)`).join("\n");

      const stmts = stmt.body.map(s => codeGenStmt(s, withParamsAndVariables)).flat();
      const stmtsBody = stmts.join("\n");
      return [`(func $${stmt.name} ${params} (result i32)
        (local $scratch i32)
        ${varDecls}
        ${stmtsBody}
        (i32.const 0))`];
    case "return":
      var valStmts = codeGenExpr(stmt.value, locals);
      valStmts.push("return");
      return valStmts;
    case "assign":
      var valStmts: Array<string> = [];
      // if (stmt?.ret) { // declare
      //   locals.set(stmt.name, true);
      //   valStmts.push(`(local $${stmt.name} i32)`);
      // }
      valStmts = valStmts.concat(codeGenExpr(stmt.value, locals));
      if(locals.has(stmt.name)) { valStmts.push(`(local.set $${stmt.name})`); }
      else { valStmts.push(`(global.set $${stmt.name})`); }
      return valStmts;
    case "expr":
      const result = codeGenExpr(stmt.expr, locals);
      result.push("(local.set $scratch)");
      return result;
    case "pass":
      return [];
    case "if":
      const ifcondbody = codeGenCondBody(stmt.ifstmt, locals);
      const elifcondbody = stmt.elifstmt.map(p => codeGenCondBody(p, locals, "elif")).flat();
      const elsestmt = stmt.elsestmt.map(p => codeGenStmt(p, locals)).flat();
      // console.log([...ifcondbody, `(else`, ...elifcondbody, ...elsestmt, `br 0`, `)`]);
      return [...ifcondbody, `(else`, ...elifcondbody, ...elsestmt, `br 0`, `)`, `)`];
    case "while":
      let cond = codeGenExpr(stmt.whilestmt.cond, locals).join("\n");
      const body = stmt.whilestmt.body.map(s => codeGenStmt(s, locals)).flat().join("\n");
      return [`(block
        (loop
          ${cond}
          (if
            (then
              ${body}
              br 1
            )
            (else
              br 2
            )
          )
        )
      )`];
  }
}

export function compile(source : string) : string {
  let ast = parseProgram(source);
  ast = tcProgram(ast);
  const emptyEnv = new Map<string, boolean>();
  const [vars, funs, stmts] = varsFunsStmts(ast);
  const funsCode : string[] = funs.map(f => codeGenStmt(f, emptyEnv)).map(f => f.join("\n"));
  const allFuns = funsCode.join("\n\n");
  const varDecls = vars.map(v => `(global $${v} (mut i32) (i32.const 0))`).join("\n");

  const allStmts = stmts.map(s => codeGenStmt(s, emptyEnv)).flat();

  const main = [`(local $scratch i32)`, ...allStmts].join("\n");

  const lastStmt = ast[ast.length - 1];
  const isExpr = lastStmt.tag === "expr";
  var retType = "";
  var retVal = "";
  if(isExpr) {
    retType = "(result i32)";
    retVal = "(local.get $scratch)"
  }

  return `
    (module
      (func $print_num (import "imports" "print_num") (param i32) (result i32))
      (func $print_bool (import "imports" "print_bool") (param i32) (result i32))
      (func $print_none (import "imports" "print_none") (param i32) (result i32))
      ${varDecls}
      ${allFuns}
      (func (export "_start") ${retType}
        ${main}
        ${retVal}
      )
    ) 
  `;
}
