#!/usr/bin/env bash
# qa-verifier DG7 round 4 (T-DG7-REV-QA-R4): F-DG7-940 mutant probe. Runs in the disposable clone ($QA_REPO, at the
# frozen source commit), never in the candidate tree. Each mutant is applied, the two shipped export test files are run,
# and the clone is restored with git checkout. Run under tests/qa/support/with-pg.sh. SYNTHETIC data only.
set -u
cd "${QA_REPO:?}"
S=apps/api/src/modules/transfer/export/service.ts
R=apps/api/src/modules/transfer/export/routes.ts
T="apps/api/test/integration/transfer/export-scope.test.ts apps/api/test/integration/transfer/export.test.ts"
run() { echo "=== $1 $(date -u +%T)"; git diff --stat -- apps/api/src; git diff -- apps/api/src | grep '^[-+][^-+]' ; npx vitest run --project integration $T --reporter=verbose 2>&1 | grep -E '✓|×|✗|FAIL|Test Files|Tests |AssertionError|Expected|Received|^\s+[-+] ' | head -60; echo "=== $1 vitest exit ${PIPESTATUS[0]}"; git checkout -q -- apps/api/src; }
run M0-unmodified
# M4 (round-3 code-security mutant): the scoped authorize() is removed; any principal holding migration.export at any
# scope gets its organization back.
python3 - "$S" <<'P'
import sys;p=sys.argv[1];s=open(p).read()
old='''    if ((await authorize(db, principal, MIGRATION_EXPORT, { type: "organization", id: organizationId })).allowed)
      return organizationId;'''
assert old in s; open(p,'w').write(s.replace(old,'    return organizationId;'))
P
run M4-no-scoped-authorize
# M6 (qa round 4, extra): only the get-by-id route loses its requireExportRight call (route-level permission remains).
python3 - "$R" <<'P'
import sys;p=sys.argv[1];s=open(p).read()
old='''    const { migrationExportId } = parse(idParams, request.params, "params");
    await requireExportRight(deps.db, principalOf(request));
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, presentExport(row));'''
assert s.count(old)==1; open(p,'w').write(s.replace(old,old.replace('    await requireExportRight(deps.db, principalOf(request));\n','')))
P
run M6-get-route-without-requireExportRight
git status --short -- apps/api/src; echo "clone restored: $(git diff --quiet -- apps/api/src && echo yes || echo NO)"
