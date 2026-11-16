#!/usr/bin/env node
// Layout check of an assembled runtime tree (deploy/scripts/assemble-runtime.sh step 4; T-DG7-DO-A2, D-246 P-1):
// every package directory in the pnpm virtual store (<runtime>/node_modules/.pnpm) must be in the shipped set
// (scope runtime or bundled) of licenses/inventory.csv.
//
//   node deploy/scripts/check-virtual-store.mjs <node_modules/.pnpm> <licenses/inventory.csv>
//
// Exit 0 and "virtual store: <n> package directories, all in the shipped set (<m> runtime+bundled)"; exit 1 and
// "not in the shipped set: <dir>, ..." otherwise (an unparseable directory name is reported the same way, never
// skipped); exit 2 on a usage error or an unreadable input. No dependency, no network.
//
// pnpm 10 names a virtual-store directory `<name>@<version>` with an optional peer suffix `_<peers>`, and writes a
// scope's `/` as `+`: `string_decoder@1.1.1`, `react-dom@19.1.0_react@19.1.0`, `@scope+pkg@2.0.0_typescript@5.9.3`.
// Only the suffix AFTER the version is stripped. P-1: the earlier `d.replace(/_.*$/, "")` also cut names that contain
// `_` (`string_decoder@1.1.1` became `string`), so the check refused a correct tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// name: `@scope+pkg` or `pkg` (no `@` inside); version: up to the first `_` (semver has no `_`); then the peer suffix.
const STORE_DIR = /^(@[^@/]+|[^@/]+)@([^_/@]+)(?:_.+)?$/;

/** Parses a virtual-store directory name into { name, version }, or null when it is not `<name>@<version>[_peers]`. */
export function parseVirtualStoreDir(dir) {
  const m = STORE_DIR.exec(dir);
  if (!m) return null;
  return { name: m[1].replace(/^@([^+]+)\+/, "@$1/"), version: m[2] };
}

/** The shipped set `name@version` (scope runtime or bundled) from the text of licenses/inventory.csv. */
export function shippedSet(csvText) {
  return new Set(
    csvText
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(","))
      .filter((c) => c[3] === "runtime" || c[3] === "bundled")
      .map((c) => `${c[0]}@${c[1]}`),
  );
}

/** Checks the package directories of a virtual store against the shipped set. */
export function checkVirtualStore(store, csvText) {
  const shipped = shippedSet(csvText);
  const extra = [];
  let n = 0;
  for (const d of readdirSync(store).sort()) {
    if (d === "node_modules" || d === "lock.yaml" || !statSync(join(store, d)).isDirectory()) continue;
    n++;
    const p = parseVirtualStoreDir(d);
    if (!p || !shipped.has(`${p.name}@${p.version}`)) extra.push(d);
  }
  return { packages: n, shipped: shipped.size, extra };
}

function main(argv) {
  if (argv.length !== 2) {
    console.error("usage: check-virtual-store.mjs <node_modules/.pnpm> <licenses/inventory.csv>");
    return 2;
  }
  let result;
  try {
    result = checkVirtualStore(argv[0], readFileSync(argv[1], "utf8"));
  } catch (e) {
    console.error(`check-virtual-store: BLOCKED: ${e.code ?? e.message}`);
    return 2;
  }
  if (result.extra.length) {
    console.error(`not in the shipped set: ${result.extra.join(", ")}`);
    return 1;
  }
  console.log(
    `virtual store: ${result.packages} package directories, all in the shipped set (${result.shipped} runtime+bundled)`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
