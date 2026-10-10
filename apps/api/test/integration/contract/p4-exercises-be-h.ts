// P4 contract exercises of BE-H (T-DG4-BE-H; p4-work-split §F+G FG.1, §1 S-10): the 19 slice F operations of the T13
// Stakeholder & Adoption Plan, champions, interventions, impacted-team involvement and champion constraints. Every call
// goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the
// zod mirror in P4_MIRRORS_BE_H. BE-H2 (T-DG4-BE-H2) appends its 17 forms, invitations, assessment and training
// exercises to this file after BE-H (no new seam file). All data is synthetic; nothing here grants a business or Finance approval or touches
// the engineering gates DG0-DG7.
import {
  adoptionIntervention,
  adoptionInterventionPage,
  adoptionPlan,
  assessmentForm,
  assessmentFormPage,
  assessmentFormVersion,
  assessmentInvitation,
  assessmentInvitationList,
  assessmentInvitationPage,
  assessmentRecord,
  assessmentRecordPage,
  championConstraint,
  championConstraintPage,
  stakeholderChampion,
  stakeholderChampionPage,
  stakeholderGroup,
  stakeholderGroupPage,
  stakeholderInvolvement,
  stakeholderInvolvementPage,
  trainingRecord,
  trainingRecordPage,
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
  // T-DG4-BE-H2: forms, invitations, assessment records and training records.
  listAssessmentForms: assessmentFormPage,
  createAssessmentForm: assessmentForm,
  getAssessmentForm: assessmentForm,
  // T-DG4-BE-R4 (ADR-0033 amendment V1): one question version of a form.
  getAssessmentFormVersion: assessmentFormVersion,
  updateAssessmentForm: assessmentForm,
  publishAssessmentForm: assessmentForm,
  retireAssessmentForm: assessmentForm,
  listAssessmentInvitations: assessmentInvitationPage,
  createAssessmentInvitations: assessmentInvitationList,
  cancelAssessmentInvitation: assessmentInvitation,
  listAssessmentRecords: assessmentRecordPage,
  createAssessmentRecord: assessmentRecord,
  getAssessmentRecord: assessmentRecord,
  reviewAssessmentRecord: assessmentRecord,
  withdrawAssessmentRecord: assessmentRecord,
  listTrainingRecords: trainingRecordPage,
  createTrainingRecord: trainingRecord,
  updateTrainingRecord: trainingRecord,
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

  // T-DG4-BE-H2 (appended after BE-H, p4-work-split §F+G FG.2): forms, invitations, records and training.
  await exerciseP4BeH2Operations(ctx, b, wl);
}

/**
 * The 17 operations of T-DG4-BE-H2 (ADR-0033 §5, §6, §9, §10): feedback and assessment forms with their versions,
 * invitations, assessment records (responses and proficiency observations) and training records. Synthetic data only.
 */
async function exerciseP4BeH2Operations(
  ctx: P4ExerciseContext,
  b: Awaited<ReturnType<typeof seedBenefitWorld>>,
  wl: Awaited<ReturnType<typeof extraUser>>,
): Promise<void> {
  const m = ctx.mirrored;
  const s = b.s;
  const group = await m("POST", `${b.base}/stakeholder-groups`, {
    session: s.tl,
    body: {
      name: "Synthetic branch advisers",
      impact: "M",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: book appointments in the new tool",
      interventionTypes: ["training"],
      ownerUserId: wl.id,
    },
  });
  expect(group.status, JSON.stringify(group.body)).toBe(201);
  const groupId = group.body.id as string;

  // ------------------------------------------------------------------ forms (ADR-0033 §5)
  const AF = `${b.base}/assessment-forms`;
  const schema = {
    questions: [
      {
        key: "can_book",
        type: "yes_no",
        label_en: "Booked an appointment unaided?",
        label_ar: "هل حجز موعداً دون مساعدة؟",
        required: true,
        proficiency: true,
      },
    ],
  };
  const bad = await m("POST", AF, {
    session: s.bo,
    body: {
      kind: "proficiency_assessment",
      name: "Synthetic",
      schema: { questions: [{ ...schema.questions[0], x: 1 }] },
    },
  });
  expect([bad.status, bad.body.code, bad.body.errors[0].pointer]).toEqual([
    400,
    "assessment_form.schema_invalid",
    "/schema/questions/0/x",
  ]);
  const form = await m("POST", AF, {
    session: s.bo,
    body: {
      kind: "proficiency_assessment",
      name: "Synthetic booking proficiency",
      stakeholderGroupId: groupId,
      schema,
    },
  });
  expect([form.status, form.body.status, form.body.currentVersion.versionNo]).toEqual([201, "draft", 1]);
  const F = `${AF}/${form.body.id}`;
  expect((await m("GET", AF, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", F, { session: s.auditor })).status).toBe(200);
  const draftResponse = await m("POST", `${b.base}/assessment-records`, {
    session: s.bo,
    body: {
      formId: form.body.id,
      stakeholderGroupId: groupId,
      subjectUserId: b.users.fin.id,
      observedOn: "2026-10-08",
      answers: { can_book: true },
    },
  });
  expect([draftResponse.status, draftResponse.body.code]).toEqual([422, "assessment_form.not_published"]);
  const renamed = await m("PATCH", F, { session: s.bo, headers: ifm(2), body: { description: "Synthetic" } });
  expect([renamed.status, renamed.body.version]).toEqual([200, 3]);
  const published = await m("POST", `${F}/publish`, { session: s.bo, headers: ifm(3) });
  expect([published.status, published.body.status, published.body.publishedVersionNo]).toEqual([200, "published", 1]);
  // getAssessmentFormVersion (ADR-0033 amendment V1): the append-only version row, no ETag; 404 for a version the form
  // does not have, and outside scope (ADM-only).
  const v1 = await m("GET", `${F}/versions/1`, { session: s.auditor });
  expect([v1.status, v1.headers.etag, v1.body]).toEqual([200, undefined, form.body.currentVersion]);
  const v9 = await m("GET", `${F}/versions/99`, { session: s.auditor });
  expect([v9.status, v9.body.code]).toEqual([404, "not_found"]);
  expect((await m("GET", `${F}/versions/1`, { session: s.admin })).status).toBe(404);

  // ------------------------------------------------------------------ invitations
  const inv = await m("POST", `${F}/invitations`, {
    session: s.bo,
    body: { userIds: [b.users.fin.id, b.users.tl.id], stakeholderGroupId: groupId, subjectUserId: wl.id },
  });
  expect([inv.status, inv.body.items.length]).toEqual([201, 2]);
  const dupInv = await m("POST", `${F}/invitations`, {
    session: s.bo,
    body: { userIds: [b.users.fin.id], stakeholderGroupId: groupId, subjectUserId: wl.id },
  });
  expect([dupInv.status, dupInv.body.code]).toEqual([409, "assessment_invitation.exists"]);
  expect((await m("GET", `${F}/invitations`, { session: s.auditor })).status).toBe(200);
  const tlInv = inv.body.items.find((i: { userId: string }) => i.userId === b.users.tl.id);
  const cancelled = await m("POST", `${b.base}/assessment-invitations/${tlInv.id}/cancel`, {
    session: s.bo,
    headers: ifm(1),
  });
  expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);

  // ------------------------------------------------------------------ records (REQ-S11-002)
  const AR = `${b.base}/assessment-records`;
  const notInvited = await m("POST", AR, {
    session: s.tl,
    body: {
      formId: form.body.id,
      stakeholderGroupId: groupId,
      subjectUserId: wl.id,
      observedOn: "2026-10-08",
      answers: { can_book: true },
    },
  });
  expect([notInvited.status, notInvited.body.code]).toEqual([403, "assessment_record.not_invited"]);
  const rec = await m("POST", AR, {
    session: s.fin,
    body: {
      formId: form.body.id,
      stakeholderGroupId: groupId,
      subjectUserId: wl.id,
      observedOn: "2026-10-08",
      answers: { can_book: true },
    },
  });
  expect([rec.status, rec.body.stakeholderGroupId, rec.body.proficiencyResult]).toEqual([201, groupId, "proficient"]);
  expect((await m("GET", `${AR}?stakeholderGroupId=${groupId}`, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", `${AR}/${rec.body.id}`, { session: s.auditor })).status).toBe(200);
  const reviewed = await m("POST", `${AR}/${rec.body.id}/review`, {
    session: s.bo,
    headers: ifm(1),
    body: { note: "Synthetic: confirmed" },
  });
  expect([reviewed.status, reviewed.body.status]).toEqual([200, "reviewed"]);
  const notMine = await m("POST", `${AR}/${rec.body.id}/withdraw`, {
    session: s.tl,
    headers: ifm(2),
    body: { reason: "Synthetic" },
  });
  expect([notMine.status, notMine.body.code]).toEqual([403, "assessment_record.not_withdrawable_by_caller"]);
  const withdrawn = await m("POST", `${AR}/${rec.body.id}/withdraw`, {
    session: s.fin,
    headers: ifm(2),
    body: { reason: "Synthetic: observed the wrong week" },
  });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
  const retired = await m("POST", `${F}/retire`, { session: s.bo, headers: ifm(4) });
  expect([retired.status, retired.body.status]).toEqual([200, "retired"]);

  // ------------------------------------------------------------------ training (REQ-PB-072)
  const TR = `${b.base}/training-records`;
  const tr = await m("POST", TR, {
    session: s.bo,
    body: { stakeholderGroupId: groupId, participantUserId: b.users.fin.id, trainingTitle: "Synthetic booking tool" },
  });
  expect([tr.status, tr.body.status]).toEqual([201, "enrolled"]);
  const noDate = await m("PATCH", `${TR}/${tr.body.id}`, {
    session: s.bo,
    headers: ifm(1),
    body: { status: "completed" },
  });
  expect([noDate.status, noDate.body.errors[0].pointer]).toEqual([400, "/completedOn"]);
  const completed = await m("PATCH", `${TR}/${tr.body.id}`, {
    session: s.bo,
    headers: ifm(1),
    body: { status: "completed", completedOn: "2026-10-09" },
  });
  expect([completed.status, completed.body.status]).toEqual([200, "completed"]);
  expect((await m("GET", `${TR}?stakeholderGroupId=${groupId}`, { session: s.auditor })).status).toBe(200);
}
