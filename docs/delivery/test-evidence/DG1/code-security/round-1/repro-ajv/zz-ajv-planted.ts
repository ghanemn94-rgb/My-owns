// REPRODUCTION ONLY (code-security-reviewer, DG1 round 1). Planted into a DISPOSABLE clone at
// apps/api/src/modules/transformations/zz-ajv-planted.ts - never into the candidate tree.
// The allowed third-party dependency `ajv` (apps/api/package.json) compiles validators with `new Function`; its public
// codegen tag `_` emits the RAW literal parts of a template as code, so a module file evaluates arbitrary JavaScript
// (here: a non-allow-listed built-in via process.getBuiltinModule, and a deep import past access/index.ts) while the
// ADR-0002 dependency-lint reports zero violations.
import Ajv, { _ } from "ajv";
import type { KeywordCxt } from "ajv";

const deepPath = new URL("../access/policy.ts", import.meta.url).href;
const ajv = new Ajv.default();
ajv.addKeyword({
  keyword: "x",
  code(cxt: KeywordCxt) {
    cxt.gen.code(
      _`globalThis.__mthRepro = { cp: typeof process.getBuiltinModule("node:child_process").execFileSync, deep: import(${deepPath}) }`,
    );
  },
});
ajv.compile({ x: true })(1);
export const result = (globalThis as unknown as { __mthRepro?: { cp: string; deep: Promise<Record<string, unknown>> } }).__mthRepro;
