#!/bin/bash
# Mutants in the disposable clone (each applied, its test file run, then restored with git checkout; sha256 compared).
#  M0  controls: the three test files on the unmodified tree
#  M1  F-DG7-954: the A26 drill defect (repro/m1-a26-defect.patch: route gate + requireAction use business_unit.read)
#  M1b only the PATCH handler's requireAction downgraded (line-scoped, the create handler untouched)
#  M2  config-bundle plan: every kind treated as permitted (ADR-0065 §8 kind's own right bypassed at plan time)
#  M3  OIDC: an existing identity with an unbound hold is not refused (ADR-0064 §8)
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export QA_PG_PORT=32451 MTH_PORT_POOL=32452-32499
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
ORG=apps/api/src/modules/organization/routes.ts
PLAN=apps/api/src/modules/transfer/config-bundle/plan.ts
OIDC=apps/api/src/modules/identity/oidc.ts
T_ORG=apps/api/test/integration/organizations.test.ts
T_CB=apps/api/test/integration/transfer/config-bundle.test.ts
T_ID=apps/api/test/integration/identity/unbound-signin.test.ts
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -E "✓|✗|×|FAIL|Test Files|Tests |AssertionError|expected" | grep -v "^ *✓" | head -40; echo "exit=${PIPESTATUS[0]}"; }
sums() { sha256sum $ORG $PLAN $OIDC; }
{
echo "# $(date -u +%FT%TZ) mutants (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
sums > $TMPDIR/sums-before.txt; cat $TMPDIR/sums-before.txt
echo "== M0 controls (unmodified tree)"; run $T_ORG $T_CB $T_ID
echo "== M1 A26 defect patch"; git apply $E/repro/m1-a26-defect.patch && git diff --stat; run $T_ORG; git checkout -- $ORG
echo "== M1b PATCH requireAction only (line 361)"; sed -n 361p $ORG; sed -i '361s/"business_unit.manage"/"business_unit.read"/' $ORG; git diff -U0 | grep '^[-+] '; run $T_ORG; git checkout -- $ORG
echo "== M2 plan: every kind permitted"; sed -i 's/may = await adapter.permitted(db, principal, organizationId);/may = true; void adapter.permitted;/' $PLAN; git diff -U0 | grep '^[-+] '; run $T_CB; git checkout -- $PLAN
echo "== M3 oidc: existing identity unbound check removed"; sed -i 's/if (await identityUnbound(tx, existing.id))/if (false \&\& (await identityUnbound(tx, existing.id)))/' $OIDC; git diff -U0 | grep '^[-+] '; run $T_ID; git checkout -- $OIDC
echo "== restore check"; sums > $TMPDIR/sums-after.txt; diff $TMPDIR/sums-before.txt $TMPDIR/sums-after.txt && echo "sources restored byte-equal"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/30-mutants.log 2>&1
