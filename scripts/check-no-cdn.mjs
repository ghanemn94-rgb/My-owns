#!/usr/bin/env node
// Fails if product source or build output references a public CDN / remote font or script host
// (REQ-S15-005, REQ-S19-019, ADR-0009/ADR-0011). Dependency-free so it runs before `pnpm install`.
// Usage: node scripts/check-no-cdn.mjs [dir ...]   (default: apps packages)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["apps", "packages"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".html", ".json", ".svg"]);
const SKIP_DIRS = new Set(["node_modules", "coverage", ".git"]);
// Hosts that must never be contacted by the product at build or run time.
const BANNED = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /cdn\.jsdelivr\.net/i,
  /unpkg\.com/i,
  /cdnjs\.cloudflare\.com/i,
  /esm\.sh/i,
  /cdn\.skypack\.dev/i,
  /ajax\.googleapis\.com/i,
  /code\.jquery\.com/i,
  /stackpath\.bootstrapcdn\.com/i,
  /use\.fontawesome\.com/i,
  /kit\.fontawesome\.com/i,
  /www\.googletagmanager\.com/i,
  /www\.google-analytics\.com/i,
];
const hits = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (SCAN_EXT.has(extname(name)) && st.size < 5_000_000) {
      const text = readFileSync(p, "utf8");
      for (const re of BANNED) {
        const m = re.exec(text);
        if (m) hits.push(`${p}: ${m[0]}`);
      }
    }
  }
}
roots.forEach(walk);
if (hits.length) {
  console.error(`FAIL no-cdn: ${hits.length} reference(s) to public CDN/remote asset hosts`);
  hits.forEach((h) => console.error(`  - ${h}`));
  process.exit(1);
}
console.log(`PASS no-cdn: scanned ${roots.join(", ")}`);
