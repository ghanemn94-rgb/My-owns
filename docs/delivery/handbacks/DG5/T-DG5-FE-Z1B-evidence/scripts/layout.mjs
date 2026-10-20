// T-DG5-FE-Z1B DB-free reproduction of F-DG5-146 (not part of the product; written for this task, qa's script was
// read, not imported). Lays out each DOM dump (dump-hook.ts) in the pre-installed Chromium with the BUILT stylesheet
// and fonts of apps/web/dist (served on 127.0.0.1:<port>; no API, no database), at 390 x 844 and at 1280 x 900 with
// the root font at 200 %, and checks the finding's final condition document.documentElement.scrollWidth -
// innerWidth <= 1, plus: every table.table in the document has a horizontally scrolling (overflow-x auto|scroll)
// ancestor that is focusable (tabIndex 0), role=region and has a non-empty aria-label.
// Usage: node layout.mjs <repo> <dumps dir> <out json> <port>   (exit 1 if any case fails)
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [REPO, DUMPS, OUT, PORT] = [process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5])];
const { chromium } = createRequire(path.join(REPO, "package.json"))("@playwright/test");
const DIST = path.join(REPO, "apps/web/dist");
const links = (readFileSync(path.join(DIST, "index.html"), "utf8").match(/<link rel="stylesheet"[^>]*>/g) ?? []).join("");
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url.startsWith("/dump/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(path.join(DUMPS, path.basename(url)), "utf8").replace("<head>", `<head>${links}`));
  }
  const f = path.join(DIST, path.normalize(url));
  if (!f.startsWith(DIST) || !existsSync(f)) return res.writeHead(404).end();
  const type = { ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" }[path.extname(f)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type }).end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
const rows = [];
let failing = 0;
for (const file of readdirSync(DUMPS).filter((f) => f.endsWith(".html")).sort()) {
  for (const [label, width, height, font] of [["390 px", 390, 844, 0], ["200 % text", 1280, 900, 200]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:${PORT}/dump/${encodeURIComponent(file)}`);
    await page.evaluate(() => document.fonts.ready);
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    const m = await page.evaluate(() => {
      const W = window.innerWidth;
      const tables = Array.from(document.querySelectorAll("table.table")).map((t) => {
        let region = null;
        for (let a = t.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === "auto" || ox === "scroll") { region = a; break; }
        }
        const r = (region ?? t).getBoundingClientRect();
        return {
          table: (t.getAttribute("class") ?? "") + Array.from(t.attributes).filter((x) => x.name.startsWith("data-")).map((x) => ` [${x.name}]`).join(""),
          tableWidth: Math.round(t.getBoundingClientRect().width),
          region: region ? { cls: region.className, tabIndex: region.tabIndex, role: region.getAttribute("role"), name: region.getAttribute("aria-label") ?? "" } : null,
          box: [Math.round(r.left), Math.round(r.right)],
        };
      });
      return { W, lang: document.documentElement.lang, pageOverflow: document.documentElement.scrollWidth - W, tables };
    });
    const problems = [];
    if (m.pageOverflow > 1) problems.push(`page scrolls ${m.pageOverflow} px horizontally`);
    for (const t of m.tables) {
      if (!t.region) problems.push(`${t.table}: in no scroll container, box [${t.box}]`);
      else if (t.region.tabIndex !== 0 || t.region.role !== "region" || t.region.name.trim() === "")
        problems.push(`${t.table}: bare scroll container .${t.region.cls}`);
    }
    if (problems.length) failing++;
    rows.push({ file, case: label, ...m, problems });
    console.log(`${problems.length ? "FAIL" : "ok  "} ${label.padEnd(10)} ${file.slice(0, 120)}${problems.length ? "\n       " + problems.join("\n       ") : ""}`);
    await page.close();
  }
}
await browser.close();
server.close();
writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(`cases ${rows.length}; failing ${failing}`);
process.exit(failing ? 1 : 0);
