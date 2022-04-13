import { CondBody, Expr, FuncBody, FunDef, Literal, Program, Stmt, Type, VarDef } from "./ast";
import { ParseError } from "./cli/error";

type FunctionsEnv = Map<string, [Type[], Type]>;
type BodyEnv = Map<string, Type>;

export function tcExpr(e: Expr<any>, functions: FunctionsEnv, 
  variables: BodyEnv, global: BodyEnv): Expr<Type> {
  switch (e.tag) {
    // case "number": return { ...e, a: "int" };
    // case "true": return { ...e, a: "bool" };
    // case "false": return { ...e, a: "bool" };
    case "literal":
      switch (e.value.tag) {
        case "number":
          return { ...e, a: "int" };
        case "bool":
          return { ...e, a: "bool" };
        case "none":
          return { ...e, a: "none" };
      }

    case "binop": {
      const nLHS = tcExpr(e.lhs, functions, variables, global);
      const nRHS = tcExpr(e.rhs, functions, variables, global);
      switch (e.op) {
        case "+":
        case "-":
        case "*":
        case "//":
        case "%":
          if (nLHS.a === "int" && nRHS.a === "int") {
            return { ...e, a: "int", lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHS.a}' and '${nRHS.a}'`);
          }
        case ">":
        case "<":
        case ">=":
        case "<=":
          if (nLHS.a === "int" && nRHS.a === "int") {
            return { ...e, a: "bool", lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHS.a}' and '${nRHS.a}'`);
          }
        case "==":
        case "!=":
          if (nLHS.a === nRHS.a) {
            return { ...e, a: "bool", lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHS.a}' and '${nRHS.a}'`);
          }
        // case "and": return { ...e, a: "bool" };
        // case "or": return { ...e, a: "bool" };
        case "is":
          // TODO: "is" operation is not complete yet
          if (nRHS.a != "none" || nLHS.a != "none") {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHS.a}' and '${nRHS.a}'`)
          }
          return { ...e, a: "bool", lhs: nLHS, rhs: nRHS };
        // default: throw new Error(`Unhandled op ${e.op}`);
      }
    }
    case "unop": {
      const nExpr = tcExpr(e.expr, functions, variables, global);
      switch (e.op) {
        case "-":
          if (nExpr.a === "int")
            return { ...e, a: "int", expr: nExpr };
          else
            throw new TypeError(`Cannot apply operator '${e.op}' on type '${nExpr.a}'`)
        case "not":
          if (nExpr.a === "bool")
            return { ...e, a: "bool", expr: nExpr };
          else
            throw new TypeError(`Cannot apply operator '${e.op}' on type '${nExpr.a}'`)
        // default: throw new Error(`Unhandled op ${e.op}`);
      }
    }
    case "id":
      if (variables.get(e.name))
        return { ...e, a: variables.get(e.name) };
      else if (global.get(e.name))
        return { ...e, a: global.get(e.name) };
      else
        throw new Error(`Not a variable: ${e.name}`);
    case "call":
      if (e.name === "print") {
        if (e.args.length !== 1)
          throw new Error("print expects a single argument");
        const newArgs = [tcExpr(e.args[0], functions, variables, global)];
        return { ...e, a: "none", args: newArgs };
      }
      if (!functions.has(e.name)) {
        throw new Error(`Not a function or class: ${e.name}`);
        // throw new Error(`function ${e.name} not found`);
      }

      const [args, ret] = functions.get(e.name);
      if (args.length !== e.args.length) {
        throw new Error(`Expected ${args.length} arguments; got ${e.args.length}`);
      }

      const newArgs = args.map((a, i) => {
        const argtyp = tcExpr(e.args[i], functions, variables, global);
        if (a !== argtyp.a) {
          throw new TypeError(`Expected ${a}; got type ${argtyp} in parameter ${i + 1}`);
        }
        return argtyp;
      });
      return { ...e, a: ret, args: newArgs };
  }
}

export function tcStmt(s: Stmt<any>, functions: FunctionsEnv,
  variables: BodyEnv, currentReturn: Type, global: BodyEnv): Stmt<Type> {
  switch (s.tag) {
    case "assign": {
      const rhs = tcExpr(s.value, functions, variables, global);
      if (s?.typ) {
        variables.set(s.name, rhs.a);
      }
      if (!variables.has(s.name)) {
        if (global.has(s.name))
          throw new Error(`Cannot assign variable that is not explicitly declared in this scope: ${s.name}`);
        else
          throw new Error(`Not a variable: ${s.name}`);
      }
      else if (variables.get(s.name) !== rhs.a) {
        throw new TypeError(`Expect type '${variables.get(s.name)}'; got type '${rhs.a}'`);
      }
      return { ...s, value: rhs };
    }
    case "expr": {
      const ret = tcExpr(s.expr, functions, variables, global);
      return { ...s, expr: ret };
    }
    case "return": {
      const valTyp = tcExpr(s.value, functions, variables, global);
      if (valTyp.a !== currentReturn) {
        throw new TypeError(`${valTyp} returned but ${currentReturn} expected.`);
      }
      return { ...s, value: valTyp };
    }
    case "pass": {
      return s;
    }
    case "if": {
      const ifstmt = tcCondBody(s.ifstmt, functions, variables, currentReturn, global);
      const elifstmt = s.elifstmt.map(p => tcCondBody(p, functions, variables, currentReturn, global));
      const elsestmt = s.elsestmt.map(p => tcStmt(p, functions, variables, currentReturn, global));
      return { ...s, ifstmt, elifstmt, elsestmt };
    }
    case "while": {
      const whilestmt = tcCondBody(s.whilestmt, functions, variables, currentReturn, global);
      return { ...s, whilestmt };
    }
  }
  return s;
}

export function tcCondBody(condbody: CondBody<any>, functions: FunctionsEnv,
  variables: BodyEnv, currentReturn: Type, global: BodyEnv): CondBody<Type> {
  const newCond = tcExpr(condbody.cond, functions, variables, global);
  const newBody = condbody.body.map(bs => tcStmt(bs, functions, variables, currentReturn, global));
  if (newCond.a !== "bool") {
    throw new TypeError(`Condition expression cannot be of type '${newCond.a}'`);
  }
  return { cond: newCond, body: newBody };
}

export function returnable(stmt: Stmt<Type>): boolean {
  if (stmt.tag === "return")
    return true;
  else if (stmt.tag === "if") {
    if (stmt.elsestmt.length === 0)
      return false;
    let res = stmt.ifstmt.body.some(returnable)
      && stmt.elsestmt.some(returnable)
      && stmt.elifstmt.map(condstmt => condstmt.body.some(returnable)).every(x => x)
    return res;
  }
  return false;
}

export function tcFunc(f: FunDef<any>, functions: FunctionsEnv, global: BodyEnv) {
  // const bodyvars = new Map<string, Type>(variables.entries());
  if (f.ret !== "none" && !f.body.stmts.some(returnable)) {
    throw new Error(`All path in this function/method ` +
      `must have a return statement: ${f.name}`);
  }
  let bodyvars = new Map<string, Type>();
  f.params.forEach(p => { bodyvars.set(p.name, p.typ) });
  const newvardefs = f.body.vardefs.map(v => tcVarDef(v, functions, bodyvars, global));
  // this is for adding the global variable
  // if we allow nested functions 
  // we will need to add an new scope of global env for the inside function
  // with new globel env = global + body vars(?)
  // decision making: if inside function could use the outside variables
  // variables.forEach((v, k) => {
  //   if (!bodyvars.has(k))
  //     bodyvars.set(k, v)
  // });
  const newStmts = f.body.stmts.map(bs => tcStmt(bs, functions, bodyvars, f.ret, global));
  return { ...f, body: { vardefs: newvardefs, stmts: newStmts } };
}

export function tcLit(lit: Literal<any>, functions: FunctionsEnv, local: BodyEnv): Literal<Type> {
  switch (lit.tag) {
    case "number":
      return { ...lit, a: "int" };
    case "bool":
      return { ...lit, a: "bool" };
    case "none":
      return { ...lit, a: "none" };
  }
}

export function tcVarDef(s: VarDef<any>, functions: FunctionsEnv,
  local: BodyEnv, global: BodyEnv = new Map<string, Type>()): VarDef<Type> {
  const rhs = tcLit(s.init, functions, local);
  if (local.has(s.typedvar.name)) {
    throw new Error(`Duplicate declaration of identifier in the same scope: ${s.typedvar.name}`);
  }
  else
    local.set(s.typedvar.name, s.typedvar.typ);
  if (local.get(s.typedvar.name) !== rhs.a) {
    throw new TypeError(`Expect type '${local.get(s.typedvar.name)}'; got type '${rhs.a}'`);
  }
  return { ...s, init: rhs };
}

export function tcProgram(p: Program<any>): Program<Type> {
  const functions = new Map<string, [Type[], Type]>();
  p.fundefs.forEach(s => {
    functions.set(s.name, [s.params.map(p => p.typ), s.ret]);
  });

  const globals = new Map<string, Type>();
  const vardefs = p.vardefs.map(s => tcVarDef(s, functions, globals));
  const fundefs = p.fundefs.map(s => tcFunc(s, functions, globals));

  const stmts = p.stmts.map(s => {
    const res = tcStmt(s, functions, globals, "none", new Map<string, Type>());
    return res;
  });
  return { vardefs, fundefs, stmts };
}