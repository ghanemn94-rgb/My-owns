#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: the two specs that failed in unit-node22.log (load ~24-28), discriminated in the probe
# clone $TMPDIR/probe2 (ea5e262):
#  1. control: each failed spec ALONE, unchanged config, Node 22 and Node 24;
#  2. raid.test.tsx with longer waits (apps/web/test/setup.ts UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS 5_000 -> 25_000 and
#     apps/web/vitest.config.ts testTimeout 20_000 -> 60_000, reverted afterwards): a pass means the page rendered after
#     > 5 s (slow render under load), not a missing render (defect).
cd $TMPDIR/probe2 || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
for n in $N22 $N24; do
  echo "## control alone, unchanged config, node $(PATH=$n:$PATH node -v) load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
  PATH=$n:$PATH pnpm exec vitest run --project unit-web --reporter=verbose apps/web/src/pages/raid/raid.test.tsx 2>&1 | grep -aE '^\s+(✓|×) .*action register|Test Files|Tests |FAIL'; echo "# raid exit_status: ${PIPESTATUS[0]}"
  PATH=$n:$PATH pnpm exec vitest run --project unit-node --reporter=verbose apps/api/src/architecture.test.ts 2>&1 | grep -aE '^\s+(✓|×) .*every import respects|Test Files|Tests |FAIL'; echo "# architecture exit_status: ${PIPESTATUS[0]}"
done
cp apps/web/test/setup.ts $TMPDIR/setup.orig; cp apps/web/vitest.config.ts $TMPDIR/vc.orig
sed -i 's/UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 5_000/UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 25_000/' apps/web/test/setup.ts
sed -i 's/testTimeout: 20_000/testTimeout: 60_000/' apps/web/vitest.config.ts
echo "## raid, longer waits ($(git diff --shortstat)) node $(PATH=$N22:$PATH node -v) load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
PATH=$N22:$PATH pnpm exec vitest run --project unit-web --reporter=verbose apps/web/src/pages/raid/raid.test.tsx 2>&1 | grep -aE '^\s+(✓|×) .*action register|Test Files|Tests |FAIL'; echo "# exit_status: ${PIPESTATUS[0]}"
cp $TMPDIR/setup.orig apps/web/test/setup.ts; cp $TMPDIR/vc.orig apps/web/vitest.config.ts
echo "# git status after revert: '$(git status --porcelain)'  load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
