// P3 contract exercises of KBE-B (T-DG3-KBE-B; p3-work-split §5): the 11 business-case operations. Every call goes
// through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror), and every success body is parsed with the
// business-case zod mirror listed in P3_MIRRORS_KBE_B. All data is SYNTHETIC; the Finance baseline validation below is
// a demo decision by a synthetic FIN user and approves nothing real (product gates G1-G6 and DG0-DG7 are untouched).
import { insertAuditEvent, sql, type Db } from "@mth/db";
import {
  businessCase,
  businessCaseLine,
  businessCaseLineList,
  businessCasePage,
  businessCaseTotals,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { createUser, grant, signIn, type P3ExerciseContext, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

export const P3_MIRRORS_KBE_B: Readonly<Record<string, z.ZodType>> = {
  listBusinessCases: businessCasePage,
  createBusinessCase: businessCase,
  getBusinessCase: businessCase,
  updateBusinessCase: businessCase,
  archiveBusinessCase: businessCase,
  getBusinessCaseTotals: businessCaseTotals,
  validateBusinessCaseBaseline: businessCase,
  listBusinessCaseLines: businessCaseLineList,
  createBusinessCaseLine: businessCaseLine,
  updateBusinessCaseLine: businessCaseLine,
  archiveBusinessCaseLine: businessCaseLine,
};

/**
 * A draft initiative written directly with its audit event (the initiative routes belong to BE-B; the p2_audit_required
 * guard demands the event). `workstreamLeadUserId` makes that user the initiative's lead (WL record-level rule).
 */
export async function insertInitiative(
  db: Db,
  p: P2World,
  opts: { name?: string; workstreamLeadUserId?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const n = await sql<{ last_value: number }>`
      INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${p.transformationId}::uuid, 'INI', 1)
      ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
      RETURNING last_value`.execute(tx);
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: t.organization_id,
        transformation_id: p.transformationId,
        code: `INI-${String(n.rows[0]!.last_value).padStart(2, "0")}`,
        name: opts.name ?? `Synthetic initiative ${id.slice(-6)}`,
        workstream_lead_user_id: opts.workstreamLeadUserId ?? null,
        created_by: p.lead.id,
        updated_by: p.lead.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: p.lead.id, requestId: `fixture-${id}`, source: "api" },
      {
        action: "initiative.create",
        recordType: "initiative",
        recordId: id,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A FIN user of the world's organization, granted on the transformation (Finance validation). */
export async function financeUser(api: TestApi, w: World, p: P2World) {
  const fin = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, fin.id, "FIN", { type: "transformation", id: p.transformationId }, w.orgA.id);
  return { id: fin.id, session: await signIn(api.app, fin.subject) };
}

export async function exerciseP3KbeBOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const fin = await financeUser(ctx.api, ctx.world, p);
  const B = "/api/v1/business-cases";

  const created = await m("POST", B, {
    session: p.lead.session,
    body: {
      transformationId: p.transformationId,
      level: "transformation",
      title: "Synthetic transformation case",
      sections: { strategicRationale: "Synthetic rationale.", baselineSummary: "Synthetic baseline: 1.2m SAR." },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body).toMatchObject({ code: "BC-01", version: 1, currency: "SAR", baselineValidation: "unvalidated" });
  const C = `${B}/${created.body.id}`;
  // AUD: 403 on a mutation; 428 without If-Match; 409 with a stale one.
  expect(
    (
      await m("POST", B, {
        session: p.auditor.session,
        body: { transformationId: p.transformationId, level: "transformation", title: "x" },
      })
    ).status,
  ).toBe(403);
  expect((await m("PATCH", C, { session: p.lead.session, body: { title: "Renamed" } })).status).toBe(428);
  expect((await m("PATCH", C, { session: p.lead.session, headers: ifm(9), body: { title: "Renamed" } })).status).toBe(
    409,
  );
  const updated = await m("PATCH", C, {
    session: p.lead.session,
    headers: ifm(1),
    body: { title: "Synthetic transformation case (v2)", sections: { decisionAskTypes: ["funding"] } },
  });
  expect([updated.status, updated.body.version]).toEqual([200, 2]);
  expect((await m("GET", C, { session: p.auditor.session })).status).toBe(200);
  const listed = await m("GET", `${B}?transformationId=${p.transformationId}&limit=5`, { session: p.auditor.session });
  expect(listed.body.items.map((c: { id: string }) => c.id)).toEqual([created.body.id]);

  // Lines: one capex line and one revenue line (the B0087 revenue example's 100000 SAR, synthetic).
  const capex = await m("POST", `${C}/lines`, {
    session: p.lead.session,
    body: {
      lineKind: "investment",
      class: "capex",
      valueBasis: "cash",
      title: "Platform",
      amount: "40000.50",
      currency: "SAR",
    },
  });
  expect(capex.status, JSON.stringify(capex.body)).toBe(201);
  const revenue = await m("POST", `${C}/lines`, {
    session: p.lead.session,
    body: {
      lineKind: "benefit",
      class: "revenue",
      valueBasis: "revenue_uplift",
      title: "Attach",
      amount: "100000",
      currency: "SAR",
    },
  });
  expect(revenue.status).toBe(201);
  expect(
    (
      await m("POST", `${C}/lines`, {
        session: p.lead.session,
        body: { lineKind: "investment", class: "revenue", valueBasis: "cash", title: "x", currency: "SAR" },
      })
    ).status,
  ).toBe(422);
  const editedLine = await m("PATCH", `${C}/lines/${capex.body.id}`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { amount: "50000" },
  });
  expect([editedLine.status, editedLine.body.amount]).toEqual([200, "50000.0000"]);
  const lines = await m("GET", `${C}/lines`, { session: p.auditor.session });
  expect(lines.body.items).toHaveLength(2);
  const totals = await m("GET", `${C}/totals`, { session: p.auditor.session });
  expect(totals.status).toBe(200);
  expect(totals.body.netValue).toEqual([{ currency: "SAR", amount: "50000", unknownLineCount: 0, lineCount: 2 }]);
  const archivedLine = await m("POST", `${C}/lines/${revenue.body.id}/archive`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic: replaced." },
  });
  expect([archivedLine.status, archivedLine.body.status]).toEqual([200, "archived"]);

  // Finance validation of the baseline: the author is refused (403), FIN validates (200).
  expect(
    (
      await m("POST", `${C}/baseline-validation`, {
        session: p.lead.session,
        headers: ifm(2),
        body: { result: "validated", note: "Synthetic" },
      })
    ).status,
  ).toBe(403);
  const validated = await m("POST", `${C}/baseline-validation`, {
    session: fin.session,
    headers: ifm(2),
    body: { result: "validated", note: "Synthetic demo validation." },
  });
  expect([validated.status, validated.body.baselineValidation]).toEqual([200, "validated"]);

  const archived = await m("POST", `${C}/archive`, {
    session: p.lead.session,
    headers: ifm(validated.body.version),
    body: { reason: "Synthetic: archived for the contract test." },
  });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
}
