#!/usr/bin/env node
// Offline dependency audit (ADR-0052 §6, REQ-S16-030 "dependency checks"; D-195 Q10; owner devops-engineer, T-DG6-DO-A).
//
// Compares the committed SBOM (licenses/sbom.cdx.json, generated from pnpm-lock.yaml by licenses/generate-sbom.mjs)
// with a DATED advisory snapshot committed as deploy/advisories/snapshot-<yyyy-mm-dd>.json. The snapshot records its
// source (service URL, advisory database) and its retrieval time; this script prints the snapshot's age.
//
// This is NOT the live audit. The live audit is `pnpm audit --audit-level high --prod` in the CI job
// `dependency-audit` (deploy/ci/ci.yml), against the registry's advisory service. The offline check only knows the
// advisories that existed when the snapshot was retrieved; a newer advisory is invisible to it until the snapshot is
// refreshed. It exists so that a runnable control also works without network (`pnpm test`, restricted networks).
//
//   node deploy/scripts/dep-audit.mjs                    offline check against the newest committed snapshot
//        [--sbom <file>] [--snapshot <file>]             (fixtures; defaults: licenses/sbom.cdx.json, newest snapshot)
//        [--max-age-days <n>]                            also fail when the snapshot is older than n days
//   node deploy/scripts/dep-audit.mjs --refresh          NETWORK: query the registry's bulk advisory endpoint for
//        [--registry <url>] [--out <file>]               every npm component of the SBOM; write a new dated snapshot
//                                                        (behind a proxy, run with NODE_USE_ENV_PROXY=1 on Node 24)
//
// Exit status (offline): 0 = no High/Critical advisory matches a SHIPPED component (scopes runtime and bundled) and
// every shipped component is covered by the snapshot; 1 = a High/Critical match on a shipped component, or a shipped
// component the snapshot never queried (Unknown is never a pass: refresh the snapshot after a lockfile change);
// 2 = invalid input (unreadable SBOM or snapshot, a version range this script cannot evaluate).
// Matches on development-only components (never shipped) and Moderate/Low matches are listed but do not fail; the
// live CI audit applies the same split (`--prod`, `--audit-level high`).
//
// Range semantics: `vulnerable_versions` uses npm range syntax. Supported: `||` alternatives; comparators `<`, `<=`,
// `>`, `>=`, `=` and bare versions; `*`/empty; hyphen ranges `a - b`. Anything else (`^`, `~`, x-ranges) is refused
// (exit 2), never guessed. Pre-release versions are compared by SemVer precedence and are NOT excluded from ranges
// (stricter than npm's install-time rule, so a pre-release is never silently out of scope).
//
// Node standard library only; no dependency.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SNAPSHOT_SCHEMA = "mth-advisory-snapshot/1";
export const FAILING_SEVERITIES = ["critical", "high"];
export const SHIPPED_SCOPES = ["runtime", "bundled"];
const SNAPSHOT_NAME = /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const BULK_PATH = "/-/npm/v1/security/advisories/bulk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ADVISORIES_DIR = join(root, "deploy", "advisories");
export const DEFAULT_SBOM = join(root, "licenses", "sbom.cdx.json");

export class AuditInputError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// SemVer comparison and npm range evaluation (subset; refuses what it does not understand)

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text) {
  const m = VERSION.exec(String(text).trim());
  if (!m) throw new AuditInputError(`not a semantic version: "${text}"`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}

export function compareVersions(a, b) {
  const x = typeof a === "string" ? parseVersion(a) : a;
  const y = typeof b === "string" ? parseVersion(b) : b;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (+p !== +q) return +p < +q ? -1 : 1;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const COMPARATOR = /^(<=|>=|<|>|=)?\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

function comparatorHolds(version, op, bound) {
  const c = compareVersions(version, bound);
  switch (op) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    default:
      return c === 0;
  }
}

/** True when `version` lies in the npm range `range`. Throws AuditInputError on syntax outside the supported subset. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  const alternatives = String(range).split("||");
  return alternatives.some((alt) => {
    let set = alt.trim();
    if (set === "" || set === "*") return true;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) set = `>=${hyphen[1]} <=${hyphen[2]}`;
    // join an operator separated from its version by spaces (">= 1.2.3")
    const tokens = set
      .replace(/(<=|>=|<|>|=)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    return tokens.every((tok) => {
      const m = COMPARATOR.exec(tok);
      if (!m) throw new AuditInputError(`unsupported range syntax "${tok}" in "${range}"`);
      return comparatorHolds(v, m[1] ?? "=", m[2]);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs

const prop = (c, name) => (c.properties ?? []).find((p) => p.name === name)?.value;

/** npm components of a CycloneDX SBOM written by licenses/generate-sbom.mjs: [{ name, version, scope }]. */
export function sbomPackages(sbom) {
  if (!sbom || !Array.isArray(sbom.components)) throw new AuditInputError("SBOM has no components array");
  return sbom.components
    .filter((c) => c.type === "library" && typeof c.purl === "string" && c.purl.startsWith("pkg:npm/"))
    .map((c) => {
      const scope = prop(c, "mth:scope");
      if (!scope) throw new AuditInputError(`SBOM component ${c.purl} has no mth:scope property`);
      return { name: c.group ? `${c.group}/${c.name}` : c.name, version: c.version, scope };
    });
}

export function validateSnapshot(s) {
  const fail = (m) => {
    throw new AuditInputError(`invalid advisory snapshot: ${m}`);
  };
  if (!s || typeof s !== "object") fail("not a JSON object");
  if (s.schema !== SNAPSHOT_SCHEMA) fail(`schema must be "${SNAPSHOT_SCHEMA}"`);
  if (!s.source || typeof s.source.url !== "string" || typeof s.source.database !== "string")
    fail("source.url and source.database are required");
  if (typeof s.retrieved_at !== "string" || Number.isNaN(Date.parse(s.retrieved_at)))
    fail("retrieved_at must be an ISO-8601 timestamp");
  if (!s.queried || typeof s.queried.packages !== "object") fail("queried.packages is required");
  if (!s.advisories || typeof s.advisories !== "object") fail("advisories is required");
  for (const [name, list] of Object.entries(s.advisories)) {
    if (!Array.isArray(list)) fail(`advisories["${name}"] must be an array`);
    for (const a of list)
      if (typeof a.severity !== "string" || typeof a.vulnerable_versions !== "string")
        fail(`advisories["${name}"] entries need severity and vulnerable_versions`);
  }
  return s;
}

/** Newest deploy/advisories/snapshot-<yyyy-mm-dd>.json by the date in its name, or null. */
export function newestSnapshot(dir = ADVISORIES_DIR) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((n) => SNAPSHOT_NAME.test(n))
    .sort();
  return names.length ? join(dir, names[names.length - 1]) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The check

/**
 * Pure audit of SBOM packages against a validated snapshot.
 * Returns { failing, info, uncoveredShipped, uncoveredDevelopment, ageDays, passed }.
 */
export function audit({ packages, snapshot, now = new Date() }) {
  const failing = [];
  const info = [];
  const uncoveredShipped = [];
  const uncoveredDevelopment = [];
  for (const p of packages) {
    const shipped = SHIPPED_SCOPES.includes(p.scope);
    const queried = snapshot.queried.packages[p.name];
    if (!Array.isArray(queried) || !queried.includes(p.version)) {
      (shipped ? uncoveredShipped : uncoveredDevelopment).push(p);
      continue;
    }
    for (const a of snapshot.advisories[p.name] ?? []) {
      if (!satisfies(p.version, a.vulnerable_versions)) continue;
      const severity = a.severity.toLowerCase();
      const row = { ...p, severity, id: a.id, url: a.url, title: a.title, vulnerable_versions: a.vulnerable_versions };
      (shipped && FAILING_SEVERITIES.includes(severity) ? failing : info).push(row);
    }
  }
  const ageDays = Math.floor((now.getTime() - Date.parse(snapshot.retrieved_at)) / 86_400_000);
  return {
    failing,
    info,
    uncoveredShipped,
    uncoveredDevelopment,
    ageDays,
    passed: failing.length === 0 && uncoveredShipped.length === 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Refresh (network)

async function refresh({ sbomPath, registry, out }) {
  const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  const packages = sbomPackages(sbom);
  const query = {};
  for (const p of packages) {
    const versions = (query[p.name] ??= []);
    if (!versions.includes(p.version)) versions.push(p.version);
  }
  for (const v of Object.values(query)) v.sort(compareVersions);
  const sortedQuery = Object.fromEntries(Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1)));
  const url = `${registry.replace(/\/$/, "")}${BULK_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(sortedQuery),
  });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const body = await res.json();
  const retrievedAt = new Date();
  const keep = ["id", "url", "title", "severity", "vulnerable_versions", "cwe", "cvss"];
  const advisories = Object.fromEntries(
    Object.entries(body)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, list]) => [
        name,
        list
          .map((a) => Object.fromEntries(keep.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])))
          .sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
      ]),
  );
  const lockSha = (sbom.metadata?.properties ?? []).find((p) => p.name === "mth:lockfile-sha256")?.value ?? null;
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    source: {
      url,
      method: "POST: body = every npm component name of the SBOM with its versions",
      database: "GitHub Advisory Database, as served by the npm registry's bulk advisory endpoint",
      database_license: "CC-BY-4.0 (GitHub Advisory Database)",
      retrieved_by: "node deploy/scripts/dep-audit.mjs --refresh",
    },
    retrieved_at: retrievedAt.toISOString(),
    queried: {
      sbom: relative(root, sbomPath),
      sbom_lockfile_sha256: lockSha,
      package_names: Object.keys(sortedQuery).length,
      package_versions: Object.values(sortedQuery).reduce((n, v) => n + v.length, 0),
      packages: sortedQuery,
    },
    advisories,
  };
  validateSnapshot(snapshot);
  const target = out ?? join(ADVISORIES_DIR, `snapshot-${snapshot.retrieved_at.slice(0, 10)}.json`);
  writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  const count = Object.values(advisories).reduce((n, l) => n + l.length, 0);
  console.log(
    `wrote ${relative(root, target)}: ${snapshot.queried.package_versions} package versions queried ` +
      `(${snapshot.queried.package_names} names), ${count} advisories on ${Object.keys(advisories).length} packages, ` +
      `retrieved ${snapshot.retrieved_at}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// CLI

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function report(result, snapshotPath, snapshot, maxAgeDays) {
  const line = (r) =>
    `  ${r.severity.toUpperCase().padEnd(8)} ${r.name}@${r.version} (${r.scope}) in "${r.vulnerable_versions}": ${r.title ?? ""} ${r.url ?? ""}`.trimEnd();
  console.log(`snapshot: ${relative(root, snapshotPath)}; source: ${snapshot.source.url}`);
  console.log(`snapshot retrieved ${snapshot.retrieved_at}; age ${result.ageDays} day(s)`);
  console.log("this is the OFFLINE snapshot check, not the live registry audit (CI job dependency-audit)");
  if (result.failing.length) {
    console.log(`High/Critical advisories on shipped components (${result.failing.length}):`);
    for (const r of result.failing) console.log(line(r));
  }
  if (result.uncoveredShipped.length) {
    console.log(`shipped components NOT covered by the snapshot (${result.uncoveredShipped.length}; status Unknown):`);
    for (const p of result.uncoveredShipped) console.log(`  ${p.name}@${p.version} (${p.scope})`);
  }
  if (result.info.length) {
    const bySev = result.info.reduce(
      (m, r) => ({ ...m, [`${r.severity}/${r.scope}`]: (m[`${r.severity}/${r.scope}`] ?? 0) + 1 }),
      {},
    );
    console.log(`not failing (development-only or below High): ${result.info.length} ${JSON.stringify(bySev)}`);
  }
  if (result.uncoveredDevelopment.length)
    console.log(`development-only components not covered by the snapshot: ${result.uncoveredDevelopment.length}`);
  let passed = result.passed;
  if (maxAgeDays !== undefined && result.ageDays > maxAgeDays) {
    console.log(`FAIL: the snapshot is older than --max-age-days ${maxAgeDays}`);
    passed = false;
  }
  console.log(
    passed
      ? "PASS: no High/Critical advisory in the snapshot matches a shipped component"
      : `FAIL: ${result.failing.length} High/Critical match(es) on shipped components, ${result.uncoveredShipped.length} shipped component(s) not covered`,
  );
  return passed;
}

async function main() {
  const sbomPath = arg("--sbom") ?? DEFAULT_SBOM;
  if (process.argv.includes("--refresh")) {
    await refresh({ sbomPath, registry: arg("--registry") ?? DEFAULT_REGISTRY, out: arg("--out") });
    return 0;
  }
  const snapshotPath = arg("--snapshot") ?? newestSnapshot();
  if (!snapshotPath) throw new AuditInputError(`no snapshot-<yyyy-mm-dd>.json in ${relative(root, ADVISORIES_DIR)}`);
  const maxAgeRaw = arg("--max-age-days");
  const maxAgeDays = maxAgeRaw === undefined ? undefined : Number(maxAgeRaw);
  if (maxAgeDays !== undefined && !(Number.isInteger(maxAgeDays) && maxAgeDays >= 0))
    throw new AuditInputError("--max-age-days needs a non-negative integer");
  const snapshot = validateSnapshot(JSON.parse(readFileSync(snapshotPath, "utf8")));
  const packages = sbomPackages(JSON.parse(readFileSync(sbomPath, "utf8")));
  return report(audit({ packages, snapshot }), snapshotPath, snapshot, maxAgeDays) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`${err instanceof AuditInputError ? "INVALID INPUT" : "ERROR"}: ${err.message}`);
      process.exit(2);
    },
  );
}
