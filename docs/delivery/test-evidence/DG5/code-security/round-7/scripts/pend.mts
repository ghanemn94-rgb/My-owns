// Prints the length of every exported array in apps/api/test/support/p5-pending-*.ts (argv[2] = that support dir).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = process.argv[2]!;
let total = 0, lists = 0;
for (const f of readdirSync(dir).filter((x) => /^p5-pending-.*\.ts$/.test(x)).sort()) {
  const m = await import(pathToFileURL(join(dir, f)).href);
  for (const [k, v] of Object.entries(m)) if (Array.isArray(v) || v instanceof Set) {
    const n = Array.isArray(v) ? v.length : v.size; total += n; lists++;
    console.log(`${f} ${k} length=${n}`);
  }
}
console.log(`lists=${lists} total_pending=${total}`);
