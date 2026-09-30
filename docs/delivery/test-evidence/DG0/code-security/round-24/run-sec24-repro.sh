#!/usr/bin/env bash
# code-security-reviewer, DG0 round 24: runs sec24-repro.tests.mjs.txt against a disposable --no-local clone at <commit>.
# Usage: run-sec24-repro.sh <repo> <commit>
set -uo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:?}/sec24-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
echo "# clone: --no-local, shallow=$(git -C "$W/c" rev-parse --is-shallow-repository), HEAD=$(git -C "$W/c" rev-parse HEAD)"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$W/c/tools/gates/tests/sec24.test.mjs"
cat "$HERE/sec24-repro.tests.mjs.txt" >> "$W/c/tools/gates/tests/sec24.test.mjs"
cd "$W/c"
TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC24-' tools/gates/tests/sec24.test.mjs
echo "exit=$?"
