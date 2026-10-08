// code-security-reviewer DG3 round-2: runtime confirmation that the residual forms N1-N11 (which pass both the ESLint
// override and the fuzz.test.ts source scan, see guard-bypass-probe.log) really evaluate text as code. Plain JS
// equivalents of the TypeScript snippets (type assertions removed). Run from $TMPDIR; touches no repository file.
const out = [];
const t = async (id, f) => {
  try {
    out.push(`${id} -> ${JSON.stringify(await f())}`);
  } catch (e) {
    out.push(`${id} -> threw ${e?.constructor?.name}: ${e?.message}`);
  }
};
await t("N1 f[k]('return 6*7')()", () => { const k = "constructor"; return (() => 0)[k]("return 6*7")(); });
await t("N2 f['con'+'structor']", () => (() => 0)["con" + "structor"]("return 6*7")());
await t("N3 getOwnPropertyDescriptor(...).value", () =>
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor").value("return 6*7")());
await t("N4 const {[k]: C} = genProto", () => {
  const k = "constructor";
  const { [k]: C } = Object.getPrototypeOf(function* () {});
  return C("yield 6*7")().next().value;
});
await t("N5 AsyncFunction via join key", () => {
  const k = ["con", "structor"].join("");
  return Object.getPrototypeOf(async () => 0)[k]("return 6*7")();
});
await t("N6 tagged template", () => { const k = "constructor"; return (() => 0)[k]`return 6*7`(); });
await t("N7 global['ev'+'al']", () => global["ev" + "al"]("6*7"));
await t("N8 self['ev'+'al'] (Node has no self; browser-only form)", () => self["ev" + "al"]("6*7"));
await t("N9 process.getBuiltinModule('node:vm')", () => process.getBuiltinModule("node:vm").runInThisContext("6*7"));
await t("N10 node:inspector Runtime.evaluate", async () => {
  const { Session } = await import("node:inspector");
  const s = new Session();
  s.connect();
  const r = await new Promise((res, rej) =>
    s.post("Runtime.evaluate", { expression: "6*7" }, (e, v) => (e ? rej(e) : res(v))),
  );
  s.disconnect();
  return r.result.value;
});
await t("N11 node:repl exports start()", async () => typeof (await import("node:repl")).start);
console.log(`node ${process.version}\n${out.join("\n")}`);
