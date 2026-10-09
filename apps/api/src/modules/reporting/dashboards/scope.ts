// The readable-transformation set of a dashboard read (ADR-0037 §6; p4-work-split JK.10 item 3; REQ-S13-001): computed
// ONCE per request with the access module's scoped policy (`scopeFilter`, the function DG1 listTransformations uses),
// intersected with the filters, and every query of every area, headline, drill-down and per-transformation row is
// constrained to it by transformation_id. An explicit transformation id the caller may not read is 404 (never 403 and
// never an empty 200 that discloses existence); an organization in which the caller holds no transformation.read
// grant is 404.
import { sql, type DbOrTx } from "@mth/db";
import { organizationsWith, requireTransformationRead, scopeFilter, type Principal } from "../../access/index.ts";
import { problems } from "../../platform/index.ts";

export interface ScopeTransformation {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly currentPhase: string;
  readonly currency: string;
}

export interface ScopeFilters {
  readonly transformationIds: readonly string[];
  readonly phase: string | null;
  readonly status: string | null;
}

const COLUMNS = ["t.id", "t.organization_id", "t.code", "t.name", "t.status", "t.current_phase", "t.currency"] as const;

function toScope(r: {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  status: string;
  current_phase: string;
  currency: string;
}): ScopeTransformation {
  return {
    id: r.id,
    organizationId: r.organization_id,
    code: r.code,
    name: r.name,
    status: r.status,
    currentPhase: r.current_phase,
    currency: r.currency.trim(),
  };
}

/**
 * The non-archived transformations of `organizationId` the principal may read, narrowed by the filters (ordered by
 * code). 404 when the caller holds no grant in the organization or names a transformation it may not read there.
 */
export async function readableTransformations(
  db: DbOrTx,
  principal: Principal,
  organizationId: string,
  filters: ScopeFilters,
): Promise<ScopeTransformation[]> {
  if (!organizationsWith(principal, "transformation.read").includes(organizationId)) throw problems.notFound();
  for (const id of filters.transformationIds) {
    const target = await requireTransformationRead(db, principal, id);
    if (target.organizationId !== organizationId) throw problems.notFound();
  }
  let q = db
    .selectFrom("transformation as t")
    .select([...COLUMNS])
    .where(
      scopeFilter(principal, "transformation.read", {
        level: "transformation",
        organizationId: sql.ref("t.organization_id"),
        businessUnitId: sql.ref("t.business_unit_id"),
        transformationId: sql.ref("t.id"),
      }),
    )
    .where("t.organization_id", "=", organizationId)
    .where("t.archived_at", "is", null);
  if (filters.transformationIds.length > 0) q = q.where("t.id", "in", [...filters.transformationIds]);
  if (filters.phase !== null) q = q.where("t.current_phase", "=", filters.phase);
  if (filters.status !== null) q = q.where("t.status", "=", filters.status);
  const rows = await q.orderBy("t.code").orderBy("t.id").execute();
  return rows.map(toScope);
}

/** One transformation the principal may read (404 otherwise; the DG1 rule). */
export async function readableTransformation(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
): Promise<ScopeTransformation> {
  await requireTransformationRead(db, principal, transformationId);
  const row = await db
    .selectFrom("transformation as t")
    .select([...COLUMNS])
    .where("t.id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return toScope(row);
}
