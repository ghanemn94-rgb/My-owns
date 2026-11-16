#!/bin/bash
# Authorization mutants on the P7 transfer reads/exports (surfaces round 2 did not mutate), in the disposable clone.
#  R0  my reproduction (repro/zz-cs-r3-transfer-scope.test.ts) + the shipped export.test.ts and import-routes.test.ts on the unmodified tree
#  M4  requireExportRight: the scoped authorize() dropped (any grant holding migration.export, at any scope, admits)
#  M5  requireImportReadRight: the same for migration_import.read
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export QA_PG_PORT=32462 MTH_PORT_POOL=32463-32480
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
EX=apps/api/src/modules/transfer/export/service.ts
IM=apps/api/src/modules/transfer/import/service.ts
REPRO=apps/api/test/integration/transfer/zz-cs-r3-transfer-scope.test.ts
T_EX=apps/api/test/integration/transfer/export.test.ts
T_IM=apps/api/test/integration/transfer/import-routes.test.ts
run() { tests/qa/support/with-pg.sh npx vitest run --project integration "$@" 2>&1 | grep -E "✓|❯|×|FAIL|Test Files|Tests |AssertionError|expected" | grep -v "^ *✓ .*[0-9]ms$" | head -30; echo "exit=${PIPESTATUS[0]}"; }
{
echo "# $(date -u +%FT%TZ) mutants (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
sha256sum $EX $IM > $TMPDIR/msums-before.txt; cat $TMPDIR/msums-before.txt
cp $E/repro/zz-cs-r3-transfer-scope.test.ts $REPRO
echo "== R0 controls (unmodified tree): repro + export.test.ts + import-routes.test.ts"; run $REPRO $T_EX $T_IM
echo "== M4 export: scoped authorize dropped"
python3 - "$EX" <<'PY'
import sys;p=sys.argv[1];s=open(p).read()
old='    if ((await authorize(db, principal, MIGRATION_EXPORT, { type: "organization", id: organizationId })).allowed)\n      return organizationId;'
assert old in s; s=s.replace(old,'    return organizationId;',1); open(p,'w').write(s)
PY
git diff -U0 $EX | grep '^[-+] '; run $REPRO $T_EX; git checkout -- $EX
echo "== M5 import reads: scoped authorize dropped"
python3 - "$IM" <<'PY'
import sys;p=sys.argv[1];s=open(p).read()
old='    if ((await authorize(db, principal, MIGRATION_IMPORT_READ, { type: "organization", id: organizationId })).allowed)\n      return organizationId;'
assert old in s; s=s.replace(old,'    return organizationId;',1); open(p,'w').write(s)
PY
git diff -U0 $IM | grep '^[-+] '; run $REPRO $T_IM; git checkout -- $IM
rm -f $REPRO
echo "== restore check"; sha256sum $EX $IM > $TMPDIR/msums-after.txt; diff $TMPDIR/msums-before.txt $TMPDIR/msums-after.txt && echo "sources restored byte-equal"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/32-authz-mutants.log 2>&1
