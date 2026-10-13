import { pathToFileURL } from "node:url";
let total = 0, n = 0;
for (const f of process.argv.slice(2)) {
  const m = await import(pathToFileURL(f).href);
  for (const [k, v] of Object.entries(m)) if (Array.isArray(v)) { n++; total += v.length; console.log(`${f.split("/").pop()} ${k} length=${v.length}`); }
}
console.log(`arrays=${n} total_entries=${total}`);
