// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2): REQ-DLV-037 "exported PDF/DOCX/XLSX/PPTX samples are inspected in both
// languages", and the F-DG5-140 verification (version 0: an Arabic export carries the Arabic shipped product name).
// Reads the files the candidate's A15 matrix wrote to QA_A15_DUMP (tests/qa alone, at branding version 0: the suite
// never publishes a branding version) with the suite's own file reader (tests/qa/support/a15.ts viewOf), and checks
// each one INDEPENDENTLY of the suite's assertions:
//   - its language: an Arabic file is laid out right to left, an English file left to right;
//   - the B0004 provenance statement is printed in the file's language;
//   - no official-PMI or certification claim, and no engineering-gate name (DG0-DG7);
//   - F-DG5-140: the shipped product name OF THE FILE'S LANGUAGE is printed ('Mobily Transformation Hub' in en,
//     'منصة موبايلي للتحوّل' in ar), and an Arabic file never prints the English name (nor an English file the Arabic);
//   - for PDF, DOCX and PPTX the header (first text piece) is that name.
// Prints one line per file and a sample of its text, so the inspection is in the log. Runs in a disposable clone only
// (copied to tests/qa/unit/ there). QA_R2_EXPECT_MUTANT=1 inverts nothing: the mutant run is expected to FAIL here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lines, plain, rev } from "../../../packages/reporting/src/pdf/read.ts";
import { contains, viewOf, type Format } from "../support/a15.ts";

const DIR = process.env["QA_A15_DUMP"] ?? "";
const B0004_EN =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management";
const B0004_AR_START = "توليفة عملية مستوحاة من سلسلة PMI";
const NAME = { en: "Mobily Transformation Hub", ar: "منصة موبايلي للتحوّل" } as const;

describe.skipIf(DIR === "")("QA-R2 REQ-DLV-037 / F-DG5-140: the A15 export samples, inspected in en and ar", () => {
  it("every dumped PDF/DOCX/XLSX/PPTX file has its language's layout, provenance, product name and no forbidden claim", async () => {
    const files = readdirSync(DIR).filter((f) => /\.(en|ar)\.(pdf|docx|xlsx|pptx)$/.test(f)).sort();
    const problems: string[] = [];
    const counts: Record<string, number> = {};
    for (const f of files) {
      const [, lang, format] = /\.(en|ar)\.(pdf|docx|xlsx|pptx)$/.exec(f)! as unknown as [string, "en" | "ar", Format];
      counts[`${format}/${lang}`] = (counts[`${format}/${lang}`] ?? 0) + 1;
      const other = lang === "en" ? "ar" : "en";
      const v = await viewOf(format, new Uint8Array(readFileSync(join(DIR, f))));
      const rtlOk = lang === "ar" ? v.rtl === true : v.rtl === false;
      const prov = lang === "en" ? contains(v, B0004_EN) : contains(v, B0004_AR_START);
      const claim = /official PMI standard|PMI[- ]certified|certified by PMI/i.test(v.text);
      const dg = /\bDG[0-7]\b/.test(v.text);
      const name = contains(v, NAME[lang]);
      const otherName = v.text.includes(NAME[other]) || v.pieces.some((p) => p.includes(NAME[other]));
      // Attempt 1 (PROBE-ERROR): a PDF's text pieces are not in reading order (the first piece of an Arabic PDF was a
      // lone glyph); for a PDF the header is the FIRST VISUAL LINE (pdf/read.ts lines), read right to left in Arabic
      // (rev) and compared without diacritics (plain), as the candidate's own PDF reader does.
      const first =
        format === "pdf" && v.pdf !== undefined
          ? (() => {
              const l = (lines(v.pdf)[0] ?? "").trim();
              return lang === "ar" ? plain(rev(l)) : l;
            })()
          : (v.pieces.find((p) => p.trim().length > 0) ?? "").trim();
      const headerOk = format === "xlsx" ? null : format === "pdf" ? first === plain(NAME[lang]) : first === NAME[lang];
      const sample = v.pieces
        .map((p) => p.trim())
        .filter((p) => p.length > 3)
        .slice(0, 8)
        .map((p) => p.slice(0, 70));
      console.info(
        `QA-R2-INSPECT ${f} | rtl=${v.rtl} (${rtlOk ? "ok" : "WRONG"}) | B0004=${prov} | name(${lang})=${name} | otherLangName=${otherName} | header=${JSON.stringify(first.slice(0, 40))} headerOk=${headerOk} | claim=${claim} | DG=${dg} | pieces=${v.pieces.length} | sample=${JSON.stringify(sample)}`,
      );
      if (!rtlOk) problems.push(`${f}: direction rtl=${v.rtl}`);
      if (!prov) problems.push(`${f}: no B0004 statement in ${lang}`);
      if (claim) problems.push(`${f}: official/certified claim`);
      if (dg) problems.push(`${f}: names an engineering gate`);
      if (!name) problems.push(`${f}: no ${lang} product name`);
      if (otherName) problems.push(`${f}: prints the ${other} product name`);
      if (headerOk === false) problems.push(`${f}: header is ${JSON.stringify(first)}, not the ${lang} product name`);
    }
    console.info(`QA-R2-INSPECT files=${files.length} by format/lang=${JSON.stringify(counts)} problems=${problems.length} ${JSON.stringify(problems)}`);
    expect(files.length).toBeGreaterThan(0);
    for (const fmt of ["pdf", "docx", "xlsx", "pptx"])
      for (const l of ["en", "ar"]) expect(counts[`${fmt}/${l}`] ?? 0, `${fmt}/${l} samples`).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  }, 600_000);
});
