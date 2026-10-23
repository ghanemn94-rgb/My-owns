#!/usr/bin/env bash
# code-security-reviewer DG5 r7: the 42 assigned requirements: register row (status, final_gate) and the number of test
# files (unit, integration, e2e, qa) that cite the id, in the clone at 1932faa.
set -u
C=$TMPDIR/review-r7; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-7; cd $C
REQS="REQ-PB-093 REQ-S01-002 REQ-S03-007 REQ-S04-011 REQ-S05-001 REQ-S05-002 REQ-S05-006 REQ-S06-001 REQ-S06-002 REQ-S06-004 REQ-S06-005 REQ-S06-006 REQ-S06-007 REQ-S06-008 REQ-S06-009 REQ-S06-010 REQ-S07-016 REQ-S08-005 REQ-S10-013 REQ-S10-015 REQ-S12-001 REQ-S12-002 REQ-S12-003 REQ-S12-004 REQ-S12-012 REQ-S12-015 REQ-S12-020 REQ-S12-021 REQ-S12-022 REQ-S12-025 REQ-S12-026 REQ-S13-005 REQ-S13-006 REQ-S13-007 REQ-S13-010 REQ-S15-004 REQ-S16-010 REQ-S16-012 REQ-S16-015 REQ-S16-021 REQ-S18-001 REQ-S18-003"
{ echo "## $(date -u +%FT%TZ) requirement map (clone HEAD $(git rev-parse --short HEAD)); $(echo $REQS | wc -w) ids"
python3 - "$REQS" <<'PY'
import csv, sys
want = sys.argv[1].split()
rows = {r["req_id"]: r for r in csv.DictReader(open("docs/delivery/requirements.csv", encoding="utf-8"))}
for k in want:
    r = rows.get(k)
    print(k, "MISSING" if r is None else f'status={r.get("status")} final_gate={r.get("final_gate")} notes_chars={len(r.get("notes") or "")}')
PY
for r in $REQS; do
  n=$(grep -rlE "$r\b" apps packages tests e2e --include=*.test.ts --include=*.test.tsx --include=*.spec.ts 2>/dev/null | wc -l)
  echo "$r test_files=$n"
done
echo "## end $(date -u +%FT%TZ)"; } > $E/07-requirement-test-map.log 2>&1
grep -cE "status=IMPLEMENTED final_gate=DG5" $E/07-requirement-test-map.log; grep -E "MISSING|test_files=0$" $E/07-requirement-test-map.log; grep -vE "status=IMPLEMENTED final_gate=DG5" $E/07-requirement-test-map.log | grep -E "status=" 
