import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2];
let t = readFileSync(f, "utf8");
const anchor = `  const m = JSON.parse(readFileSync(join(phased, "backup-manifest.json"), "utf8"));\n`;
if (!t.includes(anchor)) throw new Error("anchor not found");
t = t.replace(anchor, anchor + `  console.log("PROBE fin.out=" + JSON.stringify(fin.out));\n  console.log("PROBE config=" + JSON.stringify(m.config));\n  console.log("PROBE files=" + JSON.stringify(m.files.map((x) => x.path)));\n  assert.ok(m.config.files.length > 0, "PROBE: split-phase manifest config.files is empty");\n`);
writeFileSync(f, t);
