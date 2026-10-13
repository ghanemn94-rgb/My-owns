#!/usr/bin/env bash
# domain-reviewer DG4 round 10: BE-R7 judgement (REQ-S04-008 intent, M0412). Clone $TMPDIR/review-r10 at e70ac02.
set -u
cd "$TMPDIR/review-r10"; echo "### HEAD $(git rev-parse HEAD)"
echo "## M0412 (anchored master prompt)"; grep -n -A3 'M0412' /home/user/My-owns/docs/source/master-prompt.anchored.md | head -8
echo "## REQ-S04-008 acceptance"; python3 -c "
import csv
for r in csv.DictReader(open('/home/user/My-owns/docs/delivery/requirements.csv')):
    if r['req_id']=='REQ-S04-008': print(r['acceptance']); print('notes:', r['notes'][:600])"
echo "## a08 DELIVERY_RECORDS vs g5-g6 DELIVERY_RECORDS (expected identical)"
extract() { awk '/const DELIVERY_RECORDS = \[/,/\] as const;/' "$1" | tr -d ' \n'; echo; }
A=$(extract tests/qa/integration/a08-gate-controls.test.ts); B=$(extract apps/api/test/integration/workflows/g5-g6.test.ts)
echo "a08:   $A"; echo "g5g6:  $B"; [ "$A" = "$B" ] && echo "IDENTICAL" || echo "DIFFERENT"
echo "## Product code paths that name docs/delivery or the delivery record files (expected: none outside tests)"
grep -rnE 'docs/delivery|stages\.json|findings\.json|requirements\.csv' apps/api/src apps/web/src packages/*/src apps/worker 2>/dev/null | grep -vE '\.test\.|/test/' ; echo "(grep exit=$? ; 1 = none)"
echo "## Product code file-system writes (writeFile/appendFile/createWriteStream/mkdir) outside tests"
grep -rnE 'writeFile|appendFile|createWriteStream|mkdirSync|\bmkdir\(' apps/api/src apps/web/src packages/*/src 2>/dev/null | grep -vE '\.test\.|/test/' ; echo "(grep exit=$?)"
echo "## What else lives in docs/delivery (outside the fingerprint) - top-level entries"
ls /home/user/My-owns/docs/delivery
echo "## The fingerprint size now (records only)"
cd /home/user/My-owns/docs/delivery && find gates stages.json findings.json reviews decisions.md requirements.csv -type f | wc -l && du -ch gates stages.json findings.json reviews decisions.md requirements.csv | tail -1
echo "## The only product runtime writer (evidence store) writes under the configured EVIDENCE_STORAGE_PATH, not docs/delivery"
cd "$TMPDIR/review-r10"
grep -n 'FilesystemEvidenceStore(config.path)' apps/api/src/modules/evidence/store.ts
grep -n 'EVIDENCE_STORAGE_PATH' packages/config/src/load.ts packages/config/src/index.ts .env.example
grep -n 'key escapes the root' apps/api/src/modules/evidence/store.ts
