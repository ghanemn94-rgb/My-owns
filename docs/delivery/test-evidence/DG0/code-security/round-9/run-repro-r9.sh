#!/usr/bin/env bash
# code-security-reviewer DG0 round 9: run repro-r9-cases.mjs against a disposable clone at a given commit.
#   bash run-repro-r9.sh <clone-dir> <commit>
set -euo pipefail
CLONE="$1"; COMMIT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
git -C "$CLONE" checkout -q "$COMMIT"
echo "clone: $CLONE at $(git -C "$CLONE" rev-parse HEAD)"
head -n 238 "$CLONE/tools/gates/tests/validator.test.mjs" > "$CLONE/tools/gates/tests/zz-repro-r9.test.mjs"
cat "$HERE/repro-r9-cases.mjs" >> "$CLONE/tools/gates/tests/zz-repro-r9.test.mjs"
set +e
( cd "$CLONE" && node --test tools/gates/tests/zz-repro-r9.test.mjs )
rc=$?
set -e
rm -f "$CLONE/tools/gates/tests/zz-repro-r9.test.mjs"
echo "exit=$rc"
exit $rc
