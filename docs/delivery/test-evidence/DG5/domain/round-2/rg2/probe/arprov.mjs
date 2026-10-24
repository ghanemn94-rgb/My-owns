import { readFileSync, readdirSync } from "node:fs";
import { readPdf, lines, plain } from "./packages/reporting/src/pdf/read.ts";
import { readOoxml, xmlTexts } from "./packages/reporting/src/ooxml-read.ts";
import { readXlsx } from "./packages/reporting/src/xlsx/read.ts";
const dir = process.argv[2];
const ar = JSON.parse(readFileSync(process.argv[3], "utf8")).textAr;
const sq = (s) => plain(String(s)).replace(/[\sـ‎‏⁦-⁩]+/g, "");
const AR = /[؀-ۿﹰ-﻿]/;
for (const f of readdirSync(dir).filter((f) => !f.endsWith(".json")).sort()) {
  const b = new Uint8Array(readFileSync(`${dir}/${f}`)); const fmt = f.split(".").pop(); let t = "";
  if (fmt === "pdf") { const p = readPdf(b); const rows = new Map(); for (const x of p.shown) { const k = `${x.page}:${x.y.toFixed(1)}`; rows.set(k, [...(rows.get(k) ?? []), x]); }
    t = [...[...rows.values()].map((r) => [...r].sort((a, c) => c.x - a.x).map((x) => (AR.test(x.text) ? x.logical : x.text)).join("")), ...lines(p)].join("\n"); }
  else if (fmt === "xlsx") { const w = await readXlsx(b); t = w.sheets.flatMap((s) => s.rows.flatMap((r) => r.map((c) => c.text ?? c.value ?? ""))).join("\n"); }
  else if (fmt === "docx" || fmt === "pptx") { const o = await readOoxml(b, /\.xml$/); t = [...o.parts.values()].flatMap(xmlTexts).join("\n"); }
  else t = Buffer.from(b).toString("utf8");
  // PDF lines may wrap: check that every wrapped piece is in order by squashing everything
  console.log(`${sq(t).includes(sq(ar)) ? "OK" : "MISSING"} ar B0004 (block textAr) in ${f}`);
}
