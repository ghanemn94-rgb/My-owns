#!/usr/bin/env bash
# code-security-reviewer DG3 round-3 static scans (T-DG3-REV-SEC-R3B) of the repair diff f49ca160..ce988e20 (product code)
# and of the frozen tree, run in the disposable clone $TMPDIR/review-r3b at ce988e20 (read-only use; git and grep only).
cd "$TMPDIR/review-r3b" || exit 2
B=f49ca1604857f8a79dce28c306cff895e6158d8e; C=ce988e20f7ea2752cd3283995fbf7ed05b704485; R1=928b765419e7e84feeaae1a60724a11c318799a8
P3BASE=2376ca4
echo "# diff-scan: clone HEAD $(git rev-parse HEAD); repair base $B; source $C; $(date -u +%FT%TZ)"
echo "## S0 repair diff, product paths"; git diff --stat $B..$C -- apps packages eslint.config.js vitest.config.ts package.json docs/api docs/architecture | tail -1
echo "## S0b files changed by the repair outside apps/packages/docs (expect eslint.config.js, package.json, vitest.config.ts)"
git diff --name-only $B..$C | grep -vE '^(apps|packages|docs)/' | sed 's/^/  /'
echo "## S0c repair commits between $B and $C (first-parent and merged)"; git log --oneline $B..$C | sed 's/^/  /'
echo "## S0d authors of the repair commits"; git log --format='  %h %an <%ae> %s' $B..$C -- apps packages eslint.config.js vitest.config.ts package.json
echo "## S1 engine sources changed by the repair (expect none; only tests, canary, preload)"
git diff --name-only $B..$C -- packages/shared/src/formula | sed 's/^/  /'
git diff --name-only $B..$C -- packages/shared/src/formula | grep -vE '\.test\.ts$|/test-support/' || echo "  => engine sources: none changed"
echo "## S1b engine sources vs round-1 candidate ($R1) (expect none)"; git diff --stat $R1..$C -- packages/shared/src/formula ':!*.test.ts' ':!packages/shared/src/formula/test-support' | tail -1; echo "  (empty line = unchanged)"
echo "## S1c ../value.ts (allowlisted engine import) changed in P3? (expect no)"; git diff --stat $P3BASE..$C -- packages/shared/src/value.ts | tail -1; echo "  (empty line = unchanged)"
echo "## S1d ../value.ts contains no eval/Function/vm/require/import()/process? (expect none)"; grep -nE "\beval\b|\bFunction\b|node:vm|\brequire\(|import\(|\bprocess\b|constructor" packages/shared/src/value.ts || echo "  none"
echo "## S1e which lint config blocks apply to value.ts (formula rules?)"; npx eslint --print-config packages/shared/src/value.ts 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).rules;for(const r of ["no-eval","no-new-func","no-implied-eval","no-restricted-imports","no-restricted-globals"])console.log("  "+r+": "+JSON.stringify(c[r]??"(not set)").slice(0,120))})'
echo "## S1f lint config for evaluate.ts (engine) vs test-support preload vs fuzz.test.ts: no-restricted-imports present?"
for f in packages/shared/src/formula/evaluate.ts packages/shared/src/formula/test-support/nocodegen-preload.mjs packages/shared/src/formula/fuzz.test.ts; do
  npx eslint --print-config $f 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).rules;const ri=JSON.stringify(c["no-restricted-imports"]??"(not set)");console.log("  '"$f"': restricted-imports "+ (ri.includes("patterns")?"ALLOWLIST":"paths-only/none") +"; restricted-globals "+ (c["no-restricted-globals"]?.length-1) +" names")})'
done
echo "## S2 base .status-chip unchanged; removed CSS lines in the repair (expect none)"; git diff $B..$C -- apps/web/src/styles | grep -E '^-[^-]' || echo "  none"
echo "## S2b users of status-chip--wrap (expect only InheritedApprovalBadge)"; grep -rn "status-chip--wrap" apps/web/src --include=*.tsx --include=*.ts | grep -v '\.test\.' | sed 's/^/  /'
echo "## S2c other chips touched in the repair (className lines changed)"; git diff $B..$C -- apps/web/src | grep -E '^[-+].*className=' | sed 's/^/  /'
echo "## S3 advisory-lock registry (expect 730219-730223 distinct; unchanged by repair)"
git diff --stat $B..$C -- $(git grep -l ADVISORY_LOCK_CLASSES -- apps packages) | tail -1; echo "  (empty line = unchanged)"
git grep -nE "7302(19|2[0-9])" -- apps packages | grep -vE '\.test\.ts:' | sed 's/^/  /'
echo "## S4 migrations: changed by the repair (expect none); list"; git diff --name-status $B..$C -- packages/db/migrations; ls packages/db/migrations | grep -E '^00(19|2[0-9])' | sed 's/^/  /'
echo "## S4b migrations 0020-0027 changed since the round-1 candidate (expect none)"; git diff --name-status $R1..$C -- packages/db/migrations || true
echo "## S5 p3-pending lists (expect every list empty)"; for f in $(git ls-files | grep 'p3-pending-.*\.ts$'); do printf '  %s: ' $f; grep -cE '^\s*"[a-zA-Z]+",?\s*$' $f; done
echo "## S6 OpenAPI operations counted from the YAML; contract changed by the repair?"; grep -cE '^\s+operationId:' docs/api/openapi.yaml; git diff --stat $B..$C -- docs/api packages/shared/src/schemas | tail -1; echo "  (empty line = unchanged)"
echo "## S7 API/worker/db code changed by the repair (expect none)"; git diff --stat $B..$C -- apps/api apps/worker packages/db | tail -1; echo "  (empty line = unchanged)"
echo "## S8 dependency manifests and lockfile changed by the repair (expect root package.json scripts only)"; git diff $B..$C -- pnpm-lock.yaml package.json 'apps/*/package.json' 'packages/*/package.json' | grep -E '^[-+][^-+]' | sed 's/^/  /'
echo "## S9 eslint-disable comments added by the repair"; git diff $B..$C -- apps packages | grep -E '^\+.*eslint-disable' | sed 's/^/  /'
echo "## S10 secrets-shaped strings in added lines (expect none)"; git diff $B..$C -- apps packages eslint.config.js vitest.config.ts | grep -E '^\+' | grep -niE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" || echo "  none"
echo "## S11 public CDN / remote URLs in added lines (expect none besides comments/docs)"; git diff $B..$C -- apps packages eslint.config.js vitest.config.ts | grep -E '^\+' | grep -nE "https?://" | grep -vE "example\.invalid|localhost|127\.0\.0\.1" | sed 's/^/  /' || echo "  none"
echo "## S12 vitest projects: include globs and pools"; node -e 'import("./vitest.config.ts").catch(()=>{});' 2>/dev/null; grep -nE 'name: |include:|pool:|exclude:|execArgv' vitest.config.ts | sed 's/^/  /'
echo "## S13 formula-engine tests outside packages/shared/src/formula (would run only in unit-node, not under the flag)"
git grep -lE "from ['\"][./]*(formula|@mth/shared/formula|.*formula/index)" -- '*.test.ts' '*.test.tsx' | grep -v '^packages/shared/src/formula/' | sed 's/^/  /' || echo "  none"
echo "## S14 CI and gate tooling invoke 'pnpm test' (both vitest invocations)"; grep -rnE "pnpm (run )?test\b|vitest" .github/workflows deploy/ci 2>/dev/null | sed 's/^/  /'
echo "## S15 engine bundled into apps/web (imports of the formula engine in apps/web/src)"; git grep -nE "@mth/shared/(formula|calc)|formula/index" -- apps/web/src | grep -v '\.test\.' | head -5 | sed 's/^/  /'
echo "# end"
