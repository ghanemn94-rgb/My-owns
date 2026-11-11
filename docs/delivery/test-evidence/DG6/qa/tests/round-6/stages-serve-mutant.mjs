// qa-verifier DG6 RG round 6 (scratch only): when MUT_STAGES names a file, every read of docs/delivery/stages.json
// by the validator returns that file's content instead. Used to run the validator against a mutant stage history
// (F-DG6-911 / F-DG6-951 fix reverted) without touching the repository. Loaded with `node --import <this file>`.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const mut = process.env.MUT_STAGES;
if (mut) {
  const content = fs.readFileSync(mut);
  const orig = fs.readFileSync;
  let hits = 0;
  fs.readFileSync = function (p, ...rest) {
    if (String(p).replace(/\\/g, "/").endsWith("docs/delivery/stages.json")) {
      hits++;
      const enc = rest[0] && (typeof rest[0] === "string" ? rest[0] : rest[0].encoding);
      return enc ? content.toString(enc) : Buffer.from(content);
    }
    return orig.call(this, p, ...rest);
  };
  syncBuiltinESMExports();
  process.on("exit", () => process.stderr.write(`[stages-serve-mutant] served ${mut} for ${hits} read(s) of stages.json\n`));
}
