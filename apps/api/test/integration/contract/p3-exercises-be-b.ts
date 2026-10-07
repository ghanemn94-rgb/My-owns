// P3 contract exercises of BE-B (T-DG3-BE-B; p3-work-split §5): initiatives (T05), their gap / outcome / decision
// links, the lifecycle transitions and the portfolio selection. Every call goes through `ctx.mirrored` (OpenAPI
// status/body/headers + problem mirror), and every success body is parsed with the portfolio zod mirror listed in
// P3_MIRRORS_BE_B.
//
// This file also exports the BE-B TEST-ONLY fixtures used by test/integration/portfolio/{initiatives,links,
// transitions}.test.ts. Ranking (BE-D) and funding (BE-E) routes are built by other tasks, so the fixtures stage those
// states directly through the app role, each in ONE transaction WITH the audit events the database requires:
//  - stageRanked: a complete entry in the current ranking snapshot (created if none) and submitted -> ranked;
//  - stageFunding: a canonical `decision` row of kind `executive` (DEC-nn, decided) + a `funding_decision` row, and
//    (approved) selected -> funded / (revoked) funded -> selected, mirroring ADR-0023 §7.
// All data is SYNTHETIC. A staged selection or funding decision is a demo business decision by a synthetic user and
// approves nothing real; product gates G1-G6 are business approvals inside the product and nothing here touches DG0-DG7.
import { sql } from "@mth/db";
import {
  initiative,
  initiativeDecisionLink,
  initiativeDecisionLinkList,
  initiativeGapLink,
  initiativeGapLinkList,
  initiativeOutcomeContribution,
  initiativeOutcomeContributionList,
  initiativePage,
  portfolioSelectionPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { record } from "../../../src/modules/audit/index.ts";
import type { P3ExerciseContext, RequestOptions, Res, TestApi } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { setGateStatus } from "../portfolio/fixtures.ts";

export const P3_MIRRORS_BE_B: Readonly<Record<string, z.ZodType>> = {
  listInitiatives: initiativePage,
  createInitiative: initiative,
  getInitiative: initiative,
  updateInitiative: initiative,
  submitInitiative: initiative,
  withdrawInitiative: initiative,
  selectInitiative: initiative,
  deselectInitiative: initiative,
  launchInitiative: initiative,
  cancelInitiative: initiative,
  listPortfolioSelections: portfolioSelectionPage,
  listInitiativeGapLinks: initiativeGapLinkList,
  createInitiativeGapLink: initiativeGapLink,
  removeInitiativeGapLink: initiativeGapLink,
  listInitiativeOutcomeContributions: initiativeOutcomeContributionList,
  createInitiativeOutcomeContribution: initiativeOutcomeContribution,
  removeInitiativeOutcomeContribution: initiativeOutcomeContribution,
  listInitiativeDecisionLinks: initiativeDecisionLinkList,
  createInitiativeDecisionLink: initiativeDecisionLink,
  removeInitiativeDecisionLink: initiativeDecisionLink,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Send = (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;

const created = async (send: Send, url: string, session: P2World["lead"]["session"], body: unknown) => {
  const res = await send("POST", url, { session, body });
  expect(res.status, `POST ${url}: ${JSON.stringify(res.body).slice(0, 400)}`).toBe(201);
  return res.body as { id: string; version: number } & Record<string, unknown>;
};

// ------------------------------------------------------------------------------------------------ fixtures (API)

/** A T05 draft through the API (the lead); `over` overrides fields. */
export async function createInitiative(send: Send, p: P2World, over: Record<string, unknown> = {}) {
  return created(send, "/api/v1/initiatives", p.lead.session, {
    transformationId: p.transformationId,
    name: "Synthetic roaming bundle relaunch",
    objective: "Synthetic: grow roaming revenue per user.",
    ...over,
  });
}

/** Two outcomes, a KPI definition and a T02 row of the first outcome, through the P2 API (synthetic). */
export async function makeDirection(send: Send, p: P2World) {
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;
  const outcomeId = (await created(send, `${T}/outcomes`, lead, { statement: "Synthetic: roaming revenue grows." })).id;
  const otherOutcomeId = (await created(send, `${T}/outcomes`, lead, { statement: "Synthetic: churn falls." })).id;
  const kpiDefinitionId = (
    await created(send, `${T}/kpi-definitions`, lead, {
      name: "Synthetic roaming ARPU",
      unitKind: "count",
      polarity: "higher_is_better",
    })
  ).id;
  const outcomeKpiId = (
    await created(send, `${T}/outcome-kpis`, lead, { outcomeId, kpiDefinitionId, targetDate: "2027-12-31" })
  ).id;
  return { outcomeId, otherOutcomeId, outcomeKpiId };
}

/** A contribution with a KPI (what submit needs: 'Outcome before activity'). */
export async function addMeasurableContribution(
  send: Send,
  p: P2World,
  initiativeId: string,
  d: { outcomeId: string; outcomeKpiId: string },
) {
  return created(send, `/api/v1/initiatives/${initiativeId}/outcome-contributions`, p.lead.session, {
    outcomeId: d.outcomeId,
    outcomeKpiId: d.outcomeKpiId,
    contributionStatement: "Synthetic: the relaunch lifts roaming ARPU.",
  });
}

// ------------------------------------------------------------------------------------------------ fixtures (DB, test-only)

async function orgOf(api: TestApi, initiativeId: string) {
  return api.db.selectFrom("initiative").selectAll().where("id", "=", initiativeId).executeTakeFirstOrThrow();
}

/**
 * TEST-ONLY (BE-D builds the ranking routes): puts a SUBMITTED initiative into the current proposed ranking with a
 * complete score (creating the current snapshot under the active weight set if none exists) and moves it to `ranked`,
 * with the audit events, in one transaction. Returns the snapshot id.
 */
export async function stageRanked(api: TestApi, initiativeId: string, actorId: string): Promise<string> {
  return api.db.transaction().execute(async (tx) => {
    const audit = { actorUserId: actorId, requestId: `fixture-${uuidv7()}` };
    const ini = await tx
      .selectFrom("initiative")
      .selectAll()
      .where("id", "=", initiativeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (ini.status !== "submitted") throw new Error(`stageRanked: ${ini.code} is ${ini.status}, not submitted`);
    let snapshot = await tx
      .selectFrom("ranking_snapshot")
      .select("id")
      .where("transformation_id", "=", ini.transformation_id)
      .where("status", "=", "current")
      .executeTakeFirst();
    if (!snapshot) {
      const ws = await tx
        .selectFrom("scoring_weight_set")
        .select("id")
        .where("transformation_id", "=", ini.transformation_id)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      const id = uuidv7();
      await tx
        .insertInto("ranking_snapshot")
        .values({
          id,
          organization_id: ini.organization_id,
          transformation_id: ini.transformation_id,
          snapshot_no: 1,
          weight_set_id: ws.id,
          proposed_by: actorId,
          created_by: actorId,
          updated_by: actorId,
        })
        .execute();
      await record(tx, audit, {
        action: "ranking_snapshot.fixture_create",
        recordType: "ranking_snapshot",
        recordId: id,
        organizationId: ini.organization_id,
        transformationId: ini.transformation_id,
        newVersion: 1,
      });
      snapshot = { id };
    }
    const last = await tx
      .selectFrom("ranking_entry")
      .select((eb) => eb.fn.max<number>("rank").as("r"))
      .where("snapshot_id", "=", snapshot.id)
      .executeTakeFirst();
    await tx
      .insertInto("ranking_entry")
      .values({
        id: uuidv7(),
        organization_id: ini.organization_id,
        transformation_id: ini.transformation_id,
        snapshot_id: snapshot.id,
        initiative_id: initiativeId,
        rank: (last?.r ?? 0) + 1,
        weighted_score: "3.3000",
        completeness: "complete",
        created_by: actorId,
      })
      .execute();
    const updated = await tx
      .updateTable("initiative")
      .set({ status: "ranked", version: sql<number>`version + 1`, updated_by: actorId })
      .where("id", "=", initiativeId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "initiative.fixture_rank",
      recordType: "initiative",
      recordId: initiativeId,
      organizationId: ini.organization_id,
      transformationId: ini.transformation_id,
      priorVersion: ini.version,
      newVersion: updated.version,
      changes: { status: { from: "submitted", to: "ranked" } },
    });
    return snapshot.id;
  });
}

/**
 * TEST-ONLY (BE-E builds POST /funding-decisions): records a synthetic funding decision for the initiative - a
 * canonical `decision` row of kind `executive` (DEC-nn, status decided) and its `funding_decision` row, with their audit
 * events, in one transaction - and mirrors the status as ADR-0023 §7 describes (approved: selected -> funded; revoked:
 * funded -> selected). Returns the funding decision id.
 */
export async function stageFunding(
  api: TestApi,
  initiativeId: string,
  deciderId: string,
  outcome: "approved" | "rejected" | "deferred" | "revoked",
): Promise<string> {
  const ini0 = await orgOf(api, initiativeId);
  return api.db.transaction().execute(async (tx) => {
    const audit = { actorUserId: deciderId, requestId: `fixture-${uuidv7()}` };
    const ini = await tx
      .selectFrom("initiative")
      .selectAll()
      .where("id", "=", initiativeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const counter = await sql<{ last_value: number }>`
      INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${ini0.transformation_id}::uuid, 'DEC', 1)
      ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
      RETURNING last_value`.execute(tx);
    const decisionId = uuidv7();
    await tx
      .insertInto("decision")
      .values({
        id: decisionId,
        organization_id: ini.organization_id,
        transformation_id: ini.transformation_id,
        kind: "executive",
        code: `DEC-${String(counter.rows[0]!.last_value).padStart(2, "0")}`,
        title: `Synthetic funding decision for ${ini.code}`,
        owner_user_id: deciderId,
        status: "decided",
        outcome_text: `Synthetic: funding ${outcome}.`,
        decided_by: deciderId,
        decided_at: new Date(),
        created_by: deciderId,
        updated_by: deciderId,
      })
      .execute();
    await record(tx, audit, {
      action: "decision.fixture_create",
      recordType: "decision",
      recordId: decisionId,
      organizationId: ini.organization_id,
      transformationId: ini.transformation_id,
      newVersion: 1,
    });
    const fundingId = uuidv7();
    await tx
      .insertInto("funding_decision")
      .values({
        id: fundingId,
        organization_id: ini.organization_id,
        transformation_id: ini.transformation_id,
        initiative_id: initiativeId,
        decision_id: decisionId,
        outcome,
        amount: "1500000.0000",
        currency: "SAR",
        rationale: "Synthetic demo funding decision; approves nothing real.",
        approver_role_code: "SP",
        decided_by: deciderId,
        decided_at: new Date(),
      })
      .execute();
    await record(tx, audit, {
      action: "funding_decision.fixture_create",
      recordType: "funding_decision",
      recordId: fundingId,
      organizationId: ini.organization_id,
      transformationId: ini.transformation_id,
      changes: { outcome: { from: null, to: outcome } },
    });
    const to =
      outcome === "approved" && ini.status === "selected"
        ? "funded"
        : outcome === "revoked" && ini.status === "funded"
          ? "selected"
          : null;
    if (to !== null) {
      const updated = await tx
        .updateTable("initiative")
        .set({ status: to, version: sql<number>`version + 1`, updated_by: deciderId })
        .where("id", "=", initiativeId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "initiative.fixture_funding",
        recordType: "initiative",
        recordId: initiativeId,
        organizationId: ini.organization_id,
        transformationId: ini.transformation_id,
        priorVersion: ini.version,
        newVersion: updated.version,
        changes: { status: { from: ini.status, to } },
      });
    }
    return fundingId;
  });
}

// ------------------------------------------------------------------------------------------------ exercises

export async function exerciseP3BeBOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;

  // createInitiative / getInitiative / updateInitiative / listInitiatives (+ AUD 403, 428, 409).
  const ini = await createInitiative(m, p);
  expect([ini["code"], ini["status"], ini.version]).toEqual(["INI-01", "draft", 1]);
  expect(
    (
      await m("POST", "/api/v1/initiatives", {
        session: p.auditor.session,
        body: { transformationId: p.transformationId, name: "x" },
      })
    ).status,
  ).toBe(403);
  const I = `/api/v1/initiatives/${ini.id}`;
  expect((await m("GET", I, { session: p.auditor.session })).status).toBe(200);
  expect((await m("PATCH", I, { session: lead, body: { scopeIn: "Synthetic scope." } })).status).toBe(428);
  expect((await m("PATCH", I, { session: lead, headers: ifm(9), body: { scopeIn: "Synthetic scope." } })).status).toBe(
    409,
  );
  const patched = await m("PATCH", I, { session: lead, headers: ifm(1), body: { scopeIn: "Synthetic scope." } });
  expect([patched.status, patched.body.version]).toEqual([200, 2]);
  const list = await m("GET", `/api/v1/initiatives?transformationId=${p.transformationId}&limit=5`, { session: lead });
  expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([ini.id]);

  // Gap links: create, list, remove; a TOM record type is the 422 rule.
  const gapId = (await created(m, `${T}/tom-gaps`, lead, { dimensionCode: "technology" })).id;
  const tomEvidence = await m("POST", `${I}/gap-links`, {
    session: lead,
    body: { targetType: "capability", targetId: gapId },
  });
  expect([tomEvidence.status, tomEvidence.body.code]).toEqual([422, "initiative.not_tom_evidence"]);
  const gap = await created(m, `${I}/gap-links`, lead, { targetType: "tom_gap", targetId: gapId });
  expect((await m("GET", `${I}/gap-links`, { session: p.auditor.session })).body.items).toHaveLength(1);
  const removedGap = await m("POST", `${I}/gap-links/${gap.id}/remove`, {
    session: lead,
    headers: ifm(gap.version),
    body: { reason: "Synthetic: wrong gap." },
  });
  expect([removedGap.status, removedGap.body.status]).toEqual([200, "removed"]);

  // Outcome contributions: create, list, remove; then a measurable one for submit.
  const d = await makeDirection(m, p);
  const contribution = await created(m, `${I}/outcome-contributions`, lead, {
    outcomeId: d.outcomeId,
    contributionStatement: "Synthetic: no KPI yet.",
  });
  expect(
    (await m("GET", `${I}/outcome-contributions?includeArchived=true`, { session: lead })).body.items,
  ).toHaveLength(1);
  expect(
    (
      await m("POST", `${I}/outcome-contributions/${contribution.id}/remove`, {
        session: lead,
        headers: ifm(contribution.version),
        body: { reason: "Synthetic: replaced." },
      })
    ).status,
  ).toBe(200);
  await addMeasurableContribution(m, p, ini.id, d);

  // Decision links: a canonical (design) decision, linked, listed, removed.
  const decision = await created(m, "/api/v1/decisions", lead, {
    transformationId: p.transformationId,
    title: "Synthetic: pricing model for the relaunch",
    options: [{ title: "A" }],
  });
  const dl = await created(m, `${I}/decision-links`, lead, { decisionId: decision.id });
  expect((await m("GET", `${I}/decision-links`, { session: lead })).body.items).toHaveLength(1);
  expect(
    (
      await m("POST", `${I}/decision-links/${dl.id}/remove`, {
        session: lead,
        headers: ifm(dl.version),
        body: { reason: "Synthetic: decided elsewhere." },
      })
    ).status,
  ).toBe(200);

  // Lifecycle: submit before G1 -> 422; after a (synthetic) G1 approval -> 200; withdraw; submit again.
  const v = async () => (await m("GET", I, { session: lead })).body.version as number;
  const early = await m("POST", `${I}/submit`, { session: lead, headers: ifm(await v()), body: {} });
  expect([early.status, early.body.code]).toEqual([422, "initiative.g1_not_approved"]);
  await setGateStatus(ctx.api, p, "G1", "approved");
  const submitted = await m("POST", `${I}/submit`, { session: lead, headers: ifm(await v()), body: {} });
  expect([submitted.status, submitted.body.status]).toEqual([200, "submitted"]);
  const withdrawn = await m("POST", `${I}/withdraw`, {
    session: lead,
    headers: ifm(submitted.body.version),
    body: { reason: "Synthetic: rework the scope." },
  });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "draft"]);
  const again = await m("POST", `${I}/submit`, { session: lead, headers: ifm(withdrawn.body.version), body: {} });
  expect(again.status).toBe(200);

  // Selection: ranked (fixture) -> selected ('Selected - unfunded') -> deselected -> selected; history.
  await stageRanked(ctx.api, ini.id, p.lead.id);
  const selected = await m("POST", `${I}/select`, {
    session: p.sponsor.session,
    headers: ifm(await v()),
    body: { rationale: "Synthetic demo selection; approves nothing real." },
  });
  expect([selected.status, selected.body.displayStatus]).toEqual([200, "initiative.status.selected_unfunded"]);
  const deselected = await m("POST", `${I}/deselect`, {
    session: p.sponsor.session,
    headers: ifm(selected.body.version),
    body: { rationale: "Synthetic: capacity moved to another wave." },
  });
  expect([deselected.status, deselected.body.status]).toEqual([200, "ranked"]);
  const reselected = await m("POST", `${I}/select`, {
    session: p.sponsor.session,
    headers: ifm(deselected.body.version),
    body: { rationale: "Synthetic: capacity restored." },
  });
  expect(reselected.status).toBe(200);
  const history = await m("GET", `${I}/selections?limit=10`, { session: p.auditor.session });
  expect(history.body.items.map((s: { action: string }) => s.action)).toEqual(["selected", "deselected", "selected"]);

  // Launch: End-to-End needs G2 and G3; funded through the test-only funding fixture.
  await stageFunding(ctx.api, ini.id, p.sponsor.id, "approved");
  await setGateStatus(ctx.api, p, "G2", "approved");
  await setGateStatus(ctx.api, p, "G3", "approved");
  const launched = await m("POST", `${I}/launch`, {
    session: lead,
    headers: ifm(await v()),
    body: { note: "Synthetic launch." },
  });
  expect([launched.status, launched.body.status, launched.body.fundingState]).toEqual([200, "launched", "funded"]);

  // Cancel a second draft.
  const other = await createInitiative(m, p, { name: "Synthetic loyalty pilot" });
  const cancelled = await m("POST", `/api/v1/initiatives/${other.id}/cancel`, {
    session: lead,
    headers: ifm(other.version),
    body: { reason: "Synthetic: merged into INI-01." },
  });
  expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
}
