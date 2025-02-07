import { importObject, addLibs } from "./import-object.test";
import { compile, run as Run } from '../compiler';
import { tcProgram } from "../tc";
import { parseProgram } from "../parser"

// Modify typeCheck to return a `Type` as we have specified below
export function typeCheck(source: string) : Type {
  const tcp = tcProgram(parseProgram(source));
  const lastStmt = tcp.stmts[tcp.stmts.length - 1];
  if (lastStmt && lastStmt.tag === "expr") {
    const lastType = lastStmt.expr.a;
    if (lastType.tag === "int" || lastType.tag === "bool" || 
      lastType.tag === "none" || lastType.tag === "string") {
      return lastType.tag;
    } else if (lastType.tag === "object") {
      return CLASS(lastType.class);
    } else if (lastType.tag === "list") {
      return LIST(lastType.type);
    }
  }
  else
    return "none";
}

// Modify run to use `importObject` (imported above) to use for printing
// You can modify `importObject` to have any new fields you need here, or
// within another function in your compiler, for example if you need other
// JavaScript-side helpers
export async function run(source: string) {
  return Run(compile(source), await addLibs());
}

type Type =
  | "int"
  | "bool"
  | "none"
  | "string"
  | { tag: "object", class: string }
  | { tag: "list", type:Type }

export const NUM : Type = "int";
export const BOOL : Type = "bool";
export const NONE : Type = "none";
export const STRING: Type = "string";
export function CLASS(name : string) : Type { 
  return { tag: "object", class: name };
};

export function LIST(typ: any): Type {
  if (typ.hasOwnProperty("tag")) {
    if (typ.tag === "object")
      return { tag: "list", type: typ.class };
    else if (typ.tag === "int" || typ.tag === "bool" || typ.tag === "none" || typ.tag === "string") {
      return { tag: "list", type: typ.tag };
    }
    else if (typ.tag === "list") {
      return { tag: "list", type: LIST(typ.type) };
    }
  } else {
    return { tag: "list", type: typ };
  }
};
