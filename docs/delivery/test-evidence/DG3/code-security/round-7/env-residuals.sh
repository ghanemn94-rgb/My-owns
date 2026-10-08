#!/usr/bin/env bash
# code-security-reviewer DG3 round 7 (copied from round 6): environmental residuals on their offline/config surface, in the disposable clone
# $TMPDIR/rev (read-only use). Live registry (D-057), live CI (D-058), Keycloak (D-049).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-7
cd $TMPDIR/rev || exit 2; export PATH=/opt/node22/bin:$PATH
echo "# env residuals $(date -u +%FT%TZ) clone $(git rev-parse HEAD) node $(node -v)"
echo "## registry: offline frozen install (install1.log exit: $(tail -1 $EV/install1.log)); manifests/lockfile changed by the repair c40232b0..d3e6fe62? (expect empty)"
git diff --name-only c40232b0..d3e6fe62 -- '*package.json' pnpm-lock.yaml .github deploy | sed 's/^/  /'; echo "  (end)"
echo "## CI: node deploy/scripts/check-ci-needs.mjs"; node deploy/scripts/check-ci-needs.mjs; echo "  exit=$?"
echo "## CI: node --test deploy/scripts/tests/check-ci-needs.test.mjs (tail)"; node --test deploy/scripts/tests/check-ci-needs.test.mjs > $TMPDIR/ci-needs.out 2>&1; rc=$?; tail -9 $TMPDIR/ci-needs.out; echo "  exit=$rc"
echo "## CI: ci.yml runs pnpm test and pnpm test:integration"; grep -nE 'pnpm (test|test:integration)\b' .github/workflows/ci.yml | sed 's/^/  /'
echo "## Keycloak: passing oidc test lines per integration run (fake IdP)"
for l in integration-run1-lang-unset integration-run2-lang-c-utf8; do echo "  $l: $(grep '✓' $EV/$l.log | grep -ci oidc)"; done
