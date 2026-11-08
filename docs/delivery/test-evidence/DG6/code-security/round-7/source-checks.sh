#!/usr/bin/env bash
# code-security-reviewer DG6 round 7: static source checks on the disposable clone w3 (read only).
cd "$TMPDIR/r/w3" || exit 2
echo "# 60-source-checks $(date -u +%FT%TZ) cwd=$(pwd) commit=$(git rev-parse HEAD)"
set -x
grep -c 'operationId:' docs/api/openapi.yaml
grep -m1 '^  version:' docs/api/openapi.yaml
set +x
echo "## p6-pending lists (operation literals left in each):"
for f in $(git ls-files 'apps/api/test/support/p6-pending-*.ts'); do
  n=$(grep -oE '"[A-Za-z][A-Za-z0-9]+"' "$f" | grep -v '\./' | wc -l); echo "$f: $n literals"; done
echo "## migrations 0098..0126 (contiguous?):"
ls packages/db/migrations | grep -E '^0(09[89]|1[0-2][0-9])_' | cut -c1-4 | tr '\n' ' '; echo
prev=97; for n in $(ls packages/db/migrations | grep -E '^0(09[89]|1[0-2][0-9])_' | cut -c1-4 | sed 's/^0*//'); do [ $n -eq $((prev+1)) ] || echo "GAP before $n"; prev=$n; done; echo "highest: $prev"
echo "## worker imports api code?"
grep -rnE "from ['\"][./]*(apps/api|\.\./\.\./api)|@mth/api" apps/worker/src --include=*.ts | grep -v '\.test\.ts' | head -5; echo "(end)"
echo "## secrets-like literals in product source (sk-, BEGIN PRIVATE KEY, password=):"
grep -rnE 'BEGIN (RSA |EC )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' apps packages --include=*.ts --include=*.tsx --include=*.json --include=*.yaml -l | grep -v node_modules | head; echo "(end)"
echo "## public CDN references in web index/html:"
grep -rnE 'https?://(cdn|unpkg|fonts\.googleapis|cdnjs|jsdelivr)' apps/web/index.html apps/web/src | head -5; echo "(end)"
echo "## new uses of restriction helpers in this round's diff:"
git diff --stat 031945d8761a253665c6b794e6c8d2efbacdfe65 HEAD -- apps packages | tail -1
echo "## unfiltered reference fields found by the probe (code):"
grep -n 'parentBenefitId: r.parent_benefit_id' apps/api/src/modules/benefits/register.ts
grep -n 'outputRecordId: r.output_record_id' apps/api/src/modules/launch/tasks.ts
grep -n 'recordId: r.record_id' apps/api/src/modules/governance/meeting-outputs.ts
grep -n 'outputRecordExists' apps/api/src/modules/launch/tasks.ts | head -3
grep -n 'async function recordExists' -A12 apps/api/src/modules/governance/meeting-outputs.ts | head -14
grep -n '  const links = await db' -A8 apps/api/src/modules/procedures/steps.ts
grep -c 'restricted\|sensitiv' apps/api/src/modules/launch/tasks.ts apps/api/src/modules/governance/meeting-outputs.ts apps/api/src/modules/procedures/steps.ts apps/api/src/modules/governance/minutes.ts
echo "exit=0"
