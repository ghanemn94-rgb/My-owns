#!/usr/bin/env bash
# code-security-reviewer, DG0 round 25: runs the round-24 SEC24 fragment followed by the round-25 SEC25 fragment against a
# disposable --no-local clone at <commit>. Usage: run-sec25-repro.sh <repo> <commit>
set -uo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:?}/sec25-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
echo "# clone: --no-local, shallow=$(git -C "$W/c" rev-parse --is-shallow-repository), HEAD=$(git -C "$W/c" rev-parse HEAD)"
T="$W/c/tools/gates/tests/sec25.test.mjs"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$T"
cat "$HERE/../round-24/sec24-repro.tests.mjs.txt" "$HERE/sec25-repro.tests.mjs.txt" >> "$T"
cd "$W/c"
TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC2[45]-' tools/gates/tests/sec25.test.mjs
echo "exit=$?"
