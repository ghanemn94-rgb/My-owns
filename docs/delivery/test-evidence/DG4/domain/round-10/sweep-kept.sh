#!/usr/bin/env bash
# domain-reviewer DG4 round 10: independent check of the rows KEPT in the FE-R11 handback §3 sweep table, and a wider
# sweep for feature-availability strings the handback did not list. Clone $TMPDIR/review-r10 at e70ac02 (source).
set -u
cd "$TMPDIR/review-r10"; echo "### HEAD $(git rev-parse HEAD)"
echo "## #4-#6 gates.notEnabled/notEnabledBody, problems.gate_not_enabled: render conditions and submission_enabled"
grep -n 'notEnabled' apps/web/src/pages/gates/GateDetailPage.tsx apps/web/src/pages/gates/GatesPage.tsx
grep -n -B2 -A2 'gate_not_enabled' apps/api/src/modules/workflows/gates.ts | head -12
echo "-- migrations that set submission_enabled:"; grep -ln 'submission_enabled' packages/db/migrations/*.sql
grep -n 'submission_enabled' packages/db/migrations/*0059*.sql
echo "-- API writes to gate_definition (expected none):"; grep -rnE "(insertInto|updateTable)\(\"gate_definition\"\)|UPDATE gate_definition|INSERT INTO gate_definition" apps/api/src | grep -v '\.test\.' ; echo "(grep exit=$?)"
echo "-- catalogue test pins all six enabled:"; grep -n -A12 'submission' packages/db/test/integration/catalogue.test.ts | head -20
echo "## #7 transformations.workspace.laterStage: render sites (expected only catalogues)"
grep -rn 'laterStage' apps/web/src apps/web/e2e
echo "## #8 admin.plannedSections"; grep -n 'plannedSections' -r apps/web/src --include=*.tsx; grep -h '"plannedSections"' apps/web/src/i18n/*/admin.json
for r in REQ-S06-004 REQ-S05-002 REQ-S10-015 REQ-S12-001 REQ-S12-002 REQ-S15-004 REQ-S01-002; do python3 - "$r" <<'PY'
import csv,sys
for row in csv.DictReader(open('/home/user/My-owns/docs/delivery/requirements.csv')):
    if row['id']==sys.argv[1]: print(row['id'], row.get('final_gate'), row.get('status'), '|', row.get('title','')[:90])
PY
done
echo "## #9 access__scope_type_reserved"; grep -n -B3 -A3 'scope_type_reserved' apps/api/src/modules/access/assignments.ts | head -12; grep -n -A5 'P1_SCOPE_TYPES' packages/shared/src/constants.ts | head -8
python3 - <<'PY'
import csv
for row in csv.DictReader(open('/home/user/My-owns/docs/delivery/requirements.csv')):
    if row['id'] in ('REQ-S10-002','REQ-S03-007'): print(row['id'], row.get('final_gate'), row.get('status'), row.get('increments',''), '|', row.get('title','')[:100])
PY
echo "## #10 nav.p4.beingBuiltBody: P4_PLANNED_ROUTES contents"; grep -n -A16 'P4_PLANNED_ROUTES' apps/web/src/app/router.tsx | head -40
echo "## #11 decisionRights.arProvisional"; grep -rn 'arProvisional' apps/web/src/i18n/en/*.json | head
echo "## wider sweep (user-facing catalogues): availability wording not in the handback list"
grep -rniE 'future release|next release|upcoming|not yet (available|supported|enabled)|later (release|stage|phase|version)|coming|planned for|إصدار لاحق|إصدارات لاحقة|مرحلة لاحقة|قريبًا|غير متاح|سيتاح|لم يُتح|لاحقًا' apps/web/src/i18n | grep -v 'test' 
