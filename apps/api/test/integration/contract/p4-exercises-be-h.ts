// P4 contract exercises of BE-H (T-DG4-BE-H; p4-work-split §F+G FG.1, §1 S-10): the 19 slice F operations of the T13
// Stakeholder & Adoption Plan, champions, interventions, impacted-team involvement and champion constraints. Every call
// goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the
// zod mirror in P4_MIRRORS_BE_H. BE-H2 appends its forms, invitations, assessment and training exercises to this file
// after BE-H (no new seam file). All data is synthetic; nothing here grants a business or Finance approval or touches
// the engineering gates DG0-DG7.
import {
  adoptionIntervention,
  adoptionInterventionPage,
  adoptionPlan,
  championConstraint,
  championConstraintPage,
  stakeholderChampion,
  stakeholderChampionPage,
  stakeholderGroup,
  stakeholderGroupPage,
  stakeholderInvolvement,
  stakeholderInvolvementPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld } from "../benefits/fixtures.ts";

export const P4_MIRRORS_BE_H: Readonly<Record<string, z.ZodType>> = {
  listStakeholderGroups: stakeholderGroupPage,
  createStakeholderGroup: stakeholderGroup,
  getStakeholderGroup: stakeholderGroup,
  updateStakeholderGroup: stakeholderGroup,
  archiveStakeholderGroup: stakeholderGroup,
  getAdoptionPlan: adoptionPlan,
  listStakeholderChampions: stakeholderChampionPage,
  addStakeholderChampion: stakeholderChampion,
  removeStakeholderChampion: stakeholderChampion,
  listAdoptionInterventions: adoptionInterventionPage,
  createAdoptionIntervention: adoptionIntervention,
  getAdoptionIntervention: adoptionIntervention,
  updateAdoptionIntervention: adoptionIntervention,
  listStakeholderInvolvements: stakeholderInvolvementPage,
  createStakeholderInvolvement: stakeholderInvolvement,
  withdrawStakeholderInvolvement: stakeholderInvolvement,
  listChampionConstraints: championConstraintPage,
  createChampionConstraint: championConstraint,
  resolveChampionConstraint: championConstraint,
};

export async function exerciseP4BeHOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const wl = await extraUser(ctx.api, ctx.world, b, "WL");
  const SG = `${b.base}/stakeholder-groups`;

  // ------------------------------------------------------------------ T13 rows (ADR-0033 §7, §10)
  expect((await m("GET", SG, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", SG, { session: s.admin })).status).toBe(404);
  const hostile = await m("POST", SG, {
    session: s.tl,
    body: {
      name: "Synthetic field sales",
      impact: "H",
      currentStance: "hostile",
      requiredBehavior: "Synthetic: log visits in the new CRM",
      interventionTypes: ["training"],
      ownerUserId: wl.id,
    },
  });
  expect([hostile.status, hostile.body.errors[0].code, hostile.body.errors[0].pointer]).toEqual([
    400,
    "stakeholder_group.stance_invalid",
    "/currentStance",
  ]);
  const group = await m("POST", SG, {
    session: s.tl,
    body: {
      name: "Synthetic field sales",
      impact: "H",
      influence: "M",
      currentStance: "resist",
      requiredBehavior: "Synthetic: log visits in the new CRM",
      interventionTypes: ["comms", "training", "involvement", "incentive"],
      ownerUserId: wl.id,
      adoptionKpiDefinitionId: b.kpiDefinitionId,
      headcount: 120,
    },
  });
  expect(group.status, JSON.stringify(group.body)).toBe(201);
  expect([group.body.code, group.body.status, group.headers.etag]).toEqual(["SG-01", "active", '"1"']);
  const G = `${SG}/${group.body.id}`;
  expect((await m("GET", G, { session: s.auditor })).status).toBe(200);
  const dup = await m("POST", SG, {
    session: s.tl,
    body: {
      name: "SYNTHETIC FIELD SALES",
      impact: "L",
      currentStance: "neutral",
      requiredBehavior: "Synthetic",
      interventionTypes: ["comms"],
      ownerUserId: wl.id,
    },
  });
  expect([dup.status, dup.body.code]).toEqual([409, "stakeholder_group.name_taken"]);
  const upd = await m("PATCH", G, { session: s.tl, headers: ifm(1), body: { currentStance: "neutral" } });
  expect([upd.status, upd.body.currentStance, upd.body.version]).toEqual([200, "neutral", 2]);
  expect((await m("PATCH", G, { session: s.tl, body: { headcount: 3 } })).status).toBe(428);
  expect((await m("PATCH", G, { session: s.tl, headers: ifm(1), body: { headcount: 3 } })).status).toBe(409);
  const plan = await m("GET", `${b.base}/adoption-plan`, { session: s.auditor });
  expect([plan.status, plan.body.rows.length]).toEqual([200, 1]);

  // ------------------------------------------------------------------ champions
  const champ = await m("POST", `${G}/champions`, {
    session: s.tl,
    body: { userId: wl.id, note: "Synthetic champion" },
  });
  expect(champ.status, JSON.stringify(champ.body)).toBe(201);
  const again = await m("POST", `${G}/champions`, { session: s.tl, body: { userId: wl.id } });
  expect([again.status, again.body.code]).toEqual([409, "stakeholder_champion.exists"]);
  const boChamp = await m("POST", `${G}/champions`, { session: s.tl, body: { userId: b.users.bo.id } });
  expect(boChamp.status).toBe(201);
  expect((await m("GET", `${G}/champions`, { session: s.auditor })).status).toBe(200);

  // ------------------------------------------------------------------ interventions (My Work)
  const AI = `${b.base}/adoption-interventions`;
  const iv = await m("POST", AI, {
    session: s.tl,
    body: {
      stakeholderGroupId: group.body.id,
      interventionType: "training",
      title: "Synthetic CRM training",
      ownerUserId: wl.id,
      dueDate: "2026-12-01",
    },
  });
  expect(iv.status, JSON.stringify(iv.body)).toBe(201);
  expect([iv.body.code, iv.body.status, iv.body.ownerStatus, iv.body.origin]).toEqual([
    "AI-01",
    "planned",
    "assigned",
    "manual",
  ]);
  expect((await m("GET", `${AI}?origin=manual`, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", `${AI}/${iv.body.id}`, { session: s.auditor })).status).toBe(200);
  const noNote = await m("PATCH", `${AI}/${iv.body.id}`, { session: s.tl, headers: ifm(1), body: { status: "done" } });
  expect([noNote.status, noNote.body.code]).toEqual([422, "adoption_intervention.outcome_required"]);
  const done = await m("PATCH", `${AI}/${iv.body.id}`, {
    session: s.tl,
    headers: ifm(1),
    body: { status: "done", outcomeNote: "Synthetic: 40 trained" },
  });
  expect([done.status, done.body.status]).toEqual([200, "done"]);

  // ------------------------------------------------------------------ involvement and constraints (B0116)
  const decision = await m("POST", "/api/v1/decisions", {
    session: s.tl,
    body: {
      transformationId: b.transformationId,
      title: "Synthetic design decision: CRM rollout",
      ownerUserId: b.users.tl.id,
      tomDimensionCode: "technology",
      options: [{ title: "Big bang" }, { title: "Phased" }],
    },
  });
  expect(decision.status, JSON.stringify(decision.body)).toBe(201);
  const IV = `${b.base}/stakeholder-involvements`;
  const inv = await m("POST", IV, {
    session: s.tl,
    body: { stakeholderGroupId: group.body.id, decisionId: decision.body.id, note: "Synthetic: joined the review" },
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const wd = await m("POST", `${IV}/${inv.body.id}/withdraw`, { session: s.tl, body: { reason: "Synthetic mistake" } });
  expect([wd.status, wd.body.withdrawsInvolvementId]).toEqual([201, inv.body.id]);
  const twice = await m("POST", `${IV}/${inv.body.id}/withdraw`, {
    session: s.tl,
    body: { reason: "Synthetic again" },
  });
  expect([twice.status, twice.body.code]).toEqual([422, "stakeholder_involvement.already_withdrawn"]);
  expect((await m("GET", `${IV}?decisionId=${decision.body.id}`, { session: s.auditor })).status).toBe(200);

  const CC = `${b.base}/champion-constraints`;
  const notMine = await m("POST", CC, {
    session: s.bo,
    body: { championId: champ.body.id, decisionId: decision.body.id, constraintText: "Synthetic constraint" },
  });
  expect([notMine.status, notMine.body.code]).toEqual([403, "champion_constraint.not_champion"]);
  const cc = await m("POST", CC, {
    session: wl.session,
    body: {
      championId: champ.body.id,
      decisionId: decision.body.id,
      constraintText: "Synthetic: field has no laptops",
    },
  });
  expect(cc.status, JSON.stringify(cc.body)).toBe(201);
  const onDecision = await m("GET", `${CC}?decisionId=${decision.body.id}`, { session: s.auditor });
  expect([onDecision.status, onDecision.body.items.map((x: { id: string }) => x.id)]).toEqual([200, [cc.body.id]]);
  const addressed = await m("POST", `${CC}/${cc.body.id}/resolve`, {
    session: s.tl,
    headers: ifm(1),
    body: { outcome: "addressed", responseText: "Synthetic: tablets ordered" },
  });
  expect([addressed.status, addressed.body.status]).toEqual([200, "addressed"]);

  // ------------------------------------------------------------------ remove a champion, archive the group
  const removed = await m("POST", `${G}/champions/${boChamp.body.id}/remove`, { session: s.tl, headers: ifm(1) });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
  const archived = await m("POST", `${G}/archive`, {
    session: s.tl,
    headers: ifm(2),
    body: { reason: "Synthetic: team merged" },
  });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
  const frozen = await m("PATCH", G, { session: s.tl, headers: ifm(3), body: { headcount: 3 } });
  expect([frozen.status, frozen.body.code]).toEqual([422, "stakeholder_group.archived"]);
}
