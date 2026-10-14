// Affected records of a draft (ADR-0039 §5, §12; REQ-S06-007; p5-work-split §A.2; T-DG5-BE-B): per transformation
// pinned to the draft's lineage (a version of the same kind and key; for the kind's default key also the
// transformations without a pin of the kind, which resolve to its version 1), the number of records per record type
// that the draft's changed elements touch, computed live. The kind's provider counts (providers/methodology-kind.ts);
// a change it cannot count, or a kind without a provider hook, is reported as Unknown (count null with a reason key),
// never 0. Transformations are listed in the caller's organization only (versions are global, records are not).
// Read-only.
import type { DbOrTx } from "@mth/db";
import { configKind, type ConfigAffectedRecords } from "@mth/shared/schemas";
import { defaultVersionOf } from "./config-resolver.ts";
import { changedTypes, diffVersions } from "./diff.ts";
import { loadVersion, type MethodologyVersionRow } from "./drafts.ts";
import { configKindProvider, type AffectedRecordCount } from "./kinds.ts";

export interface LineageTransformation {
  readonly transformationId: string;
  readonly code: string;
  readonly pinnedVersionId: string;
}

/** The transformations of `organizationId` whose configuration of this kind and key is a version of the lineage. */
export async function lineageTransformations(
  db: DbOrTx,
  version: MethodologyVersionRow,
  organizationId: string,
): Promise<LineageTransformation[]> {
  const kind = configKind.parse(version.config_kind);
  const pinned = await db
    .selectFrom("transformation_config_pin as p")
    .innerJoin("methodology_version as v", "v.id", "p.methodology_version_id")
    .innerJoin("transformation as t", "t.id", "p.transformation_id")
    .select(["t.id", "t.code", "p.methodology_version_id"])
    .where("p.kind", "=", kind)
    .where("v.key", "=", version.key)
    .where("t.organization_id", "=", organizationId)
    .execute();
  const out: LineageTransformation[] = pinned.map((r) => ({
    transformationId: r.id,
    code: r.code,
    pinnedVersionId: r.methodology_version_id,
  }));
  const fallback = await defaultVersionOf(db, kind);
  if (fallback !== null && fallback.key === version.key) {
    const unpinned = await db
      .selectFrom("transformation as t")
      .select(["t.id", "t.code"])
      .where("t.organization_id", "=", organizationId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("transformation_config_pin as p")
              .select("p.id")
              .whereRef("p.transformation_id", "=", "t.id")
              .where("p.kind", "=", kind),
          ),
        ),
      )
      .execute();
    for (const r of unpinned) out.push({ transformationId: r.id, code: r.code, pinnedVersionId: fallback.versionId });
  }
  return out.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.transformationId < b.transformationId ? -1 : 1,
  );
}

/** The base a draft is compared with: its `based_on_version_id`, else itself (a seeded version has no base). */
export async function baseOf(db: DbOrTx, version: MethodologyVersionRow): Promise<MethodologyVersionRow> {
  return version.based_on_version_id === null ? version : loadVersion(db, version.based_on_version_id);
}

/** Sums the counts of one record type; any Unknown makes the total Unknown (never a partial number shown as whole). */
function merge(rows: readonly AffectedRecordCount[]): ConfigAffectedRecords["transformations"][number]["records"] {
  const byType = new Map<string, { count: number | null; unknownReason: string | null }>();
  for (const r of rows) {
    const cur = byType.get(r.recordType);
    if (cur === undefined) {
      byType.set(r.recordType, { count: r.count, unknownReason: r.count === null ? r.unknownReason : null });
    } else if (cur.count === null || r.count === null) {
      byType.set(r.recordType, { count: null, unknownReason: cur.unknownReason ?? r.unknownReason });
    } else {
      byType.set(r.recordType, { count: cur.count + r.count, unknownReason: null });
    }
  }
  return [...byType.entries()].map(([recordType, v]) => ({
    recordType,
    count: v.count,
    unknownReason: v.count === null ? (v.unknownReason ?? "affected_records.not_countable") : null,
  }));
}

/** getConfigAffectedRecords (ADR-0039 §5). */
export async function affectedRecords(
  db: DbOrTx,
  version: MethodologyVersionRow,
  organizationId: string,
): Promise<ConfigAffectedRecords> {
  const base = await baseOf(db, version);
  const { changes } = await diffVersions(db, version, base);
  const transformations = await lineageTransformations(db, version, organizationId);
  const hook = configKindProvider(configKind.parse(version.config_kind)).affectedRecords;
  const counted =
    changes.length === 0 || transformations.length === 0
      ? []
      : hook !== undefined
        ? await hook(db, {
            versionId: version.id,
            baseVersionId: base.id,
            changes,
            transformationIds: transformations.map((t) => t.transformationId),
          })
        : transformations.flatMap((t) =>
            changedTypes(changes).map((type) => ({
              transformationId: t.transformationId,
              recordType: type,
              count: null,
              unknownReason: "affected_records.not_available",
            })),
          );
  const byTransformation = new Map<string, AffectedRecordCount[]>();
  for (const c of counted) {
    const list = byTransformation.get(c.transformationId) ?? [];
    list.push(c);
    byTransformation.set(c.transformationId, list);
  }
  return {
    versionId: version.id,
    transformations: transformations.map((t) => ({
      transformationId: t.transformationId,
      code: t.code,
      pinnedVersionId: t.pinnedVersionId,
      records: merge(byTransformation.get(t.transformationId) ?? []),
    })),
  };
}
