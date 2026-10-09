// Slice A's KPI create service (T-DG4-KBE-R1 item 1; the KBE-F handback item 2; D-105). kpi/index.ts now exports
// createKpiDefinitionRow, and both createKpiDefinition (the route) and adoption's createAdoptionMetricLink (createKpi)
// call it. This file proves, against the run's disposable PostgreSQL, that the rows and audit events are
// byte-identical to what the two pre-R1 inline inserts wrote:
//  - LEGACY_ROUTE_INSERT and LEGACY_ADOPTION_INSERT below are the pre-R1 code, copied verbatim from
//    `git show 7aac2ad:apps/api/src/modules/kpi/kpi-definitions.ts` (the createKpiDefinition handler) and
//    `git show 7aac2ad:apps/api/src/modules/adoption/indicators.ts` (createKpiFromTemplate), with only the request
//    plumbing (body, ctx) replaced by parameters;
//  - each legacy insert and the service run on the same input in a rolled-back transaction; every column of the row and
//    of the audit event is compared, after masking only the generated values (the uuid, the audit seq and id, and the
//    transaction-time timestamps). `changes` (the audited field diff) is compared in full;
//  - a taken name is the same 409 `duplicate.name` problem from both.
// The end-to-end behaviour through both routes stays covered by apps/api/test/integration/kpi/** and
// apps/api/test/integration/adoption/indicators.test.ts, unchanged. All data is SYNTHETIC.
import { diffFields, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditContext } from "../../../src/modules/audit/index.ts";
import { record } from "../../../src/modules/audit/index.ts";
import { createKpiDefinitionRow, type KpiDefinitionRowInput } from "../../../src/modules/kpi/index.ts";
import type { KpiDefinitionRow } from "../../../src/modules/kpi/repository.ts";
import { problems } from "../../../src/modules/platform/index.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
}, 120_000);
afterAll(async () => {
  await api.close();
});

/** The pre-R1 audited field list (identical in kpi/repository.ts and the private copy in adoption/indicators.ts). */
const LEGACY_AUDIT_FIELDS = [
  "name",
  "description",
  "business_purpose",
  "unit_kind",
  "unit_label",
  "currency",
  "polarity",
  "frequency",
  "is_leading",
  "data_source",
  "owner_user_id",
  "steward_user_id",
  "status",
] as const;

const legacyDuplicateName = (e: { code?: string; constraint?: string }) => {
  if (e.code === "23505" && e.constraint === "kpi_definition_name_key")
    return problems.duplicate("duplicate.name", "A KPI with this name already exists in the transformation.");
  return e;
};

/** The createKpiDefinition request body as the route had it (kpiDefinitionCreate, parsed). */
interface RouteBody {
  name: string;
  description?: string;
  businessPurpose?: string;
  unitKind: KpiDefinitionRow["unit_kind"];
  unitLabel?: string;
  currency?: string;
  polarity: KpiDefinitionRow["polarity"];
  frequency?: KpiDefinitionRow["frequency"];
  isLeading?: boolean;
  dataSource?: string;
  ownerUserId?: string;
  stewardUserId?: string;
}

/** Pre-R1 kpi-definitions.ts createKpiDefinition handler body, verbatim from the insert to the audit event. */
async function LEGACY_ROUTE_INSERT(
  tx: Tx,
  audit: AuditContext,
  transformation: { organization_id: string },
  transformationId: string,
  principal: { userId: string },
  body: RouteBody,
): Promise<KpiDefinitionRow> {
  const id = uuidv7();
  const row = await tx
    .insertInto("kpi_definition")
    .values({
      id,
      organization_id: transformation.organization_id,
      transformation_id: transformationId,
      name: body.name,
      description: body.description ?? null,
      business_purpose: body.businessPurpose ?? null,
      unit_kind: body.unitKind,
      unit_label: body.unitLabel ?? null,
      currency: body.currency ?? null,
      polarity: body.polarity,
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
      ...(body.isLeading !== undefined ? { is_leading: body.isLeading } : {}),
      data_source: body.dataSource ?? null,
      owner_user_id: body.ownerUserId ?? null,
      steward_user_id: body.stewardUserId ?? null,
      created_by: principal.userId,
      updated_by: principal.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((e: { code?: string; constraint?: string }) => {
      throw legacyDuplicateName(e);
    });
  await record(tx, audit, {
    action: "kpi_definition.create",
    recordType: "kpi_definition",
    recordId: id,
    organizationId: row.organization_id,
    transformationId,
    newVersion: 1,
    changes: diffFields({} as typeof row, row, [...LEGACY_AUDIT_FIELDS]),
  });
  return row;
}

/** The adoption template row fields createKpiFromTemplate read. */
interface TemplateRow {
  measure_en: string;
  unit_kind: KpiDefinitionRow["unit_kind"];
  polarity: KpiDefinitionRow["polarity"];
}

/** Pre-R1 adoption/indicators.ts createKpiFromTemplate, verbatim from the insert to the audit event. */
async function LEGACY_ADOPTION_INSERT(
  tx: Tx,
  ctx: { organizationId: string; userId: string; audit: AuditContext },
  transformationId: string,
  template: TemplateRow,
  ownerUserId: string,
): Promise<KpiDefinitionRow> {
  const id = uuidv7();
  const row = await tx
    .insertInto("kpi_definition")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      name: template.measure_en,
      unit_kind: template.unit_kind,
      polarity: template.polarity,
      is_leading: true,
      owner_user_id: ownerUserId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((e: { code?: string; constraint?: string }) => {
      if (e.code === "23505" && e.constraint === "kpi_definition_name_key")
        throw problems.duplicate("duplicate.name", "A KPI with this name already exists in the transformation.");
      throw e;
    });
  await record(tx, ctx.audit, {
    action: "kpi_definition.create",
    recordType: "kpi_definition",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: diffFields({} as KpiDefinitionRow, row, [...LEGACY_AUDIT_FIELDS]),
  });
  return row;
}

class Rollback extends Error {
  readonly captured: unknown;
  constructor(captured: unknown) {
    super("rollback");
    this.captured = captured;
  }
}

/** Runs `write` in a transaction that is always rolled back, and returns the written row and its audit event(s). */
async function captureRolledBack(write: (tx: Tx) => Promise<KpiDefinitionRow>) {
  try {
    await api.db.transaction().execute(async (tx) => {
      const row = await write(tx);
      const events = await tx.selectFrom("audit_event").selectAll().where("record_id", "=", row.id).execute();
      const returned = await tx.selectFrom("kpi_definition").selectAll().where("id", "=", row.id).executeTakeFirst();
      throw new Rollback({ row, stored: returned, events });
    });
  } catch (e) {
    if (e instanceof Rollback) return e.captured as { row: object; stored: object; events: object[] };
    throw e;
  }
  throw new Error("unreachable");
}

/** Masks only the generated values: ids, the audit seq, and the transaction-time timestamps. */
function mask(captured: { row: object; stored: object; events: object[] }) {
  const maskRow = (r: object) => {
    const out = { ...(r as Record<string, unknown>) };
    expect(typeof out["id"]).toBe("string");
    expect(out["created_at"]).toBeInstanceOf(Date);
    expect(out["updated_at"]).toBeInstanceOf(Date);
    out["id"] = "<uuid>";
    out["created_at"] = "<now>";
    out["updated_at"] = "<now>";
    return out;
  };
  return {
    // JSON text: the exact serialised bytes of every column, after masking.
    row: JSON.stringify(maskRow(captured.row)),
    stored: JSON.stringify(maskRow(captured.stored)),
    events: captured.events.map((ev) => {
      const out = { ...(ev as Record<string, unknown>) };
      out["id"] = "<uuid>";
      out["seq"] = "<seq>";
      out["record_id"] = "<uuid>";
      out["occurred_at"] = "<now>";
      return JSON.stringify(out);
    }),
  };
}

const audit = (): AuditContext => ({ actorUserId: k.users.tl.id, requestId: "kbe-r1-create-service-synthetic" });

describe("createKpiDefinitionRow (slice A's KPI create service; T-DG4-KBE-R1 item 1)", () => {
  it("writes the byte-identical row and audit event of the pre-R1 createKpiDefinition route insert (full and minimal bodies)", async () => {
    const bodies: RouteBody[] = [
      {
        name: "Synthetic KBE-R1 full body",
        description: "Synthetic description",
        businessPurpose: "Synthetic purpose",
        unitKind: "currency",
        unitLabel: "SAR m",
        currency: "SAR",
        polarity: "lower_is_better",
        frequency: "quarterly",
        isLeading: true,
        dataSource: "Synthetic finance ledger",
        ownerUserId: k.users.bo.id,
        stewardUserId: k.users.kds.id,
      },
      { name: "Synthetic KBE-R1 minimal body", unitKind: "count", polarity: "higher_is_better" },
    ];
    for (const body of bodies) {
      const before = await captureRolledBack((tx) =>
        LEGACY_ROUTE_INSERT(
          tx,
          audit(),
          { organization_id: w.orgA.id },
          k.transformationId,
          { userId: k.users.tl.id },
          body,
        ),
      );
      const input: KpiDefinitionRowInput = {
        organizationId: w.orgA.id,
        transformationId: k.transformationId,
        actorUserId: k.users.tl.id,
        ...body,
      };
      const after = await captureRolledBack((tx) => createKpiDefinitionRow(tx, audit(), input));
      expect(before.events).toHaveLength(1);
      expect(mask(after)).toEqual(mask(before));
      expect((after.events[0] as { action: string; new_version: number }).action).toBe("kpi_definition.create");
      expect((after.events[0] as { new_version: number }).new_version).toBe(1);
      expect((after.row as { version: number; status: string }).version).toBe(1);
      expect((after.row as { status: string }).status).toBe("draft");
    }
  });

  it("writes the byte-identical row and audit event of the pre-R1 adoption createKpi insert (template defaults kept)", async () => {
    const template: TemplateRow = {
      measure_en: "Usage / activation rate",
      unit_kind: "percentage",
      polarity: "higher_is_better",
    };
    const ctx = { organizationId: w.orgA.id, userId: k.users.tl.id, audit: audit() };
    const before = await captureRolledBack((tx) =>
      LEGACY_ADOPTION_INSERT(tx, ctx, k.transformationId, template, k.users.bo.id),
    );
    // Exactly the call adoption/indicators.ts createKpiFromTemplate now makes.
    const after = await captureRolledBack((tx) =>
      createKpiDefinitionRow(tx, ctx.audit, {
        organizationId: ctx.organizationId,
        transformationId: k.transformationId,
        actorUserId: ctx.userId,
        name: template.measure_en,
        unitKind: template.unit_kind,
        polarity: template.polarity,
        isLeading: true,
        ownerUserId: k.users.bo.id,
      }),
    );
    expect(mask(after)).toEqual(mask(before));
    // The column defaults the adoption insert relied on are still the stored values (frequency monthly, nulls).
    expect(after.stored).toMatchObject({
      frequency: "monthly",
      is_leading: true,
      description: null,
      currency: null,
      steward_user_id: null,
      status: "draft",
      version: 1,
    });
  });

  it("refuses a taken name with the same 409 duplicate.name problem as both pre-R1 inserts", async () => {
    const name = "Synthetic KBE-R1 taken name";
    await api.db.transaction().execute((tx) =>
      createKpiDefinitionRow(tx, audit(), {
        organizationId: w.orgA.id,
        transformationId: k.transformationId,
        actorUserId: k.users.tl.id,
        name,
        unitKind: "count",
        polarity: "higher_is_better",
      }),
    );
    const refusal = async (write: (tx: Tx) => Promise<unknown>) => {
      try {
        await api.db.transaction().execute(write);
      } catch (e) {
        return JSON.stringify(
          e,
          Object.getOwnPropertyNames(e).filter((p) => p !== "stack"),
        );
      }
      throw new Error("expected a refusal");
    };
    const viaService = await refusal((tx) =>
      createKpiDefinitionRow(tx, audit(), {
        organizationId: w.orgA.id,
        transformationId: k.transformationId,
        actorUserId: k.users.tl.id,
        name,
        unitKind: "count",
        polarity: "higher_is_better",
      }),
    );
    const viaRoute = await refusal((tx) =>
      LEGACY_ROUTE_INSERT(
        tx,
        audit(),
        { organization_id: w.orgA.id },
        k.transformationId,
        { userId: k.users.tl.id },
        {
          name,
          unitKind: "count",
          polarity: "higher_is_better",
        },
      ),
    );
    const viaAdoption = await refusal((tx) =>
      LEGACY_ADOPTION_INSERT(
        tx,
        { organizationId: w.orgA.id, userId: k.users.tl.id, audit: audit() },
        k.transformationId,
        { measure_en: name, unit_kind: "count", polarity: "higher_is_better" },
        k.users.bo.id,
      ),
    );
    expect(viaService).toContain("duplicate.name");
    expect(viaService).toBe(viaRoute);
    expect(viaService).toBe(viaAdoption);
  });
});
