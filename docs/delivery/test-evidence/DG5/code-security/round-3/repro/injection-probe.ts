// Reviewer probe (REQ-S13-006): adversarial user texts through the real CSV and XLSX renderers.
import { render } from "../rv/packages/reporting/src/index.ts";
import { options, sampleDocument } from "../rv/packages/reporting/src/test-fixtures.ts";
import JSZip from "../rv/packages/reporting/node_modules/jszip/lib/index.js";
const payloads = ['=HYPERLINK("http://x","y")', "+1+1", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1", "=cmd|' /C calc'!A0",
  ' =1+1', "＝1+1", "'=already", 'a"b,=c'];
const doc = sampleDocument(payloads.map((d, i) => ({ code: `RAID-${100 + i}`, description: d, amount: `${i}.50` })), "60.50"); // 0.50+1.50+...+10.50 = 60.50
const csv = new TextDecoder().decode((await render(doc, options("csv"))).bytes);
let fail = 0;
for (const p of payloads) {
  const trig = /^[=+\-@\t\r]/.test(p);
  const q = /[",\r\n]/.test("'" + p) || /[",\r\n]/.test(p);
  const enc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const want = enc(trig ? `'${p}` : p);
  const ok = csv.includes(`,${want},`) || csv.includes(`,${want}\r\n`);
  if (!ok) fail++;
  console.log(`CSV ${ok ? "OK " : "BAD"} trigger=${trig} ${JSON.stringify(p)} -> expected field ${JSON.stringify(want)}${q ? " (quoted)" : ""}`);
}
const x = await render(doc, options("xlsx"));
const zip = await JSZip.loadAsync(x.bytes);
const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
let formulas: string[] = [];
for (const s of sheets) { const xml = await zip.file(s)!.async("string"); formulas = formulas.concat([...xml.matchAll(/<f>(.*?)<\/f>/g)].map((m) => m[1]!)); }
const styles = await zip.file("xl/styles.xml")!.async("string");
console.log(`XLSX sheets=${sheets.length} formulas=${JSON.stringify(formulas)} quotePrefix styles=${(styles.match(/quotePrefix="1"/g) ?? []).length}`);
if (formulas.some((f) => !/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/.test(f))) fail++;
for (const p of payloads.filter((p) => /^[=+\-@\t\r]/.test(p))) {
  const xml = (await Promise.all(sheets.map((f) => zip.file(f)!.async("string")))).join("\n");
  const esc = p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;");
  const m = new RegExp(`<c r="[A-Z]+\\d+" t="inlineStr" s="(\\d+)"><is><t xml:space="preserve">${esc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</t>`).exec(xml);
  const ok = m !== null && Number(m[1]) % 2 === 1;
  if (!ok) fail++;
  console.log(`XLSX ${ok ? "OK " : "BAD"} ${JSON.stringify(p)} inlineStr style=${m?.[1]} (odd = quotePrefix)`);
}
console.log(`failures=${fail}`);
process.exit(fail === 0 ? 0 : 1);
