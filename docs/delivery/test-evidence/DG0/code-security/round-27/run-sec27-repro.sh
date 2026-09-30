#!/usr/bin/env bash
# code-security-reviewer, DG0 round 27: runs the SEC24 + SEC25 + SEC26 + SEC27 fragments against a disposable --no-local
# clone at <commit>. Usage: run-sec27-repro.sh <repo> <commit>
set -uo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:?}/sec27-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
echo "# clone: --no-local, shallow=$(git -C "$W/c" rev-parse --is-shallow-repository), HEAD=$(git -C "$W/c" rev-parse HEAD), rules.mjs sha256=$(sha256sum "$W/c/tools/gates/lib/rules.mjs" | cut -d' ' -f1)"
T="$W/c/tools/gates/tests/sec27.test.mjs"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$T"
cat "$HERE/../round-24/sec24-repro.tests.mjs.txt" "$HERE/../round-25/sec25-repro.tests.mjs.txt" \
    "$HERE/../round-26/sec26-repro.tests.mjs.txt" "$HERE/sec27-repro.tests.mjs.txt" >> "$T"
cd "$W/c"
TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC2[4567]-' tools/gates/tests/sec27.test.mjs
echo "exit=$?"
