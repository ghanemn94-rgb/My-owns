import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
const [DIST, dumps, out, port, ...files] = [path.resolve(process.argv[2]), process.argv[3], process.argv[4], Number(process.argv[5]), ...process.argv.slice(6)];
const links = (readFileSync(path.join(DIST, "index.html"), "utf8").match(/<link rel="stylesheet"[^>]*>/g) ?? []).join("\n");
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url.startsWith("/dump/")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(readFileSync(path.join(dumps, path.basename(url)), "utf8").replace("<head>", `<head>${links}`)); }
  const f = path.join(DIST, path.normalize(url));
  if (!f.startsWith(DIST) || !existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": url.endsWith(".css") ? "text/css" : "font/woff2" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));
const b = await chromium.launch();
for (const [f, tag] of files.map((x) => x.split("::"))) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/dump/${encodeURIComponent(f)}`);
  await p.evaluate(() => document.fonts.ready);
  const t = p.locator("main table").filter({ has: p.locator("[data-field-count], [data-attachment-count]") }).first();
  const sel = (await p.locator("table[data-field-count], table[data-attachment-count]").count()) ? "table[data-field-count], table[data-attachment-count]" : "main table";
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(out, `${tag}.png`) });
  console.log(tag, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await ctx.close();
}
await b.close(); server.close();
