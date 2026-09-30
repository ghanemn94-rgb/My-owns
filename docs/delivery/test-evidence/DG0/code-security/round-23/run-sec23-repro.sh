#!/usr/bin/env bash
# code-security-reviewer, DG0 round 23: runs sec23-repro.tests.mjs.txt against a disposable --no-local clone of the candidate.
# Usage: run-sec23-repro.sh <repo> <commit>
set -euo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/sec23-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$W/c/tools/gates/tests/sec23.test.mjs"
cat "$HERE/sec23-repro.tests.mjs.txt" >> "$W/c/tools/gates/tests/sec23.test.mjs"
cd "$W/c"
node --test --test-name-pattern='^SEC23-' tools/gates/tests/sec23.test.mjs
