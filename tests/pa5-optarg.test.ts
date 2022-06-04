import { assertPrint, assertFail, assertTCFail, assertTC, assertFailContain } from "./asserts.test";
import { NUM, NONE, CLASS, STRING } from "./helpers.test"

describe("PA5 tests for optional arguments", () => {
    assertPrint("optional args", `
def f(i: int, j: int, x: int = 1, y: int = 1) -> int:
    return i + j + x + y
print(f(1, 1))
print(f(1, 1, 5))
print(f(1, 1, 5, 6))
print(f(1, j=1))
print(f(i=1, j=1))
print(f(j=1, i=1))
print(f(i=1, j=1, x=5, y=6))
print(f(y=6, j=1, i=1, x=5))
print(f(1, 1, y=6))
print(f(1, 1, x=5, y=6))
print(f(1, 1, y=6, x=5))`, 
["4", "8", "13", "4", "4", 
"4", "13", "13", "9", "13", "13"]);
    
    assertFailContain("opt arg before positional arg", `
def add(x:int = 1, y:int)->int:
    return x + y`, 'non-default argument');

    assertFailContain("unexpected positional arguments", `
def add(x:int, y:int = 1)->int:
    return x + y
add(y=1, 1)`, 'positional argument follows keyword argument');
    
    assertTCFail("no value for positional arg", `
def add(x:int, y:int = 1)->int:
    return x + y
add(y=2)`);

    assertPrint("simple optional argument", `
def add(x:int, y:int = 1)->int:
    return x + y
print(add(1))`, ['2']);

    assertTCFail("no arguments", `
def add(x:int, y:int = 1)->int:
    return x + y
add()`);

    assertTCFail("unexpected positional arguments", `
def add(x:int, y:int = 1)->int:
    return x + y
add(1, a=1)`);

    assertTCFail("wrong init for positional arguments", `
def add(x:int, y:int = True)->int:
    return x + y`);

    assertTCFail("more positional arguments than needed", `
def add(x:int, y:int = 3)->int:
    return x + y
add(1,2,3)`);

    assertPrint("list optional argument", `
def append(x:int, y:[int] = [])->[int]:
    return y + [x]
a:[int] = None
a = append(5, y=[1,2,3])
print(len(a))
`, ['4']);

    assertPrint("string optional argument", `
class Person(object):
    def say(self:Person, message:str = "hello"):
        print(message)

student:Person = None
teacher:Person = None
student = Person()
teacher = Person()
student.say("hello, teacher")
teacher.say()`, ["hello, teacher", "hello"]);

    assertPrint("list optional argument default", `
def append(x:int, y:[int] = [])->[int]:
    return y + [x]
a:[int] = None
a = append(5)
print(len(a))
print(a[len(a) - 1])
`, [`1`, `5`]);


    assertPrint("nested function with opt arg", `
b: int = 2
def f(a: int, i: int = 1) -> int:
    def g(b: int) -> int:
        def h(c: int, d: int = 3) -> int:
            global b
            b = b + 3
            return a + b + i + d
        return h(i, 5) + h(i+3, i) + h(5)
    return g(2)
print(f(1))`, [`39`]);


    assertFailContain("inheritance with no optional argument", `
class A(object):
    def f(self: A, a: int, x:int = 1) -> int:
        def g(a: int) -> int:
            return a * 2 + x
        return g(a)
class B(A):
    def f(self: B, a: int) -> int:
        return a`, `overriden`);

    assertPrint("inheritance with opt arg 1", `
class A(object):
    def f(self: A, a: int, x:int = 1) -> int:
        def g(a: int) -> int:
            return a * 2 + x
        return g(a)
class B(A):
    def f(self: B, a: int, y:int = 1) -> int:
        return a + y
a: A = None
a = B()
print(a.f(4, 8))
    `, [`12`]);

    assertPrint("inheritance with opt arg 2", `
class A(object):
    def f(self: A, a: int, x:int = 1) -> int:
        return a
class B(A):
    def f(self: B, a: int, y:int = 1) -> int:
        def g(a: int) -> int:
            return a * 2 + y
        return g(a) + y

a: A = None
a = B()
print(a.f(4))
    `, [`10`]);

});