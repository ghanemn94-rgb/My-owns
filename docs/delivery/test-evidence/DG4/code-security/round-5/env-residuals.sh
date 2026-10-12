#!/usr/bin/env bash
# code-security-reviewer DG4 round 5 (adapted from DG4 rounds 1-3): environmental residuals on their offline/config surface,
# in the disposable clone $TMPDIR/rv (read-only use). Live registry (D-057), live CI (D-058), Keycloak (D-049).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-5
cd $TMPDIR/rv || exit 2; export PATH=/opt/node22/bin:$PATH
echo "# env residuals $(date -u +%FT%TZ) clone $(git rev-parse HEAD) node $(node -v)"
echo "## registry: offline frozen install (install1.log: $(tail -1 $EV/install1.log)); manifests/lockfile changed in P4 d3e6fe6..3e3a06e:"
git diff --name-only d3e6fe6..3e3a06e -- '*package.json' pnpm-lock.yaml .github deploy | sed 's/^/  /'; echo "  (end)"
echo "## registry: pnpm deps:verify needs live registry access (npm view; scripts/verify-dependency-pins.mjs header) and is NOT run here: the live-registry residual D-057. P4 changes no dependency (only the packages/shared export map, above)."
echo "## CI: node deploy/scripts/check-ci-needs.mjs"; node deploy/scripts/check-ci-needs.mjs; echo "  exit=$?"
echo "## CI: node --test deploy/scripts/tests/check-ci-needs.test.mjs (tail)"; node --test deploy/scripts/tests/check-ci-needs.test.mjs > $TMPDIR/ci-needs.out 2>&1; rc=$?; tail -9 $TMPDIR/ci-needs.out; echo "  exit=$rc"
echo "## CI: ci.yml runs pnpm test and pnpm test:integration"; grep -nE 'pnpm (test|test:integration)\b' .github/workflows/ci.yml | sed 's/^/  /'
echo "## Keycloak: passing oidc test lines per integration run (fake IdP)"
for l in integration-run1-lang-unset integration-run2-lang-c-utf8; do [ -f $EV/$l.log ] && echo "  $l: $(grep -a '✓' $EV/$l.log | grep -ci oidc)"; done
