#!/usr/bin/env bash
# code-security-reviewer, DG0 round 29: runs sec29-repro.tests.mjs.txt against a disposable --no-local clone at <commit>.
# Usage: run-sec29-repro.sh <repo> <commit> <baseline|candidate>
set -uo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"; MODE="${3:?baseline|candidate}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:?}/sec29-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
echo "# mode=$MODE clone: --no-local, shallow=$(git -C "$W/c" rev-parse --is-shallow-repository), HEAD=$(git -C "$W/c" rev-parse HEAD), rules.mjs sha256=$(sha256sum "$W/c/tools/gates/lib/rules.mjs" | cut -d' ' -f1), $(date -u +%FT%TZ)"
T="$W/c/tools/gates/tests/sec29.test.mjs"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$T"
cat "$HERE/sec29-repro.tests.mjs.txt" >> "$T"
cd "$W/c"
SEC29_EXPECT="$MODE" TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC29-' tools/gates/tests/sec29.test.mjs
echo "exit=$?"
