// P4 contract exercises of BE-B (T-DG4-BE-B; p4-work-split §I+C.2, §1 S-10): the 23 slice C operations (groups and
// members, governance parties, role mappings and the resolve preview, delegations, approvals and the decision-record
// view). Every call goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is
// parsed with the zod mirror in P4_MIRRORS_BE_B. All data is synthetic; the approvals decided here are demo BUSINESS
// approvals on synthetic records, they approve nothing real and have nothing to do with the engineering gates DG0-DG7.
import {
  approval,
  approvalDecisionRecordPage,
  approvalPage,
  delegation,
  delegationPage,
  governancePartyList,
  group,
  groupMember,
  groupMemberPage,
  groupPage,
  partyResolution,
  roleMapping,
  roleMappingPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import { signIn, uniq, type P4ExerciseContext } from "../../support/harness.ts";
import { editDecision, newDecision, requestBody, setupApprovalWorld } from "../approvals/approval-world.ts";

export const P4_MIRRORS_BE_B: Readonly<Record<string, z.ZodType>> = {
  listGroups: groupPage,
  createGroup: group,
  getGroup: group,
  updateGroup: group,
  listGroupMembers: groupMemberPage,
  addGroupMember: groupMember,
  removeGroupMember: groupMember,
  listGovernanceParties: governancePartyList,
  listRoleMappings: roleMappingPage,
  createRoleMapping: roleMapping,
  endRoleMapping: roleMapping,
  resolveGovernanceParty: partyResolution,
  listDelegations: delegationPage,
  createDelegation: delegation,
  getDelegation: delegation,
  revokeDelegation: delegation,
  listMyApprovals: approvalPage,
  requestApproval: approval,
  getApproval: approval,
  decideApproval: approval,
  resubmitApproval: approval,
  withdrawApproval: approval,
  listApprovalDecisionRecords: approvalDecisionRecordPage,
};

export async function exerciseP4BeBOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const w = ctx.world;
  const office = await signIn(ctx.api.app, w.office.subject); // TO @ org A: group.manage, role_mapping.assign
  const auditor = await signIn(ctx.api.app, w.auditor.subject);
  const p = await setupApprovalWorld(ctx.api, w, m);

  // ------------------------------------------------------------------ groups (ADR-0026 §1)
  const G = `/api/v1/organizations/${w.orgA.id}/groups`;
  const created = await m("POST", G, {
    session: office,
    body: { code: uniq("SC-"), nameEn: "Synthetic SteerCo", nameAr: "لجنة اصطناعية", ownerUserId: w.office.id },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(
    (
      await m("POST", G, {
        session: auditor,
        body: { code: uniq("SC-"), nameEn: "x", nameAr: "س", ownerUserId: w.office.id },
      })
    ).status,
  ).toBe(403);
  expect((await m("GET", `${G}?limit=5`, { session: auditor })).status).toBe(200);
  const U = `/api/v1/groups/${created.body.id}`;
  expect((await m("GET", U, { session: auditor })).status).toBe(200);
  expect((await m("PATCH", U, { session: office, body: { nameEn: "No If-Match" } })).status).toBe(428);
  const renamed = await m("PATCH", U, {
    session: office,
    headers: ifm(1),
    body: { nameEn: "Synthetic Executive SteerCo" },
  });
  expect([renamed.status, renamed.body.version]).toEqual([200, 2]);
  const member = await m("POST", `${U}/members`, { session: office, body: { userId: p.sponsor.id } });
  expect(member.status).toBe(201);
  expect((await m("POST", `${U}/members`, { session: office, body: { userId: p.sponsor.id } })).status).toBe(409);
  const extra = await m("POST", `${U}/members`, { session: office, body: { userId: w.leadA1.id } });
  expect((await m("GET", `${U}/members`, { session: auditor })).status).toBe(200);
  const removed = await m("POST", `${U}/members/${extra.body.id}/remove`, {
    session: office,
    headers: ifm(1),
    body: { reason: "Synthetic: left the forum" },
  });
  expect([removed.status, removed.body.removedBy]).toEqual([200, w.office.id]);

  // ------------------------------------------------------------------ parties and role mappings (ADR-0026 §2)
  const parties = await m("GET", "/api/v1/governance-parties", { session: auditor });
  expect([parties.status, parties.body.items.length]).toEqual([200, 18]);
  const M = `/api/v1/transformations/${p.transformationId}/role-mappings`;
  expect((await m("GET", `${M}?status=active`, { session: auditor })).status).toBe(200);
  const unmapped = await m("GET", `${M}/resolve?party=STEERCO`, { session: auditor });
  expect(unmapped.body.status).toBe("unmapped");
  const steerco = await m("POST", M, {
    session: p.lead.session,
    body: { partyCode: "STEERCO", targetKind: "group", groupId: created.body.id },
  });
  expect(steerco.status, JSON.stringify(steerco.body)).toBe(201);
  expect(
    (
      await m("POST", M, {
        session: p.lead.session,
        body: { partyCode: "STEERCO", targetKind: "group", groupId: created.body.id },
      })
    ).status,
  ).toBe(409);
  const mapped = await m("GET", `${M}/resolve?party=STEERCO`, { session: auditor });
  expect([mapped.body.status, mapped.body.groupId]).toEqual(["mapped", created.body.id]);
  const finMap = await m("POST", M, {
    session: p.lead.session,
    body: { partyCode: "FIN", targetKind: "user", userId: p.fin.id },
  });
  const ended = await m("POST", `${M}/${finMap.body.id}/end`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic: changed owner" },
  });
  expect([ended.status, ended.body.status]).toEqual([200, "ended"]);

  // ------------------------------------------------------------------ delegations (ADR-0026 §3)
  const D = "/api/v1/delegations";
  const window = {
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    effectiveTo: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  const del = await m("POST", D, {
    session: p.bo2.session,
    body: { delegateUserId: p.fin.id, reasonCode: "absence", absenceNote: "Synthetic leave", ...window },
  });
  expect(del.status, JSON.stringify(del.body)).toBe(201);
  expect(
    (
      await m("POST", D, {
        session: p.fin.session,
        body: { delegateUserId: p.bo2.id, reasonCode: "absence", ...window },
      })
    ).status,
  ).toBe(422);
  expect((await m("GET", `${D}?role=any&status=active`, { session: p.bo2.session })).status).toBe(200);
  expect((await m("GET", `${D}/${del.body.id}`, { session: p.fin.session })).status).toBe(200);
  const revoked = await m("POST", `${D}/${del.body.id}/revoke`, {
    session: p.bo2.session,
    headers: ifm(1),
    body: { reason: "Synthetic: back early" },
  });
  expect([revoked.status, revoked.body.status]).toEqual([200, "revoked"]);

  // ------------------------------------------------------------------ approvals (ADR-0026 §4)
  const send = (method: string, url: string, o?: Parameters<typeof m>[2]) => m(method, url, o);
  const R = `/api/v1/transformations/${p.transformationId}/approvals`;
  const req = await m("POST", R, {
    session: p.lead.session,
    body: requestBody(p.decisionId, p.rights["target_state_design"]!),
  });
  expect([req.status, req.body.assignee.userId]).toEqual([201, p.bo.id]);
  expect(
    (await m("POST", R, { session: p.lead.session, body: requestBody(p.decisionId, p.rights["target_state_design"]!) }))
      .status,
  ).toBe(409);
  const A = `/api/v1/approvals/${req.body.id}`;
  expect((await m("GET", A, { session: auditor })).status).toBe(200);
  expect((await m("GET", "/api/v1/approvals?status=pending", { session: p.bo.session })).status).toBe(200);
  expect(
    (
      await m("POST", `${A}/decisions`, {
        session: p.bo.session,
        headers: ifm(1),
        body: { outcome: "approve", rationale: " ", subjectVersion: 1 },
      })
    ).status,
  ).toBe(422);
  const changes = await m("POST", `${A}/decisions`, {
    session: p.bo.session,
    headers: ifm(1),
    body: { outcome: "request_changes", rationale: "Synthetic: add the risk view", subjectVersion: 1 },
  });
  expect([changes.status, changes.body.status]).toEqual([200, "changes_requested"]);
  const v2 = await editDecision(send, p, p.decisionId, 1);
  const resub = await m("POST", `${A}/resubmit`, {
    session: p.lead.session,
    headers: ifm(2),
    body: { subjectVersion: v2 },
  });
  expect([resub.status, resub.body.roundNo]).toEqual([200, 2]);
  const approved = await m("POST", `${A}/decisions`, {
    session: p.bo.session,
    headers: ifm(3),
    body: {
      outcome: "approve",
      rationale: "Synthetic: the risk view is in",
      subjectVersion: v2,
      comments: "Synthetic",
    },
  });
  expect([approved.status, approved.body.status]).toEqual([200, "approved"]);
  const second = await m("POST", R, {
    session: p.lead.session,
    body: requestBody(await newDecision(send, p), p.rights["target_state_design"]!),
  });
  const withdrawn = await m("POST", `/api/v1/approvals/${second.body.id}/withdraw`, {
    session: p.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic: no longer needed" },
  });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
  const records = await m("GET", `/api/v1/transformations/${p.transformationId}/approval-decisions?limit=10`, {
    session: auditor,
  });
  expect(records.status).toBe(200);
  expect(records.body.items.length).toBeGreaterThanOrEqual(2);
}
