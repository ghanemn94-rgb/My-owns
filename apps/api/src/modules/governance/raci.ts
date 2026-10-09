// T12 RACI per transformation (OpenAPI tag "raci"; ADR-0026 §7; REQ-PB-067, REQ-S10-007, REQ-S10-009; T-DG4-BE-C):
//   GET   /raci-template                                            the six B0101 deliverables and 36 cells, verbatim
//   GET   /transformations/{id}/raci                                the transformation's copy with its matrix status
//   POST  /transformations/{id}/raci/deliverables                   add a deliverable with its cells (raci.edit; TO, TL)
//   PATCH /transformations/{id}/raci/deliverables/{deliverableId}   edit a deliverable and save its cells as ONE change
//                                                                   (If-Match on the deliverable)
//
// Cells accept A, R, C, I or A/R, or null (no involvement); anything else (e.g. X) is 422 raci.invalid_value. Each
// active deliverable needs exactly one accountable (A or A/R; A/R counts as one) unless its accountability exception
// documents the governance rule that permits otherwise (422 raci.accountable_count, checked here on the saved state;
// the 0030 deferred trigger re-checks at COMMIT under the raciDeliverable advisory-lock class). Copies are independent: an edit
// changes neither the template nor another transformation (REQ-S10-007). Every edit bumps the T12 matrix header
// (`reviseMatrix`), so a matrix approval always names the version it approved. Nothing here touches DG0-DG7.
import {
  sql,
  type DbOrTx,
  type TransformationRaciAssignmentRow,
  type TransformationRaciDeliverableRow,
  type Tx,
} from "@mth/db";
import {
  RACI_TEMPLATE_PARTIES,
  RACI_VALUES,
  raciDeliverableCreate,
  raciDeliverableUpdate,
  uuid,
  type Raci,
  type RaciCell,
  type RaciDeliverable,
  type RaciTemplate,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  HttpProblem,
  iso,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { loadGovernanceMatrix, requireGovernanceWrite, reviseMatrix } from "./matrices.ts";

const JSON_BODY = ["application/json"] as const;
const EDIT = "raci.edit" as const;
const ACCOUNTABLE: ReadonlySet<string> = new Set(["A", "A/R"]);
const VALUES: ReadonlySet<string> = new Set(RACI_VALUES);

const transformationParams = z.strictObject({ transformationId: uuid });
const deliverableParams = z.strictObject({ transformationId: uuid, deliverableId: uuid });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const raciRefusals = {
  invalidValue: (pointer: string) => rule("raci.invalid_value", "A RACI cell accepts A, R, C, I or A/R.", pointer),
  accountableCount: (deliverable: string, count: number) =>
    rule(
      "raci.accountable_count",
      `Each deliverable needs exactly one accountable (A or A/R), unless a documented governance rule permits otherwise. ${deliverable} has ${count}.`,
      "/cells",
    ),
  /** Not listed in ADR-0026 (a field-level check the ADR leaves to the API; the role_mapping.party_unknown text). */
  partyUnknown: (party: string, pointer: string) =>
    rule("raci.party_unknown", `${party} is not a known governance role.`, pointer),
} as const;

// ------------------------------------------------------------------------------------------------ pure rules

/** The number of accountable cells (A or A/R; A/R counts as one), REQ-S10-009. */
export function accountableCount(cells: readonly { value: string | null }[]): number {
  return cells.filter((c) => c.value !== null && ACCOUNTABLE.has(c.value)).length;
}

/** True when the deliverable satisfies the one-accountable rule (or is retired, or documents an exception). */
export function accountabilitySatisfied(d: {
  status: string;
  accountabilityException: string | null;
  cells: readonly { value: string | null }[];
}): boolean {
  return d.status !== "active" || d.accountabilityException !== null || accountableCount(d.cells) === 1;
}

// ------------------------------------------------------------------------------------------------ reading

/** The column order: the six B0101 parties, then any other party used in the transformation, in catalogue order. */
async function partiesOf(db: DbOrTx, cells: readonly { party_code: string }[]): Promise<string[]> {
  const extra = [...new Set(cells.map((c) => c.party_code))].filter(
    (p) => !(RACI_TEMPLATE_PARTIES as readonly string[]).includes(p),
  );
  if (extra.length === 0) return [...RACI_TEMPLATE_PARTIES];
  const ordered = await db
    .selectFrom("governance_party")
    .select("code")
    .where("code", "in", extra)
    .orderBy("ordinal")
    .execute();
  return [...RACI_TEMPLATE_PARTIES, ...ordered.map((p) => p.code)];
}

const partyOrder = (parties: readonly string[]) => (a: RaciCell, b: RaciCell) =>
  parties.indexOf(a.partyCode) - parties.indexOf(b.partyCode);

function toDeliverable(
  d: TransformationRaciDeliverableRow,
  cells: readonly TransformationRaciAssignmentRow[],
  parties: readonly string[],
): RaciDeliverable {
  return {
    id: d.id,
    transformationId: d.transformation_id,
    templateKey: d.template_key,
    ordinal: d.ordinal,
    labelEn: d.label_en,
    labelAr: d.label_ar,
    accountabilityException: d.accountability_exception,
    status: d.status as RaciDeliverable["status"],
    cells: cells
      .filter((c) => c.deliverable_id === d.id)
      .map((c) => ({ partyCode: c.party_code, value: c.value }))
      .sort(partyOrder(parties)),
    version: d.version,
    updatedAt: iso(d.updated_at),
  };
}

async function loadDeliverable(db: DbOrTx, d: TransformationRaciDeliverableRow): Promise<RaciDeliverable> {
  const cells = await db
    .selectFrom("transformation_raci_assignment")
    .selectAll()
    .where("deliverable_id", "=", d.id)
    .execute();
  return toDeliverable(d, cells, await partiesOf(db, cells));
}

/** The transformation's T12 RACI (deliverables in ordinal order, cells in column order) with its matrix header. */
export async function loadRaci(db: DbOrTx, transformationId: string): Promise<Raci> {
  const deliverables = await db
    .selectFrom("transformation_raci_deliverable")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const cells = await db
    .selectFrom("transformation_raci_assignment")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .execute();
  const parties = await partiesOf(db, cells);
  return {
    transformationId,
    matrix: await loadGovernanceMatrix(db, transformationId, "raci"),
    parties,
    deliverables: deliverables.map((d) => toDeliverable(d, cells, parties)),
  };
}

// ------------------------------------------------------------------------------------------------ writing

/** Values and parties of a cell list (422 raci.invalid_value / raci.party_unknown); nothing written. */
async function validateCells(db: DbOrTx, cells: readonly RaciCell[]): Promise<void> {
  cells.forEach((c, i) => {
    if (c.value !== null && !VALUES.has(c.value)) throw raciRefusals.invalidValue(`/cells/${i}/value`);
  });
  const codes = [...new Set(cells.map((c) => c.partyCode))];
  if (codes.length === 0) return;
  const known = new Set(
    (await db.selectFrom("governance_party").select("code").where("code", "in", codes).execute()).map((p) => p.code),
  );
  cells.forEach((c, i) => {
    if (!known.has(c.partyCode)) throw raciRefusals.partyUnknown(c.partyCode, `/cells/${i}/partyCode`);
  });
}

async function lockDeliverable(tx: Tx, deliverableId: string): Promise<void> {
  // Advisory-lock class raciDeliverable (ADR-0016 §6): the same lock the 0030 one-accountable trigger takes at COMMIT, so two
  // concurrent saves of one deliverable are serialized and each is checked against the other's committed cells.
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.raciDeliverable}::integer, hashtext(${deliverableId}::text))`.execute(
    tx,
  );
}

/** Writes the given cells of a deliverable as one change: changed cells step their version, new cells are inserted. */
async function saveCells(
  tx: Tx,
  audit: AuditContext,
  d: TransformationRaciDeliverableRow,
  cells: readonly RaciCell[],
  userId: string,
): Promise<number> {
  const existing = await tx
    .selectFrom("transformation_raci_assignment")
    .selectAll()
    .where("deliverable_id", "=", d.id)
    .forUpdate()
    .execute();
  let changed = 0;
  for (const c of cells) {
    const cur = existing.find((e) => e.party_code === c.partyCode);
    if (cur && cur.value === c.value) continue;
    changed += 1;
    if (cur) {
      const updated = await tx
        .updateTable("transformation_raci_assignment")
        .set({ value: c.value, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
        .where("id", "=", cur.id)
        .where("version", "=", cur.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "transformation_raci_assignment.update",
        recordType: "transformation_raci_assignment",
        recordId: cur.id,
        organizationId: d.organization_id,
        transformationId: d.transformation_id,
        priorVersion: cur.version,
        newVersion: updated.version,
        changes: { value: { from: cur.value, to: c.value } },
      });
    } else {
      const id = uuidv7();
      await tx
        .insertInto("transformation_raci_assignment")
        .values({
          id,
          organization_id: d.organization_id,
          transformation_id: d.transformation_id,
          deliverable_id: d.id,
          party_code: c.partyCode,
          value: c.value,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await record(tx, audit, {
        action: "transformation_raci_assignment.create",
        recordType: "transformation_raci_assignment",
        recordId: id,
        organizationId: d.organization_id,
        transformationId: d.transformation_id,
        newVersion: 1,
        changes: { party_code: { from: null, to: c.partyCode }, value: { from: null, to: c.value } },
      });
    }
  }
  return changed;
}

/** The cells a deliverable will have after the save (existing cells overlaid with the request's). */
function mergedCells(existing: readonly TransformationRaciAssignmentRow[], cells: readonly RaciCell[]) {
  const out = new Map(existing.map((e) => [e.party_code, e.value]));
  for (const c of cells) out.set(c.partyCode, c.value);
  return [...out.values()].map((value) => ({ value }));
}

// ------------------------------------------------------------------------------------------------ routes

export function registerRaciRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const TEMPLATE = "/api/v1/raci-template";
  const RACI = "/api/v1/transformations/:transformationId/raci";
  const DELIVERABLES = `${RACI}/deliverables`;
  const ONE = `${DELIVERABLES}/:deliverableId`;

  app.get(TEMPLATE, { config: { access: { permission: "authenticated" } } }, async (request) => {
    principalOf(request);
    parseQuery(z.strictObject({}), request.query);
    const deliverables = await db.selectFrom("raci_template_deliverable").selectAll().orderBy("ordinal").execute();
    const cells = await db.selectFrom("raci_template_cell").selectAll().execute();
    const parties = [...RACI_TEMPLATE_PARTIES];
    const out: RaciTemplate = {
      parties,
      deliverables: deliverables.map((d) => ({
        key: d.key,
        ordinal: d.ordinal,
        sourceDeliverableEn: d.source_deliverable_en,
        deliverableAr: d.deliverable_ar,
        sourceRef: d.source_ref,
        cells: cells
          .filter((c) => c.deliverable_key === d.key)
          .map((c) => ({ partyCode: c.party_code, value: c.value }))
          .sort(partyOrder(parties)),
      })),
    };
    return out;
  });

  app.get(RACI, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return loadRaci(db, transformationId);
  });

  app.post(DELIVERABLES, { config: { access: { permission: EDIT }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(raciDeliverableCreate, request.body);
    const out = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceWrite(tx, request, transformationId, EDIT);
      const audit = auditContextOf(request);
      await validateCells(tx, body.cells);
      const exception = body.accountabilityException ?? null;
      const count = accountableCount(body.cells);
      if (!accountabilitySatisfied({ status: "active", accountabilityException: exception, cells: body.cells }))
        throw raciRefusals.accountableCount(body.labelEn, count);
      await reviseMatrix(tx, audit, transformationId, "raci", userId);
      const ordinal =
        body.ordinal ??
        Math.min(
          999,
          ((
            await tx
              .selectFrom("transformation_raci_deliverable")
              .select(sql<number | null>`max(ordinal)`.as("m"))
              .where("transformation_id", "=", transformationId)
              .executeTakeFirst()
          )?.m ?? 0) + 1,
        );
      const id = uuidv7();
      await lockDeliverable(tx, id);
      const d = await tx
        .insertInto("transformation_raci_deliverable")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          template_key: null,
          ordinal,
          label_en: body.labelEn,
          label_ar: body.labelAr,
          accountability_exception: exception,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "transformation_raci_deliverable.create",
        recordType: "transformation_raci_deliverable",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        newVersion: 1,
        changes: {
          ordinal: { from: null, to: ordinal },
          label_en: { from: null, to: body.labelEn },
          label_ar: { from: null, to: body.labelAr },
          accountability_exception: { from: null, to: exception },
        },
      });
      await saveCells(tx, audit, d, body.cells, userId);
      return loadDeliverable(tx, d);
    });
    return sendVersioned(reply, 201, out, `/api/v1/transformations/${transformationId}/raci/deliverables/${out.id}`);
  });

  app.patch(ONE, { config: { access: { permission: EDIT }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, deliverableId } = parse(deliverableParams, request.params, "params");
    const body = parseBody(raciDeliverableUpdate, request.body);
    const out = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceWrite(tx, request, transformationId, EDIT);
      const expected = requireIfMatch(request);
      const audit = auditContextOf(request);
      const current = await tx
        .selectFrom("transformation_raci_deliverable")
        .selectAll()
        .where("id", "=", deliverableId)
        .where("transformation_id", "=", transformationId)
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const cells = body.cells ?? [];
      await validateCells(tx, cells);
      // The header first (the approvalSubject lock and the in-approval refusal), then the deliverable (raciDeliverable lock), then the row.
      await reviseMatrix(tx, audit, transformationId, "raci", userId);
      await lockDeliverable(tx, deliverableId);
      const locked = await tx
        .selectFrom("transformation_raci_deliverable")
        .selectAll()
        .where("id", "=", deliverableId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.version !== expected) throw problems.versionConflict(locked.version);
      const existing = await tx
        .selectFrom("transformation_raci_assignment")
        .selectAll()
        .where("deliverable_id", "=", deliverableId)
        .execute();
      const after = {
        status: body.status ?? locked.status,
        accountabilityException:
          body.accountabilityException !== undefined ? body.accountabilityException : locked.accountability_exception,
        cells: mergedCells(existing, cells),
      };
      if (!accountabilitySatisfied(after))
        throw raciRefusals.accountableCount(body.labelEn ?? locked.label_en, accountableCount(after.cells));
      // The deliverable's version is the save's If-Match: every save (fields or cells) steps it once.
      const updated = await tx
        .updateTable("transformation_raci_deliverable")
        .set({
          ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
          ...(body.labelEn !== undefined ? { label_en: body.labelEn } : {}),
          ...(body.labelAr !== undefined ? { label_ar: body.labelAr } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.accountabilityException !== undefined
            ? { accountability_exception: body.accountabilityException }
            : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", deliverableId)
        .where("version", "=", locked.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      const changeList: [string, { from: unknown; to: unknown }][] = [];
      const fields = [
        ["ordinal", locked.ordinal, updated.ordinal],
        ["label_en", locked.label_en, updated.label_en],
        ["label_ar", locked.label_ar, updated.label_ar],
        ["status", locked.status, updated.status],
        ["accountability_exception", locked.accountability_exception, updated.accountability_exception],
      ] as const;
      for (const [f, from, to] of fields) if (from !== to) changeList.push([f, { from, to }]);
      const cellChanges = cells.filter(
        (c) =>
          existing.find((e) => e.party_code === c.partyCode)?.value !== c.value ||
          !existing.some((e) => e.party_code === c.partyCode),
      );
      if (cellChanges.length > 0)
        changeList.push([
          "cells",
          {
            from: existing
              .filter((e) => cellChanges.some((c) => c.partyCode === e.party_code))
              .map((e) => ({ partyCode: e.party_code, value: e.value })),
            to: cellChanges,
          },
        ]);
      await record(tx, audit, {
        action: "transformation_raci_deliverable.update",
        recordType: "transformation_raci_deliverable",
        recordId: deliverableId,
        organizationId: locked.organization_id,
        transformationId,
        priorVersion: locked.version,
        newVersion: updated.version,
        changes: Object.fromEntries(changeList),
      });
      await saveCells(tx, audit, updated, cells, userId);
      return loadDeliverable(tx, updated);
    });
    return sendVersioned(reply, 200, out);
  });

  return [`GET ${TEMPLATE}`, `GET ${RACI}`, `POST ${DELIVERABLES}`, `PATCH ${ONE}`];
}
