// Scratch-only: serves docs/delivery/stages.json from a git revision (env STAGES_REV) instead of the working tree,
// so the validator can be run against a committed stages.json without changing any file in the repository.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const rev = process.env.STAGES_REV;
const txt = execFileSync("git", ["show", `${rev}:docs/delivery/stages.json`]);
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  if (String(p).endsWith("docs/delivery/stages.json")) {
    return rest.length && (rest[0] === "utf8" || rest[0]?.encoding) ? txt.toString() : Buffer.from(txt);
  }
  return orig.call(this, p, ...rest);
};
syncBuiltinESMExports();
