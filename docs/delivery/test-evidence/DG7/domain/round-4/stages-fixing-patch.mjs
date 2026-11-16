// domain-reviewer DG7 round 4: control for the stages.json transition check.
// Preloaded with `node --import <this file>`. Serves docs/delivery/stages.json IN MEMORY with one FIXING entry
// inserted before DG7's last REVIEWING entry (the round-4 freeze). The repository is never changed.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  const out = orig.call(this, p, ...rest);
  if (typeof p === "string" && p.endsWith("docs/delivery/stages.json")) {
    const doc = JSON.parse(typeof out === "string" ? out : out.toString("utf8"));
    const s = doc.stages.find((x) => x.id === "DG7");
    const h = s.history;
    if (h.length >= 2 && h[h.length - 1].state === "REVIEWING" && h[h.length - 2].state === "REVIEWING") {
      h.splice(h.length - 1, 0, { state: "FIXING", at: "2026-11-16T00:00:00Z", note: "reviewer control (in memory only)" });
    }
    const text = JSON.stringify(doc, null, 2);
    return typeof out === "string" ? text : Buffer.from(text);
  }
  return out;
};
syncBuiltinESMExports();
