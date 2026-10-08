#!/usr/bin/env bash
# code-security-reviewer DG3 round-2 static scans of the repair diff 928b7654..f49ca16 (product code) and of the
# frozen tree, run in the disposable clone $TMPDIR/review-p2 (read-only use; git and grep only).
cd "$TMPDIR/review-p2" || exit 2
B=928b765419e7e84feeaae1a60724a11c318799a8; C=f49ca1604857f8a79dce28c306cff895e6158d8e
echo "# diff-scan: clone HEAD $(git rev-parse HEAD); base $B; source $C; $(date -u +%FT%TZ)"
echo "## S0 repair diff, product paths"; git diff --stat $B..$C -- apps packages eslint.config.js docs/api docs/architecture | tail -1
echo "## S0b files outside product paths in the repair diff (delivery records only expected)"
git diff --name-only $B..$C | grep -vE '^(apps|packages|docs/api|docs/architecture)/|^eslint.config.js$' | sed 's/^/  /'
echo "## S1 engine sources changed (expect none)"; git diff --name-only $B..$C -- packages/shared/src/formula | grep -v 'fuzz.test.ts$' || echo "  none"
echo "## S2 workflows imports portfolio? (expect none)"; grep -rnE "from ['\"](\.\./)+portfolio|modules/portfolio" apps/api/src/modules/workflows || echo "  none"
echo "## S2b architecture.test.ts acyclicity/forbidden-edge assertions"; f=$(git ls-files | grep -E 'architecture\.test\.ts$'); echo "  file(s): $f"; grep -nE "cycle|workflows.*portfolio|portfolio.*workflows|forbidden" $f | head -20 | sed 's/^/  /'
echo "## S2c portfolio -> workflows imports added by the repair"; git diff $B..$C -- apps/api/src/modules/portfolio | grep -E '^\+.*from "\.\./workflows' | sed 's/^/  /'
echo "## S3 advisory-lock registry changed by the repair? (expect no)"; git diff --stat $B..$C -- $(git grep -l ADVISORY_LOCK_CLASSES -- apps packages) | tail -1; [ -z "$(git diff $B..$C -- $(git grep -l ADVISORY_LOCK_CLASSES -- apps packages))" ] && echo "  unchanged"
git grep -nE "7302(19|2[0-9])" -- apps packages | grep -vE '\.test\.ts:' | sed 's/^/  /'
echo "## S4 migrations changed by the repair (expect none)"; git diff --name-status $B..$C -- packages/db/migrations || true; ls packages/db/migrations | tail -9 | sed 's/^/  /'
echo "## S5 p3-pending lists (expect every list empty)"; for f in $(git ls-files | grep 'p3-pending-.*\.ts$'); do printf '  %s: ' $f; grep -cE '^\s*"[a-zA-Z]+",?\s*$' $f; done
echo "## S5b contract.test.ts operation pin"; grep -nE "270|toHaveLength|operations.length" $(git ls-files | grep 'contract.test.ts$') | head -8 | sed 's/^/  /'
echo "## S6 OpenAPI operations counted from the YAML"; grep -cE '^\s+operationId:' docs/api/openapi.yaml
echo "## S7 remote/client I/O in the repair's API code (expect none)"; git diff $B..$C -- apps/api/src | grep -E '^\+' | grep -nE "fetch\(|node:fs|readFile|request\.raw|http\.request|https\.request|axios" || echo "  none"
echo "## S7b writes in the annotation path (expect none: insert/update/delete in added API lines)"; git diff $B..$C -- apps/api/src | grep -E '^\+' | grep -niE "insertInto|updateTable|deleteFrom|\.execute\(\)" | sed 's/^/  /' || true
echo "## S8 web: navigation/cache primitives in added lines (expect none besides <Link>)"; git diff $B..$C -- apps/web/src | grep -E '^\+' | grep -nE "useNavigate|\.navigate\(|setQueryData|window\.location|dangerouslySetInnerHTML|on-track|approved" | sed 's/^/  /' || echo "  none"
echo "## S8b i18n key parity of gates.inheritedApproval (en vs ar)"
node -e 'const a=require("./apps/web/src/i18n/en/gates.json").inheritedApproval,b=require("./apps/web/src/i18n/ar/gates.json").inheritedApproval;const k=o=>Object.entries(o).flatMap(([x,v])=>typeof v==="object"?k(v).map(y=>x+"."+y):[x]).sort();console.log("  en",JSON.stringify(k(a)));console.log("  ar",JSON.stringify(k(b)));console.log("  equal:",JSON.stringify(k(a))===JSON.stringify(k(b)))'
echo "## S9 dependency manifests changed by the repair (expect none)"; git diff --stat $B..$C -- pnpm-lock.yaml package.json 'apps/*/package.json' 'packages/*/package.json' | tail -1; echo "  (empty line above = unchanged)"
echo "## S10 eslint-disable comments added by the repair"; git diff $B..$C -- apps packages | grep -E '^\+.*eslint-disable' | sed 's/^/  /'
echo "## S11 secrets-shaped strings in added lines (expect none)"; git diff $B..$C -- apps packages eslint.config.js | grep -E '^\+' | grep -niE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" || echo "  none"
echo "## S12 zod mirror vs OpenAPI GateInheritedApproval"; sed -n '/GateInheritedApproval:/,/approvedOn:/p' docs/api/openapi.yaml | sed 's/^/  /'; sed -n '/export const gateInheritedApproval/,/^});/p' packages/shared/src/schemas/gate.ts | sed 's/^/  /'
echo "# end"
