// A22/A28 REQ-S21-001 (qa-verifier, T-DG5-QA-F): "a text scan of UI strings and export templates finds no DG0-DG7
// references; demo G-approvals display 'Synthetic demonstration - approves nothing real'".
//
// An independent scanner (it does not reuse the product's packages/shared/src/text-scan): it reads the shipped files
// from disk and searches the text a user can see:
//  - UI strings: every string value of the web catalogues apps/web/src/i18n/{en,ar}/*.json, and the string and JSX text
//    of the web source apps/web/src/** (comments removed: comments are not UI text);
//  - export templates: the report and export layer packages/reporting/src/** (labels, layouts, the five exporters)
//    and the worker's export runner apps/worker/src/reports/** (comments removed);
//  - texts the API returns to the UI (problem titles and details, labels) in apps/api/src/** (comments removed).
// Test files, test fixtures and build output are excluded. Pattern: "DG" + optional space + a digit 0-7 as a word, or
// a DGx-DGy range. QA_TEXT_SCAN_EXTRA_ROOT adds one more directory to the UI scan (used only by the mutation check in
// the handback). Every sample is synthetic.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ENGINEERING_GATE = /\bDG ?[0-7]\b|\bDG[0-7]?\s*[–—-]\s*DG ?[0-7]\b/;

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "dist" || name === "test" || name === "e2e" || name === "test-results")
      continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, accept));
    else if (accept(p)) out.push(p);
  }
  return out;
}

const isSource = (f: string) =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/test-fixtures|test-support|fixtures?\.ts$/.test(f);

/** Removes block and line comments (a // inside a string such as a URL, after ':' or a quote, is kept). */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function jsonStrings(value: unknown, at: string, out: { at: string; text: string }[]): void {
  if (typeof value === "string") out.push({ at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => jsonStrings(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) jsonStrings(v, `${at}.${k}`, out);
}

interface Hit {
  readonly file: string;
  readonly where: string;
  readonly text: string;
}

function scanCatalogues(dirs: readonly string[]): { hits: Hit[]; strings: number; files: number } {
  const hits: Hit[] = [];
  let strings = 0;
  let files = 0;
  for (const dir of dirs)
    for (const file of walk(dir, (f) => f.endsWith(".json"))) {
      files += 1;
      const all: { at: string; text: string }[] = [];
      jsonStrings(JSON.parse(readFileSync(file, "utf8")), "$", all);
      strings += all.length;
      for (const s of all)
        if (ENGINEERING_GATE.test(s.text)) hits.push({ file: path.relative(ROOT, file), where: s.at, text: s.text });
    }
  return { hits, strings, files };
}

function scanSources(dirs: readonly string[]): { hits: Hit[]; files: number } {
  const hits: Hit[] = [];
  let files = 0;
  for (const dir of dirs)
    for (const file of walk(dir, isSource)) {
      files += 1;
      const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (ENGINEERING_GATE.test(line))
          hits.push({ file: path.relative(ROOT, file), where: `line ${i + 1}`, text: line.trim().slice(0, 200) });
      });
    }
  return { hits, files };
}

const r = (...p: string[]) => path.join(ROOT, ...p);

describe("REQ-S21-001: a text scan of UI strings and export templates finds no DG0-DG7 references", () => {
  it("the scanner itself finds the references it must find (and none in look-alikes)", () => {
    for (const t of ["Release DG7 passed", "DG 5 approved", "dg0", "DG0–DG7", "DG3-DG4", "(DG6)"])
      expect([t, ENGINEERING_GATE.test(t) || ENGINEERING_GATE.test(t.toUpperCase())]).toEqual([t, true]);
    for (const t of ["G6 Sustain", "DG8", "DGX", "BDG5", "DG4_OUTCOME", "edge7", "Gate G1"])
      expect([t, ENGINEERING_GATE.test(t)]).toEqual([t, false]);
    expect(withoutComments('const a = "x"; // DG5 note\n/* DG4 */ const u = "http://h/DG";')).not.toMatch(/DG[45]/);
  });

  it("UI strings: no web catalogue string (en, ar) names an engineering gate", () => {
    const extra = process.env["QA_TEXT_SCAN_EXTRA_ROOT"];
    const dirs = [
      r("apps", "web", "src", "i18n", "en"),
      r("apps", "web", "src", "i18n", "ar"),
      ...(extra ? [extra] : []),
    ];
    const { hits, strings, files } = scanCatalogues(dirs);
    expect(files, "catalogue files scanned").toBeGreaterThan(20);
    expect(strings, "catalogue strings scanned").toBeGreaterThan(1000);
    expect(hits).toEqual([]);
  });

  it("UI strings: no string or JSX text of the web source names an engineering gate", () => {
    const { hits, files } = scanSources([r("apps", "web", "src")]);
    expect(files).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });

  it("export templates: the report/export layer and the worker's export runner name no engineering gate", () => {
    const { hits, files } = scanSources([r("packages", "reporting", "src"), r("apps", "worker", "src", "reports")]);
    expect(files).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });

  // Beyond the row's literal scope (UI strings, export templates): the API's own texts. One known hit, reported in the
  // handback as an observation: the disclaimer stored in every gate-submission snapshot (`snapshot.note`, returned by
  // the gate submission reads). It is a disclaimer, not a DG status; any OTHER hit fails here.
  it("texts the API returns name no engineering gate, except the disclosed gate-snapshot disclaimer", () => {
    const { hits, files } = scanSources([r("apps", "api", "src")]);
    expect(files).toBeGreaterThan(50);
    expect(hits.map((h) => [h.file, h.text])).toEqual([
      [
        "apps/api/src/modules/workflows/gates.ts",
        'note: "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7.",',
      ],
    ]);
  });
});

describe("REQ-S21-001: demo G-approvals display 'Synthetic demonstration - approves nothing real' (en and ar catalogues)", () => {
  const all = (lang: "en" | "ar") => {
    const out: { at: string; text: string }[] = [];
    for (const f of walk(r("apps", "web", "src", "i18n", lang), (x) => x.endsWith(".json")))
      jsonStrings(JSON.parse(readFileSync(f, "utf8")), path.basename(f), out);
    return out.map((s) => s.text);
  };
  it("the English label is shipped verbatim, and its Arabic text (ADR-0050 §2 (c)) too", () => {
    expect(all("en")).toContain("Synthetic demonstration - approves nothing real");
    expect(all("ar")).toContain("عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي");
  });
  it("exports carry the illustrative label in en and ar (packages/reporting labels)", () => {
    const labels = readFileSync(r("packages", "reporting", "src", "labels.ts"), "utf8");
    expect(labels).toContain("Illustrative example — synthetic");
    expect(labels).toContain("مثال توضيحي — اصطناعي");
  });
});
