// The continuous-improvement backlog (T-DG4-BE-I2; ADR-0034 §8, §9, §12; REQ-PB-084, REQ-S11-008). Proves, against the
// run's disposable PostgreSQL:
//  - REQ-PB-084 A11 "CI backlog items remain visible after transformation closure": after the transformation is closed
//    (SYNTHETIC direct closure-record fixture, BE-I's closeTransformationSynthetic, until BE-J routes closeTransformation),
//    listImprovementItems still returns the items, and they stay editable (update, move, close) and creatable; the
//    listing is the read slice H's G6 evaluator consumes ("G6 lists the backlog" is slice H's);
//  - create (BO, TO) with a CI-nn code, its source (manual, or a lesson / control check / review / handover of the same
//    transformation: 400 validation.required without sourceId, 400 validation.not_applicable with one for manual, 422
//    validation.reference for another transformation's record); AUD/WL 403, ADM-only and outsider 404;
//  - the status machine: open -> in_progress -> open -> done; done and rejected need a resolution note (400
//    improvement_item.resolution_note_required at /resolutionNote, nothing written) and are final (422
//    improvement_item.final, exact text); If-Match 428/409; one audit event per mutation.
// All data is SYNTHETIC; nothing here approves anything, and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  areaInBau,
  closeTransformationSynthetic,
  createArea,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const itemsOf = (x: SustainmentWorld) => `${x.b.base}/improvement-items`;

async function newItem(x: SustainmentWorld, body: Record<string, unknown> = {}) {
  const r = await send("POST", itemsOf(x), {
    session: x.to.session,
    body: { title: "Synthetic: automate the churn extract", sourceKind: "manual", ...body },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; status: string };
}

describe("create (ADR-0034 §8)", () => {
  it("BO and TO create with CI-nn and version 1, audited; a handover-sourced item names its handover", async () => {
    const { area, handover } = await areaInBau(api, s);
    const a = await newItem(s, { performanceAreaId: area.id, priority: "H", targetDate: "2026-12-31" });
    expect([a.code.startsWith("CI-"), a.version, a.status]).toEqual([true, 1, "open"]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual(["improvement_item.create"]);
    const b = await send("POST", itemsOf(s), {
      session: s.b.s.bo,
      body: {
        title: "Synthetic: SOP gap",
        sourceKind: "handover",
        sourceId: handover.id,
        ownerUserId: s.b.users.bo.id,
      },
    });
    expect([b.status, b.body.sourceKind, b.body.sourceId, b.body.ownerUserId]).toEqual([
      201,
      "handover",
      handover.id,
      s.b.users.bo.id,
    ]);
    const list = await send("GET", `${itemsOf(s)}?performanceAreaId=${area.id}`, { session: s.b.s.auditor });
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
  });

  it("source rules: sourceId required unless manual, not applicable for manual, must be in this transformation", async () => {
    const noId = await send("POST", itemsOf(s), { session: s.to.session, body: { title: "x", sourceKind: "lesson" } });
    expect([noId.status, noId.body.errors[0].pointer, noId.body.errors[0].code]).toEqual([
      400,
      "/sourceId",
      "validation.required",
    ]);
    const manual = await send("POST", itemsOf(s), {
      session: s.to.session,
      body: { title: "x", sourceKind: "manual", sourceId: crypto.randomUUID() },
    });
    expect([manual.status, manual.body.errors[0].code]).toEqual([400, "validation.not_applicable"]);
    const foreign = await send("POST", itemsOf(s), {
      session: s.to.session,
      body: { title: "x", sourceKind: "review", sourceId: crypto.randomUUID() },
    });
    expect([foreign.status, foreign.body.code, foreign.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/sourceId",
    ]);
  });

  it("AUD, WL and FIN 403; ADM-only and an outsider 404", async () => {
    const body = { title: "Synthetic", sourceKind: "manual" };
    for (const session of [s.b.s.auditor, s.wl.session, s.b.s.fin])
      expect((await send("POST", itemsOf(s), { session, body })).status).toBe(403);
    for (const session of [s.b.s.admin, s.b.s.outsider]) {
      expect((await send("POST", itemsOf(s), { session, body })).status).toBe(404);
      expect((await send("GET", itemsOf(s), { session })).status).toBe(404);
    }
  });
});

describe("the status machine (ADR-0034 §8, §12)", () => {
  it("open -> in_progress -> open -> done with a note; final afterwards; If-Match 428/409; audited", async () => {
    const it0 = await newItem(s);
    const I = `${itemsOf(s)}/${it0.id}`;
    expect((await send("PATCH", I, { session: s.to.session, body: { status: "in_progress" } })).status).toBe(428);
    expect(
      (await send("PATCH", I, { session: s.to.session, headers: ifm(5), body: { status: "in_progress" } })).status,
    ).toBe(409);
    expect(
      (await send("PATCH", I, { session: s.b.s.auditor, headers: ifm(1), body: { status: "in_progress" } })).status,
    ).toBe(403);
    const p = await send("PATCH", I, { session: s.to.session, headers: ifm(1), body: { status: "in_progress" } });
    expect([p.status, p.body.status, p.body.version]).toEqual([200, "in_progress", 2]);
    const back = await send("PATCH", I, { session: s.to.session, headers: ifm(2), body: { status: "open" } });
    expect([back.status, back.body.status]).toEqual([200, "open"]);
    const noNote = await send("PATCH", I, { session: s.b.s.bo, headers: ifm(3), body: { status: "done" } });
    expect([noNote.status, noNote.body.errors]).toEqual([
      400,
      [
        {
          pointer: "/resolutionNote",
          code: "improvement_item.resolution_note_required",
          message: "Record a resolution note before closing the item.",
        },
      ],
    ]);
    const noteOnly = await send("PATCH", I, {
      session: s.b.s.bo,
      headers: ifm(3),
      body: { resolutionNote: "Synthetic" },
    });
    expect([noteOnly.status, noteOnly.body.errors[0].code]).toEqual([400, "validation.not_applicable"]);
    const done = await send("PATCH", I, {
      session: s.b.s.bo,
      headers: ifm(3),
      body: { status: "done", resolutionNote: "Synthetic: extract automated" },
    });
    expect([done.status, done.body.status, done.body.resolvedBy, done.body.resolutionNote]).toEqual([
      200,
      "done",
      s.b.users.bo.id,
      "Synthetic: extract automated",
    ]);
    const final = await send("PATCH", I, { session: s.b.s.bo, headers: ifm(4), body: { title: "Synthetic again" } });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "improvement_item.final",
      "This improvement item is done and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, it0.id)).map((e) => e.action)).toEqual([
      "improvement_item.create",
      "improvement_item.update",
      "improvement_item.update",
      "improvement_item.done",
    ]);
  });

  it("rejected needs a note and is final too", async () => {
    const it0 = await newItem(s);
    const I = `${itemsOf(s)}/${it0.id}`;
    const rej = await send("PATCH", I, {
      session: s.to.session,
      headers: ifm(1),
      body: { status: "rejected", resolutionNote: "Synthetic: out of scope" },
    });
    expect([rej.status, rej.body.status]).toEqual([200, "rejected"]);
    const again = await send("PATCH", I, { session: s.to.session, headers: ifm(2), body: { status: "open" } });
    expect([again.status, again.body.detail]).toEqual([
      422,
      "This improvement item is rejected and can no longer be changed.",
    ]);
  });
});

describe("REQ-PB-084 A11: the backlog stays visible and editable after the transformation is closed", () => {
  it("after closure: listed, edited, closed and created as before; the transformation is closed, not archived", async () => {
    const x = await seedSustainmentWorld(api, w);
    const area = await createArea(send, x);
    const open = await newItem(x, { performanceAreaId: area.id });
    const inProgress = await newItem(x);
    expect(
      (
        await send("PATCH", `${itemsOf(x)}/${inProgress.id}`, {
          session: x.to.session,
          headers: ifm(1),
          body: { status: "in_progress" },
        })
      ).status,
    ).toBe(200);
    await closeTransformationSynthetic(api, x.b);
    const t = await api.db
      .selectFrom("transformation")
      .select(["status", "archived_at"])
      .where("id", "=", x.b.transformationId)
      .executeTakeFirstOrThrow();
    expect([t.status, t.archived_at]).toEqual(["closed", null]);

    for (const session of [x.b.s.auditor, x.b.s.bo, x.b.s.tl]) {
      const list = await send("GET", itemsOf(x), { session });
      expect(list.status).toBe(200);
      expect(list.body.items.map((i: { id: string }) => i.id).sort()).toEqual([open.id, inProgress.id].sort());
    }
    const edited = await send("PATCH", `${itemsOf(x)}/${open.id}`, {
      session: x.b.s.bo,
      headers: ifm(1),
      body: { priority: "M", ownerUserId: x.b.users.bo.id },
    });
    expect([edited.status, edited.body.priority]).toEqual([200, "M"]);
    const closed = await send("PATCH", `${itemsOf(x)}/${inProgress.id}`, {
      session: x.to.session,
      headers: ifm(2),
      body: { status: "done", resolutionNote: "Synthetic: done after closure" },
    });
    expect([closed.status, closed.body.status]).toEqual([200, "done"]);
    const later = await newItem(x, { title: "Synthetic: raised after closure" });
    expect(later.status).toBe("open");
    const filtered = await send("GET", `${itemsOf(x)}?status=done`, { session: x.b.s.auditor });
    expect(filtered.body.items.map((i: { id: string }) => i.id)).toEqual([inProgress.id]);
  });
});
