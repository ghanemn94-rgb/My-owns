#!/usr/bin/env node
// T-DG6-DO-H: summarise the three export-proof reports (rep-N/export-proof.json) for REQ-S20-030.
//   node docs/delivery/handbacks/DG6/T-DG6-DO-H-evidence/summarize.mjs > …/summary.txt
// Reads only the JSON reports export-proof.mjs wrote; the 2 s threshold is export-proof's own START_TARGET_MS.
// Percentiles: nearest rank (rank = ceil(p·n/100)), the same rule export-proof.mjs uses.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const nr = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil((p * s.length) / 100) - 1)] : null;
};
const stats = (v) => ({ n: v.length, p50: nr(v, 50), p95: nr(v, 95), max: v.length ? Math.max(...v) : null });
const fmt = (s) => `n=${s.n} p50=${s.p50} ms p95=${s.p95} ms max=${s.max} ms`;
const nonDec = (p) => p.every((x, i) => i === 0 || x >= p[i - 1]);

const allB = [];
for (const rep of [1, 2, 3]) {
  const r = JSON.parse(readFileSync(join(here, `rep-${rep}`, "export-proof.json"), "utf8"));
  const A = r.partA.exports;
  const B = r.partB.exports;
  const all = [...A, ...B];
  allB.push(...B.map((e) => e.startMs));
  const over = all.filter((e) => e.startMs > r.startTargetMs);
  console.log(`== repetition ${rep} (${r.label}; ${r.startedAt} – ${r.finishedAt}; target ${r.startTargetMs} ms)`);
  console.log(`start part A: ${fmt(stats(A.map((e) => e.startMs)))}`);
  console.log(`start part B: ${fmt(stats(B.map((e) => e.startMs)))}`);
  console.log(`start all:    ${fmt(stats(all.map((e) => e.startMs)))}`);
  console.log(`starts over ${r.startTargetMs} ms: ${over.length} of ${all.length}` +
    (over.length ? ` (${over.map((e) => `${e.transformation} ${e.startMs}`).join(", ")})` : ""));
  console.log(`202 with job id: ${all.filter((e) => e.startStatus === 202 && e.jobId).length} of ${all.length}`);
  console.log(`percent non-decreasing and last = 100: ${all.filter((e) => e.percents && nonDec(e.percents) && e.percents.at(-1) === 100).length} of ${all.length}`);
  console.log(`final status succeeded: ${all.filter((e) => e.finalStatus === "succeeded").length} of ${all.length}`);
  console.log(`requester download 200 (bytes = fileSizeBytes): ${all.filter((e) => e.downloadStatus === 200 && e.downloadBytes === e.fileSizeBytes).length} of ${all.length}`);
  const oth = all.filter((e) => e.sameScopeOtherUserId);
  console.log(`same-scope other user 404/404: ${oth.filter((e) => e.sameScopeOtherStatuses?.getExport === 404 && e.sameScopeOtherStatuses?.download === 404).length} of ${oth.length} (exports with such a user)`);
  console.log(`AUD 404/404: ${all.filter((e) => e.audStatuses?.getExport === 404 && e.audStatuses?.download === 404).length} of ${all.length} (AUD same scope on ${all.filter((e) => e.audSameScope).length})`);
  console.log(`completion part A: ${fmt(stats(A.map((e) => e.completionMs).filter((x) => x != null)))}`);
  console.log(`completion part B: ${fmt(stats(B.map((e) => e.completionMs).filter((x) => x != null)))}`);
  console.log(`largest file: ${Math.max(...all.map((e) => e.fileSizeBytes ?? 0))} bytes; failures: ${all.filter((e) => e.failures.length).length}`);
  console.log(`per export (part, transformation, definition/register, format, start status, start ms, job id, final, completion ms, download, other, aud):`);
  for (const [part, list] of [["A", A], ["B", B]])
    for (const e of list)
      console.log(`  ${part} ${e.transformation} ${e.definitionCode}${e.register ? `/${e.register}` : ""} ${e.format} ` +
        `${e.startStatus} ${e.startMs} ${e.jobId} ${e.finalStatus} ${e.completionMs} ${e.downloadStatus} ` +
        `${e.sameScopeOtherStatuses ? `${e.sameScopeOtherStatuses.getExport}/${e.sameScopeOtherStatuses.download}` : "n/a"} ` +
        `${e.audStatuses ? `${e.audStatuses.getExport}/${e.audStatuses.download}` : "n/a"}` +
        (e.failures.length ? ` FAIL: ${e.failures.join("; ")}` : ""));
  console.log();
}
console.log(`== part B over all three repetitions: ${fmt(stats(allB))}; over 2000 ms: ${allB.filter((x) => x > 2000).length} of ${allB.length}`);
