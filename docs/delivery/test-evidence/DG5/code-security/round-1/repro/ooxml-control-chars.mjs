// code-security-reviewer DG5 RG2 round 1: do the DOCX / PPTX / XLSX renderers emit well-formed XML 1.0 when user text
// contains a C0 control character that the API accepts (U+0001..U+0008, U+000B, U+000C, U+000E..U+001F; only U+0000
// and lone surrogates are refused by hasInvalidCharacter)? XML 1.0 (§2.2 Char) forbids these characters, raw or as
// character references, so a part that contains one is not well-formed and Office refuses or "repairs" the file.
// Run from the disposable clone root after `pnpm -r build`:  node <this file>
import { join } from "node:path";
import { createRequire } from "node:module";
const root = process.cwd();
const require = createRequire(join(root, "packages/reporting/package.json"));
const JSZip = require("jszip");
const { render } = await import(join(root, "packages/reporting/dist/index.js"));
const T_ID = "0190a000-0000-7000-8000-000000000001";
const rid = (n) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (value, authored = "user") => ({ type: "text", value, authored, validation: "validated", reason: null });
const money = (value) => ({ type: "decimal", value, unitKind: "currency", currency: "SAR", valueBasis: null, validation: "validated", reason: null });
const doc = (desc) => ({
  schemaVersion: 1,
  definitionCode: "registers",
  transformation: { id: T_ID, code: "TR-001", name: "Synthetic roaming transformation" },
  subject: { type: "transformation", id: T_ID, code: "TR-001", label: "Synthetic roaming transformation" },
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
      rows: [{ recordType: "raid_entry", recordId: rid(1), recordVersion: 1, cells: [text("R-1", "system"), text(desc), money("10.00")] }],
      totals: [],
      emptyKey: "report.empty.no_records",
    },
  ],
});
const options = (format) => ({
  format,
  language: "en",
  title: "Registers",
  branding: { productName: "Mobily Transformation Hub" },
  snapshot: { id: rid(170), status: "generated", issueVersion: null },
  timeZone: "Asia/Riyadh",
});
// XML 1.0 Char production: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
const FORBIDDEN_RAW = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;
const FORBIDDEN_REF = /&#(x0*(?:[0-8bBcC]|1[0-9a-fA-F])|0*(?:[0-8]|1[124-9]|2[0-9]|3[01]));/;
const DESC = "Supplier\u0001delay\u000B(pasted)";
let bad = 0;
for (const format of ["docx", "pptx", "xlsx"]) {
  let out;
  try {
    out = await render(doc(DESC), options(format));
  } catch (err) {
    console.log(`${format}: render threw ${err?.name}: ${err?.message}`);
    continue;
  }
  const zip = await JSZip.loadAsync(out.bytes);
  const findings = [];
  let sawText = false;
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml"))) {
    const xml = await zip.file(name).async("string");
    if (xml.includes("Supplier")) sawText = true;
    if (FORBIDDEN_RAW.test(xml)) findings.push(`${name}: raw forbidden char U+${xml.match(FORBIDDEN_RAW)[0].charCodeAt(0).toString(16).padStart(4, "0")} near ${JSON.stringify(xml.slice(Math.max(0, xml.search(FORBIDDEN_RAW) - 30), xml.search(FORBIDDEN_RAW) + 20))}`);
    else if (FORBIDDEN_REF.test(xml)) findings.push(`${name}: forbidden character reference ${xml.match(FORBIDDEN_REF)[0]}`);
  }
  if (findings.length > 0) bad += 1;
  console.log(`${format}: ${out.bytes.byteLength} bytes; user text present: ${sawText}; not-well-formed parts: ${findings.length === 0 ? "none" : findings.join(" | ")}`);
}
console.log(bad === 0 ? "RESULT: every part is well-formed XML 1.0" : `RESULT: ${bad} format(s) emit XML that is not well-formed`);
process.exit(bad === 0 ? 0 : 1);
