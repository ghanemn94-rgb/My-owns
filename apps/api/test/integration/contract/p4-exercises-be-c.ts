// P4 contract exercises of BE-C (T-DG4-BE-C; p4-work-split §I+C.3, §1 S-10): the 13 slice C operations of T11
// decision rights, T12 RACI, governance matrices and Transform readiness. Every call goes through `ctx.mirrored`
// (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_BE_C. All data is synthetic; the matrix approval requested here is a demo BUSINESS approval on synthetic
// records, it approves nothing real and has nothing to do with the engineering gates DG0-DG7.
import {
  approval,
  decisionRight,
  decisionRightPage,
  decisionRightTemplateList,
  dueDatePreview,
  governanceMatrixList,
  raci,
  raciDeliverable,
  raciTemplate,
  transformReadiness,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { setupApprovalWorld } from "../approvals/approval-world.ts";

export const P4_MIRRORS_BE_C: Readonly<Record<string, z.ZodType>> = {
  listDecisionRightTemplates: decisionRightTemplateList,
  listDecisionRights: decisionRightPage,
  createDecisionRight: decisionRight,
  getDecisionRight: decisionRight,
  updateDecisionRight: decisionRight,
  previewDecisionRightDueDate: dueDatePreview,
  getRaciTemplate: raciTemplate,
  getTransformationRaci: raci,
  createRaciDeliverable: raciDeliverable,
  updateRaciDeliverable: raciDeliverable,
  listGovernanceMatrices: governanceMatrixList,
  submitGovernanceMatrix: approval,
  getTransformReadiness: transformReadiness,
};

export async function exerciseP4BeCOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupApprovalWorld(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session; // TL: decision_right.configure, raci.edit
  const auditor = p.auditor.session;

  // ------------------------------------------------------------------ T11 (ADR-0026 §5)
  const templates = await m("GET", "/api/v1/decision-right-templates", { session: auditor });
  expect(templates.status).toBe(200);
  expect(templates.body.items).toHaveLength(4);
  const list = await m("GET", `${T}/decision-rights?limit=2`, { session: auditor });
  expect(list.status).toBe(200);
  expect(list.body.nextCursor).not.toBeNull();
  const rowBody = {
    decisionEn: "Synthetic vendor change",
    decisionAr: "تغيير مورد اصطناعي",
    recommendLabel: "Transformation Lead",
    approveLabel: "Business owner",
    consultLabel: "Finance",
    informLabel: "PMO",
    slaLabel: "3 working days",
    recommendParties: ["TL"],
    approvePartyCode: "BO",
    consultParties: ["FIN"],
    informParties: ["PMO"],
    slaType: "working_days",
    slaWorkingDays: 3,
    escalationChain: ["BO", "SP"],
  };
  expect((await m("POST", `${T}/decision-rights`, { session: auditor, body: rowBody })).status).toBe(403);
  const badParty = await m("POST", `${T}/decision-rights`, {
    session: lead,
    body: { ...rowBody, approvePartyCode: "NOBODY" },
  });
  expect([badParty.status, badParty.body.code]).toEqual([422, "decision_right.party_unknown"]);
  const created = await m("POST", `${T}/decision-rights`, { session: lead, body: rowBody });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const R = `${T}/decision-rights/${created.body.id}`;
  expect((await m("GET", R, { session: auditor })).status).toBe(200);
  expect((await m("PATCH", R, { session: lead, body: { slaWorkingDays: 4 } })).status).toBe(428);
  expect((await m("PATCH", R, { session: lead, headers: ifm(9), body: { slaWorkingDays: 4 } })).status).toBe(409);
  const badSla = await m("PATCH", R, { session: lead, headers: ifm(1), body: { slaWorkingDays: 0 } });
  expect([badSla.status, badSla.body.code]).toEqual([422, "decision_right.sla_invalid"]);
  const edited = await m("PATCH", R, { session: lead, headers: ifm(1), body: { slaWorkingDays: 4 } });
  expect([edited.status, edited.body.version]).toEqual([200, 2]);
  const due = await m("GET", `${T}/decision-rights/${p.rights["business_scope_change"]}/due-date?raisedOn=2026-10-08`, {
    session: auditor,
  });
  expect(due.status, JSON.stringify(due.body)).toBe(200);
  const urgent = await m("GET", `${R}/due-date?raisedOn=2026-10-08&urgent=true`, { session: auditor });
  expect([urgent.status, urgent.body.code]).toEqual([422, "decision_right.urgent_not_configured"]);

  // ------------------------------------------------------------------ T12 (ADR-0026 §7)
  const template = await m("GET", "/api/v1/raci-template", { session: auditor });
  expect([template.status, template.body.deliverables.length]).toEqual([200, 6]);
  const own = await m("GET", `${T}/raci`, { session: auditor });
  expect([own.status, own.body.deliverables.length]).toEqual([200, 6]);
  const cells = [
    { partyCode: "SP", value: "A" },
    { partyCode: "TL", value: "R" },
  ];
  const D = `${T}/raci/deliverables`;
  expect((await m("POST", D, { session: auditor, body: { labelEn: "x", labelAr: "س", cells } })).status).toBe(403);
  const x = await m("POST", D, {
    session: lead,
    body: { labelEn: "Synthetic", labelAr: "اصطناعي", cells: [{ partyCode: "SP", value: "X" }] },
  });
  expect([x.status, x.body.code]).toEqual([422, "raci.invalid_value"]);
  const deliverable = await m("POST", D, {
    session: lead,
    body: { labelEn: "Synthetic deliverable", labelAr: "مخرج اصطناعي", cells },
  });
  expect(deliverable.status, JSON.stringify(deliverable.body)).toBe(201);
  const DD = `${D}/${deliverable.body.id}`;
  expect((await m("PATCH", DD, { session: lead, body: { labelEn: "No If-Match" } })).status).toBe(428);
  const twoA = await m("PATCH", DD, {
    session: lead,
    headers: ifm(1),
    body: { cells: [{ partyCode: "TL", value: "A" }] },
  });
  expect([twoA.status, twoA.body.code]).toEqual([422, "raci.accountable_count"]);
  const moved = await m("PATCH", DD, {
    session: lead,
    headers: ifm(1),
    body: {
      cells: [
        { partyCode: "SP", value: "R" },
        { partyCode: "TL", value: "A/R" },
      ],
    },
  });
  expect([moved.status, moved.body.version]).toEqual([200, 2]);

  // ------------------------------------------------------------------ matrices and readiness (ADR-0026 §7, §9)
  const matrices = await m("GET", `${T}/governance-matrices`, { session: auditor });
  expect(matrices.status).toBe(200);
  const raciMatrix = (matrices.body.items as { kind: string; version: number }[]).find((i) => i.kind === "raci")!;
  const S = `${T}/governance-matrices/raci/submit`;
  expect((await m("POST", S, { session: lead, body: { title: "No If-Match" } })).status).toBe(428);
  const submitted = await m("POST", S, {
    session: lead,
    headers: ifm(raciMatrix.version),
    body: { title: "Synthetic RACI change for the Sponsor's business approval" },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  expect(submitted.body.assignee).toMatchObject({ partyCode: "SP", userId: p.sponsor.id });
  const frozen = await m("PATCH", DD, { session: lead, headers: ifm(2), body: { labelEn: "Frozen" } });
  expect([frozen.status, frozen.body.code]).toEqual([422, "governance_matrix.in_approval"]);
  const again = await m("POST", S, { session: lead, headers: ifm(raciMatrix.version + 1), body: { title: "Again" } });
  expect([again.status, again.body.code]).toEqual([422, "governance_matrix.not_draft"]);
  const readiness = await m("GET", `${T}/readiness/transform`, { session: auditor });
  expect([readiness.status, readiness.body.status]).toEqual([200, "not_ready"]);
}
