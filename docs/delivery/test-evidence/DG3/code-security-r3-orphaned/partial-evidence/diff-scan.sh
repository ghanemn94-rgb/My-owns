#!/usr/bin/env bash
# code-security-reviewer DG3 round-3 static scans of the repair diff f49ca16..ce988e2 (product code) and of the frozen
# tree, run in the disposable clone $TMPDIR/rev (read-only use; git, grep and node -e only). Derived from round-2/diff-scan.sh.
cd "$TMPDIR/scan" || exit 2
R1=928b765419e7e84feeaae1a60724a11c318799a8; B=f49ca1604857f8a79dce28c306cff895e6158d8e; C=ce988e20f7ea2752cd3283995fbf7ed05b704485
echo "# diff-scan: clone HEAD $(git rev-parse HEAD); round-1 source $R1; round-2 source $B; round-3 source $C; $(date -u +%FT%TZ)"
echo "## S0 repair diff, product paths"; git diff --stat $B..$C -- apps packages eslint.config.js vitest.config.ts package.json docs/api docs/architecture | tail -1
echo "## S0a repair commits between round-2 and round-3 sources"; git log --oneline $B..$C | sed 's/^/  /'
echo "## S0b files outside product paths in the repair diff (delivery records only expected)"
git diff --name-only $B..$C | grep -vE '^(apps|packages|docs/api|docs/architecture)/|^(eslint.config.js|vitest.config.ts|package.json)$' | sed 's/^/  /'
echo "## S0c no orchestrator edits: f49ca16 + diff(de06138) + diff(6b30768) == ce988e2 on the product paths (expect 0 differing lines)"
P="apps packages eslint.config.js vitest.config.ts package.json docs/api docs/architecture"
for c in de06138 6b30768; do echo "  $c parent=$(git rev-parse --short $c^) files: $(git diff --name-only $c^ $c -- $P | tr '\n' ' ')"; done
git checkout -q -b s0c-tmp $B && git diff de06138^ de06138 -- $P | git apply --index && git diff 6b30768^ 6b30768 -- $P | git apply --index && echo "  differing lines vs ce988e2: $(git diff --cached $C -- $P | wc -l)"
git reset -q --hard; git checkout -q 0e820ae7f122caecffdac00d1ec8a125375f90a3; git branch -D -q s0c-tmp
echo "## S1 engine sources changed since round 1 and round 2 (expect none; tests and test-support excluded)"
git diff --name-only $R1..$C -- packages/shared/src/formula ':!packages/shared/src/formula/*.test.ts' ':!packages/shared/src/formula/test-support/**' || true; echo "  (end of list)"
git ls-tree $C packages/shared/src/formula/ | sed 's/^/  /'
echo "## S1b engine imports (allowlisted only)"; grep -nE "^(import|export) .* from|^\} from" packages/shared/src/formula/{evaluate,index,parse,tokenize,typecheck,types}.ts | sed 's/^/  /'
echo "## S1c value.ts (allowlisted ../value.ts) imports and change since round 1"; grep -nE "^import" packages/shared/src/value.ts | sed 's/^/  /'; git diff --stat $R1..$C -- packages/shared/src/value.ts | tail -1; echo "  (empty line above = unchanged)"
echo "## S2 workflows imports portfolio? (expect none)"; grep -rnE "from ['\"](\.\./)+portfolio|modules/portfolio" apps/api/src/modules/workflows || echo "  none"
echo "## S3 advisory-lock registry changed since round 2? (expect no)"; [ -z "$(git diff $B..$C -- $(git grep -l ADVISORY_LOCK_CLASSES -- apps packages))" ] && echo "  unchanged"
git grep -nE "7302(19|2[0-9])" -- apps packages | grep -vE '\.test\.ts:' | sed 's/^/  /'
echo "## S4 migrations changed since round 1 (expect none)"; git diff --name-status $R1..$C -- packages/db/migrations || true; ls packages/db/migrations | tail -9 | sed 's/^/  /'
echo "## S5 p3-pending lists (expect every list empty)"; for f in $(git ls-files | grep 'p3-pending-.*\.ts$'); do printf '  %s: ' $f; grep -cE '^\s*"[a-zA-Z]+",?\s*$' $f; done
echo "## S6 OpenAPI operations counted from the YAML"; grep -cE '^\s+operationId:' docs/api/openapi.yaml
echo "## S6b OpenAPI / shared schemas / API / db changed by the repair (expect none)"; git diff --stat $B..$C -- docs/api apps/api packages/db packages/shared/src/schemas apps/worker | tail -1; echo "  (empty line above = unchanged)"
echo "## S7 web: added lines with navigation/cache/HTML-injection primitives (expect none)"; git diff $B..$C -- apps/web/src | grep -E '^\+' | grep -nE "useNavigate|\.navigate\(|setQueryData|window\.location|dangerouslySetInnerHTML|innerHTML\s*=" | sed 's/^/  /' || echo "  none"
echo "## S8 CSS: base .status-chip and other chip rules untouched (only additions)"; git diff $B..$C -- apps/web/src/styles/app.css | grep -E '^-[^-]' | sed 's/^/  removed: /' || true; git diff $B..$C -- apps/web/src/styles/app.css | grep -cE '^\+[^+]' | sed 's/^/  added lines: /'
echo "## S8b usages of status-chip--wrap"; git grep -n "status-chip--wrap" -- apps/web/src | sed 's/^/  /'
echo "## S9 dependency manifests changed by the repair (expect only the root test script)"; git diff $B..$C -- pnpm-lock.yaml package.json 'apps/*/package.json' 'packages/*/package.json' | grep -E '^[-+][^-+]' | sed 's/^/  /'
echo "## S10 eslint-disable comments added by the repair"; git diff $B..$C -- apps packages | grep -E '^\+.*eslint-disable' | sed 's/^/  /'
echo "## S10b eslint-disable comments in engine sources (expect none)"; grep -n "eslint-disable" packages/shared/src/formula/{evaluate,index,parse,tokenize,typecheck,types}.ts || echo "  none"
echo "## S11 secrets-shaped strings in added lines (expect none)"; git diff $B..$C -- apps packages eslint.config.js vitest.config.ts | grep -E '^\+' | grep -niE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" || echo "  none"
echo "## S12 public CDN / remote URLs in added lines (expect none besides example.invalid)"; git diff $B..$C -- apps packages eslint.config.js vitest.config.ts | grep -E '^\+' | grep -noE "https?://[^ \"')]+" | sed 's/^/  /' || echo "  none"
echo "## S13 CI runs 'pnpm test' (so the no-codegen invocation is in CI)"; grep -n "pnpm test" .github/workflows/ci.yml deploy/ci/ci.yml | sed 's/^/  /'
echo "## S14 CSP in HELMET_OPTIONS (script-src, unsafe-eval)"; sed -n '/export const HELMET_OPTIONS/,/^} satisfies/p' apps/api/src/server.ts | sed 's/^/  /'; grep -rn "unsafe-eval\|wasm-unsafe-eval" apps packages --include=*.ts --include=*.tsx --include=*.html | grep -v node_modules | sed 's/^/  /' || echo "  no unsafe-eval anywhere in apps/packages"
echo "# end"
