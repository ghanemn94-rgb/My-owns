// qa-verifier DG5 r2: dump what a reader sees in each sample (en/ar). Copied into the disposable clone and run there
// with Node 24 type stripping: `node inspect-samples.ts <samples dir>`.
//  - PDF: the package's own PDF reader (packages/reporting/src/pdf/read.ts: drawn runs with positions and ToUnicode);
//    lines are grouped by page and baseline; Arabic lines are ordered right to left with each Arabic run in logical order.
//  - DOCX/PPTX/XLSX: an INDEPENDENT reading (system `unzip -p` of the XML parts, regex over w:t / a:t / <t>, plus the
//    direction markers w:bidi, w:rtl, rtl="1", rightToLeft="1").
//  - CSV: the text.
// For each file it prints the checks: provenance (B0004 wording), the demo illustrative label, "Provisional"/"مؤقت",
// DG0-DG7 references, and the first lines.
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readPdf } from "./packages/reporting/src/pdf/read.ts";

const dir = process.argv[2]!;
const AR = /[؀-ۿﹰ-﻿]/;
const B0004 = readFileSync("docs/source/playbook.md", "utf8");
const prov = /practical synthesis/i;
const demoLabel = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" };
const provisional = { en: "Provisional", ar: "مؤقت" };
const squash = (s: string) => s.normalize("NFKC").replace(/[ً-ٰٟـ\s]+/g, "");

function pdfLines(bytes: Buffer, lang: string): string[] {
  const pdf = readPdf(new Uint8Array(bytes));
  const rows = new Map<string, typeof pdf.shown>();
  for (const s of pdf.shown) {
    const k = `${s.page}:${s.y.toFixed(1)}`;
    rows.set(k, [...(rows.get(k) ?? []), s]);
  }
  return [...rows.entries()].map(([k, r]) => {
    const sorted = [...r].sort((a, b) => (lang === "ar" ? b.x - a.x : a.x - b.x));
    return `p${k.split(":")[0]} ` + sorted.map((s) => (AR.test(s.text) ? s.logical : s.text)).join(lang === "ar" ? " " : " ");
  });
}

function xmlParts(file: string, re: RegExp): string[] {
  const names = execFileSync("unzip", ["-Z1", file]).toString().split("\n").filter((n) => re.test(n));
  return names.map((n) => execFileSync("unzip", ["-p", file, n], { maxBuffer: 64 << 20 }).toString("utf8"));
}
const texts = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) =>
    m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );

console.log(`B0004 present in playbook source: ${prov.test(B0004)}`);
for (const f of readdirSync(dir).filter((x) => /\.(pdf|docx|pptx|xlsx|csv)$/.test(x)).sort()) {
  const file = path.join(dir, f);
  const lang = /-ar\./.test(f) ? "ar" : "en";
  const ext = path.extname(f).slice(1);
  let out: string[] = [];
  let dirInfo = "";
  if (ext === "pdf") out = pdfLines(readFileSync(file), lang);
  else if (ext === "docx") {
    const parts = xmlParts(file, /^word\/(document|header\d*|footer\d*)\.xml$/);
    out = parts.flatMap((x) => texts(x, "w:t"));
    dirInfo = `w:bidi=${parts.some((x) => /<w:bidi\/>|<w:bidi w:val="(1|true)"\/>/.test(x))} w:rtl=${parts.some((x) => /<w:rtl\/>|<w:rtl w:val="(1|true)"\/>/.test(x))}`;
  } else if (ext === "pptx") {
    const parts = xmlParts(file, /^ppt\/slides\/slide\d+\.xml$/);
    out = parts.flatMap((x, i) => [`--slide ${i + 1}`, ...texts(x, "a:t")]);
    dirInfo = `slides=${parts.length} rtl="1" in ${parts.filter((x) => / rtl="1"/.test(x)).length}`;
  } else if (ext === "xlsx") {
    const parts = xmlParts(file, /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/);
    out = parts.flatMap((x) => [...texts(x, "t"), ...[...x.matchAll(/<f>([^<]*)<\/f>/g)].map((m) => `FORMULA =${m[1]}`)]);
    dirInfo = `rightToLeft sheets=${parts.filter((x) => /rightToLeft="(1|true)"/.test(x)).length}/${parts.filter((x) => /<worksheet/.test(x)).length}`;
  } else out = readFileSync(file, "utf8").split(/\r?\n/);
  const all = out.join("\n");
  const has = (s: string) => all.includes(s) || squash(all).includes(squash(s));
  console.log(`\n===== ${f} (${readFileSync(file).byteLength} B) ${dirInfo}`);
  console.log(
    `checks: provenance(practical synthesis|ممارسة)=${prov.test(all) || /توليفة|خلاصة عملية/.test(all)} demoLabel=${has(demoLabel[lang])} provisional=${has(provisional[lang])} DG0-7=${/\bDG[0-7]\b/.test(all)} arabicText=${AR.test(all)}`,
  );
  console.log(out.slice(0, 45).map((l) => `  | ${l.slice(0, 220)}`).join("\n"));
  if (out.length > 45) console.log(`  | ... (${out.length - 45} more)`);
}
