#!/usr/bin/env bash
# code-security-reviewer, DG6 round 12: runs a probe under repro/ inside the disposable clone $TMPDIR/r/w1, copied into
# apps/api/test/integration/access/ (its imports are relative to that directory), on a disposable PostgreSQL
# (tests/qa/support/with-pg.sh), Node 22, LANG/LC_ALL unset, port 32465. The probe file is removed afterwards.
# Usage: repro-api.sh <log name> <file under repro/>
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-12
cd "$TMPDIR/r/w1" || exit 2
export PATH=/opt/node22/bin:$PATH QA_PG_PORT=32465 MTH_PORT_POOL=32470-32499
unset LANG LC_ALL
dst="apps/api/test/integration/access/$2"
cp "$E/repro/$2" "$dst"
{
  echo "# $1  started $(date -u +%FT%TZ)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
  echo "\$ tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $dst"
  tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$dst"
  echo "exit=$?  finished $(date -u +%FT%TZ)"
} >"$E/$1.log" 2>&1
rm -f "$dst"
git status --short | wc -l >>"$E/$1.log"
tail -2 "$E/$1.log"
