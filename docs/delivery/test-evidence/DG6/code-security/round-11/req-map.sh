#!/usr/bin/env bash
# code-security-reviewer, DG6 round 11: per requirement, the number of PASSING test lines (✓) naming it in the
# integration logs of both locales (30-*, 31-*-p) and the unit logs (21-*, 20-*, 22c-*), plus the test files in the
# candidate tree that name it. Then a scan of every cited log for failure, skip, todo and timeout lines.
# Output: 70-req-map.log.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-11
cd /home/user/My-owns
REQS="REQ-S01-005 REQ-S02-006 REQ-S10-002 REQ-S10-004 REQ-S12-019 REQ-S12-023 REQ-S12-024 REQ-S13-011 REQ-S13-013 REQ-S15-010 REQ-S16-006 REQ-S16-007 REQ-S16-022 REQ-S16-023 REQ-S16-026 REQ-S16-027 REQ-S16-029 REQ-S16-030 REQ-S16-032 REQ-S17-001 REQ-S17-002 REQ-S17-003 REQ-S17-005 REQ-S17-006 REQ-S17-007 REQ-S17-008 REQ-S17-009 REQ-S17-010 REQ-S17-011 REQ-S20-012 REQ-S20-013 REQ-S20-014 REQ-S20-017 REQ-S20-022 REQ-S20-029 REQ-S20-030"
UNSET=$(ls $E/30-integration-lang-unset-shard?of4.log)
CUTF8=$(ls $E/31-integration-lang-cutf8-shard?of4-p.log)
UNIT="$E/21-unit-node24.log $E/20-unit-node22.log"
printf "%-12s %8s %8s %8s %6s\n" REQ int-unset int-cutf8 unit24+22 files
for r in $REQS; do
  a=$(cat $UNSET | grep "✓" | grep -c "$r")
  b=$(cat $CUTF8 | grep "✓" | grep -c "$r")
  u=$(cat $UNIT | grep "✓" | grep -c "$r")
  f=$(grep -rl "$r" apps/*/test apps/*/src packages/*/test packages/*/src tests/qa e2e apps/web/e2e --include=*.ts --include=*.tsx 2>/dev/null | grep -v "/dist/" | wc -l)
  printf "%-12s %8s %8s %8s %6s\n" "$r" "$a" "$b" "$u" "$f"
done
echo
echo "## failure / skip / todo / timeout lines in every cited test log"
for l in $E/2*.log $E/3*.log $E/4*.log; do
  echo "== $(basename $l): $(grep -E '^ +(Test Files|Tests) ' $l | tr -s ' ' | tr '\n' ';')"
  grep -nE " × |^ FAIL|Hook timed out|Test timed out|Unhandled Error|Error: \[vitest|↓|skipped|todo| failed" $l | grep -v "✓" | head -12
done
echo "## exit=0"
