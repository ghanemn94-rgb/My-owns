import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/scripts/openapi-lint.mjs");
const YAML = require("/home/user/My-owns/node_modules/.pnpm/yaml@2.8.1/node_modules/yaml");
const doc = YAML.parse(fs.readFileSync("docs/api/openapi.yaml", "utf8"));
const pats = new Map();
(function walk(o, path) {
  if (Array.isArray(o)) o.forEach((v, i) => walk(v, path + "/" + i));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
    if (k === "pattern" && typeof v === "string") { (pats.get(v) ?? pats.set(v, []).get(v)).push(path); }
    else walk(v, path + "/" + k);
  }
})(doc, "");
for (const [p, where] of pats) {
  let ok = true; try { new RegExp(p, "u"); } catch (e) { ok = false; }
  console.log(JSON.stringify(p), where.length, ok ? "" : "INVALID", where[0]);
}
