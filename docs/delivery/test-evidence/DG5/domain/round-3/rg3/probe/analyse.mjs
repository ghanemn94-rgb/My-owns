// domain-reviewer DG5 round 1: compares what my demo-stack probe recorded (API bodies, page text, export files) with
// the source (docs/source/playbook.blocks.json, B0xxx) and the ADR-0050 §2 label texts. Prints one line per check:
// "OK <id> ..." or "MISMATCH <id> ...", and exits 1 if any MISMATCH. Usage (from the clone root, Node 24 strips the
// TypeScript of the reporting readers):  node analyse.mjs <probe-out-dir>
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readPdf, lines, plain } from "./packages/reporting/src/pdf/read.ts";
import { readOoxml, xmlTexts } from "./packages/reporting/src/ooxml-read.ts";
import { readXlsx } from "./packages/reporting/src/xlsx/read.ts";

const OUT = process.argv[2];
const blocks = JSON.parse(readFileSync("docs/source/playbook.blocks.json", "utf8"));
const B = (id) => blocks.find((b) => b.id === id);
const J = (rel) => JSON.parse(readFileSync(path.join(OUT, rel), "utf8"));
const T = (rel) => (existsSync(path.join(OUT, rel)) ? readFileSync(path.join(OUT, rel), "utf8") : null);
let bad = 0;
const ok = (id, cond, detail = "") => {
  if (!cond) bad++;
  console.log(`${cond ? "OK" : "MISMATCH"} ${id}${detail ? " :: " + detail : ""}`);
};
const squash = (s) => plain(String(s)).replace(/[\sـ‎‏⁦-⁩]+/g, "");

const B0004 = B("B0004").text;
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" };
const APPROVAL = { en: "Synthetic demonstration - approves nothing real", ar: "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي" };

// ---------------------------------------------------------------- API vs source
const en = "api/en";
ok("B0004.api", J(`${en}/block-B0004.json`).textEn === B0004);
const gq = J(`${en}/guiding-questions.json`).items.map((q) => q.textEn);
const b16 = B("B0016").rows[0][0];
ok("B0016.four-questions", gq.length === 4 && gq.every((q) => b16.includes(q)), JSON.stringify(gq));
const b124 = B("B0124").rows[0][0];
ok("B0124.api", (J(`${en}/block-B0124.json`).textEn ?? "").includes("aligns with PMI Benefits Realization Management logic"), b124.slice(0, 80));
const hq = J(`${en}/health-check-questions.json`).items;
const b150 = B("B0150").rows.flat().filter((c) => /^☐ \d+\./.test(c)).map((c) => c.replace(/^☐ \d+\. /, ""));
ok("B0150.25-questions", hq.length === 25 && hq.every((q, i) => q.textEn === b150[i]), `${hq.length} served, ${b150.length} in source`);
for (const [i, q] of hq.entries()) if (q.textEn !== b150[i]) console.log(`   q${i + 1}: served ${JSON.stringify(q.textEn)} source ${JSON.stringify(b150[i])}`);
const lt = J(`${en}/launch-plan-template.json`).windows;
const b134 = B("B0134").rows.slice(1);
ok(
  "B0134.windows",
  lt.length === 3 &&
    lt.every((w, i) => w.labelEn === b134[i][0] && w.objectiveEn === b134[i][1] && w.actionsSourceEn === b134[i][2] && w.outputsSourceEn === b134[i][3]),
  lt.map((w) => `${w.labelEn}|${w.objectiveEn}`).join("; "),
);
for (const [i, w] of lt.entries()) {
  const acts = b134[i][2].replace(/\.$/, "").split("; ");
  const served = w.items.filter((x) => x.itemKind === "action").map((x) => x.textEn.toLowerCase());
  ok(`B0134.${w.code}.every-action-a-task`, acts.every((a) => served.includes(a.toLowerCase())), `${acts.length} source actions, served ${JSON.stringify(served)}`);
}
// roaming example (B0145) and chains (B0147)
const roam = J(`${en}/roaming.json`);
console.log(`   roaming: code=${roam.code} name=${JSON.stringify(roam.name ?? roam.nameEn)} northStar=${JSON.stringify(roam.northStar ?? roam.northStarEn ?? "")}`);
const tr = J(`${en}/traceability.json`);
const byId = new Map(tr.nodes.map((n) => [n.recordId, n]));
const out = new Map();
for (const e of tr.edges) {
  const from = e.fromId ?? e.from?.recordId ?? e.sourceId ?? e.from;
  const to = e.toId ?? e.to?.recordId ?? e.targetId ?? e.to;
  out.set(from, [...(out.get(from) ?? []), to]);
}
const paths = [];
const walk = (id, acc) => {
  const nx = out.get(id) ?? [];
  if (nx.length === 0 || acc.length > 8) return paths.push(acc);
  for (const n of nx) walk(n, [...acc, n]);
};
for (const n of tr.nodes.filter((n) => n.recordType === "diagnostic_finding")) walk(n.recordId, [n.recordId]);
const lineOf = (p) => p.map((id) => byId.get(id)?.label ?? `?${id}`).join(" -> ");
const allLines = paths.map(lineOf);
for (const row of B("B0147").rows.slice(1)) {
  const want = row.join(" -> ");
  ok(`B0147.chain "${row[0]}"`, allLines.includes(want), allLines.filter((l) => l.startsWith(row[0])).join(" || "));
}
console.log(`   traceability: ${tr.nodes.length} nodes, ${tr.edges.length} edges; edge keys ${Object.keys(tr.edges[0] ?? {}).join(",")}`);
// environment and walkthrough
const env = J(`${en}/environment.json`);
ok("env.demo", env.kind === "demo" && env.synthetic === true, JSON.stringify(env));
const wt = J(`${en}/walkthrough.json`);
const steps = wt.steps ?? wt.items ?? [];
ok("walkthrough.twelve-steps", steps.length === 12, steps.map((s) => s.code ?? s.key).join(","));
// navigation per demo role
for (const f of readdirSync(path.join(OUT, en)).filter((f) => f.startsWith("navigation-"))) {
  const n = J(`${en}/${f}`);
  const areas = (n.areas ?? n.items ?? []).map((a) => a.code ?? a.key);
  console.log(`   ${f}: ${areas.length} areas: ${areas.join(",")}`);
}

// ---------------------------------------------------------------- page text (rendered)
for (const lang of ["en", "ar"]) {
  const dir = path.join(OUT, "text", lang);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir);
  for (const f of files) {
    const t = readFileSync(path.join(dir, f), "utf8");
    const want = lang === "ar" ? 'dir=rtl' : 'dir=ltr';
    if (!t.includes(want)) ok(`ui.${lang}.${f}.direction`, false, t.split("\n")[1]);
  }
  ok(`ui.${lang}.direction-all`, files.every((f) => readFileSync(path.join(dir, f), "utf8").includes(lang === "ar" ? "dir=rtl" : "dir=ltr")), `${files.length} screens`);
  const banner = lang === "en" ? "synthetic" : "اصطناعي";
  const noBanner = files.filter((f) => !readFileSync(path.join(dir, f), "utf8").includes(banner));
  ok(`ui.${lang}.synthetic-text-on-every-screen`, noBanner.length === 0, noBanner.join(","));
  const about = T(`text/${lang}/tl-about.txt`) ?? "";
  if (lang === "en") ok("ui.en.about.B0004", about.includes(B0004));
  const reader = T(`text/${lang}/tl-reader-B0004.txt`) ?? "";
  if (lang === "en") ok("ui.en.reader.B0004", reader.includes(B0004));
  const gate = T(`text/${lang}/tl-gate-G1.txt`) ?? "";
  ok(`ui.${lang}.gate-G1.synthetic-approval-label`, gate.includes(APPROVAL[lang]));
  const fin = T(`text/${lang}/fin-finance-validation.txt`) ?? "";
  ok(`ui.${lang}.finance-queue.synthetic-approval-label`, fin.includes(APPROVAL[lang]));
  const charter = T(`text/${lang}/tl-charter.txt`) ?? "";
  ok(`ui.${lang}.charter.record-badge`, charter.includes(LABEL[lang]));
  const hc = T(`text/${lang}/tl-health-check.txt`) ?? "";
  if (lang === "en") for (const r of B("B0152").rows.slice(1)) console.log(`   health-check page shows band "${r[0]}": ${hc.includes(r[0])}; text: ${hc.includes(r[1])}`);
  const d90 = T(`text/${lang}/tl-day-90-test.txt`) ?? "";
  if (lang === "en")
    ok("ui.en.day-90.six-questions-verbatim", ["B0136", "B0137", "B0138", "B0139", "B0140", "B0141"].every((b) => d90.includes(B(b).text)),
      ["B0136", "B0137", "B0138", "B0139", "B0140", "B0141"].filter((b) => !d90.includes(B(b).text)).join(","));
  const trc = T(`text/${lang}/tl-traceability.txt`) ?? "";
  if (lang === "en") for (const row of B("B0147").rows.slice(1)) console.log(`   traceability page shows all five labels of "${row[0]}": ${row.every((c) => trc.includes(c))}`);
}

// ---------------------------------------------------------------- export files
for (const lang of ["en", "ar"]) {
  const dir = path.join(OUT, "exports", lang);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => !f.endsWith(".json")).sort()) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, f)));
    const fmt = f.split(".").pop();
    let text = "";
    let rtl = null;
    if (fmt === "pdf") {
      const pdf = readPdf(bytes);
      const rows = new Map();
      for (const x of pdf.shown) { const k = `${x.page}:${x.y.toFixed(1)}`; rows.set(k, [...(rows.get(k) ?? []), x]); }
      const AR = /[\u0600-\u06FF\uFE70-\uFEFF]/;
      const rtlLines = [...rows.values()].map((r) => [...r].sort((a, b) => b.x - a.x).map((x) => (AR.test(x.text) ? x.logical : x.text)).join(""));
      text = [...pdf.shown.flatMap((s) => [s.text, s.logical, plain(s.logical)]), ...lines(pdf), ...rtlLines].join("\n");
    } else if (fmt === "xlsx") {
      const wb = await readXlsx(bytes);
      text = wb.sheets.flatMap((s) => [s.name, ...s.rows.flatMap((r) => r.map((c) => c.text ?? c.value ?? ""))]).join("\n");
      rtl = wb.sheets.every((s) => s.rtl);
    } else if (fmt === "docx" || fmt === "pptx") {
      const o = await readOoxml(bytes, fmt === "docx" ? /^word\/(document|footer\d*|header\d*)\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/);
      const xml = [...o.parts.values()].join("\n");
      text = [...o.parts.values()].flatMap(xmlTexts).join("\n");
      rtl = fmt === "docx" ? /<w:bidi\/>|<w:bidi w:val="(1|true)"\/>/.test(xml) : / rtl="1"/.test(xml);
    } else text = Buffer.from(bytes).toString("utf8");
    const s = squash(text);
    const prov = s.includes(squash(B0004)) || (lang === "ar" && /PMI/.test(text) && /برايتلاين|Brightline/.test(text));
    const label = s.includes(squash(LABEL[lang]));
    const dg = /\bDG[0-7]\b/.test(text);
    const official = /official PMI|PMI[- ]certified|certified by PMI/i.test(text);
    ok(`export.${lang}.${f}`, prov && label && !dg && !official, `B0004=${s.includes(squash(B0004)) ? "verbatim-en" : prov ? "ar-rendering" : "MISSING"} label=${label} DG=${dg} officialClaim=${official} rtl=${rtl}`);
  }
}
console.log(bad === 0 ? "ALL OK" : `${bad} MISMATCH`);
process.exit(bad === 0 ? 0 : 1);
