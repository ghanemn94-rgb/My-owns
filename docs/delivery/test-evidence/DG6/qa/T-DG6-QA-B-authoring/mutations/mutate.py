# Applies ONE named mutation to the disposable copy (argv[1] = copy root, argv[2] = mutation id). Exits 1 if the
# anchor text is not found (the mutation would be a no-op, which must not count as a "caught" mutation).
import sys, pathlib
root, mid = pathlib.Path(sys.argv[1]), sys.argv[2]
M = {
  "M1-search-scope": ("apps/api/src/modules/search/query.ts",
     "sql<SqlBool>`(d.record_type IN (${sql.join(plain)}) AND ${scope.predicate({ ...base, recordType: null })})`",
     "sql<SqlBool>`(d.record_type IN (${sql.join(plain)}) AND TRUE)`"),
  "M2-export-owner": ("apps/api/src/modules/reporting/exports/jobs.ts",
     'let q = db.selectFrom("export_job").selectAll().where("id", "=", jobId).where("requested_by", "=", userId);',
     'void userId; let q = db.selectFrom("export_job").selectAll().where("id", "=", jobId);'),
  "M3-evidence-gate": ("apps/api/src/modules/evidence/access.ts",
     "  if (decision.refusal !== null)\n    throw evidenceParentForbidden()",
     "  if (decision.refusal !== null && false)\n    throw evidenceParentForbidden()"),
  "M4-deeplink-reauth": ("apps/api/src/modules/tasks/deep-links.ts",
     "if (!readable) throw deepLinkForbidden();",
     "if (!readable && false) throw deepLinkForbidden();"),
  "M5-assistant-data-as-instructions": ("apps/api/src/modules/assistant/prompt.ts",
     "    system: SYSTEM_TEXT,",
     "    system: SYSTEM_TEXT + data.map((d) => d.text).join(\"\\n\"),"),
  "M6-sensitivity-clause": ("apps/api/src/modules/access/read-scope.ts",
     "  const type = cols.recordType;\n  if (type === null) return sql<SqlBool>`TRUE`;",
     "  const type = cols.recordType;\n  if (type === null || true) return sql<SqlBool>`TRUE`;"),
  "M2b-export-read-check": ("apps/api/src/modules/reporting/exports/jobs.ts",
     "async function canRead(db: DbOrTx, principal: Principal, transformationId: string): Promise<boolean> {\n  return (",
     "async function canRead(db: DbOrTx, principal: Principal, transformationId: string): Promise<boolean> {\n  if (transformationId) return true;\n  return ("),
  "M2c-export-subject-check": ("apps/api/src/modules/reporting/reports/snapshots.ts",
     "  if (d.target === null) throw problems.notFound();\n  if (d.allowed) return d.target;",
     "  if (d.target === null) throw problems.notFound();\n  if (d.allowed || permission !== \"transformation.read\") return d.target;"),
  "M3b-evidence-transformation-gate": ("apps/api/src/modules/evidence/access.ts",
     "  const target = await requireTransformationRead(db, principal, transformationId);",
     "  const target = (await resolveTarget(db, { type: \"transformation\", id: transformationId }))!;\n  void requireTransformationRead;"),
}
f, old, new = M[mid]
p = root / f
t = p.read_text()
if t.count(old) != 1:
    print(f"ANCHOR NOT FOUND ({t.count(old)}x) for {mid} in {f}"); sys.exit(1)
t = t.replace(old, new)
if mid == "M3b-evidence-transformation-gate":
    t = t.replace("  readScopeFor,\n  requireTransformationRead,", "  readScopeFor,\n  resolveTarget,\n  requireTransformationRead,", 1)
p.write_text(t)
print(f"applied {mid} to {f}")
