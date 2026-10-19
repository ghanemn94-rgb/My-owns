// qa-verifier r4: import every p5-pending-*.ts (Node 24 type stripping) and print the size of each exported collection.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const files = execSync("find . -name 'p5-pending-*.ts' -not -path '*/node_modules/*' | sort").toString().trim().split("\n");
let nonEmpty = 0;
for (const f of files) {
  const m = await import(pathToFileURL(f).href);
  const sizes = Object.entries(m).map(([k, v]) => [k, v instanceof Set || v instanceof Map ? v.size : Array.isArray(v) ? v.length : typeof v === "object" && v ? Object.keys(v).length : String(v)]);
  for (const [, s] of sizes) if (typeof s === "number" && s > 0) nonEmpty++;
  console.log(f, JSON.stringify(sizes));
}
console.log(`files=${files.length} non-empty exports=${nonEmpty}`);
