// code-security-reviewer DG5 corrected re-gate round 2 (T-DG5-RG2-SEC-R2): re-verification of F-DG5-100 at the renderer
// level. Do the DOCX / PPTX / XLSX renderers return only well-formed XML 1.0 packages when user text holds ANY character
// XML 1.0 cannot carry? Every forbidden code point is tried (U+0001-U+0008, U+000B, U+000C, U+000E-U+001F, U+FFFE,
// U+FFFF, a lone high and a lone low surrogate), in the transformation name (printed in every header and in the core
// properties), the transformation code, a register cell and the branding product name, in both export languages.
//
// The check is INDEPENDENT of the candidate's own xml-chars.ts / ooxml-read.ts: every XML part of the package is
// scanned for a raw forbidden character and for a forbidden numeric character reference (decimal or hex, any padding),
// computed by parsing the number, not by a regex list. A render that throws a RenderError is also reported (the
// fix's backstop), and is a FAIL for this probe (the expected behaviour is a well-formed file with U+FFFD).
// It also checks that harmless text survives unchanged (no over-replacement: tab, LF, Arabic, emoji, '&#11;' typed
// literally by a user, U+FFFD itself).
//
// Usage (from the disposable clone root):
//   node <this file> dist   -> imports packages/reporting/dist/index.js (after pnpm -r build)
//   node <this file> src    -> imports packages/reporting/src/index.ts (Node >= 23.6 type stripping; for mutants)
import { join } from "node:path";
import { createRequire } from "node:module";
const mode = process.argv[2] ?? "dist";
const root = process.cwd();
const require = createRequire(join(root, "packages/reporting/package.json"));
const JSZip = require("jszip");
const entry = mode === "src" ? "packages/reporting/src/index.ts" : "packages/reporting/dist/index.js";
const { render } = await import(join(root, entry));

const T_ID = "0190a000-0000-7000-8000-000000000001";
const rid = (n) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (value, authored = "user") => ({ type: "text", value, authored, validation: "validated", reason: null });
const money = (value) => ({ type: "decimal", value, unitKind: "currency", currency: "SAR", valueBasis: null, validation: "validated", reason: null });

const FORBIDDEN_CPS = [
  ...Array.from({ length: 0x20 }, (_, i) => i).filter((c) => c !== 0 && c !== 9 && c !== 10 && c !== 13),
  0xfffe,
  0xffff,
];
const SURROGATES = ["\uD800", "\uDFFF"];
const forbiddenString = FORBIDDEN_CPS.map((c) => String.fromCharCode(c)).join("") + SURROGATES.join("x");
const HARMLESS = "tab\there; Arabic موبايلي; emoji \u{1F680}; typed &#11; and &#x1F; literally; � itself";

const doc = (name, code, desc) => ({
  schemaVersion: 1,
  definitionCode: "registers",
  transformation: { id: T_ID, code, name },
  subject: { type: "transformation", id: T_ID, code, label: name },
  period: null,
  asOf: "2026-10-15T10:00:00.000Z",
  methodology: { versionId: rid(900), key: "playbook", versionNo: 3 },
  approvalState: "not_applicable",
  sections: [
    {
      key: "register",
      titleKey: "report.registers.raid.title",
      kind: "table",
      sources: [],
      columns: [
        { key: "code", labelKey: "report.registers.raid.code", valueKind: "text", unitKind: null },
        { key: "description", labelKey: "report.registers.raid.description", valueKind: "text", unitKind: null },
        { key: "amount", labelKey: "report.registers.raid.amount", valueKind: "decimal", unitKind: "currency" },
      ],
      rows: [
        { recordType: "raid_entry", recordId: rid(1), recordVersion: 1, cells: [text("R-1", "system"), text(desc), money("10.00")] },
        { recordType: "raid_entry", recordId: rid(2), recordVersion: 1, cells: [text("R-2", "system"), text(HARMLESS), money("2.50")] },
      ],
      totals: [],
      emptyKey: "report.empty.no_records",
    },
  ],
});
const options = (format, language, productName) => ({
  format,
  language,
  title: "Registers",
  branding: { productName, reportHeader: `Header${forbiddenString}`, reportFooter: `Footer${forbiddenString}` },
  snapshot: { id: rid(170), status: "generated", issueVersion: null },
  timeZone: "Asia/Riyadh",
});

const okCp = (cp) =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
function problems(xml) {
  const out = [];
  for (let i = 0; i < xml.length; i++) {
    const c = xml.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < xml.length) {
      const d = xml.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { i++; continue; }
    }
    if (!okCp(c)) { out.push(`raw U+${c.toString(16).toUpperCase().padStart(4, "0")} at ${i}`); if (out.length > 3) break; }
  }
  for (const m of xml.matchAll(/&#(x[0-9a-fA-F]+|[0-9]+);/g)) {
    const cp = m[1].startsWith("x") ? parseInt(m[1].slice(1), 16) : parseInt(m[1], 10);
    if (!okCp(cp)) out.push(`reference ${m[0]}`);
  }
  return out;
}

let failures = 0;
const cases = [
  ["name", (s) => doc(`Roaming${s}programme`, "TR-001", "plain"), "Mobily Transformation Hub"],
  ["code", (s) => doc("Roaming programme", `TR${s}001`, "plain"), "Mobily Transformation Hub"],
  ["cell", (s) => doc("Roaming programme", "TR-001", `Supplier${s}delay`), "Mobily Transformation Hub"],
  ["product", () => doc("Roaming programme", "TR-001", "plain"), `Mobily${forbiddenString}Hub`],
];
for (const [where, mk, productName] of cases) {
  for (const language of ["en", "ar"]) {
    for (const format of ["docx", "pptx", "xlsx"]) {
      const label = `${format}/${language}/${where}`;
      let out;
      try {
        out = await render(mk(forbiddenString), options(format, language, productName));
      } catch (err) {
        failures += 1;
        console.log(`${label}: FAIL render threw ${err?.name}: ${err?.message}`);
        continue;
      }
      const zip = await JSZip.loadAsync(out.bytes);
      const bad = [];
      let replacement = false;
      let harmless = false;
      for (const name of Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n))) {
        const xml = await zip.file(name).async("string");
        for (const p of problems(xml)) bad.push(`${name}: ${p}`);
        if (xml.includes("�")) replacement = true;
        if (xml.includes("\u{1F680}") && xml.includes("&amp;#11;")) harmless = true;
      }
      const ok = bad.length === 0 && replacement && harmless;
      if (!ok) failures += 1;
      console.log(
        `${label}: ${ok ? "PASS" : "FAIL"} ${out.bytes.byteLength} bytes; forbidden: ${bad.length === 0 ? "none" : bad.slice(0, 4).join(" | ")}; U+FFFD present: ${replacement}; harmless text intact: ${harmless}`,
      );
    }
  }
}
console.log(failures === 0 ? `RESULT(${mode}): all 24 renders are well-formed XML 1.0 with U+FFFD` : `RESULT(${mode}): ${failures} of 24 renders FAIL`);
process.exit(failures === 0 ? 0 : 1);
