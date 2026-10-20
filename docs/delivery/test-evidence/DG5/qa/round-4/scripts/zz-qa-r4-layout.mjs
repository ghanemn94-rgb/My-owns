// qa-verifier DG5 r4: lay out the jsdom DOM dumps (zz-qa-r4-dom-dump.test.tsx) in the pre-installed Chromium with the
// candidate's BUILT stylesheet, served with its fonts from apps/web/dist by a local static server (no API, no database),
// and measure F-DG5-144's conditions and the conflict banner's:
//  - page-level horizontal overflow (documentElement.scrollWidth - innerWidth) at 390 x 900, 320 x 900 and
//    1280 x 900 with the root font at 200 %;
//  - each workstream card and the conflict banner / its table inside the viewport;
//  - each scrolling .table-wrap is a focusable (tabIndex 0), named role=region;
//  - words broken inside a word (a word whose Range spans more than one line box) in column and row headers (must be 0)
//    and in value / text cells (reported: D-175 observation (n));
// and the CONTROL: the same measurement with the repair's declarations reverted in the browser (an injected stylesheet
// restoring the pre-repair values), which must reproduce the overflow, so the check is not vacuous.
// Run from the disposable clone root: node zz-qa-r4-layout.mjs <dumps dir> <out dir> <port>
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const [dumps, out, port] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 26690)];
const DIST = path.resolve("apps/web/dist");
const index = readFileSync(path.join(DIST, "index.html"), "utf8");
const links = (index.match(/<link rel="stylesheet"[^>]*>/g) ?? []).join("\n");
const TYPES = { ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".html": "text/html; charset=utf-8" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url.startsWith("/dump/")) {
    const html = readFileSync(path.join(dumps, path.basename(url)), "utf8").replace("<head>", `<head>${links}`);
    res.writeHead(200, { "content-type": TYPES[".html"] });
    return res.end(html);
  }
  const f = path.join(DIST, path.normalize(url));
  if (!f.startsWith(DIST) || !existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

const REVERT = `.workstreams{grid-template-columns:none!important}.workstreams>.workstream{min-inline-size:auto!important}
.conflict{grid-template-columns:none!important}.conflict>*{min-inline-size:auto!important}
.conflict .table thead th{white-space:nowrap!important}.conflict .table td{overflow-wrap:normal!important}`;

function measure() {
  const W = window.innerWidth;
  const broken = (el) => {
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode())
      for (const m of (t.textContent ?? "").matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(t, m.index);
        r.setEnd(t, m.index + m[0].length);
        const tops = new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top / 3)));
        if (tops.size > 1) words.push(m[0].slice(0, 40));
      }
    return words;
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right) };
  };
  const banner = document.querySelector("[data-state='conflict']");
  return {
    W,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    font: getComputedStyle(document.body).fontFamily.split(",")[0],
    pageOverflow: document.documentElement.scrollWidth - W,
    cards: Array.from(document.querySelectorAll("article.workstream")).map((a) => ({ code: a.dataset.workstream, ...box(a) })),
    regions: Array.from(document.querySelectorAll("main .table-wrap")).map((el) => ({
      in: el.closest("article.workstream")?.dataset.workstream ?? el.closest("section[aria-labelledby],section[aria-label]")?.getAttribute("aria-label") ?? "-",
      tabIndex: el.tabIndex,
      role: el.getAttribute("role"),
      name: (el.getAttribute("aria-label") ?? "").trim(),
      scrolls: el.scrollWidth > el.clientWidth + 1,
    })),
    banner: banner ? { box: box(banner), table: box(banner.querySelector("table")) } : null,
    headerBreaks: Array.from(document.querySelectorAll(banner ? "[data-state='conflict'] th" : "article.workstream th")).flatMap(broken),
    valueBreaks: Array.from(document.querySelectorAll(banner ? "[data-state='conflict'] td" : "article.workstream .text-cell")).flatMap(broken),
    workstreamsCols: (() => { const g = document.querySelector(".workstreams"); return g ? getComputedStyle(g).gridTemplateColumns : null; })(),
  };
}

const browser = await chromium.launch();
const results = [];
const failures = [];
mkdirSync(path.join(out, "shots"), { recursive: true });
for (const file of readdirSync(dumps).filter((f) => f.endsWith(".html")).sort())
  for (const [label, width, font] of [["390", 390, 0], ["320", 320, 0], ["200pct", 1280, 200]])
    for (const control of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`http://127.0.0.1:${port}/dump/${file}`);
      await page.evaluate(() => document.fonts.ready);
      if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
      if (control) await page.addStyleTag({ content: REVERT });
      await page.waitForTimeout(150);
      const m = await page.evaluate(measure);
      const name = `${file.replace(".html", "")}-${label}${control ? "-CONTROL-reverted" : ""}`;
      await page.screenshot({ path: path.join(out, "shots", `${name}.png`), fullPage: true });
      await page.close();
      const f = [];
      if (m.pageOverflow > 1) f.push(`page overflow ${m.pageOverflow}px`);
      for (const c of m.cards) if (c.left < -1 || c.right > m.W + 1) f.push(`card ${c.code} [${c.left}..${c.right}]`);
      if (m.banner) for (const [k, b] of Object.entries(m.banner)) if (!b || b.left < -1 || b.right > m.W + 1) f.push(`${k} [${b?.left}..${b?.right}]`);
      for (const r of m.regions) if (r.scrolls && (r.tabIndex !== 0 || r.role !== "region" || !r.name)) f.push(`bare scrolling region in ${r.in}`);
      if (m.headerBreaks.length) f.push(`header broken inside a word: ${m.headerBreaks.join(" | ")}`);
      const setup = file.startsWith("diagnose") ? m.cards.length === 6 : m.banner !== null;
      results.push({ name, control, setup, failures: f, ...m, cards: m.cards.length, scrollingRegions: m.regions.filter((r) => r.scrolls).length, regions: m.regions.length });
      if (!setup) failures.push(`${name}: set-up failed`);
      if (!control && f.length) failures.push(`${name}: ${f.join("; ")}`);
      if (control && label !== "200pct" && !f.some((x) => x.startsWith("page overflow"))) failures.push(`${name}: CONTROL did not reproduce the overflow (check vacuous)`);
    }
await browser.close();
server.close();
writeFileSync(path.join(out, "layout-results.json"), JSON.stringify(results, null, 1));
for (const r of results)
  console.log(`${r.name.padEnd(42)} lang=${r.lang} dir=${r.dir} font=${r.font} overflow=${r.pageOverflow} cards=${r.cards} regions=${r.regions} scrolling=${r.scrollingRegions} headerBreaks=${r.headerBreaks.length} valueBreaks=${r.valueBreaks.length} cols=${r.workstreamsCols} -> ${r.failures.length ? r.failures.join("; ") : "ok"}`);
console.log(failures.length ? `FAILURES ${failures.length}:\n${failures.join("\n")}` : "ALL REPAIRED CASES OK; every 390/320 control reproduces the overflow");
process.exit(failures.length ? 1 : 0);
