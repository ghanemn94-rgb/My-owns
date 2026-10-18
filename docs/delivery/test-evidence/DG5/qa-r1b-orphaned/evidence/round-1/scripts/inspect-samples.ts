import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { lines, readPdf } from "./packages/reporting/src/pdf/read.ts";
import { readOoxml, xmlTexts } from "./packages/reporting/src/ooxml-read.ts";
import { readXlsx } from "./packages/reporting/src/xlsx/read.ts";
for (const f of process.argv.slice(2)) {
  const b = new Uint8Array(readFileSync(f));
  const n = basename(f);
  console.log(`\n===== ${n} (${b.byteLength} bytes)`);
  if (n.endsWith(".pdf")) {
    const pdf: any = await readPdf(b);
    const ls: string[] = lines(pdf);
    console.log(`pages=${pdf.pages?.length ?? "?"} visual lines=${ls.length}`);
    for (const l of ls.slice(0, 45)) console.log("  | " + l);
  } else if (n.endsWith(".xlsx")) {
    const wb: any = await readXlsx(b);
    for (const sh of wb.sheets) {
      console.log(`sheet "${sh.name}" sheet keys=${Object.keys(sh).join(",")} rightToLeft=${JSON.stringify(sh.rightToLeft ?? sh.rtl ?? null)} rows=${sh.rows.length}`);
      for (const r of sh.rows.slice(0, 14)) console.log("  | " + r.map((c: any) => (c.formula ? `=${c.formula}` : String(c.text ?? c.value ?? ""))).join(" ¦ "));
    }
  } else {
    const o: any = await readOoxml(b, /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/);
    console.log(`parts: ${[...o.parts.keys()].join(", ")}`);
    for (const [k, xml] of [...o.parts.entries()].slice(0, 4) as [string, string][]) {
      console.log(`-- ${k}: rtl markers (w:bidi / w:rtl / rtl="1")=${(xml.match(/<w:bidi\b|<w:rtl\b|rtl="1"/g) ?? []).length} texts:`);
      console.log("  | " + xmlTexts(xml).slice(0, 40).join(" ¦ "));
    }
  }
}
