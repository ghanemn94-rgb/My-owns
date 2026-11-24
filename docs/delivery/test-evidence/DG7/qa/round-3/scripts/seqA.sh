#!/usr/bin/env bash
# qa-verifier DG7 round 3, sequence A: build, static checks, unit tests in the disposable clone $TMPDIR/rv.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-3/scripts
R="bash $S/run.sh"
$R 10-build pnpm build
$R 11-static-typecheck pnpm -r typecheck
$R 12-static-lint pnpm lint
$R 13-static-openapi-lint pnpm openapi:lint
$R 14-static-no-cdn pnpm check:no-cdn
$R 15-static-deps-verify timeout 120 pnpm deps:verify
$R 16-static-prettier bash -c 'git ls-files -co --exclude-standard -z | python3 -c "import sys,os; sys.stdout.write(\"\".join(p+\"\\0\" for p in sys.stdin.read().split(\"\\0\") if p and os.path.isfile(p)))" | xargs -0 npx prettier --check --ignore-unknown'
$R 20-unit-node24-unset env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$R 21-unit-node24-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
echo "seqA done $(date -u +%FT%TZ)"
