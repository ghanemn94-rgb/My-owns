#!/usr/bin/env bash
# Usage: make-clone.sh <name>  -> $TMPDIR/mut/<name>: a clone of HEAD + the uncommitted QA files, node_modules linked.
set -euo pipefail
SRC=/home/user/wt/dg5-qa-f
DST="$TMPDIR/mut/$1"
rm -rf "$DST"
git clone -q --no-hardlinks --no-checkout "$SRC" "$DST"
git -C "$DST" sparse-checkout set apps packages tests e2e docs/api tools/gates/schemas >/dev/null
git -C "$DST" checkout -q "$(git -C "$SRC" rev-parse HEAD)"
for f in tests/qa/support/a13-durable.ts tests/qa/support/a13-child-worker.ts tests/qa/integration/a13-durable-automation.test.ts \
         tests/qa/integration/a13-starter-jobs.test.ts tests/qa/integration/a22-operational-readiness.test.ts \
         tests/qa/unit/a22-s21-001-text-scan.test.ts; do cp "$SRC/$f" "$DST/$f"; done
# node_modules: link every package's node_modules (pnpm layout) and the root one; copy built dist folders.
( cd "$SRC" && find . -maxdepth 3 -name node_modules -type d -not -path "*/node_modules/*" ) | while read -r d; do
  mkdir -p "$DST/$(dirname "$d")"; ln -sfn "$SRC/$d" "$DST/$d"; done
for d in packages/*/dist apps/*/dist; do [ -d "$SRC/$d" ] && [ "$d" != apps/web/dist ] && cp -r "$SRC/$d" "$DST/$d"; done
echo "clone ready: $DST ($(git -C "$DST" rev-parse --short HEAD))"
