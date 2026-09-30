#!/usr/bin/env bash
# code-security-reviewer, DG0 round 28: runs the SEC24..SEC28 fragments against a disposable --no-local clone at <commit>.
# Usage: run-sec28-repro.sh <repo> <commit> [baseline]   (baseline => SEC28_BASELINE=1, only SEC28-[01234] judged)
set -uo pipefail
REPO="${1:?repo}"; COMMIT="${2:?commit}"; MODE="${3:-candidate}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:?}/sec28-repro.XXXXXX")"
trap 'rm -rf "$W"' EXIT
git clone -q --no-local "$REPO" "$W/c"
git -C "$W/c" checkout -q "$COMMIT"
echo "# mode=$MODE clone: --no-local, shallow=$(git -C "$W/c" rev-parse --is-shallow-repository), HEAD=$(git -C "$W/c" rev-parse HEAD), rules.mjs sha256=$(sha256sum "$W/c/tools/gates/lib/rules.mjs" | cut -d' ' -f1)"
T="$W/c/tools/gates/tests/sec28.test.mjs"
cp "$W/c/tools/gates/tests/validator.test.mjs" "$T"
cat "$HERE/../round-24/sec24-repro.tests.mjs.txt" "$HERE/../round-25/sec25-repro.tests.mjs.txt" \
    "$HERE/../round-26/sec26-repro.tests.mjs.txt" "$HERE/../round-27/sec27-repro.tests.mjs.txt" \
    "$HERE/sec28-repro.tests.mjs.txt" >> "$T"
cd "$W/c"
if [ "$MODE" = baseline ]; then
  SEC28_BASELINE=1 TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC28-[01234] ' tools/gates/tests/sec28.test.mjs
else
  TMPDIR="$W" node --test --test-reporter=spec --test-name-pattern='^SEC2[45678]-' tools/gates/tests/sec28.test.mjs
fi
echo "exit=$?"
