// qa-verifier A20 "UX and branding", the catalogue half of REQ-S15-007 (DG6, T-DG6-QA-D). Binding row text
// (docs/delivery/requirements.csv): "A20;A15: a test finds no missing ar or en key; a validation error returned by the
// API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable".
// This file is "a test finds no missing ar or en key": it reads the shipped catalogues (apps/web/src/i18n/{en,ar}/*.json)
// as data and checks (1) the two languages have exactly the same keys in every namespace, with no empty text, and (2)
// every problem code that a P6 operation of docs/api/openapi.yaml names as a 4xx response (the operations whose summary
// cites a P6 ADR, ADR-0051 … ADR-0061) has a text in BOTH languages under `problems.<code with "." as "__">` - the key
// the SPA's problem renderer looks up - and the Arabic text is not the English one. The "shown in the selected
// language" half is e2e/a20-p6-ux.spec.ts; the export half is A15's. Nothing here reads product code.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const I18N = path.join(ROOT, "apps", "web", "src", "i18n");
type Tree = { [k: string]: string | Tree };

function load(lang: "en" | "ar"): Record<string, Tree> {
  const dir = path.join(I18N, lang);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Tree]),
  );
}
function flatten(t: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const en = load("en");
const ar = load("ar");
const enFlat = flatten(en as unknown as Tree);
const arFlat = flatten(ar as unknown as Tree);

/** Problem codes the contract names after a 4xx status in the summary of a P6 operation (ADR-0051 … ADR-0061). */
function p6ProblemCodes(): string[] {
  const yaml = readFileSync(path.join(ROOT, "docs", "api", "openapi.yaml"), "utf8");
  const codes = new Set<string>();
  for (const m of yaml.matchAll(/^\s+summary: "(.*)"$/gm)) {
    const s = m[1]!;
    if (!/ADR-00(5[1-9]|6[01])\b/.test(s)) continue;
    for (const run of s.matchAll(
      /\b4\d\d ((?:(?:or |and )?[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+(?:, |,? or | and )?)+)/g,
    ))
      for (const c of run[1]!.matchAll(/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+/g)) codes.add(c[0]);
  }
  return [...codes].sort();
}

describe("REQ-S15-007 (A20): no missing ar or en key", () => {
  it("both languages ship the same namespaces", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("every English key exists in Arabic and every Arabic key in English; no text is empty", () => {
    const missingInAr = [...enFlat.keys()].filter((k) => !arFlat.has(k));
    const missingInEn = [...arFlat.keys()].filter((k) => !enFlat.has(k));
    expect(missingInAr, "keys missing in ar").toEqual([]);
    expect(missingInEn, "keys missing in en").toEqual([]);
    const empty = [...enFlat, ...arFlat].filter(([, v]) => v.trim() === "").map(([k]) => k);
    expect(empty, "empty texts").toEqual([]);
    expect(enFlat.size).toBeGreaterThan(1000);
  });

  it("every P6 problem code of the contract has an en and an ar text, and the Arabic one is Arabic", () => {
    const codes = p6ProblemCodes();
    // The extraction must find the P6 codes at all (guards against a silently empty list).
    expect(codes.length).toBeGreaterThan(40);
    for (const c of ["assistant.disabled", "notification_channel.adapter_unavailable", "connector.disabled"])
      expect(codes).toContain(c);
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    const missing = codes.filter((c) => !enFlat.has(key(c)) || !arFlat.has(key(c)));
    expect(missing, "P6 problem codes without a text in en and ar").toEqual([]);
    const notArabic = codes.filter((c) => {
      const a = arFlat.get(key(c)) ?? "";
      return a === enFlat.get(key(c)) || !/[؀-ۿ]/.test(a);
    });
    expect(notArabic, "P6 problem codes whose ar text is not Arabic").toEqual([]);
  });
});
