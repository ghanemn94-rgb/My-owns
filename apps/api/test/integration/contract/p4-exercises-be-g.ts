// P4 contract exercises of BE-G (T-DG4-BE-G; p4-work-split §D.2, §1 S-10): the 11 slice D operations of the T16
// Executive Decision Log, decision-SLA escalations, escalation rules and blocker RAG by cycle. Every call goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_BE_G. The escalation listed here is written by the worker's real handler (the API only reads them). All
// data is synthetic; recording an Outcome approves no gate and nothing here touches the engineering gates DG0-DG7.
import {
  blockerStatus,
  blockerStatusPage,
  decisionEscalationPage,
  escalationRule,
  escalationRulePage,
  executiveDecision,
  executiveDecisionPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { handleDecisionSlaScan } from "../../../../worker/src/handlers/escalations.ts";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld } from "../governance/meeting-fixtures.ts";
import {
  askBody,
  createBlockerRisk,
  meetingInSession,
  moveAskDates,
  organizationOf,
  setWorkweek,
  workweekOf,
} from "../governance/t16-fixtures.ts";

export const P4_MIRRORS_BE_G: Readonly<Record<string, z.ZodType>> = {
  listExecutiveDecisions: executiveDecisionPage,
  createExecutiveDecision: executiveDecision,
  getExecutiveDecision: executiveDecision,
  updateExecutiveDecision: executiveDecision,
  recordExecutiveDecisionOutcome: executiveDecision,
  listDecisionEscalations: decisionEscalationPage,
  listEscalationRules: escalationRulePage,
  createEscalationRule: escalationRule,
  updateEscalationRule: escalationRule,
  listBlockerStatuses: blockerStatusPage,
  recordBlockerStatus: blockerStatus,
};

export async function exerciseP4BeGOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const x = await setupMeetingWorld(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${x.transformationId}`;
  const today = await businessToday(ctx.api);

  // ------------------------------------------------------------------ T16 (ADR-0032 §6)
  const { whyNow: _w, ...noWhy } = askBody(x.bo.id, plusDays(today, 5));
  const refused = await m("POST", `${T}/executive-decisions`, { session: x.lead.session, body: noWhy });
  expect([refused.status, refused.body.errors[0].pointer]).toEqual([400, "/whyNow"]);
  const created = await m("POST", `${T}/executive-decisions`, {
    session: x.lead.session,
    body: askBody(x.bo.id, plusDays(today, 5)),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  expect((await m("GET", `${T}/executive-decisions`, { session: x.auditor.session })).status).toBe(200);
  expect((await m("GET", `${T}/executive-decisions?overdue=true`, { session: x.auditor.session })).status).toBe(200);
  expect((await m("GET", `${T}/executive-decisions/${id}`, { session: x.auditor.session })).status).toBe(200);
  const updated = await m("PATCH", `${T}/executive-decisions/${id}`, {
    session: x.lead.session,
    headers: ifm(1),
    body: { impactOfDelay: "Synthetic: one more quarter on the old terms" },
  });
  expect([updated.status, updated.body.version]).toEqual([200, 2]);
  const notOwner = await m("POST", `${T}/executive-decisions/${id}/outcome`, {
    session: x.bo2.session,
    headers: ifm(2),
    body: { outcome: "decided", outcomeText: "Synthetic" },
  });
  expect([notOwner.status, notOwner.body.code]).toEqual([403, "executive_decision.not_owner"]);

  // ------------------------------------------------------------------ escalation rules (ADR-0032 §8.1)
  const rules = await m("GET", `${T}/escalation-rules`, { session: x.auditor.session });
  expect(rules.body.items.map((r: { isDefault: boolean }) => r.isDefault)).toEqual([true, true]);
  const rule = await m("POST", `${T}/escalation-rules`, {
    session: x.office.session,
    body: { ruleKind: "decision_sla", escalationChain: ["SP"] },
  });
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  const shape = await m("POST", `${T}/escalation-rules`, {
    session: x.office.session,
    body: { ruleKind: "blocker_red", escalationChain: ["SP"] },
  });
  expect([shape.status, shape.body.code]).toEqual([422, "escalation_rule.shape"]);
  const ruleUpdated = await m("PATCH", `${T}/escalation-rules/decision_sla`, {
    session: x.office.session,
    headers: ifm(1),
    body: { escalationChain: ["SP", "BO"] },
  });
  expect([ruleUpdated.status, ruleUpdated.body.version]).toEqual([200, 2]);

  // ------------------------------------------------------------------ the SLA scan writes one escalation (§7)
  // Every day a working day for this one scan (today may be a weekend), then the calendar is restored.
  const organizationId = await organizationOf(ctx.api, x.transformationId);
  const workweek = await workweekOf(ctx.api.db, organizationId);
  await setWorkweek(ctx.api.db, organizationId, [1, 2, 3, 4, 5, 6, 7]);
  await moveAskDates(ctx.api.db, id, plusDays(today, -2), plusDays(today, -2));
  await handleDecisionSlaScan(ctx.api.db, { organizationId }, "contract-be-g");
  await setWorkweek(ctx.api.db, organizationId, workweek);
  const escalations = await m("GET", `${T}/escalations?decisionId=${id}`, { session: x.auditor.session });
  expect([escalations.status, escalations.body.items.length]).toEqual([200, 1]);
  const decided = await m("POST", `${T}/executive-decisions/${id}/outcome`, {
    session: x.bo.session,
    headers: ifm(3),
    body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: switch vendor" },
  });
  expect([decided.status, decided.body.status]).toEqual([200, "decided"]);

  // ------------------------------------------------------------------ blocker RAG by cycle (§8.2)
  const risk = await createBlockerRisk(m, x);
  const meetingId = await meetingInSession(m, x, x.forums.transformation_review, plusDays(today, 1));
  const S = `${T}/meetings/${meetingId}/blocker-statuses`;
  const status = await m("POST", S, {
    session: x.lead.session,
    body: { sourceRecordType: "raid_entry", sourceRecordId: risk, rag: "red", note: "Synthetic: still blocked" },
  });
  expect(status.status, JSON.stringify(status.body)).toBe(201);
  const dup = await m("POST", S, {
    session: x.lead.session,
    body: { sourceRecordType: "raid_entry", sourceRecordId: risk, rag: "amber" },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "blocker_status.exists"]);
  const list = await m("GET", S, { session: x.auditor.session });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
}
