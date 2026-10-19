const ts = require(process.argv[2]);
const run = (fileName, src, extra) => (ts.transpileModule(src, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, ...extra } }).diagnostics || []).filter(d => d.category === 1).map(d => ts.flattenDiagnosticMessageText(d.messageText, " "));
for (const src of ["export const r = /a/v;", "export const r = /(?<a>x)/;", "export const s = /a/s;", "await x;", "export const o = 010;", "class A { #p = 1 }", "export const b = 1n;", "using r = f(); export {};"]) {
  console.log(JSON.stringify(src), "default:", JSON.stringify(run("a.ts", src, {})), "ES2015:", JSON.stringify(run("a.ts", src, { target: ts.ScriptTarget.ES2015 })), "ES5:", JSON.stringify(run("a.ts", src, { target: ts.ScriptTarget.ES5 })));
}
console.log("default target from getDefaultCompilerOptions:", ts.getDefaultCompilerOptions().target, "ES2015=", ts.ScriptTarget.ES2015, "Latest=", ts.ScriptTarget.Latest);
