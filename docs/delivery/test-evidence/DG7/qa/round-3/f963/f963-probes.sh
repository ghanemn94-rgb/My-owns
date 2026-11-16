#!/usr/bin/env bash
# qa-verifier DG7 round 3: F-DG7-963 (transfer-drill cleanup after PASS). Runs in $TMPDIR/m2 (sparse clone at 8323dac).
# P0 candidate: the whole transfer-drill node:test file under a disposable PostgreSQL.
# P1 revert-to-fail: transfer-drill.sh put back to f22c97b5 (round-2 candidate), cleanup.sh and the test kept; only the
#    T-DG7-DO-D8 describe block is run. Expected: the static wiring case and the end-to-end WARNING case fail.
# P2 revert-to-fail: cleanup.sh's td_remove_work made to propagate rm's failure (return 1), the script kept.
set -u
cd "$TMPDIR/m2"
T=deploy/scripts/tests/transfer-drill.test.mjs
D=deploy/scripts/transfer-drill.sh
L=deploy/scripts/drill/cleanup.sh
sum() { grep -E '^# (tests|pass|fail|skipped|cancelled)' ; }
echo "HEAD $(git rev-parse HEAD); $(node tools/gates/candidate.mjs --stage DG7)"
echo "=== P0 candidate: full file $(date -u +%T)"
QA_PG_PORT=32560 MTH_PORT_POOL=32561-32569 tests/qa/support/with-pg.sh node --test "$T" > "$OUTDIR/p0-full.tap" 2>&1; echo "P0 exit $?"; sum < "$OUTDIR/p0-full.tap"
grep -E '^not ok|# SKIP|# TODO' "$OUTDIR/p0-full.tap" | head
echo "=== P0b candidate: DO-D8 block only $(date -u +%T)"
node --test --test-name-pattern='T-DG7-DO-D8' "$T" > "$OUTDIR/p0b-d8.tap" 2>&1; echo "P0b exit $?"; sum < "$OUTDIR/p0b-d8.tap"
cp "$D" "$TMPDIR/drill.keep"; git show f22c97b5:"$D" > "$D"
echo "=== P1 transfer-drill.sh reverted to f22c97b5 ($(git diff --stat | tail -1)) $(date -u +%T)"
node --test --test-name-pattern='T-DG7-DO-D8' "$T" > "$OUTDIR/p1-reverted-drill.tap" 2>&1; echo "P1 exit $?"; sum < "$OUTDIR/p1-reverted-drill.tap"
grep -E '^\s*not ok' "$OUTDIR/p1-reverted-drill.tap"
cp "$TMPDIR/drill.keep" "$D"
cp "$L" "$TMPDIR/lib.keep"
python3 - "$L" <<'P'
import sys
p=sys.argv[1]; s=open(p).read()
old='  if [ -n "$log" ]; then echo "$line" >>"$log" 2>/dev/null || true; fi\n  return 0\n}'
assert old in s, 'anchor'
s=s.replace(old,'  if [ -n "$log" ]; then echo "$line" >>"$log" 2>/dev/null || true; fi\n  return 1\n}')
open(p,'w').write(s)
P
echo "=== P2 td_remove_work returns 1 after a failed removal ($(git diff --stat | tail -1)) $(date -u +%T)"
node --test --test-name-pattern='T-DG7-DO-D8' "$T" > "$OUTDIR/p2-remove-returns-1.tap" 2>&1; echo "P2 exit $?"; sum < "$OUTDIR/p2-remove-returns-1.tap"
grep -E '^\s*not ok' "$OUTDIR/p2-remove-returns-1.tap"
cp "$TMPDIR/lib.keep" "$L"
echo "--- restored: $(git status --short | wc -l) changed; $(node tools/gates/candidate.mjs --stage DG7)"
