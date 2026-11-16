#!/bin/bash
# F-DG7-963: the transfer-drill harness tests on the candidate, then two mutants of drill/cleanup.sh (revert-to-fail):
#  M1 td_remove_work lets a failed rm decide its status again (the pre-fix `rm -rf` under set -e)
#  M2 td_stop_pg sends only SIGTERM to the launcher pid and does not wait (the pre-fix stop_pid race)
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
L=deploy/scripts/drill/cleanup.sh
T=deploy/scripts/tests/transfer-drill.test.mjs
P="T-DG7-DO-D8"
d8() { node --test --test-name-pattern="$P" $T 2>&1 | grep -E "^not ok|^ok|^# (tests|pass|fail|skipped)|✖|ℹ (tests|pass|fail|skipped)|BLOCKED|expected|actual:" | head -40; echo "exit=${PIPESTATUS[0]}"; }
{
echo "# $(date -u +%FT%TZ) F-DG7-963 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
sha256sum $L deploy/scripts/transfer-drill.sh
echo "== A. full harness file on the candidate: node --test $T"
node --test $T 2>&1 | grep -E "^not ok|✖|ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)|BLOCKED|T-DG7-DO-D8 real" | head -40; echo "exit=${PIPESTATUS[0]}"
echo "== B. control: only the T-DG7-DO-D8 cases (name pattern '$P')"; d8
echo "== M1 td_remove_work: return the rm status (pre-fix behaviour)"
python3 - "$L" <<'PY'
import sys;p=sys.argv[1];s=open(p).read()
old='  [ -n "$dir" ] && [ "$dir" != "/" ] || return 0\n  for i in 1 2 3 4 5; do'
assert old in s; s=s.replace(old,'  [ -n "$dir" ] && [ "$dir" != "/" ] || return 0\n  rm -rf -- "$dir"; return $?\n  for i in 1 2 3 4 5; do',1); open(p,'w').write(s)
PY
git diff -U0 $L | grep '^[-+] '; d8; git checkout -- $L
echo "== M2 td_stop_pg: TERM to the launcher pid only, no wait (pre-fix stop_pid race)"
python3 - "$L" <<'PY'
import sys;p=sys.argv[1];s=open(p).read()
old='  td_alive "$pid" || return 0\n  # The tree is listed'
assert old in s; s=s.replace(old,'  td_alive "$pid" || return 0\n  kill -TERM "$pid" 2>/dev/null; return 0\n  # The tree is listed',1); open(p,'w').write(s)
PY
git diff -U0 $L | grep '^[-+] '; d8; git checkout -- $L
sha256sum $L
echo "== leftover postgres processes from these runs (none expected)"; ps -eo pid,comm,args | grep "[p]ostgres -D" | grep -c "pg-stop-\|pg-dir-\|mth-transfer-drill-test" 
echo "== final git status (must be clean)"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/31-f963-drill-cleanup.log 2>&1
