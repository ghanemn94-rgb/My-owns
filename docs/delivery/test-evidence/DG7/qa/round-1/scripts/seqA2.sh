#!/usr/bin/env bash
# qa-verifier DG7 round 1, sequence A2: the steps of seqA.sh after deps:verify (moved, unchanged).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1/scripts
R="bash $S/run.sh"
$R 16-static-prettier bash -c 'git ls-files -co --exclude-standard -z | python3 -c "import sys,os; sys.stdout.write(\"\".join(p+\"\\0\" for p in sys.stdin.read().split(\"\\0\") if p and os.path.isfile(p)))" | xargs -0 npx prettier --check --ignore-unknown'
$R 20-unit-node24-unset env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$R 21-unit-node24-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
$R 22-unit-node22-unset env -u LANG -u LC_ALL -u LC_CTYPE PATH=/opt/node22/bin:$PATH bash -c 'node -v; pnpm test'
# sparse clone note: skip-worktree paths (docs/delivery/{runs,handbacks,test-evidence}) are absent; prettier checks every present file
echo "seqA2 done $(date -u +%FT%TZ)"
