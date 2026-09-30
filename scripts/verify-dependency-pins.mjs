#!/usr/bin/env node
// Dependency pin verification (ADR-0001, REQ-S16-009). Needs registry access; run it where `npm view` works
// (the orchestrator's registry-only install sandbox, REQ-DLV-042) BEFORE `pnpm install` regenerates the lockfile.
// For every exact pin in every workspace package.json it reports: existence, licence, deprecation, engines.node,
// the dist-tags.latest version and the publish date. It also checks the peerDependencies of each pinned package
// against the other pins, and fails on a missing version, a deprecated pin, a range pin, or a licence outside
// the allow-list. Output: a Markdown table on stdout (paste into docs/architecture/discovery/).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_LICENCES = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "CC0-1.0",
]);
const manifests = ["package.json"];
for (const dir of ["apps", "packages"]) {
  if (!existsSync(dir)) continue;
  for (const d of readdirSync(dir))
    if (existsSync(join(dir, d, "package.json"))) manifests.push(join(dir, d, "package.json"));
}
const pins = new Map();
for (const m of manifests) {
  const pkg = JSON.parse(readFileSync(m, "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec.startsWith("workspace:")) continue;
      const prev = pins.get(name);
      if (prev && prev.spec !== spec) prev.conflict = `${prev.spec} vs ${spec} (${m})`;
      else pins.set(name, { spec, where: m });
    }
  }
}
const view = (arg) =>
  JSON.parse(execFileSync("npm", ["view", arg, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const semverSatisfies = (v, range) => {
  // Minimal check for common peer ranges (^x, >=x, x || y). Anything else is reported for manual review.
  return range.split("||").some((part) => {
    const r = part.trim();
    const [maj] = v.split(".").map(Number);
    if (r === "*" || r === "") return true;
    let m;
    if ((m = /^\^(\d+)/.exec(r))) return maj === Number(m[1]);
    if ((m = /^>=\s*(\d+)(?:\.(\d+))?/.exec(r))) {
      const lt = /<\s*(\d+)/.exec(r);
      return maj >= Number(m[1]) && (!lt || maj < Number(lt[1]));
    }
    if ((m = /^(\d+)\.x/.exec(r))) return maj === Number(m[1]);
    return null;
  });
};
let failed = 0;
const rows = [];
for (const [name, { spec, where, conflict }] of [...pins].sort()) {
  const row = { name, spec, where, status: "OK", notes: [] };
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(spec)) {
    row.status = "FAIL";
    row.notes.push("not an exact pin");
  }
  if (conflict) {
    row.status = "FAIL";
    row.notes.push(`conflicting pins: ${conflict}`);
  }
  try {
    const meta = view(`${name}@${spec}`);
    const info = Array.isArray(meta) ? meta[meta.length - 1] : meta;
    const all = view(name);
    row.licence = info.license ?? "?";
    row.latest = all["dist-tags"]?.latest ?? "?";
    row.published = all.time?.[spec]?.slice(0, 10) ?? "?";
    row.engines = info.engines?.node ?? "";
    if (info.deprecated) {
      row.status = "FAIL";
      row.notes.push(`deprecated: ${info.deprecated}`);
    }
    if (!ALLOWED_LICENCES.has(row.licence)) {
      row.status = "FAIL";
      row.notes.push(`licence needs review: ${row.licence}`);
    }
    for (const [peer, range] of Object.entries(info.peerDependencies ?? {})) {
      const p = pins.get(peer);
      if (!p) continue;
      const ok = semverSatisfies(p.spec, range);
      if (ok === false) {
        row.status = "FAIL";
        row.notes.push(`peer ${peer}@${range} not satisfied by ${p.spec}`);
      }
      if (ok === null) row.notes.push(`peer ${peer}@${range}: check manually against ${p.spec}`);
    }
    if (row.latest !== spec) row.notes.push(`latest is ${row.latest}`);
  } catch (err) {
    row.status = "FAIL";
    row.notes.push(`npm view failed: ${String(err.stderr ?? err.message).split("\n")[0]}`);
  }
  if (row.status === "FAIL") failed++;
  rows.push(row);
}
console.log(
  `Checked ${rows.length} pins on ${new Date().toISOString()} with npm ${execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()}\n`,
);
console.log("| Package | Pin | Licence | Published | engines.node | Latest | Status | Notes |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.spec} | ${r.licence ?? ""} | ${r.published ?? ""} | ${r.engines ?? ""} | ${r.latest ?? ""} | ${r.status} | ${r.notes.join("; ")} |`,
  );
process.exit(failed ? 1 : 0);
