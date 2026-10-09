// Source scan of the KPI library (p4-work-split §A.1 rules; T-DG4-KBE-A): pure functions only (no I/O, no clock, no
// randomness), decimal.js only for KPI values (no parseFloat / Number on values), imports limited to the library itself,
// the formula engine's public API and the shared value helpers. The formula engine itself is reused unchanged (S-9).
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const SOURCES = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();
/** Comments are stripped so the rules apply to code, not to the explanations of the rules. */
const code = (f: string) =>
  readFileSync(DIR + f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("KPI library source scan", () => {
  it("covers the nine library files of §A.1 plus the shared types file", () => {
    expect(SOURCES).toEqual([
      "aggregate.ts",
      "change.ts",
      "formula-binding.ts",
      "index.ts",
      "measures.ts",
      "periods.ts",
      "rag.ts",
      "status.ts",
      "trajectory.ts",
      "types.ts",
    ]);
  });
  it.each([
    ["clock: Date.now", /\bDate\.now\s*\(/],
    ["clock: new Date() without an argument", /new\s+Date\s*\(\s*\)/],
    ["clock: performance", /\bperformance\./],
    ["randomness", /\bMath\.random\b/],
    ["process / environment", /\bprocess\./],
    ["network", /\bfetch\s*\(|XMLHttpRequest|WebSocket/],
    ["timers", /\bset(Timeout|Interval|Immediate)\s*\(/],
    ["float parsing", /\bparse(Float|Int)\s*\(/],
    ["dynamic code", /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/],
    ["dynamic import", /\bimport\s*\(/],
    ["toPrecision on a JS number", /\.toPrecision\s*\(/],
  ])("no %s", (_, pattern) => {
    for (const f of SOURCES) expect(code(f), f).not.toMatch(pattern);
  });
  it("Number(…) appears only in types.ts's ISO date parsing (year/month/day integers), never on a KPI value", () => {
    for (const f of SOURCES) {
      const uses = code(f).match(/\bNumber\s*\(/g) ?? [];
      if (f === "types.ts")
        expect(uses.length).toBe(5); // y, m, d in dayNumber; year, month in yearMonth
      else expect(uses, f).toEqual([]);
    }
  });
  it("imports only ./*, the formula engine's public index, the shared value helpers (no node:*, no packages)", () => {
    for (const f of SOURCES) {
      const specs = [...code(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const s of specs)
        expect(["../formula/index.ts", "../value.ts"].includes(s) || /^\.\/[a-z-]+\.ts$/.test(s), `${f}: ${s}`).toBe(
          true,
        );
    }
  });
});
