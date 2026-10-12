#!/usr/bin/env bash
# code-security-reviewer DG4 round 6: discriminates a slow render from a missing render for the specs that still failed
# alone at load ~23 (raid, prioritization, p2-blank-forms). Probe clone $TMPDIR/probe only: apps/web/test/setup.ts
# UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS 5_000 -> 25_000 and apps/web/vitest.config.ts testTimeout 20_000 -> 60_000 (reverted
# afterwards). If the tests pass with the longer wait, the failure was the page rendering after > 5 s, not a defect.
# A control run with the UNCHANGED config follows, for comparison at the same load.
cd $TMPDIR/probe || exit 2; export PATH=/opt/node22/bin:$PATH
F="apps/web/src/pages/raid/raid.test.tsx apps/web/src/pages/prioritization/prioritization.test.tsx apps/web/src/pages/p2-blank-forms.test.tsx"
cp apps/web/test/setup.ts $TMPDIR/setup.orig; cp apps/web/vitest.config.ts $TMPDIR/vc.orig
sed -i 's/UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 5_000/UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 25_000/' apps/web/test/setup.ts
sed -i 's/testTimeout: 20_000/testTimeout: 60_000/' apps/web/vitest.config.ts
echo "## longer waits ($(git diff --shortstat)) node $(node -v) load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
pnpm exec vitest run --project unit-web --reporter=verbose $F 2>&1 | grep -aE '^\s+(✓|×) .*(action register|ranked table|scorecard: 6|whitespace-only)|Test Files|Tests |FAIL'; echo "# exit_status: ${PIPESTATUS[0]}"
cp $TMPDIR/setup.orig apps/web/test/setup.ts; cp $TMPDIR/vc.orig apps/web/vitest.config.ts
echo "## control, unchanged config, node $(node -v) load $(cut -d' ' -f1-3 /proc/loadavg) $(date -u +%FT%TZ)"
pnpm exec vitest run --project unit-web --reporter=verbose $F 2>&1 | grep -aE '^\s+(✓|×) .*(action register|ranked table|scorecard: 6|whitespace-only)|Test Files|Tests |FAIL'; echo "# exit_status: ${PIPESTATUS[0]}"
echo "# git status: '$(git status --porcelain)'"
