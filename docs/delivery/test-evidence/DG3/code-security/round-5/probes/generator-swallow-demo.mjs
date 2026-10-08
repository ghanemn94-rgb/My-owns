// code-security-reviewer DG3 round 5: plain-Node demonstration of the G1/G2 semantics, independent of the repository.
// Run twice: `node generator-swallow-demo.mjs` and `node --disallow-code-generation-from-strings generator-swallow-demo.mjs`.
// A generator whose try block generates code from a string and whose finally block yields: the consumer calls next()
// once (G1) or next() then return() (G2). No catch, no return/throw/break/continue in finally, no Promise/async.
const KEY = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114); // "constructor"
let ran = "no";
function codegen() {
  ran = (function () {}[KEY])("return 'generated code ran'")();
}
function* g() {
  try {
    codegen();
  } finally {
    yield 0;
  }
}
const flag = process.execArgv.includes("--disallow-code-generation-from-strings");
let threw = "nothing";
try {
  const r1 = g().next(); // G1
  const it = g();
  const r2 = it.next();
  const r3 = it.return(0); // G2
  console.log(`flag=${flag} G1 next()=${JSON.stringify(r1)} G2 next()=${JSON.stringify(r2)} return()=${JSON.stringify(r3)}`);
} catch (e) {
  threw = `${e?.name}: ${e?.message}`;
}
console.log(`flag=${flag} codegen result: ${ran}; exception reaching the caller: ${threw}`);
// Control: the same code generation without the generator propagates the EvalError under the flag.
try {
  codegen();
  console.log(`flag=${flag} control: no exception (code generation allowed), result: ${ran}`);
} catch (e) {
  console.log(`flag=${flag} control: ${e?.name}: ${e?.message}`);
}
