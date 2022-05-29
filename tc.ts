/* 
The type checker uses an array of BodyEnv as different level of scopes,
making it easier(?) to add keywords like global and nonlocal
This idea is borrowed from my classmate, Shanbin Ke.
*/
import { ClsDef, CondBody, Expr, FunDef, Literal, MemberExpr, Program, Stmt, Type, VarDef, ObjType, TypedVar, ScopeVar, IdVar, IndexExpr, isIndexable, isIterable, isObject, isSimpleType, LValue } from "./ast";
import { isTypeEqual, isCls, getTypeStr, isAssignable } from "./ast"
import { TypeError } from "./error"

type FunctionsEnv = Env<OneFun<Type>>;
type BodyEnv = Env<OneVar<Type>>;
// type Class
type ClassEnv = Env<OneClass<Type>>;

export enum SearchScope {
  LOCAL = -1,
  GLOBAL = 0,
  NONLOCAL = 1,
  LOCAL_AND_GLOBAL = 2,
  ALL = 3
};
class Env<T> {
  decls: Map<string, T | undefined>[];
  constructor() {
    this.decls = [];
    this.addScope();
  }

  addScope() {
    this.decls.push(new Map<string, T>());
  }

  removeScope() {
    return this.decls.pop();
  }

  getCurScope() {
    return this.decls[this.decls.length - 1];
  }

  addDecl(id: string, value: T | undefined) {
    this.getCurScope().set(id, value);
  }

  lookUpVar(id: string, scope: SearchScope = SearchScope.LOCAL): [boolean, T | undefined] {
    // scope: 3 - search all scopes
    //        0 - search globally (only the global vars)
    //        1 - NONLOCAL
    //        2 - LOCAL_AND_GLOBAL
    //       -1 - search locally (only the last scope, current scope)
    // return: True - found, Type: type for id
    //         False - not found, Type: undefined
    let start: number = this.decls.length - 1;
    let end: number = 0;
    if (scope === SearchScope.GLOBAL) {
      start = 0;
    } else if (scope === SearchScope.LOCAL) {
      end = this.decls.length - 1;
    } else if (scope === SearchScope.NONLOCAL) {
      if (this.decls.length < 3)
        return [false, undefined];
      start = this.decls.length - 2;
      end = 1;
    } else if (scope === SearchScope.LOCAL_AND_GLOBAL) {
      // The order matters first local then global
      if (this.decls[start].has(id))
        return [true, this.decls[start].get(id)];
      if (this.decls[0].has(id))
        return [true, this.decls[0].get(id)];
      return [false, undefined];
    }
    for (let i = start; i >= end; i--) {
      if (this.decls[i].has(id))
        return [true, this.decls[i].get(id)];
    }
    return [false, undefined];
  }
}

class OneVar<T> {
  typ: T;
  ref?: boolean;
  constructor(typ: T, ref:boolean = undefined) {
    this.typ = typ;
    this.ref = ref;
  }
}
class OneClass<T> {
  vars: Map<string, OneVar<T>>;
  funs: Map<string, OneFun<T>>;
  super: ObjType = null;
  constructor() {
    this.vars = new Map<string, OneVar<T>>();
    this.funs = new Map<string, OneFun<T>>();
    this.super = null;
  }
}

class OneFun<T> {
  name: string;
  params: T[];
  ret: T;
  nonlocal: TypedVar[];
  constructor(name: string, params: T[], ret: T, nonlocal: TypedVar[] = null) {
    this.name = name;
    this.params = params;
    this.ret = ret;
    this.nonlocal = nonlocal;
  }
}

const globalStrs = new Map<string, VarDef<Type>>();

export function isRefType(maybeTyp: OneVar<Type>): boolean {
  return maybeTyp.ref !== undefined;
}

function isSubClass(superCls: Type, subCls: Type, classes: ClassEnv): boolean {
  if (!isCls(superCls) || !isCls(subCls)) {
    // sanity check
    // throw new Error("not a class type");
    return false;
  }
  while (subCls.class !== "object") {
    const [found, clsEnv] = classes.lookUpVar(getTypeStr(subCls));
    if (isTypeEqual(superCls, clsEnv.super)) {
      return true;
    }
    subCls = clsEnv.super;
  } 
  return false;
}

export function unionListType(typ1: Type, typ2: Type, classes: ClassEnv): Type {
  if (isTypeEqual(typ1, typ2)) {
    return typ1;
  } else if (assignable(typ1, typ2, classes)) {
    return typ1;
  } else if (assignable(typ2, typ1, classes)) {
    return typ2;
  } 
  return { tag: "object", class: "object" }
}

export function tcLit(lit: Literal<any>): Literal<Type> {
  switch (lit.tag) {
    case "number":
      return { ...lit, a: { tag: "int" } };
    case "bool":
    case "none":
    case "string":
      return { ...lit, a: { tag: lit.tag } };
  }
}

export function tcArgs(args: Expr<any>[], funcInfo: OneFun<Type>, 
  variables: BodyEnv, functions: FunctionsEnv, classes: ClassEnv, 
  isMethod: boolean = false): Expr<Type>[] {
  const paramLen: number = funcInfo.params.length;
  const additionParamLen: number = funcInfo.nonlocal.length;
  const selfMask: number = Number(isMethod);
  if (paramLen - additionParamLen !== args.length + selfMask) {
    throw new Error(`Expected ${paramLen - additionParamLen - selfMask} arguments; got ${args.length}`);
  }

  let newArgs = args.map((a, i) => {
    const argtyp = tcExpr(a, variables, functions, classes);
    if (!assignable(funcInfo.params[i + selfMask], argtyp.a, classes)) {
      throw new TypeError(`Expected ${getTypeStr(funcInfo.params[i + selfMask])}; ` +
      `got type ${getTypeStr(argtyp.a)} in parameter ${i + 1}`);
    }
    return argtyp;
  });
  newArgs = newArgs.concat(funcInfo.nonlocal.map(nl => {
    return { a: nl.typ, tag: "id", name: nl.name };
  }));
  return newArgs;
}

export function tcIdVar(e: IdVar<any>, variables: BodyEnv, functions: FunctionsEnv, classes: ClassEnv): IdVar<Type> {
  var [found, varInfo] = variables.lookUpVar(e.name, SearchScope.LOCAL_AND_GLOBAL);
  if (found) {
    return { ...e, a: varInfo.typ };
  }
  var [found, varInfo] = variables.lookUpVar(e.name, SearchScope.NONLOCAL);
  if (!found) {
    throw new ReferenceError(`Not a variable: ${e.name}`);
  }
  variables.addDecl(e.name, { ...varInfo, ref: false });
  return { ...e, a: varInfo.typ };
}

export function tcExpr(e: Expr<any>, variables: BodyEnv, functions: FunctionsEnv, classes: ClassEnv): Expr<Type> {
  switch (e.tag) {
    case "literal":
      const lit = tcLit(e.value);
      return { ...e, value: lit, a: lit.a };

    case "binop": {
      const nLHS = tcExpr(e.lhs, variables, functions, classes);
      const nRHS = tcExpr(e.rhs, variables, functions, classes);
      const nLHStyp = getTypeStr(nLHS.a);
      const nRHStyp = getTypeStr(nRHS.a);
      switch (e.op) {
        case "+":
          if (nLHStyp === "string" && nRHStyp === "string") {
            return { ...e, a: { tag: "string" }, lhs: nLHS, rhs: nRHS };
          } else if (nLHS.a.tag === "list" && nRHS.a.tag === "list") {
            // chocopy can concat any two inited lists with return type list[object]
            const newTyp = unionListType(nLHS.a.type, nRHS.a.type, classes);
            return { ...e, a: { tag: "list", type: newTyp}, lhs: nLHS, rhs: nRHS };
          }
        case "-":
        case "*":
        case "//":
        case "%":
          if (nLHStyp === "int" && nRHStyp === "int") {
            return { ...e, a: { tag: "int" }, lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHStyp}' and '${nRHStyp}'`);
          }
        case ">":
        case "<":
        case ">=":
        case "<=":
          if (nLHStyp === "int" && nRHStyp === "int") {
            return { ...e, a: { tag: "bool" }, lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHStyp}' and '${nRHStyp}'`);
          }
        case "==":
        case "!=":
          if (nLHStyp === nRHStyp && !isCls(nLHS.a)) {
            return { ...e, a: { tag: "bool" }, lhs: nLHS, rhs: nRHS };
          }
          else {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHStyp}' and '${nRHStyp}'`);
          }
        // case "and": return { ...e, a: "bool" };
        // case "or": return { ...e, a: "bool" };
        case "is":
          if ((!isObject(nLHS.a) && nLHS.a.tag !== "none") || (!isObject(nRHS.a) && nRHS.a.tag !== "none")) {
            throw new TypeError(`Cannot apply operator '${e.op}' on types '${nLHStyp}' and '${nRHStyp}'`)
          }
          return { ...e, a: { tag: "bool" }, lhs: nLHS, rhs: nRHS };
      }
    }
    case "unop": {
      const nExpr = tcExpr(e.expr, variables, functions, classes);
      const typstr = getTypeStr(nExpr.a);
      switch (e.op) {
        case "-":
          if (typstr === "int")
            return { ...e, a: { tag: "int" }, expr: nExpr };
          else
            throw new TypeError(`Cannot apply operator '${e.op}' on type '${typstr}'`);
        case "not":
          if (typstr === "bool")
            return { ...e, a: { tag: "bool" }, expr: nExpr };
          else
            throw new TypeError(`Cannot apply operator '${e.op}' on type '${typstr}'`);
        // default: throw new Error(`Unhandled op ${e.op}`);
      }
    }
    case "id":
      return tcIdVar(e, variables, functions, classes);
    case "call":{
      let newArgs: Expr<Type>[] = [];
      if (e.name === "print") {
        if (e.args.length !== 1)
          throw new Error("print expects a single argument");
        newArgs = [tcExpr(e.args[0], variables, functions, classes)];
        return { ...e, a: { tag: "none" }, args: newArgs };
      } else if (e.name === "len") {
        if (e.args.length !== 1)
          throw new Error("len expects a single argument");
        const newArgs = tcExpr(e.args[0], variables, functions, classes);
        if (newArgs.a.tag !== "list" && newArgs.a.tag !== "string") {
          // Chocopy do not type check this argument
          throw new TypeError(`Cannot call len on type ${getTypeStr(newArgs.a)}`);
        }
        return { ...e, a: { tag: "int" }, args: [newArgs] };
      }
      var [found, cls] = classes.lookUpVar(e.name, SearchScope.GLOBAL);
      if (found) {
        if (cls.funs.has("__init__")) {
          var initMethodInfo = cls.funs.get("__init__");
          newArgs = tcArgs(e.args, initMethodInfo, variables, functions, classes, true);
          return { ...e, a: { tag: "object", class: e.name }, args: newArgs };
        } else {
          return { ...e, a: { tag: "object", class: e.name } };
        }
      }      
      var [found, funcInfo] = functions.lookUpVar(e.name, SearchScope.LOCAL_AND_GLOBAL);
      // a call can only be 
      // (1) calling nested function define inside this function 
      // (2) calling global functions
      if (!found) {
        throw new Error(`Not a function or class: ${e.name}`);
      }
      newArgs = tcArgs(e.args, funcInfo, variables, functions, classes);
      return { ...e, a: funcInfo.ret, name: funcInfo.name, args: newArgs };
    }
    case "getfield":
      return tcMemberExpr(e, variables, functions, classes);
    case "method":
      const newObj = tcExpr(e.obj, variables, functions, classes);
      const typStr = getTypeStr(newObj.a);
      if (!isCls(newObj.a)) {
        throw new Error(`There is no method named ${e.name} in class ${typStr}`);
      }
      var [found, cls] = classes.lookUpVar(typStr, SearchScope.GLOBAL);
      if (!found) {
        throw new Error("Should not happened");
      }
      if (!cls.funs.has(e.name)) {
        throw new Error(`There is no method named ${e.name} in class ${typStr}`);
      }
      const methodInfo = cls.funs.get(e.name);
      let newArgs = tcArgs(e.args, methodInfo, variables, functions, classes, true);
      return { ...e, obj: newObj, args: newArgs, a: methodInfo.ret };
    case "index": 
      return tcIndexExpr(e, variables, functions, classes); 
    case "array": {
      const newEles = e.eles.map(ele => tcExpr(ele, variables, functions, classes));
      var typ: Type;
      if (newEles.length === 0) {
        typ = { tag: "list", type: null };
      } else {
        let generalType = newEles[0].a;
        newEles.forEach(ele => {
          let curType = ele.a;
          generalType = unionListType(generalType, curType, classes);
        })
        typ = { tag: "list", type: generalType }
      }

      return { ...e, a: typ, eles: newEles }
    } 
  }
}

function assignable(src: Type, tar: Type, classes: ClassEnv):boolean {
  // if the type tar can be assigned to original type src 
  if (isAssignable(src, tar)) {
    return true;
  } else if (isCls(src) && isCls(tar)) {
    return isSubClass(src, tar, classes);
  }
  return false;
}


export function tcMemberExpr(e: MemberExpr<any>, variables: BodyEnv, functions: FunctionsEnv, classes: ClassEnv): MemberExpr<Type> {
  const obj = tcExpr(e.obj, variables, functions, classes);
  const typStr = getTypeStr(obj.a);
  if (!isCls(obj.a)) {
    throw new Error(`There is no attribute named ${e.field} in class ${typStr}`);
  }
  
  const [found, cls] = classes.lookUpVar(getTypeStr(obj.a), SearchScope.GLOBAL);
  if (!found) {
    throw new Error(`Invalid type annotation; there is no class named: ${typStr}`);
  }
  if (!cls.vars.has(e.field)) {
    throw new Error(`There is no attribute named ${e.field} in class ${typStr}`);
  }
  return { ...e, a: cls.vars.get(e.field).typ, obj };
}

export function tcIndexExpr(e: IndexExpr<any>, variables: BodyEnv, functions: FunctionsEnv, classes: ClassEnv): IndexExpr<Type> {
  const newObj = tcExpr(e.obj, variables, functions, classes);
  if (!isIndexable(newObj.a)) {
    throw new TypeError(`Cannot index into type ${getTypeStr(newObj.a)}`)
  }
  const newIdx = tcExpr(e.idx, variables, functions, classes);
  if (newIdx.a.tag !== "int") {
    throw new TypeError(`Index is of non-integer type ${getTypeStr(newIdx.a)}`)
  }
  if (newObj.a.tag === "string") {
    return { ...e, obj: newObj, idx: newIdx, a: newObj.a };
  }
  else if (newObj.a.tag === "list") {
    return { ...e, obj: newObj, idx: newIdx, a: newObj.a.type }
  }
}

export function tcStmt(s: Stmt<any>, variables: BodyEnv, 
  functions: FunctionsEnv, classes: ClassEnv, currentReturn: Type): Stmt<Type> {
  switch (s.tag) {
    case "assign": {
      const rhs = tcExpr(s.value, variables, functions, classes);
      let target: LValue<Type>;
      if (s.target.tag === "id"){
        const [found, varInfo] = variables.lookUpVar(s.target.name, SearchScope.LOCAL);
        if (!found) {
          const [allFound] = variables.lookUpVar(s.target.name, SearchScope.ALL); // all scopes
          if (allFound)
            throw new Error(`Cannot assign variable that is not explicitly ` +
              `declared in this scope: ${s.target.name}`);
          else
            throw new ReferenceError(`Not a variable: ${s.target}`);
        } else if (isRefType(varInfo) && !varInfo.ref) {
            throw new Error(`Cannot assign variable that is not explicitly ` +
              `declared in this scope: ${s.target.name}`);
        }
        target = { ...s.target, a: varInfo.typ };
      } else if (s.target.tag === "getfield") {
        target = tcMemberExpr(s.target, variables, functions, classes);
      } else if (s.target.tag === "index") {
        target = tcIndexExpr(s.target, variables, functions, classes);
        if (target.obj.a.tag === "string") {
          throw new TypeError(`str is not a list type`);
        }
      } else {
        throw new Error("not implemented");
      } 
      if (!assignable(target.a, rhs.a, classes)) {
        throw new TypeError(`Expect type '${getTypeStr(target.a)}'; got type '${getTypeStr(rhs.a)}'`);
      }
      return { ...s, target, value: rhs };
    }
    case "expr": {
      const ret = tcExpr(s.expr, variables, functions, classes);
      return { ...s, expr: ret };
    }
    case "return": {
      const valTyp = tcExpr(s.value, variables, functions, classes);
      if (!assignable(currentReturn, valTyp.a, classes)) {
        throw new TypeError(`${getTypeStr(valTyp.a)} returned but ${getTypeStr(currentReturn)} expected.`);
      }
      return { ...s, value: valTyp };
    }
    case "pass": {
      return s;
    }
    case "if": {
      const ifstmt = tcCondBody(s.ifstmt, variables, functions, classes, currentReturn);
      const elifstmt = s.elifstmt.map(p => tcCondBody(p, variables, functions, classes, currentReturn));
      const elsestmt = s.elsestmt.map(p => tcStmt(p, variables, functions, classes, currentReturn));
      return { ...s, ifstmt, elifstmt, elsestmt };
    }
    case "while": {
      const whilestmt = tcCondBody(s.whilestmt, variables, functions, classes, currentReturn);
      return { ...s, whilestmt };
    }
    case "for": {
      const newCnt = tcIdVar(s.loopVar, variables, functions, classes);
      const newIter = tcExpr(s.iter, variables, functions, classes);
      if (!isIterable(newIter.a)) {
        throw new TypeError(`Cannot iterate over value of type ${getTypeStr(newCnt.a)}`);
      }
      // TODO: should compare to newArray.a.type
      if ((newIter.a.tag === "list" && !isAssignable(newCnt.a, newIter.a.type)) ||
        (newIter.a.tag === "string" && !isAssignable(newCnt.a, newIter.a))) {
        throw new TypeError(`Expected type ${getTypeStr(newCnt.a)} but got type ${getTypeStr(newIter.a)}`);
      }
      const newBody = s.body.map(stmt => tcStmt(stmt, variables, functions, classes, currentReturn));
      return { ...s, loopVar: newCnt, iter: newIter, body: newBody };
    }
  }
}

export function tcCondBody(condbody: CondBody<any>, variables: BodyEnv, 
  functions: FunctionsEnv, classes: ClassEnv,
  currentReturn: Type): CondBody<Type> {
  const newCond = tcExpr(condbody.cond, variables, functions, classes);
  const newBody = condbody.body.map(bs => tcStmt(bs, variables, functions, classes, currentReturn));
  if (newCond.a.tag !== "bool") {
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
      && stmt.elifstmt.map(condstmt =>
        condstmt.body.some(returnable)).every(x => x)
    return res;
  }
  return false;
}

export function tcNestedFuncDef(f: FunDef<any>, variables: BodyEnv,
  functions: FunctionsEnv, classes: ClassEnv, namePrefix: string): FunDef<Type>[] {
  if (f.ret.tag !== "none" && !f.body.stmts.some(returnable)) {
    throw new TypeError(`All path in this function/method ` +
      `must have a return statement: ${f.name}`);
  }
  // const newName = `${namePrefix}$${f.name}`;
  const newName = namePrefix + f.name;
  variables.addScope();
  functions.addScope();
  f.params.forEach(p => { variables.addDecl(p.name, { typ: p.typ }) });
  f.body.decls.forEach(d => {
    let [found, typ] = variables.lookUpVar(d.name, SearchScope.GLOBAL);
    // if ((!found && !d.nonlocal) || (found && d.nonlocal)) {
    if (found === d.nonlocal) {
      throw new Error(`not a ${d.nonlocal ? "nonlocal" : "global"} variable: ${d.name}`);
    }
    if (d.nonlocal) {
      [found, typ] = variables.lookUpVar(d.name, SearchScope.NONLOCAL);
      if (!found) {
        throw new Error(`not a nonlocal variable: ${d.name}`);
      }
    }
    let newTyp: OneVar<Type> = typ ;
    if (d.nonlocal) { // global no change
      newTyp = { ...typ, ref: true };
    }
    variables.addDecl(d.name, newTyp);
  }) 
  const newVarDefs = f.body.vardefs.map(v => tcVarDef(v, variables, classes, newName+"$"));
  const newFunDefs: FunDef<Type>[] = f.body.fundefs.map(nestF => 
    tcNestedFuncDef(nestF, variables, functions, classes, newName+"$")).flat();
  const newStmts = f.body.stmts.map(bs => tcStmt(bs, variables, functions, classes, f.ret));
  const nonlocalVars: TypedVar[] = [];
  variables.getCurScope().forEach((typ, v) => {
    if (isRefType(typ)) {
      nonlocalVars.push({ name:v, ...typ });
      f.params.push({name:v, ...typ });
    }
  });
  newVarDefs.forEach(v => {
    let refed = false;
    functions.getCurScope().forEach((nestFinfo, nf) => {
      nestFinfo.nonlocal.forEach((nonlocalvar => {
        if (nonlocalvar.name === v.typedvar.name)
          refed ||= nonlocalvar.ref;
      }));
    });
    v.typedvar.refed = refed;
    // v.typedvar.typ = { ...v.typedvar.typ, refed };
  });
  f.params.forEach(p => {
    let refed = false;
    functions.getCurScope().forEach((nestFinfo, nf) => {
      nestFinfo.nonlocal.forEach((nonlocalvar => {
        if (nonlocalvar.name === p.name)
          refed ||= nonlocalvar.ref;
      }));
    });
    p.refed =  refed;
  });
  variables.removeScope();
  functions.removeScope();
  
  functions.addDecl(f.name, 
    new OneFun<Type>(newName, 
      f.params.map(p => p.typ), 
      f.ret, nonlocalVars));
  nonlocalVars.forEach(v => {
    const [found] = variables.lookUpVar(v.name, SearchScope.LOCAL);
    if (!found)
      variables.addDecl(v.name, { typ: v.typ, ref: v.ref} );
  }); // update the upper var scope, incase there are some nonlocal vars from upper upper scope
  newFunDefs.push({ ...f, name: newName, body: { vardefs: newVarDefs, stmts: newStmts } });
  return newFunDefs;
}

export function tcFuncDef(f: FunDef<any>, variables: BodyEnv, 
  functions: FunctionsEnv, classes: ClassEnv, namePrefix: string = ""): FunDef<Type>[] {
  /*
  |-----------------------------------------------------------------------------------------------------------|
  | TC          |  params  |    var    |    nonlocal   |  global    |    global     |        nonlocal         |
  |             |          | local def |     decl      |   decl     |      use      |          use            |
  |-----------------------------------------------------------------------------------------------------------|
  | tcFunc      |   add to var scope   |      add to var scope      |        /      |            /            |
  | init        |  with no ref (undef) |   ref = True  |   no ref   |       /       |            /            |
  |-----------------------------------------------------------------------------------------------------------|
  | "id"        |  LOCAL search, True  |     LOCAL search, true     | GLOBAL search |     NONLOCAL search     |
  |             |  return  |  return   |    return     |   return   |    return     |  add to var ref = False |
  |-----------------------------------------------------------------------------------------------------------|
  | ass tar     |    ok    |    ok     |      ok       |    ok      |    error      |          error          |
  |             |            if LOCAL search true and (no ref or ref=True), ok else error                     |
  |-----------------------------------------------------------------------------------------------------------|
  | compute func|   not    |    not    | add to param  |   not      |      not      |      add to param       |
  |   nonlocal  |          |           | info.nonlocal |            |               |      info.nonlocal      |
  |-----------------------------------------------------------------------------------------------------------|
  */
  if (f.ret.tag !== "none" && !f.body.stmts.some(returnable)) {
    throw new TypeError(`All path in this function/method ` +
      `must have a return statement: ${f.name}`);
  }
  let newName = namePrefix + f.name;
  variables.addScope();
  functions.addScope();
  f.params.forEach(p => { variables.addDecl(p.name, { typ: p.typ })});
  f.body.decls.forEach(d => {
    if (d.nonlocal) {
      // no nonlocal vars in the outide function
      throw new Error(`not a nonlocal variable: ${d.name}`);
    }
    const [found, typ] = variables.lookUpVar(d.name, Number(d.nonlocal));
    if (!found) {
      throw new Error(`not a global variable: ${d.name}`);
    }
    // only global allowed, no type change, no ref in typ.
    variables.addDecl(d.name, typ );
  })
  const newVarDefs = f.body.vardefs.map(v => tcVarDef(v, variables, classes, newName + "$"));
  const newFunDefs: FunDef<Type>[] = f.body.fundefs.map(nestF => 
    tcNestedFuncDef(nestF, variables, functions, classes, newName + "$")).flat();
  const newStmts = f.body.stmts.map(bs => tcStmt(bs, variables, functions, classes, f.ret));
  newVarDefs.forEach(v => {
    let refed = false;
    functions.getCurScope().forEach((nestFinfo, nf) => {
      nestFinfo.nonlocal.forEach((nonlocalvar => {
        if (nonlocalvar.name === v.typedvar.name)
          refed ||= nonlocalvar.ref;
      }));
    });
    v.typedvar.refed = refed;
  });
  f.params.forEach(p => {
    let refed = false;
    functions.getCurScope().forEach((nestFinfo, nf) => {
      nestFinfo.nonlocal.forEach((nonlocalvar => {
        if (nonlocalvar.name === p.name)
          refed ||= nonlocalvar.ref;
      }));
    });
    p.refed = refed;
  });
  
  variables.removeScope();
  functions.removeScope();
  newFunDefs.push({ ...f, body: { vardefs: newVarDefs, stmts: newStmts } });
  return newFunDefs;
}

export function tcClsDef(c: ClsDef<any>, variables: BodyEnv, 
  functions: FunctionsEnv, classes: ClassEnv): ClsDef<Type> {
  // clsdef has already set indexOfField, indexOfMethod and ptrOfMethod
  const [found, superClsEnv] = classes.lookUpVar(c.super, SearchScope.GLOBAL);
  // if (!found) {
  //   // should not report, already checked
  //   throw new Error(`Super class not defined: ${c.super}`);
  // }
  // the class name must be unique, which is guaranteed in parser
  variables.addScope();
  functions.addScope();
  classes.addDecl(c.name, {
    vars: variables.getCurScope(),
    funs: functions.getCurScope(),
    super: { tag: "object", class: c.super }
  });
  // variables.addDecl("self",{ tag: "object", class: c.name } );
  variables.addDecl("self", new OneVar<Type>({ tag: "object", class: c.name }));

  if (found) {
    superClsEnv.vars.forEach((typ, v) => {
      variables.addDecl(v, typ);
    });
    superClsEnv.funs.forEach((typ, f) => {
      functions.addDecl(f, typ);
    });
  }

  const newFields = c.fields.map(v => tcVarDef(v, variables, classes, c.name + "$"));

  const newMethods = c.methods.map(m => {
    if (m.params.length < 1 || 
      m.params[0].name !== "self" || 
      !isTypeEqual(m.params[0].typ, { tag: "object", class: c.name })) {
      throw new TypeError(`First parameter of the following method ` + 
      `must be of the enclosing class: ${c.name}`);
    }
    if (m.name === "__init__" && m.params.length > 1) {
      throw new TypeError(`__init__ method does not accept arguments`);
    }
    if (found && superClsEnv.funs.has(m.name)) {
      const superMethodInfo = superClsEnv.funs.get(m.name);
      // TODO: params nums compare
      m.params.forEach((arg, i) => {
        if (!assignable(arg.typ, superMethodInfo.params[i], classes) && arg.name !== "self") {
          throw new Error(`Method overriden with different type signature: ${c.name}`);
        }
      });
      if (!assignable(m.ret, superMethodInfo.ret, classes)) {
        throw new Error(`Method overriden with different type signature: ${c.name}`);
      }
    }
    functions.addDecl(m.name, new OneFun<Type>(m.name, m.params.map(p => p.typ), m.ret, []));
    return tcFuncDef(m, variables, functions, classes, c.name + "$");
  }).flat();

  classes.addDecl(c.name, { 
    vars: variables.removeScope(), 
    funs: functions.removeScope(),
    super: { tag: "object", class: c.super }
  });

  return { ...c, methods: newMethods, fields: newFields };
}


export function processCls(clsdefs: ClsDef<any>[], variables: BodyEnv,
  functions: FunctionsEnv, classes: ClassEnv) {
  const objCls: ClsDef<any> = {
    tag: "class", name: "object", super: null,
    methods: [
      {
        name: "__init__", ret: { tag:"none" },
        params: [{ name: "self", typ: { tag: "object", class: "object" } }],
        body: { vardefs: [], fundefs: [], decls: [], stmts: [{ tag: "pass" }] }
      }
    ],
    fields: [],
    indexOfField: new Map<string, number>(),
    indexOfMethod: new Map<string, number>(),
    ptrOfMethod: new Map<string, string>(),
  }
  objCls.indexOfMethod.set("__init__", 0);
  objCls.ptrOfMethod.set("__init__", "$object$__init__");
  clsdefs.push(objCls);
  const clsGraph = new Map<string, Set<ClsDef<any>>>();
  clsdefs.forEach(cls => clsGraph.set(cls.name, new Set<ClsDef<any>>()));
  clsdefs.forEach(cls => {
    if (cls.super !== null && !clsGraph.has(cls.super)) {
      throw new Error(`Super class not defined: ${cls.super}`);
    }
    else if (cls.super !== null)
      clsGraph.get(cls.super).add(cls);
  });

  const queue: ClsDef<any>[] = [];
  const newClsDefs: ClsDef<any>[] = [];
  queue.push(objCls);
  while (queue.length !== 0) {
    let superCls = queue.shift();
    superCls = tcClsDef(superCls, variables, functions, classes);
    newClsDefs.push(superCls);
    clsGraph.get(superCls.name).forEach(subCls => {
      const indexOfField = new Map<string, number>(superCls.indexOfField.entries());
      const indexOfMethod = new Map<string, number>(superCls.indexOfMethod.entries());
      const ptrOfMethod = new Map<string, string>(superCls.ptrOfMethod.entries());
      const lenSuperField = superCls.indexOfField.size;
      let lenMethod = superCls.indexOfMethod.size;
      const newFields = superCls.fields.slice();
      subCls.fields.forEach((f, i) => {
        if (indexOfField.has(f.typedvar.name)) {
          throw new Error(`Cannot re-define attribute: ${f.typedvar.name} in class ${subCls.name}`);
        }
        indexOfField.set(f.typedvar.name, i + lenSuperField);
        newFields.push(f);
      });

      subCls.methods.forEach(m => {
        if (!indexOfMethod.has(m.name)) {
          // compare the function?
          indexOfMethod.set(m.name, lenMethod);
          lenMethod = lenMethod + 1;
        }
        ptrOfMethod.set(m.name, `$${subCls.name}$${m.name}`);
      });
      let newSubCls = { ...subCls, fields: newFields, indexOfField, indexOfMethod, ptrOfMethod }
      queue.push(newSubCls);
    })
  }
  return newClsDefs;
}

export function tcVarDef(s: VarDef<any>, local: BodyEnv, classes: ClassEnv, namePrefix:string = ""): VarDef<Type> {
  const rhs = tcLit(s.init);
  if (!isSimpleType(rhs.a)) {
    throw new Error(`can only initialize variable with literal`);
  }
  const rhsTyp = getTypeStr(rhs.a);
  const varTypName = getTypeStr(s.typedvar.typ);
  local.addDecl(s.typedvar.name, new OneVar<Type>(s.typedvar.typ, s.typedvar.ref)); // no redefinition error
  
  if (!assignable(s.typedvar.typ, rhs.a, classes)) {
    throw new TypeError(`Expect type '${varTypName}'; ` + 
      `got type '${rhs.a}'`);
  }

  if (s.init.tag === "string") {
    const newName = namePrefix + s.typedvar.name;
    globalStrs.set(newName, {
      typedvar: { ...s.typedvar, name: newName },
      init: rhs
    });
  }

  // if (!isObject(s.typedvar.typ)) {
  //   if (!isTypeEqual(s.typedvar.typ, rhs.a)) {
  //     throw new TypeError(`Expect type '${varTypName}'; ` +
  //       `got type '${rhs.a}'`);
  //   }
  //   if (s.init.tag === "string") {
  //     const newName = namePrefix + s.typedvar.name;
  //     globalStrs.set(newName, { 
  //       typedvar: { ...s.typedvar, name: newName  }, 
  //       init: rhs 
  //     });
  //   }
  // } else if (isCls(s.typedvar.typ)){
  //   const [found] = classes.lookUpVar(varTypName, SearchScope.GLOBAL);
  //   if (!found) {
  //     throw new Error(`Invalid type annotation; ` + 
  //       `there is no class named: ${varTypName}`);
  //   }
  //   if (rhsTyp !== "none") {
  //     throw new TypeError(`Expect type '${varTypName}'; ` +
  //       `got type '${rhsTyp}'`);
  //   }
  // } 
  return { ...s, init: rhs };
}


export function tcProgram(p: Program<any>): Program<Type> {
  const variables = new Env<OneVar<Type>>();
  const functions = new Env<OneFun<Type>>();
  const classes = new Env<OneClass<Type>>();
  globalStrs.clear();

  p.fundefs.forEach(s => {
    functions.addDecl(s.name, new OneFun<Type>(s.name, s.params.map(p => p.typ), s.ret, []));
  }); // no redefinition error
  
  classes.addDecl("object", undefined);
  p.clsdefs.forEach(c => {
    classes.addDecl(c.name, undefined);
  })
  
  let vardefs = p.vardefs.map(s => tcVarDef(s, variables, classes));
  const clsdefs = processCls(p.clsdefs, variables, functions, classes);
  const fundefs = p.fundefs.map(s => tcFuncDef(s, variables, functions, classes)).flat();
  

  const stmts = p.stmts.map(s => {
    const res = tcStmt(s, variables, functions, classes, {tag: "none"});
    return res;
  });

  globalStrs.forEach((value, name) => {
    const [found] = variables.lookUpVar(name);
    if (!found)
      vardefs.push(value);
  })

  return { ...p, vardefs, fundefs, clsdefs, stmts };
}