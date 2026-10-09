// The phase catalogue, workspace, guided steps, step evidence and the review queue (T-DG4-BE-L2; ADR-0035 §1, §7 item 3,
// §8, §11; REQ-PB-014, REQ-S04-001, REQ-S04-002 first clause) against a real PostgreSQL:
//   - GET /phases returns exactly six phases in order, names and purposes equal to the playbook's B0021 table and each
//     objective equal to its "Objective:" block (read from docs/source/playbook.md at test time, not from the seed);
//   - each of the six phases shows steps, required evidence, owners (null = Unknown when unassigned) and a review queue;
//   - a step with an unmet completion rule cannot be put in review or accepted (422 phase_step.completion_rule_unmet),
//     and SQL cannot bypass it (the 0051 CHECKs);
//   - the owner cannot accept their own step (403), a non-owner cannot progress it (403);
//   - completing every step of a phase leaves its gate draft (no submission, instance unchanged);
//   - AUD 403 on every write (nothing written), If-Match 428/409, one audit event per mutation.
// All people and records are SYNTHETIC. Accepting a step is a procedural review, not a business approval; nothing here
// submits or decides a gate (G1-G6) or touches the engineering delivery gates DG0-DG7.
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { phaseStep, type PhaseDefinition } from "@mth/shared/schemas";
import { mapP4PhaseStepError } from "../../../src/modules/platform/db-errors.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  seedPhaseWorld,
  startStep,
  verifiedEvidence,
  type PhaseActor,
  type PhaseWorld,
} from "../contract/p4-exercises-be-l.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// ------------------------------------------------------------------------------------------------ the playbook source

const playbook = readFileSync(new URL("../../../../../docs/source/playbook.md", import.meta.url), "utf8");

/** B0021: "| n | NAME | Purpose | Key outputs |" rows, verbatim. */
function b0021(): { name: string; purpose: string; keyOutputs: string }[] {
  const lines = playbook.split("\n");
  const start = lines.findIndex((l) => l.includes("<!-- B0021 table -->"));
  const rows: { name: string; purpose: string; keyOutputs: string }[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith("|")) break;
    const cells = l.split("|").map((c) => c.trim());
    if (cells[1] === "---") continue;
    rows.push({ name: cells[2]!, purpose: cells[3]!, keyOutputs: cells[4]! });
  }
  return rows;
}

/** The "Objective: …" sentence of a block, after the word "Objective:". */
function objective(block: string): string {
  const line = playbook.split("\n").find((l) => l.includes(`<!-- ${block} -->`) && l.startsWith("Objective:"))!;
  return line.replace(/^Objective:\s*/, "").replace(/\s*<!-- B\d+ -->\s*$/, "");
}

const OBJECTIVE_BLOCKS = ["B0027", "B0046", "B0054", "B0068", "B0091", "B0119"];
const PHASES = ["diagnose", "define", "design", "mobilize", "transform", "realize"];
const STEPS_PER_PHASE = [5, 3, 4, 5, 4, 4];

// ------------------------------------------------------------------------------------------------ helpers

type Step = { stepKey: string; status: string; ownerUserId: string | null; version: number; id: string | null };

const S = (p: PhaseWorld, key: string) => `${p.base}/phase-steps/${key}`;

async function stepRowOf(p: PhaseWorld, key: string) {
  return api.db
    .selectFrom("phase_step")
    .selectAll()
    .where("transformation_id", "=", p.transformationId)
    .where("step_key", "=", key)
    .executeTakeFirst();
}

async function workItems(stepId: string, kind: string) {
  return api.db
    .selectFrom("work_item")
    .select(["assignee_user_id", "status", "message_key", "dedupe_key", "link_path"])
    .where("subject_type", "=", "phase_step")
    .where("subject_id", "=", stepId)
    .where("kind", "=", kind)
    .orderBy("assignee_user_id")
    .execute();
}

/** Owner + started + one verified evidence linked + review requested; returns the in-review step (version 3). */
async function toReview(p: PhaseWorld, key: string, owner: PhaseActor = p.tl): Promise<Step> {
  await startStep(send, p, key, owner);
  const evidenceId = await verifiedEvidence(send, p);
  const link = await send("POST", `${S(p, key)}/evidence`, { session: owner.session, body: { evidenceId } });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  const r = await send("POST", `${S(p, key)}/request-review`, { session: owner.session, headers: ifm(1) });
  expect([r.status, r.body.status], JSON.stringify(r.body)).toEqual([200, "in_review"]);
  return r.body as Step;
}

// ------------------------------------------------------------------------------------------------ REQ-PB-014

describe("the phase catalogue (REQ-PB-014)", () => {
  it("GET /phases: exactly six phases in order; names, purposes and key outputs equal B0021; objectives equal the phase blocks", async () => {
    const p = await seedPhaseWorld(api, w);
    const r = await send("GET", "/api/v1/phases", { session: p.tl.session });
    expect(r.status).toBe(200);
    const items = r.body.items as PhaseDefinition[];
    const source = b0021();
    expect(source).toHaveLength(6);
    expect(items.map((i) => [i.code, i.ordinal, i.gateCode])).toEqual(PHASES.map((c, n) => [c, n + 1, `G${n + 1}`]));
    expect(items.map((i) => i.sourceNameEn)).toEqual(source.map((s) => s.name));
    expect(items.map((i) => i.sourcePurposeEn)).toEqual(source.map((s) => s.purpose));
    expect(items.map((i) => i.sourceKeyOutputsEn)).toEqual(source.map((s) => s.keyOutputs));
    expect(items.map((i) => i.sourceObjectiveEn)).toEqual(OBJECTIVE_BLOCKS.map(objective));
    for (const i of items) {
      expect(i.arProvisional).toBe(true);
      expect(String(i.nameAr).length).toBeGreaterThan(0);
      expect(String(i.objectiveAr).length).toBeGreaterThan(0);
    }
    // Any signed-in user, including the read-only auditor; anonymous 401.
    expect((await send("GET", "/api/v1/phases", { session: p.auditor })).status).toBe(200);
    expect((await send("GET", "/api/v1/phases")).status).toBe(401);
    expect((await send("GET", "/api/v1/phases?x=1", { session: p.auditor })).status).toBe(400);
  });

  it("the workspace shows the current phase with its purpose, objective and key outputs, and each phase's gate status", async () => {
    const p = await seedPhaseWorld(api, w);
    const r = await send("GET", `${p.base}/phases`, { session: p.auditor });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.transformationId, r.body.currentPhase]).toEqual([p.transformationId, "diagnose"]);
    const phases = r.body.phases as {
      phase: { code: string; sourcePurposeEn: string; sourceObjectiveEn: string; sourceKeyOutputsEn: string };
      isCurrent: boolean;
      gateStatus: string;
    }[];
    expect(phases.map((x) => [x.phase.code, x.isCurrent, x.gateStatus])).toEqual(
      PHASES.map((c, n) => [c, n === 0, "draft"]),
    );
    expect(phases[0]!.phase.sourcePurposeEn).toBe("Establish fact base");
    expect(phases[0]!.phase.sourceObjectiveEn).toBe(objective("B0027"));
    expect(phases[0]!.phase.sourceKeyOutputsEn).toBe("Current state, root causes, value pools");
    // Outside the scope: 404 (existence is not disclosed); ADM-only (no transformation read) 404 as well.
    expect((await send("GET", `${p.base}/phases`, { session: p.outsider })).status).toBe(404);
    expect((await send("GET", `${p.base}/phases`, { session: p.admin })).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S04-001

describe("guided phase steps (REQ-S04-001)", () => {
  it("each of the six phases shows steps, required evidence, owners (Unknown when unassigned) and a review queue", async () => {
    const p = await seedPhaseWorld(api, w);
    await startStep(send, p, "define.north_star", p.bo);
    const r = await send("GET", `${p.base}/phases`, { session: p.auditor });
    expect(r.status).toBe(200);
    const phases = r.body.phases as {
      phase: { code: string };
      steps: (Step & {
        requiredEvidenceEn: string;
        requiredEvidenceAr: string;
        sourceProcedureEn: string;
        defaultOwnerRoleCode: string;
        reviewerRoleCode: string;
        completionRule: string;
      })[];
      reviewQueueCount: number;
    }[];
    expect(phases.map((x) => x.steps.length)).toEqual(STEPS_PER_PHASE);
    for (const x of phases) {
      expect(x.reviewQueueCount).toBe(0);
      for (const s of x.steps) {
        expect(s.stepKey.startsWith(`${x.phase.code}.`)).toBe(true);
        expect(s.requiredEvidenceEn.length).toBeGreaterThan(0);
        expect(s.requiredEvidenceAr.length).toBeGreaterThan(0);
        expect(s.sourceProcedureEn.length).toBeGreaterThan(0);
        expect(s.reviewerRoleCode).not.toBe(s.defaultOwnerRoleCode);
      }
    }
    // A step without a row: not_started, owner null (Unknown), version 0, never complete.
    const unassigned = phases[0]!.steps[0]!;
    expect([unassigned.status, unassigned.ownerUserId, unassigned.version, unassigned.id]).toEqual([
      "not_started",
      null,
      0,
      null,
    ]);
    const named = phases[1]!.steps.find((s) => s.stepKey === "define.north_star")!;
    expect([named.status, named.ownerUserId]).toEqual(["in_progress", p.bo.id]);
    // The review queue: GET …/phase-steps?status=in_review, and the per-phase count.
    await toReview(p, "diagnose.register_scope_sponsor");
    const after = await send("GET", `${p.base}/phases`, { session: p.auditor });
    expect(after.body.phases.map((x: { reviewQueueCount: number }) => x.reviewQueueCount)).toEqual([1, 0, 0, 0, 0, 0]);
    const queue = await send("GET", `${p.base}/phase-steps?status=in_review`, { session: p.auditor });
    expect(queue.body.items.map((s: Step) => s.stepKey)).toEqual(["diagnose.register_scope_sponsor"]);
    // Version 0 (no row): ETag "0" as the getPhaseStep summary says; the ETagOrZero header admits it (ARCH-R1).
    const one = await send("GET", S(p, "diagnose.assess_performance"), { session: p.auditor });
    expect(phaseStep.safeParse(one.body).success).toBe(true);
    expect([one.status, one.headers.etag, one.body.version, one.body.ownerUserId]).toEqual([200, '"0"', 0, null]);
    expect((await send("GET", S(p, "diagnose.no_such_step"), { session: p.auditor })).status).toBe(404);
    expect((await send("GET", S(p, "Diagnose.bad"), { session: p.auditor })).status).toBe(400);
  });

  it("listPhaseSteps pages in procedure order with phase and status filters", async () => {
    const p = await seedPhaseWorld(api, w);
    const keys: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor === null ? "?limit=7" : `?limit=7&cursor=${cursor}`;
      const r = await send("GET", `${p.base}/phase-steps${q}`, { session: p.auditor });
      expect(r.status).toBe(200);
      keys.push(...r.body.items.map((s: Step) => s.stepKey));
      cursor = r.body.nextCursor;
    } while (cursor !== null);
    expect(keys).toHaveLength(25);
    expect(keys.slice(0, 5).every((k) => k.startsWith("diagnose."))).toBe(true);
    expect(keys.slice(-4).every((k) => k.startsWith("realize."))).toBe(true);
    const realize = await send("GET", `${p.base}/phase-steps?phase=realize`, { session: p.auditor });
    expect(realize.body.items.map((s: Step) => s.stepKey)).toEqual([
      "realize.measure_validate_benefits",
      "realize.correct_gaps",
      "realize.transfer_ownership_controls",
      "realize.sustained_monitoring",
    ]);
    const first = await send("GET", `${p.base}/phase-steps?limit=2`, { session: p.auditor });
    const mixed = await send("GET", `${p.base}/phase-steps?phase=define&cursor=${first.body.nextCursor}`, {
      session: p.auditor,
    });
    expect([mixed.status, mixed.body.errors?.[0]?.code]).toEqual([400, "validation.cursor"]);
  });

  it("an unmet completion rule cannot be put in review or accepted (422); SQL cannot bypass the rule", async () => {
    const p = await seedPhaseWorld(api, w);
    const key = "diagnose.register_scope_sponsor";
    await startStep(send, p, key);
    const unmet = await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([unmet.status, unmet.body.type, unmet.body.code, unmet.body.detail]).toEqual([
      422,
      "urn:mth:problem:validation",
      "phase_step.completion_rule_unmet",
      "The completion rule of this step is not met: at least one verified evidence item must be linked.",
    ]);
    // Unverified evidence does not count.
    const created = await send("POST", `${p.base}/evidence`, {
      session: p.tl.session,
      body: { kind: "note", title: "Synthetic unverified", noteBody: "Synthetic", ownerUserId: p.tl.id },
    });
    const unverified = await send("POST", `${S(p, key)}/evidence`, {
      session: p.tl.session,
      body: { evidenceId: created.body.id },
    });
    expect(unverified.status).toBe(201);
    const still = await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([still.status, still.body.code]).toEqual([422, "phase_step.completion_rule_unmet"]);
    expect((await stepRowOf(p, key))!.status).toBe("in_progress");

    // Met at the request, unmet at acceptance (the verified link removed meanwhile): the accept re-evaluates -> 422.
    const evidenceId = await verifiedEvidence(send, p);
    const link = await send("POST", `${S(p, key)}/evidence`, { session: p.tl.session, body: { evidenceId } });
    const inReview = await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([inReview.status, inReview.body.completionCheck]).toEqual([
      200,
      { rule: "evidence_linked", met: true, facts: { verifiedEvidenceLinks: 1 } },
    ]);
    const removed = await send("POST", `${S(p, key)}/evidence/${link.body.id}/remove`, {
      session: p.tl.session,
      headers: ifm(1),
    });
    expect(removed.status).toBe(200);
    const accept = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(2),
      body: { outcome: "accepted" },
    });
    expect([accept.status, accept.body.code]).toEqual([422, "phase_step.completion_rule_unmet"]);
    expect((await stepRowOf(p, key))!.status).toBe("in_review");

    // The database refuses a complete step without an accepting review and a met check (0051 phase_step_complete_shape).
    await expect(
      sql`UPDATE phase_step SET status = 'complete', completed_at = now(), version = version + 1
          WHERE transformation_id = ${p.transformationId}::uuid AND step_key = ${key}`.execute(api.db),
    ).rejects.toThrow();
    // ...and an in-review step without a met check (phase_step_in_review_checked).
    const other = "diagnose.assess_performance";
    await startStep(send, p, other);
    await expect(
      sql`UPDATE phase_step SET status = 'in_review', review_requested_by = ${p.tl.id}::uuid,
            review_requested_at = now(), completion_check = '{"rule":"evidence_linked","met":false}'::jsonb,
            version = version + 1
          WHERE transformation_id = ${p.transformationId}::uuid AND step_key = ${other}`.execute(api.db),
    ).rejects.toThrow(/phase_step_in_review_checked/);
  });

  it("other completion rules are evaluated server-side (RAID register empty -> 422; no open corrective case -> met)", async () => {
    const p = await seedPhaseWorld(api, w);
    const raid = "transform.manage_raid_decisions";
    await startStep(send, p, raid);
    const r = await send("POST", `${S(p, raid)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([r.status, r.body.detail]).toEqual([
      422,
      "The completion rule of this step is not met: the RAID register is empty.",
    ]);
    for (const [key, text] of [
      ["transform.workstreams_forums", "no meeting has been held"],
      ["transform.track_progress", "no KPI actual has been accepted"],
    ] as const) {
      await startStep(send, p, key);
      const x = await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(1) });
      expect([x.status, x.body.detail]).toEqual([422, `The completion rule of this step is not met: ${text}.`]);
    }
    for (const [key, text] of [
      ["realize.measure_validate_benefits", "no benefit measurement has been validated by Finance"],
      ["realize.transfer_ownership_controls", "no BAU handover has been accepted"],
      ["realize.sustained_monitoring", "the improvement backlog is empty"],
    ] as const) {
      await startStep(send, p, key, p.bo);
      const x = await send("POST", `${S(p, key)}/request-review`, { session: p.bo.session, headers: ifm(1) });
      expect([x.status, x.body.detail]).toEqual([422, `The completion rule of this step is not met: ${text}.`]);
    }
    const gaps = "realize.correct_gaps";
    await startStep(send, p, gaps);
    const ok = await send("POST", `${S(p, gaps)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([ok.status, ok.body.status, ok.body.completionCheck]).toEqual([
      200,
      "in_review",
      { rule: "corrective_cases_owned", met: true, facts: { openCases: 0, openCasesWithoutOwnerOrFollowUp: 0 } },
    ]);
  });

  it("the owner cannot accept their own step (403); a non-owner cannot progress it (403); an owner is required (422)", async () => {
    const p = await seedPhaseWorld(api, w);
    // BO holds both phase_step.progress and phase_step.review: as the owner it still cannot review its own step.
    const key = "define.north_star";
    const step = await toReview(p, key, p.bo);
    const own = await send("POST", `${S(p, key)}/review`, {
      session: p.bo.session,
      headers: ifm(step.version),
      body: { outcome: "accepted" },
    });
    expect([own.status, own.body.code, own.body.detail]).toEqual([
      403,
      "phase_step.reviewer_is_owner",
      "The owner cannot review their own step.",
    ]);
    expect((await stepRowOf(p, key))!.status).toBe("in_review");

    // A non-owner holding phase_step.progress (TO) cannot link evidence or request the review of the TL's step.
    const other = "diagnose.root_causes";
    await startStep(send, p, other);
    const evidenceId = await verifiedEvidence(send, p);
    const link = await send("POST", `${S(p, other)}/evidence`, { session: p.to.session, body: { evidenceId } });
    expect([link.status, link.body.code, link.body.detail]).toEqual([
      403,
      "phase_step.not_owner",
      "Only the owner of this step can do this.",
    ]);
    const req = await send("POST", `${S(p, other)}/request-review`, { session: p.to.session, headers: ifm(1) });
    expect([req.status, req.body.code]).toEqual([403, "phase_step.not_owner"]);

    // A step started without an owner cannot be put in review.
    const ownerless = "diagnose.value_pools";
    const started = await send("PATCH", S(p, ownerless), {
      session: p.tl.session,
      headers: ifm(0),
      body: { start: true },
    });
    expect([started.status, started.body.ownerUserId]).toEqual([200, null]);
    const noOwner = await send("POST", `${S(p, ownerless)}/request-review`, { session: p.tl.session, headers: ifm(1) });
    expect([noOwner.status, noOwner.body.code, noOwner.body.detail]).toEqual([
      422,
      "phase_step.owner_required",
      "Assign an owner before the step can be reviewed.",
    ]);
  });

  it("the review queue: one task per reviewer-role holder (never the owner); accept closes them and enables the next owned step once", async () => {
    const p = await seedPhaseWorld(api, w);
    const key = "diagnose.register_scope_sponsor";
    const next = "diagnose.assess_performance";
    // The next step has an owner (the WL, a synthetic person), so accepting this step creates its task.
    const nextOwned = await send("PATCH", S(p, next), {
      session: p.tl.session,
      headers: ifm(0),
      body: { ownerUserId: p.wl.id },
    });
    expect(nextOwned.status).toBe(200);
    const step = await toReview(p, key);
    const items = await workItems(step.id!, "phase_step_review");
    const assignees = items.map((i) => i.assignee_user_id);
    // Every holder of the reviewer role (TO) with phase_step.review on the transformation: this TO and the org TO.
    expect(assignees).toEqual([p.to.id, w.office.id].sort());
    expect(assignees).not.toContain(p.tl.id);
    for (const i of items) {
      expect([i.status, i.message_key, i.link_path]).toEqual([
        "open",
        "gates.task.phase_step_review",
        `/transformations/${p.transformationId}/phases/diagnose/steps/${key}`,
      ]);
    }
    const accepted = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(step.version),
      body: { outcome: "accepted", note: "Synthetic: evidence checked" },
    });
    expect([accepted.status, accepted.body.status, accepted.body.reviewedBy, accepted.body.reviewOutcome]).toEqual([
      200,
      "complete",
      p.to.id,
      "accepted",
    ]);
    expect(accepted.body.completedAt).not.toBeNull();
    const closed = await workItems(step.id!, "phase_step_review");
    expect(closed.map((i) => [i.assignee_user_id, i.status])).toEqual(
      [
        [p.to.id, "done"],
        [w.office.id, "cancelled"],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );
    const enabled = await workItems(nextOwned.body.id, "phase_step_enabled");
    expect(enabled.map((i) => [i.assignee_user_id, i.dedupe_key, i.message_key])).toEqual([
      [p.wl.id, `phase_step_next:${step.id}`, "gates.task.phase_step_enabled"],
    ]);
    // The audit trail of the step: create, update (start), request_review, accept: one event per mutation.
    expect((await auditOf(api.db, step.id!)).map((e) => e.action)).toEqual([
      "phase_step.create",
      "phase_step.request_review",
      "phase_step.accept",
    ]);
    // A complete step is final: its evidence is frozen and it cannot be reviewed again.
    const evidenceId = await verifiedEvidence(send, p);
    const late = await send("POST", `${S(p, key)}/evidence`, { session: p.tl.session, body: { evidenceId } });
    expect([late.status, late.body.code, late.body.detail]).toEqual([
      422,
      "phase_step.complete",
      "This step is complete; its evidence can no longer change.",
    ]);
    const again = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(accepted.body.version),
      body: { outcome: "accepted" },
    });
    expect([again.status, again.body.type, again.body.code, again.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "phase_step.invalid_transition",
      "A step moves from complete to complete only as the phase procedure allows.",
    ]);
    // The next step without an owner (no row: owner Unknown) gets no task.
    const fourth = await toReview(p, "diagnose.root_causes");
    const ok = await send("POST", `${S(p, "diagnose.root_causes")}/review`, {
      session: p.to.session,
      headers: ifm(fourth.version),
      body: { outcome: "accepted" },
    });
    expect(ok.status).toBe(200);
    expect(await stepRowOf(p, "diagnose.value_pools")).toBeUndefined();
    const none = await api.db
      .selectFrom("work_item")
      .select("id")
      .where("dedupe_key", "=", `phase_step_next:${fourth.id}`)
      .execute();
    expect(none).toEqual([]);
  });

  it("return with a note, then back to review; a return without a note is 400; invalid transitions are 422", async () => {
    const p = await seedPhaseWorld(api, w);
    const key = "define.outcome_hierarchy";
    const step = await toReview(p, key);
    const noNote = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(step.version),
      body: { outcome: "returned" },
    });
    expect([noNote.status, noNote.body.code, noNote.body.errors?.[0]?.pointer, noNote.body.detail]).toEqual([
      400,
      "phase_step.return_note_required",
      "/note",
      "A note is required to return a step.",
    ]);
    const blank = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(step.version),
      body: { outcome: "returned", note: "   " },
    });
    expect(blank.status).toBe(400);
    const returned = await send("POST", `${S(p, key)}/review`, {
      session: p.to.session,
      headers: ifm(step.version),
      body: { outcome: "returned", note: "Synthetic: link the signed outcome tree" },
    });
    expect([returned.status, returned.body.status, returned.body.reviewNote]).toEqual([
      200,
      "returned",
      "Synthetic: link the signed outcome tree",
    ]);
    // Owner changes and restarts are refused with the exact transition text.
    const restart = await send("PATCH", S(p, key), {
      session: p.tl.session,
      headers: ifm(returned.body.version),
      body: { start: true },
    });
    expect([restart.status, restart.body.code, restart.body.detail]).toEqual([
      422,
      "phase_step.invalid_transition",
      "A step moves from returned to in_progress only as the phase procedure allows.",
    ]);
    const back = await send("POST", `${S(p, key)}/request-review`, {
      session: p.tl.session,
      headers: ifm(returned.body.version),
    });
    expect([back.status, back.body.status, back.body.reviewOutcome, back.body.reviewNote]).toEqual([
      200,
      "in_review",
      null,
      null,
    ]);
    const swap = await send("PATCH", S(p, key), {
      session: p.tl.session,
      headers: ifm(back.body.version),
      body: { ownerUserId: p.bo.id },
    });
    expect([swap.status, swap.body.code]).toEqual([422, "phase_step.invalid_transition"]);
    const notInReview = "define.outcomes_kpis_guardrails";
    await startStep(send, p, notInReview);
    const early = await send("POST", `${S(p, notInReview)}/review`, {
      session: p.to.session,
      headers: ifm(1),
      body: { outcome: "accepted" },
    });
    expect([early.status, early.body.detail]).toEqual([
      422,
      "A step moves from in_progress to complete only as the phase procedure allows.",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S04-002 (first clause)

describe("steps never move a gate (REQ-S04-002: completing every phase task leaves the gate Draft)", () => {
  it("completing all five Diagnose steps leaves G1 draft, with no submission and an unchanged gate instance", async () => {
    const p = await seedPhaseWorld(api, w);
    const g1 = () =>
      api.db
        .selectFrom("gate_instance")
        .selectAll()
        .where("transformation_id", "=", p.transformationId)
        .where("gate_code", "=", "G1")
        .executeTakeFirstOrThrow();
    const before = await g1();
    const ws0 = await send("GET", `${p.base}/phases`, { session: p.auditor });
    const keys = ws0.body.phases[0].steps.map((s: Step) => s.stepKey) as string[];
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      const step = await toReview(p, key);
      const ok = await send("POST", `${S(p, key)}/review`, {
        session: p.to.session,
        headers: ifm(step.version),
        body: { outcome: "accepted" },
      });
      expect([ok.status, ok.body.status]).toEqual([200, "complete"]);
    }
    const after = await g1();
    expect(after.status).toBe("draft");
    expect([after.version, after.updated_at.toISOString()]).toEqual([before.version, before.updated_at.toISOString()]);
    const submissions = await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(submissions).toEqual([]);
    const ws = await send("GET", `${p.base}/phases`, { session: p.auditor });
    expect([ws.body.currentPhase, ws.body.phases[0].gateStatus]).toEqual(["diagnose", "draft"]);
    expect(ws.body.phases[0].steps.every((s: Step) => s.status === "complete")).toBe(true);
    const t = await api.db
      .selectFrom("transformation")
      .select("current_phase")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    expect(t.current_phase).toBe("diagnose");
  });
});

// ------------------------------------------------------------------------------------------------ S-4

describe("authorization, If-Match and audit on every write (S-4)", () => {
  it("AUD (read-only) gets 403 on every write and nothing is written; an outsider gets 404", async () => {
    const p = await seedPhaseWorld(api, w);
    const key = "diagnose.register_scope_sponsor";
    const step = await toReview(p, key);
    const link = (await send("GET", `${S(p, key)}/evidence`, { session: p.auditor })).body.items[0] as {
      id: string;
      version: number;
    };
    const evidenceId = await verifiedEvidence(send, p);
    const writes: [string, string, Record<string, unknown> | undefined, number][] = [
      ["PATCH", S(p, "diagnose.root_causes"), { start: true }, 0],
      ["POST", `${S(p, key)}/request-review`, undefined, step.version],
      ["POST", `${S(p, key)}/review`, { outcome: "accepted" }, step.version],
      ["POST", `${S(p, key)}/evidence`, { evidenceId }, -1],
      ["POST", `${S(p, key)}/evidence/${link.id}/remove`, undefined, link.version],
    ];
    for (const [method, url, body, version] of writes) {
      const headers = version >= 0 ? ifm(version) : {};
      const r = await send(method, url, { session: p.auditor, headers, ...(body ? { body } : {}) });
      expect([url, r.status]).toEqual([url, 403]);
      const o = await send(method, url, { session: p.outsider, headers, ...(body ? { body } : {}) });
      expect([url, o.status]).toEqual([url, 404]);
    }
    expect(await stepRowOf(p, "diagnose.root_causes")).toBeUndefined();
    const row = await stepRowOf(p, key);
    expect([row!.status, row!.version]).toEqual(["in_review", step.version]);
    const links = await api.db
      .selectFrom("phase_step_evidence")
      .select(["status"])
      .where("phase_step_id", "=", row!.id)
      .execute();
    expect(links.map((l) => l.status)).toEqual(["active"]);
  });

  it('If-Match: 428 when missing, 409 when stale; If-Match "0" on an existing row is 409; creates are version 1', async () => {
    const p = await seedPhaseWorld(api, w);
    const key = "design.compare_states";
    const missing = await send("PATCH", S(p, key), { session: p.tl.session, body: { ownerUserId: p.tl.id } });
    expect(missing.status).toBe(428);
    const stale0 = await send("PATCH", S(p, key), { session: p.tl.session, headers: ifm(3), body: { start: true } });
    expect([stale0.status, stale0.body.code]).toEqual([409, "version_conflict"]);
    const created = await send("PATCH", S(p, key), {
      session: p.tl.session,
      headers: ifm(0),
      body: { ownerUserId: p.tl.id },
    });
    expect([created.status, created.body.version, created.headers.etag]).toEqual([200, 1, '"1"']);
    const twice = await send("PATCH", S(p, key), { session: p.tl.session, headers: ifm(0), body: { start: true } });
    expect([twice.status, twice.body.code, twice.body.currentVersion]).toEqual([409, "version_conflict", 1]);
    const empty = await send("PATCH", S(p, key), { session: p.tl.session, headers: ifm(1), body: {} });
    expect(empty.status).toBe(400);
    const unknownUser = await send("PATCH", S(p, key), {
      session: p.tl.session,
      headers: ifm(1),
      body: { ownerUserId: w.officeB.id },
    });
    expect([unknownUser.status, unknownUser.body.code]).toEqual([422, "validation.user_invalid"]);
    const started = await send("PATCH", S(p, key), { session: p.tl.session, headers: ifm(1), body: { start: true } });
    expect([started.status, started.body.status, started.body.version]).toEqual([200, "in_progress", 2]);
    const startAgain = await send("PATCH", S(p, key), {
      session: p.tl.session,
      headers: ifm(2),
      body: { start: true },
    });
    expect([startAgain.status, startAgain.body.detail]).toEqual([
      422,
      "A step moves from in_progress to in_progress only as the phase procedure allows.",
    ]);
    expect((await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session })).status).toBe(428);
    expect((await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(1) })).status).toBe(
      409,
    );
    const evidenceId = await verifiedEvidence(send, p);
    const link = await send("POST", `${S(p, key)}/evidence`, { session: p.tl.session, body: { evidenceId } });
    expect([link.status, link.body.version, link.headers.location]).toEqual([
      201,
      1,
      `${S(p, key)}/evidence/${link.body.id}`,
    ]);
    const R = `${S(p, key)}/evidence/${link.body.id}/remove`;
    expect((await send("POST", R, { session: p.tl.session })).status).toBe(428);
    expect((await send("POST", R, { session: p.tl.session, headers: ifm(2) })).status).toBe(409);
    const inReview = await send("POST", `${S(p, key)}/request-review`, { session: p.tl.session, headers: ifm(2) });
    expect(inReview.status).toBe(200);
    const rv = `${S(p, key)}/review`;
    expect((await send("POST", rv, { session: p.to.session, body: { outcome: "accepted" } })).status).toBe(428);
    expect(
      (await send("POST", rv, { session: p.to.session, headers: ifm(2), body: { outcome: "accepted" } })).status,
    ).toBe(409);
    const foreign = await send("POST", `${S(p, "design.ten_dimension_tom")}/evidence`, {
      session: p.tl.session,
      body: { evidenceId },
    });
    expect([foreign.status, foreign.body.code]).toEqual([403, "phase_step.not_owner"]);
    // Audit: one event per successful mutation of the step and of the link.
    expect((await auditOf(api.db, created.body.id)).map((e) => e.action)).toEqual([
      "phase_step.create",
      "phase_step.update",
      "phase_step.request_review",
    ]);
    expect((await auditOf(api.db, link.body.id)).map((e) => e.action)).toEqual(["phase_step_evidence.link"]);
  });

  it("an evidence item of another transformation cannot be linked (422)", async () => {
    const p = await seedPhaseWorld(api, w);
    const q = await seedPhaseWorld(api, w);
    const key = "diagnose.root_causes";
    await startStep(send, p, key);
    const theirs = await verifiedEvidence(send, q);
    const r = await send("POST", `${S(p, key)}/evidence`, { session: p.tl.session, body: { evidenceId: theirs } });
    expect([r.status, r.body.code]).toEqual([422, "validation.reference"]);
  });
});

// ------------------------------------------------------------------------------------------------ db-errors (BE-L2 block)

describe("the 0051 phase-step guards map to the ADR-0035 §11 problems (a race never surfaces as a 500)", () => {
  it("maps each guard a concurrent write can hit, and leaves other constraints to the generic mapping", () => {
    const map = (constraint: string, message = "") => mapP4PhaseStepError({ code: "23514", constraint, message });
    expect([map("phase_step_key")?.status, map("phase_step_key")?.code]).toEqual([409, "version_conflict"]);
    const t = map("phase_step_status_step", "phase_step: in_progress -> complete is not an allowed transition");
    expect([t?.status, t?.code, t?.detail]).toEqual([
      422,
      "phase_step.invalid_transition",
      "A step moves from in_progress to complete only as the phase procedure allows.",
    ]);
    expect(map("phase_step_reviewer_separate")?.code).toBe("phase_step.reviewer_is_owner");
    expect([map("phase_step_returned_note")?.status, map("phase_step_returned_note")?.code]).toEqual([
      400,
      "phase_step.return_note_required",
    ]);
    expect([map("phase_step_evidence_active_key")?.status, map("phase_step_evidence_active_key")?.code]).toEqual([
      409,
      "phase_step_evidence.exists",
    ]);
    expect(map("phase_step_evidence_step_open")?.code).toBe("phase_step.complete");
    expect(map("phase_step_complete_shape")?.status).toBe(500);
    expect(map("some_other_constraint")).toBeNull();
  });
});
