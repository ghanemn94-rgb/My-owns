#!/usr/bin/env node
// =====================================================================================================================
// Licence check for SHIPPED dependencies (spec §16 "licence checks"; supply-chain.md).
//
//   node scripts/ops/licence-check.mjs                    # runs `pnpm licenses list --json --prod`
//   node scripts/ops/licence-check.mjs --input lic.json   # use a saved listing
//   node scripts/ops/licence-check.mjs --release          # review-required items without an approval FAIL
//   node scripts/ops/licence-check.mjs --report out.md    # also write a Markdown report
//
// Policy: scripts/ops/licence-policy.json (a PROPOSAL until Mobily Legal / Open-Source Office approves it).
//   allowed          → OK
//   denied (strong copyleft, network copyleft, source-available) → FAIL unless an approval entry exists
//   reviewRequired (weak copyleft, unknown) → WARN on pull requests; FAIL with --release unless approved
// SPDX expressions: "A OR B" passes if any alternative passes; "A AND B" needs every part to pass.
// Exit status: 0 = no FAIL, 1 = FAIL findings, 2 = tool/usage error.
// =====================================================================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const release = args.includes('--release');
const policy = JSON.parse(readFileSync(opt('--policy') ?? join(here, 'licence-policy.json'), 'utf8'));

let listing;
try {
  const raw = opt('--input')
    ? readFileSync(opt('--input'), 'utf8')
    : execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], { cwd: join(here, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  listing = JSON.parse(raw);
} catch (e) {
  console.error(`licence-check: cannot obtain licence listing: ${e.message}`);
  process.exit(2);
}

const norm = (l) => policy.aliases?.[l.trim()] ?? l.trim();
const startsWithAny = (l, prefixes) => prefixes.some((p) => l.toUpperCase().startsWith(p.toUpperCase()));
function classifySingle(l) {
  const n = norm(l);
  if (policy.allowed.includes(n)) return 'ok';
  if (startsWithAny(n, policy.denied.prefixes)) return 'denied';
  if (startsWithAny(n, policy.reviewRequired.prefixes)) return 'review';
  return 'review'; // anything not explicitly allowed needs a human decision
}
const rank = { ok: 0, review: 1, denied: 2 };
function classify(expr) {
  const e = expr.replace(/^\(+|\)+$/g, '').trim();
  if (/ OR /i.test(e)) return e.split(/ OR /i).map(classify).reduce((a, b) => (rank[a] <= rank[b] ? a : b));
  if (/ AND /i.test(e)) return e.split(/ AND /i).map(classify).reduce((a, b) => (rank[a] >= rank[b] ? a : b));
  return classifySingle(e);
}
const approved = (name, version, licence) =>
  (policy.approvals ?? []).find((a) => a.package === name && (!a.version || a.version === version) && a.license === licence && a.approvedBy && a.reference);

const rows = [];
for (const [licence, pkgs] of Object.entries(listing)) {
  for (const p of pkgs) {
    for (const version of p.versions ?? [p.version]) {
      const cls = classify(licence);
      const appr = cls === 'ok' ? null : approved(p.name, version, licence);
      let status = 'OK';
      if (cls === 'denied') status = appr ? 'APPROVED' : 'FAIL';
      else if (cls === 'review') status = appr ? 'APPROVED' : release ? 'FAIL' : 'WARN';
      rows.push({ name: p.name, version, licence, status, approval: appr ? `${appr.approvedBy} (${appr.reference})` : '' });
    }
  }
}
rows.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
const count = (s) => rows.filter((r) => r.status === s).length;
const byLicence = {};
for (const r of rows) byLicence[r.licence] = (byLicence[r.licence] ?? 0) + 1;

console.log(`licence-check (policy ${policy.version}; mode ${release ? 'release' : 'pull-request'}): ${rows.length} package versions`);
console.log(Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`).join('\n'));
const notable = rows.filter((r) => r.status !== 'OK');
if (notable.length) {
  console.log('\nItems needing attention:');
  for (const r of notable) console.log(`  ${r.status.padEnd(8)} ${r.name}@${r.version}  [${r.licence}]${r.approval ? `  approved: ${r.approval}` : ''}`);
}
console.log(`\nRESULT: ${count('FAIL')} FAIL, ${count('WARN')} WARN, ${count('APPROVED')} APPROVED, ${count('OK')} OK`);

const reportPath = opt('--report');
if (reportPath) {
  const md = [
    `# Licence check report`,
    ``,
    `Policy \`${policy.version}\` (proposal pending Mobily approval); mode: ${release ? 'release' : 'pull-request'}; ${rows.length} package versions.`,
    ``,
    `| Status | Package | Version | Licence | Approval |`,
    `|---|---|---|---|---|`,
    ...notable.map((r) => `| ${r.status} | ${r.name} | ${r.version} | ${r.licence} | ${r.approval || '—'} |`),
    ``,
    `Licence distribution: ${Object.entries(byLicence).map(([l, n]) => `${l} ×${n}`).join(', ')}`,
    ``,
  ].join('\n');
  writeFileSync(reportPath, md);
}
process.exit(count('FAIL') ? 1 : 0);
