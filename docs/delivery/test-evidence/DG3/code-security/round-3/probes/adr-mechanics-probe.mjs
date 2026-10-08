// code-security-reviewer DG3 round-3 (T-DG3-REV-SEC-R3B): checks the factual claims of ADR-0024 §6 layer 3 about
// what --disallow-code-generation-from-strings does and does not cover. Touches no repository file. Run:
//   node adr-mechanics-probe.mjs            (control)
//   node --disallow-code-generation-from-strings adr-mechanics-probe.mjs
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import { Session } from "node:inspector";

const out = [];
const t = async (id, f) => {
  try {
    out.push(`${id} -> ${JSON.stringify(await f())}`);
  } catch (e) {
    out.push(`${id} -> threw ${e?.code ?? e?.constructor?.name}: ${String(e?.message).split("\n")[0]}`);
  }
};
const k = ["con", "structor"].join("");
await t("A1 eval('6*7')", () => (0, eval)("6*7"));
await t("A2 Function via (()=>0)[k]", () => (() => 0)[k]("return 6*7")());
await t("A3 AsyncFunction via prototype[k]", async () => Object.getPrototypeOf(async () => 0)[k]("return 6*7")());
await t("A4 GeneratorFunction via prototype[k]", () => Object.getPrototypeOf(function* () {})[k]("yield 6*7")().next().value);
await t("B1 vm.runInThisContext('6*7') (script compilation, not covered by the flag per ADR)", () => vm.runInThisContext("6*7"));
await t("B2 vm.runInNewContext('6*7')", () => vm.runInNewContext("6*7"));
await t("B3 vm.runInNewContext(\"eval('6*7')\") (ADR: vm contexts re-enable code generation)", () => vm.runInNewContext("eval('6*7')"));
await t("B4 vm.runInThisContext(\"eval('6*7')\") (main context: flag applies)", () => vm.runInThisContext("eval('6*7')"));
await t("B5 vm.createContext({}, {codeGeneration:{strings:false}}) eval", () =>
  vm.runInContext("eval('6*7')", vm.createContext({}, { codeGeneration: { strings: false } })),
);
await t("C1 process.getBuiltinModule('node:vm').runInThisContext('6*7')", () =>
  process.getBuiltinModule("node:vm").runInThisContext("6*7"),
);
await t("D1 inspector Runtime.evaluate('6*7')", () => {
  const s = new Session();
  s.connect();
  let v;
  s.post("Runtime.evaluate", { expression: "6*7" }, (e, r) => {
    v = e ? `error ${e.message}` : (r.result.value ?? r.exceptionDetails?.exception?.description?.split("\n")[0]);
  });
  s.disconnect();
  return v;
});
await t("E1 new Worker(eval, execArgv:[flag]) (ADR: threads refuse the flag)", () =>
  new Promise((res, rej) => {
    const w = new Worker("1", { eval: true, execArgv: ["--disallow-code-generation-from-strings"] });
    w.on("error", rej);
    w.on("exit", (c) => res(`worker exit ${c}`));
  }),
);
await t("F1 WebAssembly.compile(minimal module)", async () => {
  const m = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  return typeof m;
});
console.log(`node ${process.version} execArgv=${JSON.stringify(process.execArgv)}\n${out.join("\n")}`);
