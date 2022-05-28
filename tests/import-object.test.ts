import { readFileSync } from "fs";

enum Type { Num, Bool, None, String }

function stringify(typ: Type, arg: any): string {
  switch (typ) {
    case Type.Num:
      return (arg as number).toString();
    case Type.Bool:
      return (arg as boolean) ? "True" : "False";
    case Type.None:
      return "None";
  }
}

function print(typ: Type, arg: any, mem?: WebAssembly.Memory): any {
  if (typ !== Type.String) {
    importObject.output += stringify(typ, arg);
  } else {
    const mem = new Uint32Array(memory.buffer);
    let str: string = "";
    const addr = Number(arg) / 4;
    const len = mem[addr];
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(mem[addr + i + 1]);
    }
    importObject.output += str;
  }
  importObject.output += "\n";
  return arg;
}

const memory = new WebAssembly.Memory({ initial: 10, maximum: 100 });

const check = {
  check_init: (arg: any) => {
    if (arg <= 0) {
      throw new Error("RUNTIME ERROR: object not intialized");
    }
    return arg;
  },
  check_index: (length: any, arg: any) => {
    if (arg >= length || arg < 0) {
      throw new Error("RUNTIME ERROR: Index out of bounds");
    }
    return arg;
  }
};

export async function addLibs() { 
  const heap = new WebAssembly.Global({ value: 'i32', mutable: true }, 4);

  const bytes = readFileSync("build/memory.wasm");
  const memoryModule = await WebAssembly.instantiate(bytes, { js: { memory, heap } });

  const built = readFileSync("build/builtin.wasm");
  const builtinModule = await WebAssembly.instantiate(built, { check, js: { memory, heap } });
  
  importObject.builtin = builtinModule.instance.exports; 
  importObject.libmemory = memoryModule.instance.exports;
  importObject.memory_values = memory;
  importObject.js = { memory, heap };
  importObject.check = check;

  return importObject;
}

export const importObject:any = {
  imports: {
    // we typically define print to mean logging to the console. To make testing
    // the compiler easier, we define print so it logs to a string object.
    //  We can then examine output to see what would have been printed in the
    //  console.
    print: (arg: any) => print(Type.Num, arg),
    print_num: (arg: number) => print(Type.Num, arg),
    print_bool: (arg: number) => print(Type.Bool, arg),
    print_none: (arg: number) => print(Type.None, arg),
    print_string: (arg: number) => print(Type.String, arg, memory),
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
  },

  output: "",
};
