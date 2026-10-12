#!/usr/bin/env bash
# code-security-reviewer DG4 round 6: every spec file that failed in a full `pnpm test` run under load (unit-node22, unit-node24,
# unit-repeat-1/2) re-run ALONE, on Node 22 and Node 24, in the disposable probe clone $TMPDIR/probe (0e499f2, unmodified).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-6
cd $TMPDIR/probe || exit 2
for n in /opt/node22/bin /opt/nvm/versions/node/v24.21.0/bin; do
  echo "## node $(PATH=$n:$PATH node -v) load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
  PATH=$n:$PATH pnpm exec vitest run --project unit-web apps/web/src/pages/gates/g1-agreements.test.tsx apps/web/src/pages/p2-blank-forms.test.tsx apps/web/src/pages/prioritization/prioritization.test.tsx apps/web/src/pages/raid/raid.test.tsx apps/web/src/pages/traceability/traceability.test.tsx 2>&1 | grep -aE '^ (✓|❯|×) |Test Files|Tests |FAIL|Error'; echo "# unit-web exit_status: ${PIPESTATUS[0]}"
  PATH=$n:$PATH pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -aE '^ (✓|❯|×) |Test Files|Tests |FAIL|Error'; echo "# unit-node exit_status: ${PIPESTATUS[0]}"
done
echo "# git status: '$(git status --porcelain)'  load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
