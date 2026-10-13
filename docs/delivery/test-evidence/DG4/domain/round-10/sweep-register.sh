#!/usr/bin/env bash
# domain-reviewer DG4 round 10: register rows behind the kept sweep rows #8 and #9 and the nav rewording (REQ-S03-007).
# (Re-run of the register part of sweep-kept.sh, whose first attempt used a wrong column name 'id'; the column is 'req_id'.)
python3 - <<'PY'
import csv
want=['REQ-S06-004','REQ-S05-002','REQ-S10-015','REQ-S12-001','REQ-S12-002','REQ-S15-004','REQ-S01-002','REQ-S10-002','REQ-S03-007','REQ-S13-001','REQ-S04-008','REQ-PB-021','REQ-S03-003']
rows={r['req_id']:r for r in csv.DictReader(open('/home/user/My-owns/docs/delivery/requirements.csv'))}
for w in want:
    r=rows[w]; print(w,'| final_gate',r['final_gate'],'| status',r['status'],'| increments',r['increments'],'|',r['title'][:110])
PY
