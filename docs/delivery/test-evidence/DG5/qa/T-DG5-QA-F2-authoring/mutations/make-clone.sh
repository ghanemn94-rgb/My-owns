#!/usr/bin/env bash
# Usage: make-clone.sh <name>  -> $TMPDIR/mutf2/<name>: a sparse clone of this tree's HEAD plus the uncommitted QA-F2
# files, node_modules linked and the built dist folders copied. Nothing in the source tree is modified.
set -euo pipefail
SRC=/home/user/wt/dg5-qa-f2
DST="$TMPDIR/mutf2/$1"
rm -rf "$DST"; mkdir -p "$(dirname "$DST")"
git clone -q --no-hardlinks --no-checkout "$SRC" "$DST"
git -C "$DST" sparse-checkout set apps packages tests e2e docs/api tools/gates/schemas >/dev/null
git -C "$DST" checkout -q "$(git -C "$SRC" rev-parse HEAD)"
for f in tests/qa/support/a13-replay.ts tests/qa/integration/a13-dependency-slip-rule-b.test.ts \
         tests/qa/integration/a13-jobs-rerun.test.ts tests/qa/integration/a13-starters-run.test.ts \
         e2e/a13-automation-recovery.spec.ts e2e/support/a13-a22-stack.ts; do cp "$SRC/$f" "$DST/$f"; done
( cd "$SRC" && find . -maxdepth 3 -name node_modules -type d -not -path "*/node_modules/*" ) | while read -r d; do
  mkdir -p "$DST/$(dirname "$d")"; ln -sfn "$SRC/$d" "$DST/$d"; done
for d in packages/*/dist apps/*/dist; do [ -d "$SRC/$d" ] && [ "$d" != apps/web/dist ] && cp -r "$SRC/$d" "$DST/$d"; done
echo "clone ready: $DST ($(git -C "$DST" rev-parse --short HEAD))"
