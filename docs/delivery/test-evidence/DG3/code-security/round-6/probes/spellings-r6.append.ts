
// ---- code-security-reviewer DG3 round 6 (T-DG3-REV-SEC-R6): appended in a DISPOSABLE clone only ----
// Independent L1–L7 spellings (not taken from the candidate's probe table). Each REFUSED row must be refused by a rule
// (no-restricted-syntax or no-unsafe-finally; a parse error does not count) AND be a scan hit. Each ALLOWED row must lint
// clean of those two rules and be scan-clean (except where noted).
const R6_REFUSED: readonly (readonly [string, string])[] = [
  ["L1", "try { a(); } catch ({ message }) { void message; }"],
  ["L1", "try { a(); } catch (err) { if (err instanceof EvalError) throw err; }"],
  ["L1", "try { a(); } catch (e) { if (e instanceof EvalError) { throw e; } }"],
  ["L1", "try { a(); } catch (e) { if (e instanceof EvalError) throw e; else b(); }"],
  ["L1", "try { a(); } catch (e) { void 0; if (e instanceof EvalError) throw e; }"],
  ["L1", "try { a(); } catch (e) { if (e instanceof RangeError) throw e; }"],
  ["L1", "try { a(); } catch (e) { if (e instanceof EvalError) throw new Error(); }"],
  ["L1", "try { a(); } catch { b(); }"],
  ["L2", "const EvalError = RangeError; void EvalError;"],
  ["L2", "export const x = EvalError;"],
  ["L3", "export function f(): void { try { a(); } finally { return; } }"],
  ["L3", "for (;;) { try { a(); } finally { break; } }"],
  ["L3", "for (;;) { try { a(); } finally { continue; } }"],
  ["L3", "l: { try { a(); } finally { break l; } }"],
  ["L3", "try { a(); } finally { throw new Error(); }"],
  ["L4", "export function* g(): Generator<number> {}"],
  ["L4", "export const o = { *g() {} };"],
  ["L4", "export class C { private *g() {} }"],
  ["L4", "export class C { static *#g() {} }"],
  ["L4", "export const g = function* () {};"],
  ["L4", "export class C { *[k]() {} }"],
  ["L4", "export async function* g() {}"],
  ["L5", "export const f = async () => 0;"],
  ["L5", "export class C { async m() {} }"],
  ["L5", "export const p = Promise;"],
  ["L5", "queueMicrotask(a);"],
  ["L5", "export async function f() { for await (const x of y) void x; }"],
  ["L6", "p.then(a);"],
  ["L6", "p?.then(a);"],
  ['L6', 'p["then"](a);'],
  ["L6", "p[`then`](a);"],
  ["L6", "const { then } = p; void then;"],
  ['L6', 'const { ["then"]: t } = p; void t;'],
  ["L6", "export const o = { then() {} };"],
  ['L6', 'export const o = { "then": 1 };'],
  ["L6", "export class C { #then = 1; m() { return this.#then; } }"],
  ["L6", "export class C { then() {} }"],
  ["L6", "export const then = 1;"],
  ["L6", "export function f(then: number) { return then; }"],
  ["L6", "p.catch(a);"],
  ["L6", "p.finally(a);"],
  ["L6", "const { catch: c } = p; void c;"],
  ['L6', 'export const s = "finally";'],
  ["L6", "export interface I { then(): void }"],
  ["L6", "export type T = { then: number };"],
  ["L6", "export enum E { then }"],
  ["L6", "then: for (;;) break then;"],
  ["L7", "Array.fromAsync(x);"],
  ["L7", "const { fromAsync } = Array; void fromAsync;"],
  ["L7", "export const s = Symbol.asyncIterator;"],
  ["L7", "export const o = { [Symbol.asyncIterator]() {} };"],
  ['L7', 'x["fromAsync"](y);'],
  ['L7', 'export const k = "asyncIterator";'],
];
const R6_ALLOWED: readonly string[] = [
  "export function f(a: () => void): void {\n  try {\n    a();\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n  }\n}\n",
  "export function f(a: () => void): void {\n  try {\n    a();\n  } finally {\n    a();\n  }\n}\n",
  "export function f(a: () => void): void {\n  try {\n    a();\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n    return;\n  } finally {\n    a();\n  }\n}\n",
  'export const s = "thenable";\n',
];
describe("code-security-reviewer r6: independent L1-L7 spellings", () => {
  it.each(R6_REFUSED)("scan: %s %s is a hit", (_l, text) => {
    expect(scanSource(text).length, text).toBeGreaterThan(0);
  });
  it.each(R6_ALLOWED)("scan: allowed %s is clean", (text) => {
    expect(scanSource(text)).toEqual([]);
  });
  it.skipIf(NOCODEGEN)("lint: every refused spelling is refused by a rule; allowed shapes are clean", { timeout: 120_000 }, async () => {
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const eslint = new ESLint({ cwd: repoRoot });
    const rules = async (text: string) => {
      const [result] = await eslint.lintText(text, { filePath: `${SRC_DIR}formula/tokenize.ts` });
      return result!.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
    };
    const missed: string[] = [];
    for (const [l, text] of R6_REFUSED) {
      const r = await rules(text);
      const ok = r.includes("no-restricted-syntax") || r.includes("no-unsafe-finally");
      console.log(`R6-LINT ${ok ? "REFUSED" : "NOT-REFUSED"} ${l} ${JSON.stringify(text)} rules=${JSON.stringify(r)}`);
      if (!ok) missed.push(`${l} ${text}`);
    }
    for (const text of R6_ALLOWED) {
      const r = (await rules(text)).filter((x) => x === "no-restricted-syntax" || x === "no-unsafe-finally");
      console.log(`R6-LINT ALLOWED-CHECK ${JSON.stringify(text)} handler-rules=${JSON.stringify(r)}`);
      if (r.length) missed.push(`allowed shape refused: ${text}`);
    }
    expect(missed).toEqual([]);
  });
});
