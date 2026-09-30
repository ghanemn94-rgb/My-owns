#!/usr/bin/env bash
# Assemble the production runtime tree of the mth-app image from a BUILT workspace (`pnpm -r build` done).
# The Dockerfile runs exactly this script, and so does the local clean start, so both exercise the same layout.
#
#   deploy/scripts/assemble-runtime.sh [--store-dir <pnpm store>] <workspace> <out>
#
# Steps:
#  1. third-party licence notices + SBOM/inventory into <out>/licenses (needs the full dependency tree);
#  2. prune the workspace IN PLACE to production dependencies from the same frozen lockfile, OFFLINE
#     (`pnpm install --frozen-lockfile --prod --offline`): nothing is resolved or downloaded, so the result is exactly
#     the lockfile's production closure. This MODIFIES <workspace>/node_modules: use a disposable copy;
#  3. copy only what api/worker/migrate need; dev seeds, sources, tests and build tooling are not copied;
#  4. verify the layout (fails loudly).
# Why not `pnpm deploy`: in pnpm 10 its lockfile-faithful mode needs inject-workspace-packages=true, and `--legacy`
# re-resolves versions without the lockfile (needs the network; not reproducible).
set -euo pipefail

STORE=()
if [ "${1:-}" = "--store-dir" ]; then STORE=(--store-dir "$2"); shift 2; fi
[ $# -eq 2 ] || { echo "usage: $0 [--store-dir DIR] <workspace> <out>" >&2; exit 64; }
WS="$(cd "$1" && pwd)"
OUT="$2"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
[ -z "$(ls -A "$OUT")" ] || { echo "assemble-runtime: $OUT is not empty" >&2; exit 65; }
for f in apps/api/dist/main.js apps/worker/dist/main.js packages/db/dist/cli.js apps/web/dist/index.html; do
  [ -f "$WS/$f" ] || { echo "assemble-runtime: $WS/$f missing: run 'pnpm -r build' first" >&2; exit 65; }
done

# 1) notices and inventory (before pruning: development packages are still installed, so every licence id resolves)
node "$WS/licenses/collect-notices.mjs" --out "$OUT/licenses"
cp "$WS/licenses/sbom.cdx.json" "$WS/licenses/inventory.csv" "$OUT/licenses/"

# 2) production prune, offline, from the frozen lockfile
#    modules-cache-max-age=0: pnpm otherwise keeps orphaned (development) packages in node_modules/.pnpm for 7 days.
(cd "$WS" && CI=true pnpm install --frozen-lockfile --prod --offline --config.modules-cache-max-age=0 "${STORE[@]}")

# 3) runtime tree
mkdir -p "$OUT/apps" "$OUT/packages"
cp -a "$WS/package.json" "$WS/node_modules" "$OUT/"
for p in apps/api apps/worker packages/config packages/db packages/shared; do
  mkdir -p "$OUT/$p"
  cp -a "$WS/$p/package.json" "$WS/$p/dist" "$WS/$p/node_modules" "$OUT/$p/"
done
cp -a "$WS/packages/db/migrations" "$OUT/packages/db/"
mkdir -p "$OUT/apps/web"
cp -a "$WS/apps/web/dist" "$OUT/apps/web/"
find "$OUT/apps" "$OUT/packages" -path '*/node_modules' -prune -o \
  \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.js.map' -o -name '*.test.d.ts.map' \) -type f -exec rm -f {} +

# 4) layout verification
for f in apps/api/dist/main.js apps/worker/dist/main.js packages/db/dist/cli.js apps/web/dist/index.html \
         licenses/THIRD-PARTY-NOTICES.md licenses/sbom.cdx.json; do
  [ -f "$OUT/$f" ] || { echo "layout check failed: missing $f" >&2; exit 1; }
done
ls "$OUT"/packages/db/migrations/*.sql >/dev/null
[ ! -e "$OUT/packages/db/seeds" ] || { echo "layout check failed: dev seeds present" >&2; exit 1; }
# Every package directory in the virtual store must be in the shipped set (scope runtime|bundled) of the inventory.
node - "$OUT/node_modules/.pnpm" "$WS/licenses/inventory.csv" <<'JS' || { echo "layout check failed: non-shipped packages present" >&2; exit 1; }
const fs = require("node:fs");
const [store, csv] = process.argv.slice(2);
const shipped = new Set(fs.readFileSync(csv, "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(",")).filter((c) => c[3] === "runtime" || c[3] === "bundled").map((c) => `${c[0]}@${c[1]}`));
const extra = [];
let n = 0;
for (const d of fs.readdirSync(store)) {
  if (d === "node_modules" || d === "lock.yaml" || !fs.statSync(`${store}/${d}`).isDirectory()) continue;
  n++;
  const base = d.replace(/_.*$/, "");
  const at = base.lastIndexOf("@");
  const name = base.slice(0, at).replace(/^@([^+]+)\+/, "@$1/");
  if (!shipped.has(`${name}@${base.slice(at + 1)}`)) extra.push(d);
}
if (extra.length) { console.error(`not in the shipped set: ${extra.join(", ")}`); process.exit(1); }
console.log(`virtual store: ${n} package directories, all in the shipped set (${shipped.size} runtime+bundled)`);
JS
(cd "$OUT/apps/api" && node -e 'import("@mth/db").then(()=>{})') || { echo "layout check failed: @mth/db does not resolve" >&2; exit 1; }
(cd "$OUT/apps/worker" && node -e 'import("pg-boss").then(()=>{})') || { echo "layout check failed: pg-boss does not resolve" >&2; exit 1; }
echo "assemble-runtime: OK $(find "$OUT/node_modules/.pnpm" -mindepth 1 -maxdepth 1 -type d ! -name node_modules | wc -l) packages, $(du -sh "$OUT" | cut -f1) -> $OUT"
