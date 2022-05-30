This repo is a personal compiler implementation for [Chocopy](https://chocopy.org/) and beyond, based on CSE231 materials. We focus on compiling Chocopy into wasm. 

### Build

Requires node to be installed (https://nodejs.org/en/download/)

- To build, first run `npm install`

- run `make` to build some wasm libraries

- run `npm run build-web` to write code on webpages

- run `npm test` to run all the test cases
  
  - more test command, see `package.json` 

### Features

- Control flow 

- String

- Class

- Nested function

- Lists

See more details about Chocopy grammar [here](https://chocopy.org/chocopy_language_reference.pdf).

### Credit

The repo is based on [CSE231 spring'22 materials](https://github.com/ucsd-cse231-s22).

### Miscellaneous

- branches starting wth pa2/3 are for personal assignments from CSE231
- branches starting wth pa4 are aimed for a fully functional Chocopy compiler
- so as the test cases in `tests` folder
- EVEN better: check out the [PyScript](https://pyscript.net/) which enables running python in HTML (also use wasm).
