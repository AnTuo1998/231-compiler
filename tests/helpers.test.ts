import { importObject } from "./import-object.test";
import { compile, run as Run } from '../compiler';
import { tcProgram } from "../tc";
import { parseProgram } from "../parser"

// Modify typeCheck to return a `Type` as we have specified below
export function typeCheck(source: string) : Type {
  const tcp = tcProgram(parseProgram(source));
  const lastStmt = tcp.stmts[tcp.stmts.length - 1];
  if (lastStmt && lastStmt.tag === "expr") {
    return lastStmt.expr.a;
  }
  else
    return "none";
}

// Modify run to use `importObject` (imported above) to use for printing
// You can modify `importObject` to have any new fields you need here, or
// within another function in your compiler, for example if you need other
// JavaScript-side helpers
export async function run(source: string) {
  let newImportObject = {
    ...importObject,
    imports : {
      ...importObject.imports,
      ObjInit: (arg: any) => {
        if (arg === 0) {
          throw new Error("RUNTIME ERROR: object not intialized");
        }
        return arg;
      }
    }
  };
  return Run(compile(source), newImportObject);
}

type Type =
  | "int"
  | "bool"
  | "none"
  | { tag: "object", class: string }

export const NUM : Type = "int";
export const BOOL : Type = "bool";
export const NONE : Type = "none";
export function CLASS(name : string) : Type { 
  return { tag: "object", class: name }
};
