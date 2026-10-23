#!/usr/bin/env bash
# code-security-reviewer DG5 r7: structure, contract-pending lists, scans and validators (clone at 1932faa, Node 24).
set -u
C=$TMPDIR/review-r7; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd $C
{ echo "## $(date -u +%FT%TZ) structure; clone HEAD $(git rev-parse --short HEAD)"
echo "\$ git diff --stat e70ac02..12dc33e -- apps packages | tail -1"; git diff --stat e70ac02..12dc33e -- apps packages | tail -1
echo "\$ git diff --name-status ad52a56..12dc33e -- packages apps/api apps/worker   (the round-7 delta outside apps/web: expected empty)"; git diff --name-status ad52a56..12dc33e -- packages apps/api apps/worker | wc -l
echo "\$ git diff --name-status ad52a56..12dc33e -- docs/api   (contract change: expected empty)"; git diff --name-status ad52a56..12dc33e -- docs/api | wc -l
echo "\$ ls packages/db/migrations | contiguity 0001..0097"
ls packages/db/migrations | grep -E '^[0-9]{4}_' | cut -c1-4 | sort -u | awk '{n=$1+0; if (p && n!=p+1) printf "GAP before %04d\n", n; p=n; c++} END {print "last", p, "count", c}'
echo "\$ git diff --name-status e70ac02..12dc33e -- packages/db/migrations | cut -f1 | sort | uniq -c   (only additions expected)"; git diff --name-status e70ac02..12dc33e -- packages/db/migrations | cut -f1 | sort | uniq -c
echo "\$ grep -c 'operationId:' docs/api/openapi.yaml"; grep -c 'operationId:' docs/api/openapi.yaml
echo "\$ module graph: reporting -> workflows/admin imports (non-test); worker -> apps/api imports"
grep -rnE "from \"\.\./(workflows|admin)/" apps/api/src/modules/reporting --include=*.ts | grep -v '\.test\.ts' | wc -l
grep -rnE "from \"[./]*(apps/api|@mth/api)" apps/worker/src | wc -l
echo "\$ web: the new hook's module imports"; grep -n '^import' apps/web/src/api/queries.ts
echo "\$ web: lazy routes (React.lazy count in the router)"; grep -rc "lazy(" apps/web/src/routes.tsx apps/web/src/App.tsx 2>/dev/null
echo; echo "\$ node --experimental-strip-types scripts/pend.mts apps/api/test/support"
node --experimental-strip-types --no-warnings $E/scripts/pend.mts $C/apps/api/test/support; echo "EXIT $?"
echo; echo "## scans over added lines of git diff ad52a56..12dc33e -- apps packages (the round-7 delta)"
D=$(git diff ad52a56..12dc33e -- apps packages | grep '^+' | grep -v '^+++')
echo "added lines: $(printf '%s\n' "$D" | wc -l)"
echo "--- dangerouslySetInnerHTML|innerHTML|eval(|new Function|window.open|href=\{|localStorage|sessionStorage|https?://"
printf '%s\n' "$D" | grep -nE 'dangerouslySetInnerHTML|innerHTML|eval\(|new Function|window\.open|href=\{|localStorage|sessionStorage|https?://' | grep -v 'http://localhost' || echo "(none)"
echo "--- secrets (BEGIN .*PRIVATE KEY|AKIA|password=|secret=|api_key|ghp_|xox)"
printf '%s\n' "$D" | grep -nEi 'BEGIN .*PRIVATE KEY|AKIA[0-9A-Z]{16}|password\s*[:=]\s*"[^"]{6,}|secret\s*[:=]\s*"[^"]{8,}|api[_-]?key\s*[:=]\s*"|ghp_|xox[bp]-' || echo "(none)"
echo; echo "## validators"
for a in "--historical --stage DG4" "--historical --stage DG3" "--historical --stage DG2" "--historical --stage DG1" "--register DG5"; do
  echo "\$ node tools/gates/validate.mjs $a"; node tools/gates/validate.mjs $a 2>&1 | tail -3; echo "EXIT ${PIPESTATUS[0]}"; done
echo "## end $(date -u +%FT%TZ)"; } > $E/04-structure.log 2>&1
cat $E/04-structure.log | grep -vE 'length=0$'
