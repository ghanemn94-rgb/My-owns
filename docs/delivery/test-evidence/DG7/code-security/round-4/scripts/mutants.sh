#!/bin/bash
# F-DG7-940 re-verification on the round-4 candidate, in the disposable clone $TMPDIR/rv (never the candidate tree).
#  R0  the shipped export-scope.test.ts + export.test.ts on the unmodified tree (controls; must pass)
#  M4  requireExportRight: the scoped authorize() removed (the round-3 mutant named in the assignment)
#  M6  list route: requireExportRight dropped          M7  get route: requireExportRight dropped
#  M8  manifest/attachment-manifest download: requireExportRight dropped
#  M9  create route pre-check dropped (requestExport still re-checks inside the transaction: expected SURVIVOR,
#      the in-transaction check still refuses; recorded, not a defect)
# Every mutant runs ONLY the new export-scope.test.ts, so a kill is attributable to the BE-R8 test.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export QA_PG_PORT=32462 MTH_PORT_POOL=32463-32480
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-4
cd $TMPDIR/rv
SV=apps/api/src/modules/transfer/export/service.ts
RT=apps/api/src/modules/transfer/export/routes.ts
T_SC=apps/api/test/integration/transfer/export-scope.test.ts
T_EX=apps/api/test/integration/transfer/export.test.ts
run() { tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@" 2>&1 | grep -E "✓|❯|×|FAIL|Test Files|Tests |AssertionError|expected|Error" | head -40; echo "exit=${PIPESTATUS[0]}"; }
mut() { # mut <file> <python-old> <python-new>
python3 - "$1" "$2" "$3" <<'PY'
import sys;p,old,new=sys.argv[1:4];s=open(p).read()
assert s.count(old)>=1, "anchor not found"
s=s.replace(old,new,1);open(p,'w').write(s)
PY
}
{
echo "# $(date -u +%FT%TZ) F-DG7-940 mutants (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
sha256sum $SV $RT > $TMPDIR/msums-before.txt; cat $TMPDIR/msums-before.txt
echo "== R0 controls (unmodified tree): export-scope.test.ts + export.test.ts"; run $T_SC $T_EX

echo "== M4 requireExportRight: scoped authorize() removed"
mut $SV '    if ((await authorize(db, principal, MIGRATION_EXPORT, { type: "organization", id: organizationId })).allowed)
      return organizationId;' '    return organizationId;'
git diff -U0 $SV | grep '^[-+] '; run $T_SC; git checkout -- $SV

echo "== M6 list route: requireExportRight dropped"
mut $RT '    const query = parseQuery(listQuery, request.query);
    await requireExportRight(deps.db, principalOf(request));' '    const query = parseQuery(listQuery, request.query);'
git diff -U0 $RT | grep '^[-+] '; run $T_SC; git checkout -- $RT

echo "== M7 get route: requireExportRight dropped"
mut $RT '    const { migrationExportId } = parse(idParams, request.params, "params");
    await requireExportRight(deps.db, principalOf(request));
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned' '    const { migrationExportId } = parse(idParams, request.params, "params");
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned'
git diff -U0 $RT | grep '^[-+] '; run $T_SC; git checkout -- $RT

echo "== M8 manifest downloads: requireExportRight dropped"
mut $RT '    await requireExportRight(deps.db, principalOf(request));
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    const { bytes, sha256 }' '    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    const { bytes, sha256 }'
git diff -U0 $RT | grep '^[-+] '; run $T_SC; git checkout -- $RT

echo "== M9 create route pre-check dropped (in-transaction re-check remains; expected survivor)"
mut $RT '    await requireExportRight(deps.db, principal);
    const body' '    const body'
git diff -U0 $RT | grep '^[-+] '; run $T_SC; git checkout -- $RT

echo "== restore check"; sha256sum $SV $RT > $TMPDIR/msums-after.txt; diff $TMPDIR/msums-before.txt $TMPDIR/msums-after.txt && echo "sources restored byte-equal"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/32-f940-mutants.log 2>&1
