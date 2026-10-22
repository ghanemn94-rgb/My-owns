#!/usr/bin/env bash
# code-security-reviewer DG5 r6: the integration project on a disposable PostgreSQL (tests/qa/support/with-pg.sh), Node 24.
# $1 = unset|cutf8 ; $2 = starting port ; rest = extra vitest args. Port range 26500-26599 (assignment).
set -u
C=$TMPDIR/review-r6; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-6
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
MODE=$1; PORT=$2; LBL=$3; shift 3
L=$E/05-integration-$LBL.log; cd $C
if [ "$MODE" = cutf8 ]; then ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); else ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); fi
{ echo "## $(date -u +%FT%TZ) integration, mode=$MODE (${ENVP[*]}); node $(node -v); load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "\$ ${ENVP[*]} QA_PG_PORT=$PORT MTH_PORT_POOL=$((PORT+1))-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $*"
"${ENVP[@]}" QA_PG_PORT=$PORT MTH_PORT_POOL=$((PORT+1))-26599 bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s/\x1b\[[0-9;]*m//g"
echo "EXIT ${PIPESTATUS[0]}"; echo "## end $(date -u +%FT%TZ) load: $(cut -d' ' -f1-3 /proc/loadavg)"; } > $L 2>&1
grep -E 'Test Files|^ +Tests |^EXIT|^## end|FAIL' $L | tail -12
