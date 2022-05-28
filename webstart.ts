import {compile, run} from './compiler';

document.addEventListener("DOMContentLoaded", async () => {
  function display(arg : string) {
    const elt = document.createElement("pre");
    document.getElementById("output").appendChild(elt);
    elt.innerText = arg;
    // const out = document.getElementById("output");
    // out.innerText += arg + "\n";
  }

  var importObject:any = {
    imports: {
      print_num: (arg : any) => {
        console.log("Logging from WASM: ", arg);
        display(String(arg));
        // return arg;
      },
      print_bool: (arg : any) => {
        if(arg === 0) { display("False"); }
        else { display("True"); }
        // return arg;
      },
      print_none: (arg: any) => {
        display("None");
        // return arg;
      },
      print_string: (arg: any) => {
        // TODO WebAssembly.Memory
        const mem = new Uint32Array(memory.buffer);
        let str: string = "\"";
        const addr = Number(arg) / 4;
        const len = mem[addr];
        for (let i = 0; i < len; i++) {
          // display(String.fromCharCode(mem[addr + i + 1]));
          str += String.fromCharCode(mem[addr + i + 1]);
        } 
        str += "\""
        display(str);
      },
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
      pow: Math.pow,
    },
    check: {
      check_init: (arg: any) => {
        if (arg <= 0)
          throw new Error("RUNTIME ERROR: object not intialized");
        return arg;
      },
      check_index: (length: any, arg: any) => {
        if (arg >= length || arg < 0) {
          throw new Error("RUNTIME ERROR: Index out of bounds");
        }
        return arg;
      },
    },
  };
  const memory = new WebAssembly.Memory({ initial: 10, maximum: 100 });
  importObject.js = { memory };
  const runButton = document.getElementById("run");
  const userCode = document.getElementById("user-code") as HTMLTextAreaElement;
  runButton.addEventListener("click", async () => {
    const program = userCode.value;
    const output = document.getElementById("output");
    try {
      const wat = compile(program);
      const code = document.getElementById("generated-code");
      code.textContent = wat;
      let result = await run(wat, importObject);
      if (result === undefined)
        result = "";
      // output.textContent += String(result);
      output.setAttribute("style", "color: black");
    }
    catch(e) {
      console.error(e)
      output.textContent = String(e);
      output.setAttribute("style", "color: red");
    }
  });

  userCode.value = localStorage.getItem("program");
  userCode.addEventListener("keypress", async() => {
    localStorage.setItem("program", userCode.value);
  });
});