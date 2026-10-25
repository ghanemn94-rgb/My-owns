// Imports every apps/api/test/support/p5-pending-*.ts and reports the length of every exported array.
import { readdirSync } from "node:fs";
const dir = `${process.argv[2]}/apps/api/test/support`;
let files = 0, arrays = 0, nonEmpty = 0;
for (const f of readdirSync(dir).filter((f) => /^p5-pending.*\.ts$/.test(f)).sort()) {
  files++;
  const m = await import(`${dir}/${f}`);
  for (const [k, v] of Object.entries(m)) if (Array.isArray(v)) { arrays++; if (v.length) nonEmpty++; console.log(`${f}\t${k}\t${v.length}`); }
}
console.log(`files=${files} arrays=${arrays} nonEmpty=${nonEmpty}`);
process.exit(nonEmpty === 0 ? 0 : 1);
