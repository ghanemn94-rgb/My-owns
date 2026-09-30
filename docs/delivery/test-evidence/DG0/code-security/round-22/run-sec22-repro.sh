#!/usr/bin/env bash
# code-security-reviewer, DG0 round 22: runs sec22-repro.tests.mjs.txt against a disposable clone of the candidate.
# Usage: run-sec22-repro.sh <repo> <commit>
set -euo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/sec22-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "file://$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$W/c/tools/gates/tests/sec22.test.mjs"
cat "$HERE/sec22-repro.tests.mjs.txt" >> "$W/c/tools/gates/tests/sec22.test.mjs"
cd "$W/c"
node --test --test-name-pattern='^SEC22-' tools/gates/tests/sec22.test.mjs
