// qa-verifier DG5 r4: lay out the P5 screen DOM snapshots (zz-qa-dump-hook.ts) in the pre-installed Chromium with the
// candidate's BUILT stylesheet and fonts (served from apps/web/dist by a local static server; no API, no database), at
// 390 x 844 and at 1280 x 900 with the root font at 200 %, and record per snapshot:
//  - page-level horizontal overflow (documentElement.scrollWidth - innerWidth) and, if any, its outermost culprits;
//  - every horizontally scrolling element in <main>: focusable (tabIndex >= 0), role=region, non-empty aria-label;
//  - axe (wcag2a/2aa/21a/21aa, the rule set of apps/web/e2e/support/ui.ts): serious and critical violations.
// A static snapshot has no script: it checks layout, structure and the accessibility tree, not behaviour.
// Run from a disposable clone root: node zz-qa-r4-p5-layout.mjs <dist dir> <dumps dir> <out dir> <port>
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const [DIST, dumps, out, port] = [path.resolve(process.argv[2]), process.argv[3], process.argv[4], Number(process.argv[5] ?? 26691)];
const links = (readFileSync(path.join(DIST, "index.html"), "utf8").match(/<link rel="stylesheet"[^>]*>/g) ?? []).join("\n");
const TYPES = { ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url.startsWith("/dump/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(path.join(dumps, path.basename(url)), "utf8").replace("<head>", `<head>${links}`));
  }
  const f = path.join(DIST, path.normalize(url));
  if (!f.startsWith(DIST) || !existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

function measure() {
  const W = window.innerWidth;
  const inScroller = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
    }
    return false;
  };
  const past = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > W + 1 || r.left < -1);
  };
  const culprits = [];
  if (document.documentElement.scrollWidth - W > 1)
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!past(el) || inScroller(el)) continue;
      if (el.parentElement && el.parentElement !== document.body && past(el.parentElement) && !inScroller(el.parentElement)) continue;
      const r = el.getBoundingClientRect();
      culprits.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 3).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      if (culprits.length >= 6) break;
    }
  const regions = [];
  for (const el of Array.from(document.querySelectorAll("main *"))) {
    if (!el.checkVisibility()) continue;
    const ox = getComputedStyle(el).overflowX;
    if ((ox !== "auto" && ox !== "scroll") || el.scrollWidth <= el.clientWidth + 1) continue;
    regions.push({
      el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).join(".")}`,
      ok: el.tabIndex >= 0 && el.getAttribute("role") === "region" && (el.getAttribute("aria-label") ?? "").trim() !== "",
    });
  }
  return { W, lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector("main h1")?.textContent?.trim().slice(0, 60) ?? null, pageOverflow: document.documentElement.scrollWidth - W, culprits, regions };
}

const browser = await chromium.launch();
const rows = [];
const files = readdirSync(dumps).filter((f) => f.endsWith(".html")).sort();
for (const file of files) {
  const row = { file };
  for (const [label, width, height, font] of [["390", 390, 844, 0], ["200pct", 1280, 900, 200]]) {
    const ctx = await browser.newContext({ viewport: { width, height } }); // AxeBuilder needs an explicit context
    const page = await ctx.newPage();
    try {
      await page.goto(`http://127.0.0.1:${port}/dump/${encodeURIComponent(file)}`);
      await page.evaluate(() => document.fonts.ready);
      if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
      await page.waitForTimeout(50);
      const m = await page.evaluate(measure);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      m.axeSerious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}(${v.impact}): ${v.nodes.slice(0, 3).map((x) => x.target.join(" ")).join(", ")}`);
      m.axeOther = axe.violations.filter((v) => !(v.impact === "serious" || v.impact === "critical")).map((v) => `${v.id}(${v.impact})`);
      row[label] = m;
    } catch (e) {
      row[label] = { error: String(e).slice(0, 300) };
    }
    await ctx.close();
  }
  rows.push(row);
}
await browser.close();
server.close();
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "p5-layout-results.json"), JSON.stringify(rows, null, 1));
const bad = (m) => m.error || m.pageOverflow > 1 || m.regions.some((r) => !r.ok) || m.axeSerious.length;
let nBad = 0;
for (const r of rows) {
  const flags = ["390", "200pct"].filter((k) => bad(r[k]));
  if (flags.length) nBad++;
  console.log(`${flags.length ? "BAD " : "ok  "} ${r.file.slice(0, 110)} | ${["390", "200pct"].map((k) => r[k].error ? `${k}: error ${r[k].error}` : `${k}: lang=${r[k].lang} overflow=${r[k].pageOverflow} regions=${r[k].regions.length}${r[k].regions.some((x) => !x.ok) ? " (BARE)" : ""} axeSerious=${r[k].axeSerious.length}${r[k].axeSerious.length ? " " + r[k].axeSerious.join(" ; ") : ""}${r[k].culprits.length ? " culprits " + r[k].culprits.join(", ") : ""}`).join(" | ")}`);
}
console.log(`snapshots ${rows.length}; with a failing condition ${nBad}`);
process.exit(nBad ? 1 : 0);
