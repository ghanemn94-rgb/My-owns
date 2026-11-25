#!/usr/bin/env bash
# qa-verifier DG7 round 4, sequence A: build and static checks in the disposable clone $TMPDIR/rv (units run in w1-unit.sh).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4/scripts
R="bash $S/run.sh"
$R 10-build pnpm build
$R 11-static-typecheck pnpm -r typecheck
$R 12-static-lint pnpm lint
$R 13-static-openapi-lint pnpm openapi:lint
$R 14-static-no-cdn pnpm check:no-cdn
$R 15-static-deps-verify timeout 120 pnpm deps:verify
$R 16-static-prettier bash -c 'git ls-files -co --exclude-standard -z | python3 -c "import sys,os; sys.stdout.write(\"\".join(p+\"\\0\" for p in sys.stdin.read().split(\"\\0\") if p and os.path.isfile(p)))" | xargs -0 npx prettier --check --ignore-unknown'
echo "seqA done $(date -u +%FT%TZ)"
