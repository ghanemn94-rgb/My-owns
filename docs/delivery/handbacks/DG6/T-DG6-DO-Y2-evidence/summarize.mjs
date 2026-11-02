#!/usr/bin/env node
// T-DG6-DO-Y2: summarize the export-proof reports of each repetition (rep-N/export-proof.json) and the 1-minute load
// average sampled during each proof (rep-N/loadavg-during-proof.txt). Read-only; prints to stdout.
//   node docs/delivery/handbacks/DG6/T-DG6-DO-Y2-evidence/summarize.mjs
import { existsSync, readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const TARGET = 2000;
const nr = (vals, p) => {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor((p * s.length + 99) / 100) - 1)];
};
const stat = (vals) => `n=${vals.length} p50=${nr(vals, 50)} ms p95=${nr(vals, 95)} ms max=${Math.max(...vals)} ms`;

for (let rep = 1; ; rep++) {
  const file = new URL(`rep-${rep}/export-proof.json`, here);
  if (!existsSync(file)) break;
  const r = JSON.parse(readFileSync(file, "utf8"));
  const all = [...r.partA.exports.map((e) => ({ ...e, part: "A" })), ...r.partB.exports.map((e) => ({ ...e, part: "B" }))];
  const ms = (e) => e.startMs;
  const a = all.filter((e) => e.part === "A");
  const b = all.filter((e) => e.part === "B");
  const count = (pred) => all.filter(pred).length;
  console.log(`== repetition ${rep} (${r.label}; ${r.startedAt} - ${r.finishedAt}; target ${r.startTargetMs} ms)`);
  console.log(`start part A: ${stat(a.map(ms))}; over ${TARGET} ms: ${a.filter((e) => ms(e) > TARGET).length}`);
  console.log(`start part B: ${stat(b.map(ms))}; over ${TARGET} ms: ${b.filter((e) => ms(e) > TARGET).length}`);
  console.log(`202 with job id: ${count((e) => e.startStatus === 202 && typeof e.jobId === "string")} of ${all.length}`);
  console.log(`final status succeeded: ${count((e) => e.finalStatus === "succeeded")} of ${all.length}`);
  console.log(`percent non-decreasing, last 100: ${count((e) => e.percents?.length > 0 && e.percents.every((v, i, xs) => i === 0 || v >= xs[i - 1]) && e.percents.at(-1) === 100)} of ${all.length}`);
  console.log(`requester download 200: ${count((e) => e.downloadStatus === 200 && e.downloadBytes === e.fileSizeBytes && e.fileSizeBytes > 0)} of ${all.length}`);
  const pair = (s) => (s ? `${s.getExport}/${s.download}` : null);
  const other = all.filter((e) => e.sameScopeOtherUserId);
  console.log(`same-scope other user 404/404: ${other.filter((e) => pair(e.sameScopeOtherStatuses) === "404/404").length} of ${other.length} (exports with such a user)`);
  console.log(`AUD 404/404: ${count((e) => pair(e.audStatuses) === "404/404")} of ${all.length}`);
  const comp = (xs) => xs.map((e) => e.completionMs).filter((v) => typeof v === "number");
  console.log(`completion part A: ${stat(comp(a))}`);
  console.log(`completion part B: ${stat(comp(b))}`);
  console.log(`failures: ${(r.summary?.failed ?? "?")}: ${all.filter((e) => (e.failures ?? []).length > 0).map((e) => `${e.part} ${e.transformation} ${e.failures.join("; ")}`).join(" | ")}`);
  const la = new URL(`rep-${rep}/loadavg-during-proof.txt`, here);
  if (existsSync(la)) {
    const v = readFileSync(la, "utf8").trim().split("\n").map((l) => Number(l.split(" ")[1]));
    console.log(`loadavg-1m during proof: samples ${v.length} min ${Math.min(...v)} max ${Math.max(...v)}`);
  }
  console.log();
}
