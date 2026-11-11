// Scratch-only: serves stages.json with one extra DG6 history entry (FIXING between VERIFYING and REVIEWING),
// to test whether the illegal transition is the only reason the historical validators fail. The repository is not changed.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  const out = orig.call(this, p, ...rest);
  if (String(p).endsWith("docs/delivery/stages.json")) {
    const doc = JSON.parse(out.toString());
    const s = doc.stages.find((x) => x.id === "DG6");
    const i = s.history.findIndex((h, k) => k > 0 && h.state === "REVIEWING" && s.history[k - 1].state === "VERIFYING");
    if (i > 0) s.history.splice(i, 0, { state: "FIXING", at: "2026-11-11T06:40:00Z", note: "scratch probe" });
    const txt = JSON.stringify(doc, null, 2) + "\n";
    return rest.length && (rest[0] === "utf8" || rest[0]?.encoding) ? txt : Buffer.from(txt);
  }
  return out;
};
syncBuiltinESMExports();
