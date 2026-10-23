// T-DG5-FE-Z1B DB-free visual evidence (not part of the product): viewport screenshots at 390 x 844 of selected DOM
// dumps (before / after the fix) with the BUILT stylesheet, and, after the fix, a keyboard check per table region:
// Tab from the page start reaches the region (document.activeElement), its focus outline is visible, and the arrow key
// in the reading direction (ArrowRight en, ArrowLeft ar) scrolls the table inside the region (scrollLeft changes)
// while the page itself stays at scrollX 0.
// Usage: node shots.mjs <repo> <dumps dir> <out dir> <port> <before|after>
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const [REPO, DUMPS, OUT, PORT, PHASE] = [process.argv[2], process.argv[3], process.argv[4], Number(process.argv[5]), process.argv[6]];
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
  res.writeHead(200, { "content-type": { ".css": "text/css", ".woff2": "font/woff2" }[path.extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const PICK = [
  ["form-builder.test.tsx--002--", "form-builder-draft-en", "table[data-field-count]"],
  ["form-builder.test.tsx--006--", "form-builder-draft-ar", "table[data-field-count]"],
  ["form-builder.test.tsx--004--", "form-builder-readonly-en", "table[data-field-count]"],
  ["form-builder.test.tsx--008--", "form-builder-readonly-ar", "table[data-field-count]"],
  ["form-framework.test.tsx--005--", "t14-attachments-en", "table[data-attachment-count]"],
  ["form-framework.test.tsx--012--", "t14-attachments-ar", "table[data-attachment-count]"],
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let bad = 0;
for (const [prefix, name, sel] of PICK) {
  const file = readdirSync(DUMPS).find((f) => f.startsWith(prefix));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${PORT}/dump/${encodeURIComponent(file)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(sel).scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  let line = `${PHASE} ${name}: page overflow ${overflow} px`;
  if (PHASE === "after") {
    // Tab through the page from the start until the table's region has focus (at most 200 presses).
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    let reached = false, presses = 0;
    for (; presses < 200 && !reached; presses++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate((s) => document.activeElement === document.querySelector(s)?.closest(".table-wrap"), sel);
    }
    const before = await page.evaluate((s) => {
      const r = document.querySelector(s).closest(".table-wrap");
      const cs = getComputedStyle(r);
      return { name: r.getAttribute("aria-label"), role: r.getAttribute("role"), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, scrollLeft: r.scrollLeft, dir: document.documentElement.dir };
    }, sel);
    const key = before.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    for (let i = 0; i < 4; i++) await page.keyboard.press(key);
    // Chromium animates keyboard scrolling: wait until the region's scroll position settles.
    let last = NaN;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      const now = await page.evaluate((s) => document.querySelector(s).closest(".table-wrap").scrollLeft, sel);
      if (now === last) break;
      last = now;
    }
    const after = await page.evaluate((s) => { const r = document.querySelector(s).closest(".table-wrap"); return { scrollLeft: r.scrollLeft, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, pageX: window.scrollX }; }, sel);
    const ok = reached && before.role === "region" && before.outline.startsWith("solid") && after.scrollLeft !== before.scrollLeft && after.pageX === 0 && overflow <= 1;
    if (!ok) bad++;
    line += ` | Tab reached the region: ${reached} (${presses} presses), role ${before.role}, name "${before.name}", focus outline "${before.outline}" | ${key} x4: region (scrollWidth ${after.scrollWidth} > clientWidth ${after.clientWidth}) scrollLeft ${before.scrollLeft} -> ${after.scrollLeft}, page scrollX ${after.pageX} | ${ok ? "PASS" : "FAIL"}`;
    await page.screenshot({ path: path.join(OUT, `${PHASE}-${name}-390-focused-scrolled.png`) });
    await page.evaluate(() => { document.activeElement?.blur?.(); });
    await page.evaluate((s) => { document.querySelector(s).closest(".table-wrap").scrollLeft = 0; }, sel);
    await page.locator(sel).scrollIntoViewIfNeeded();
  }
  await page.screenshot({ path: path.join(OUT, `${PHASE}-${name}-390.png`) });
  console.log(line);
  await page.close();
}
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
