// The web source scan of the security suite (T-DG6-BE-E2; ADR-0052 §3, §11; REQ-S16-030 "XSS in rich text";
// p6-work-split §E/F.8). The primary XSS control is that the product stores and returns no HTML and the web renders
// every free-text value as a React text node. This scan fails when any source file under apps/web/src, outside test
// files, uses one of the five DOM sinks that would turn text into markup: `dangerouslySetInnerHTML`, `innerHTML`,
// `outerHTML`, `insertAdjacentHTML` or `document.write` (which also covers `document.writeln`).
//
// "Test files" are `*.test.ts(x)` and the shared test support folder `src/test/**`; everything else (pages,
// components, lib, api, auth, app, i18n, main.tsx) is scanned, comments included, so a sink cannot hide behind a
// computed access such as `el["innerHTML"]`. The CSP (`script-src 'self'`, no `unsafe-inline`) is defence in depth,
// not the control this test proves.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The five sinks of ADR-0052 §3, each as a whole identifier (`document.write` also matches `document.writeln`). */
const SINKS: readonly (readonly [string, RegExp])[] = [
  ["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["document.write", /\bdocument\s*\.\s*write(?:ln)?\b/],
];

/** Source files the scan reads: script and markup sources (ts, tsx, js, jsx, mjs, cjs, html). */
const SOURCE = /\.(?:[cm]?[jt]sx?|html)$/;

function isTestFile(rel: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(rel) || rel.split(sep)[0] === "test";
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

/** Every `file:line: sink` occurrence in `text`. */
function findSinks(rel: string, text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of SINKS) if (re.test(line)) hits.push(`${rel}:${i + 1}: ${name}`);
  });
  return hits;
}

describe("web source scan: no HTML sinks outside test files (ADR-0052 §3; REQ-S16-030 XSS in rich text)", () => {
  it("the scanner recognizes each sink (a self-check, so an empty result is not vacuous)", () => {
    const sample = [
      "<div dangerouslySetInnerHTML={{ __html: x }} />",
      "el.innerHTML = x;",
      'el["outerHTML"] = x;',
      "el.insertAdjacentHTML('beforeend', x);",
      "document.write(x); document .writeln(x);",
    ].join("\n");
    expect(findSinks("sample.tsx", sample)).toEqual([
      "sample.tsx:1: dangerouslySetInnerHTML",
      "sample.tsx:2: innerHTML",
      "sample.tsx:3: outerHTML",
      "sample.tsx:4: insertAdjacentHTML",
      "sample.tsx:5: document.write",
    ]);
    // Identifiers that merely contain a sink's letters are not sinks.
    expect(findSinks("ok.ts", "const myinnerHTMLish = 1; textContent = s; documentWriter.write(s);")).toEqual([]);
    expect(isTestFile(join("pages", "x.test.tsx"))).toBe(true);
    expect(isTestFile(join("test", "fixtures.tsx"))).toBe(true);
    expect(isTestFile(join("pages", "test-results.tsx"))).toBe(false);
  });

  it("no source file under apps/web/src (outside test files) uses a sink", () => {
    const files = walk(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => !isTestFile(rel));
    // The scan covers the real tree: main.tsx and the page and component sources are in it.
    expect(files).toContain("main.tsx");
    expect(files.filter((rel) => rel.startsWith(`pages${sep}`)).length).toBeGreaterThan(50);
    const hits = files.flatMap((rel) => findSinks(rel, readFileSync(join(SRC, rel), "utf8")));
    expect(hits).toEqual([]);
    console.log(`PASS REQ-S16-030 web source scan: ${files.length} source files, 0 HTML sinks`);
  });
});
