import { readdirSync } from "node:fs";
import { join } from "node:path";
const dir = join(process.cwd(), "apps/api/test/support");
let files = 0, lists = 0, nonEmpty = 0;
for (const f of readdirSync(dir).filter((n) => /^p6-pending.*\.ts$/.test(n)).sort()) {
  files++;
  const m = await import(join(dir, f));
  for (const [k, v] of Object.entries(m)) {
    if (!Array.isArray(v) && !(v instanceof Set)) continue;
    lists++;
    const n = Array.isArray(v) ? v.length : (v as Set<unknown>).size;
    if (n !== 0) nonEmpty++;
    console.log(`${f} ${k} length=${n}`);
  }
}
console.log(`files=${files} lists=${lists} non-empty=${nonEmpty}`);
