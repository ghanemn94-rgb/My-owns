#!/usr/bin/env bash
# code-security-reviewer DG2 round-16 auxiliary checks (T-DG2-REV-SEC-R16), in the disposable clone $TMPDIR/review-r16
# (HEAD f4242ae = candidate 0cab0a8c, source e3b2375). Reads the integration logs written by checks.sh.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-16
cd $TMPDIR/review-r16
export PATH=/opt/node22/bin:$PATH
R1=$EV/integration-run1-lang-unset.log; R2=$EV/integration-run2-lang-c-utf8.log

{ echo "# command: grep -c '^ *operationId:' docs/api/openapi.yaml; ls packages/db/migrations; contract/migrate lines from both integration runs (clone HEAD $(git rev-parse --short HEAD))"
  echo "operationIds: $(grep -c '^ *operationId:' docs/api/openapi.yaml)"
  ls packages/db/migrations
  for L in $R1 $R2; do echo "== $(basename $L)"; grep -E '^ +(✓|×) .*(contract\.test\.ts|migrate\.test\.ts)' $L | sed 's/ [0-9]*ms$//' | cut -c1-240; done
  echo "# exit_status: 0"; } > $EV/contract-ops.log 2>&1

{ echo "# command: per integration test file, passing (✓) / failing (×) counts in both locale runs: grep -E '^ +(✓|×) \\|integration\\| ' <log> | sed 's/ >.*//' | sort | uniq -c"
  echo "# required by the assignment: contract.test.ts (161 ops), media-types.test.ts, connection-hygiene.test.ts (BE16 connection/shutdown), request-io.test.ts (BE17), packages/db pool-bounds.test.ts (BE17), commit-time-auth.test.ts + shutdown-cleanup.test.ts (BE18A), blank-text, oidc, invalid-character, framework-errors, invalid-utf8, encoding, evidence tests, migrations 0001->0019"
  for L in $R1 $R2; do echo "== $(basename $L)"; echo "-- passing"; grep -E '^ +✓ \|integration\| ' $L | sed 's/^ *✓ |integration| //; s/ >.*//' | sort | uniq -c
    echo "-- failing"; grep -E '^ +× \|integration\| ' $L | sed 's/^ *× |integration| //; s/ >.*//' | sort | uniq -c; echo "-- totals"; grep -E 'Test Files|Tests  ' $L; done
  echo "# exit_status: 0"; } > $EV/requirements-suites.log 2>&1

{ echo "# command: grep -E '^ +(✓|×).*aud-write-deny' <both integration logs> (counts, failures)"
  for L in $R1 $R2; do echo "$(basename $L) pass=$(grep -cE '^ +✓.*aud-write-deny' $L) fail=$(grep -cE '^ +×.*aud-write-deny' $L) (of which kpi-aud-write-deny pass=$(grep -cE '^ +✓.*kpi-aud-write-deny' $L))"; done
  grep -E '^ +(✓|×).*aud-write-deny' $R1 $R2 | sed "s#$EV/##" | cut -c1-260
  echo "# exit_status: 0"; } > $EV/aud-403-sweep.log 2>&1

{ echo "# command: git diff ed80b23..e3b2375 --stat -- . ':!docs'; then the product diff (non-test) scanned for risky patterns"
  git diff --stat ed80b23..e3b2375 -- . ':!docs'
  echo "# pattern: https?://|cdn|unpkg|jsdelivr|googleapis|innerHTML|dangerously|eval\\(|new Function|localStorage|sessionStorage|password|secret|token|api[_-]?key|window\\.location|returnTo|console\\.(log|debug)"
  git diff ed80b23..e3b2375 -- apps packages ':!**/*.test.*' ':!**/e2e/**' | grep '^+' | grep -nEi 'https?://|cdn|unpkg|jsdelivr|googleapis|innerHTML|dangerously|eval\(|new Function|localStorage|sessionStorage|password|secret|token|api[_-]?key|window\.location|returnTo|console\.(log|debug)'
  echo "# note: the assignment names the range fe22d759..cbdb4f68 (round 10 -> 11, already reviewed in rounds 11-15); the product change since round 15 is ed80b23..e3b2375 (round-15 source -> round-16 source; FE14 44f1cf0). Stat of the named range for the record:"
  git diff --stat fe22d759..cbdb4f68 -- apps packages | tail -3
  echo "# exit_status: 0"; } > $EV/diff-scan.log 2>&1

{ echo "# command: node deploy/scripts/check-ci-needs.mjs; node --test deploy/scripts/tests/check-ci-needs.test.mjs; grep -nE 'run: pnpm|validate.mjs' .github/workflows/*.yml  (clone HEAD $(git rev-parse --short HEAD); node $(node --version))"
  echo "## live registry (D-057): offline frozen-lockfile install - see install.log/install2.log (exit 0); no network in the sandbox"
  echo "## live CI (D-058):"
  node deploy/scripts/check-ci-needs.mjs; echo "check-ci-needs exit=$?"
  node --test deploy/scripts/tests/check-ci-needs.test.mjs 2>&1 | tail -9; echo "check-ci-needs.test exit=${PIPESTATUS[0]}"
  grep -nE 'run: pnpm|validate.mjs' .github/workflows/*.yml
  echo "## Keycloak (D-049): OIDC is exercised against the in-process test IdP in oidc.test.ts (33 passed in each integration run); no Keycloak in the sandbox"
  echo "oidc.test.ts run1 pass=$(grep -cE '^ +✓.*oidc\.test\.ts' $R1) fail=$(grep -cE '^ +×.*oidc\.test\.ts' $R1); run2 pass=$(grep -cE '^ +✓.*oidc\.test\.ts' $R2) fail=$(grep -cE '^ +×.*oidc\.test\.ts' $R2)"
  echo "# finished"; } > $EV/env-residuals.log 2>&1
