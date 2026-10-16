// A16 "Health and launch", part 1: the 25-question Transformation Health Check (qa-verifier, T-DG5-QA-D).
// Scenario (master prompt §20 A16): "All 25 questions and four source score bands work; incomplete assessments are
// labeled; launch tasks are generated from the chosen start date". This file covers the health-check half through the
// REAL API (Fastify inject on a disposable PostgreSQL; every response validated against docs/api/openapi.yaml by the
// harness). Each check is derived from the acceptance text of the row named in its title (docs/delivery/requirements.csv)
// and the contract; every expected text comes from docs/source/playbook.md (tests/qa/support/a16.ts), never from the
// product:
//  - REQ-PB-091: the 25 questions verbatim (B0150); an assessment with an unanswered question is incomplete and shows no
//    band; submission without three actions is rejected;
//  - REQ-PB-092: scores 21, 16, 10 and 9 map to the four B0152 band texts verbatim;
//  - REQ-S14-001: 25 answers with 17 Yes give 17 and the band "16-20"; the method is flagged an implementation assumption;
//  - REQ-S14-002: 24 answers -> completion 24/25 (the UI's "Incomplete (24/25)": e2e/a16-*.spec.ts) and band = null;
//  - REQ-S14-003: publishing a scheme that adds N/A without new bands is rejected; existing assessments keep their
//    original scheme version and band after a new scheme is published;
//  - REQ-S16-021 (HealthAssessment): created and read through the API with authorization enforced (the other five
//    entities of the group: tests/qa/integration/a16-s16-021-entities.test.ts).
// Every mutation is also checked for its server-side authorization (AUD 403, other organization 404), optimistic
// concurrency (428 without If-Match, 409 stale) and its audit event (rows written by that request id).
// All data is SYNTHETIC. A score is an assessment of test data, not an approval. Publishing a scoring scheme is
// configuration by a synthetic Methodology Administrator, reviewed by a synthetic Transformation Office user; it
// approves nothing real and never touches the engineering gates DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest } from "../../../apps/api/test/support/harness.ts";
import { call, createUser, grant, signIn, startApi, type Res, type Session, type TestApi } from "../support/api.ts";
import { seedNativeGateWorld, type NativeGateWorld } from "../support/gates-native.ts";
import { seedWorld, type World } from "../support/p4.ts";
import { b0150Questions, b0152Bands, QUESTION_CODES } from "../support/a16.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let g: NativeGateWorld;
let methodAdmin: Session;
let reviewerTo: Session;
let auditor: Session;
let outsider: Session;
let member: Session;
let HC: string;

const send = (method: string, url: string, opts: Parameters<typeof call>[3] = {}) =>
  call<Body>(api.app, method, url, opts);
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: Res<Body>) => [r.status, r.body?.code];
const SCHEMES = "/api/v1/admin/health-check-schemes";
const V = "/api/v1/admin/methodology-versions";

/** A mutation with its own request id, so the audit rows it wrote can be read back exactly. */
async function mutate(session: Session, method: string, url: string, body?: unknown, version?: number) {
  const rid = `qa-a16-${randomUUID()}`;
  const res = await send(method, url, {
    session,
    ...(body !== undefined ? { body } : {}),
    headers: { "x-request-id": rid, ...(version !== undefined ? ifm(version) : {}) },
  });
  return { res, rid };
}

async function readAssessment(id: string, session = g.tl.session): Promise<Body> {
  const r = await send("GET", `${HC}/${id}`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** Start a draft as the Lead (assessment date fixed: synthetic data, no clock dependency). */
async function startDraft(date = "2026-10-05"): Promise<Body> {
  const { res } = await mutate(g.tl.session, "POST", HC, { assessmentDate: date });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Answer the given question codes, the first `yes` of them Yes and the rest No; returns the last body. */
async function answer(a: Body, codes: readonly string[], yes: number): Promise<Body> {
  let cur = a;
  for (const [i, code] of codes.entries()) {
    const { res } = await mutate(
      g.tl.session,
      "PUT",
      `${HC}/${a.id}/answers/${code}`,
      { response: i < yes ? "yes" : "no" },
      cur.version,
    );
    expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(200);
    cur = res.body;
  }
  return cur;
}

const THREE_ACTIONS = [1, 2, 3].map((rank) => ({ rank, actionText: `Synthetic QA improvement action ${rank}` }));

async function setActions(a: Body, actions: Body[]): Promise<Body> {
  const { res } = await mutate(g.tl.session, "PUT", `${HC}/${a.id}/actions`, { actions }, a.version);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** A complete assessment with exactly `yes` Yes answers and three actions, submitted. */
async function submittedWithScore(yes: number): Promise<Body> {
  const a = await startDraft();
  const full = await answer(a, QUESTION_CODES, yes);
  const withActions = await setActions(full, THREE_ACTIONS);
  const { res } = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, withActions.version);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  g = await seedNativeGateWorld(api, w, "A16 health");
  HC = `${g.base}/health-checks`;
  auditor = g.auditor.session;
  outsider = g.outsider.session;
  member = await signIn(api.app, w.nobody.subject);
  const ma = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, ma.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  methodAdmin = await signIn(api.app, ma.subject);
  const rv = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, rv.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewerTo = await signIn(api.app, rv.subject);
}, 180_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-PB-091: all 25 questions render verbatim (B0150)", () => {
  it("GET /health-check-questions returns the 25 playbook questions verbatim, in order, q01..q25", async () => {
    const source = b0150Questions();
    expect(source).toHaveLength(25);
    const r = await send("GET", "/api/v1/health-check-questions", { session: member });
    expect(r.status).toBe(200);
    const items = r.body.items as Body[];
    expect(items).toHaveLength(25);
    expect(items.map((q) => q.code)).toEqual(QUESTION_CODES);
    expect(items.map((q) => q.ordinal)).toEqual(QUESTION_CODES.map((_, i) => i + 1));
    expect(items.map((q) => q.textEn)).toEqual(source);
    for (const q of items) {
      expect(q.textAr.trim().length, `${q.code} Arabic text`).toBeGreaterThan(0);
      expect(q.sourceRef).toContain("B0150");
    }
    // Spot check of a source hyphen kept verbatim (REQ-PB-091 note): "Are 3-5 business outcomes measurable?"
    expect(items[3].textEn).toBe("Are 3-5 business outcomes measurable?");
    expect((await send("GET", "/api/v1/health-check-questions")).status).toBe(401);
  });

  it("a new assessment lists 25 unanswered questions and its answers carry response, evidence, owner and action", async () => {
    const a = await startDraft();
    expect(a).toMatchObject({
      status: "draft",
      completion: { answered: 0, total: 25, complete: false },
      score: null,
      band: null,
      answers: [],
      actions: [],
    });
    const { res } = await mutate(
      g.tl.session,
      "PUT",
      `${HC}/${a.id}/answers/q01`,
      {
        response: "yes",
        evidenceNote: "Synthetic QA evidence note",
        ownerUserId: g.tl.id,
        actionNote: "Synthetic QA follow-up",
      },
      a.version,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.answers).toEqual([
      expect.objectContaining({
        questionCode: "q01",
        response: "yes",
        evidenceNote: "Synthetic QA evidence note",
        ownerUserId: g.tl.id,
        actionNote: "Synthetic QA follow-up",
        answeredBy: g.tl.id,
      }),
    ]);
    // Finish this draft (score 1 of 25, band 0-9) so later tests can start their own.
    const full = await answer(res.body, QUESTION_CODES.slice(1), 0);
    expect(full.score).toBe("1");
    const withActions = await setActions(full, THREE_ACTIONS);
    const sub = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, withActions.version);
    expect(sub.res.status, JSON.stringify(sub.res.body)).toBe(200);
  });
});

describe("REQ-S14-002 / REQ-PB-091: an unanswered question makes the assessment incomplete, with no score or band", () => {
  let draft: Body;
  it("24 answers: completion 24/25, complete false, score null and band null (API band=null)", async () => {
    const a = await startDraft();
    draft = await answer(a, QUESTION_CODES.slice(0, 24), 17);
    expect(draft.completion).toEqual({ answered: 24, total: 25, complete: false });
    expect(draft.score).toBeNull();
    expect(draft.band).toBeNull();
    // The same on a fresh read and in the history list (never 0, never a band).
    const read = await readAssessment(draft.id);
    expect([read.completion, read.score, read.band]).toEqual([
      { answered: 24, total: 25, complete: false },
      null,
      null,
    ]);
    const list = await send("GET", HC, { session: g.tl.session });
    expect(list.status).toBe(200);
    const row = (list.body.items as Body[]).find((x) => x.id === draft.id);
    expect([row.completion.answered, row.completion.complete, row.score, row.band]).toEqual([24, false, null, null]);
  });

  it("an incomplete assessment cannot be submitted (422 health_check.incomplete), even with three actions", async () => {
    const withActions = await setActions(draft, THREE_ACTIONS);
    const { res } = await mutate(g.tl.session, "POST", `${HC}/${draft.id}/submit`, undefined, withActions.version);
    expect(codeOf(res)).toEqual([422, "health_check.incomplete"]);
    const after = await readAssessment(draft.id);
    expect([after.status, after.score, after.band]).toEqual(["draft", null, null]);
    draft = after;
  });

  it("REQ-S14-001: the 25th answer (17 Yes in all) gives score 17 of 25 and the band '16-20'; the method is an implementation assumption", async () => {
    const full = await answer(draft, ["q25"], 0);
    expect(full.completion).toEqual({ answered: 25, total: 25, complete: true });
    expect(full.score).toBe("17");
    expect(full.scoreMax).toBe("25");
    expect(full.band.rangeLabel).toBe("16-20");
    expect(full.scoringAssumption).toBe(true);
    const { res } = await mutate(g.tl.session, "POST", `${HC}/${draft.id}/submit`, undefined, full.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.status, res.body.score, res.body.band.rangeLabel]).toEqual(["submitted", "17", "16-20"]);
    expect(res.body.band.textEn).toBe(b0152Bands()[1]![1]);
    // The scheme the assessment used is v1, published as an implementation assumption: Yes = 1, No = 0, out of 25.
    const scheme = await send("GET", `${SCHEMES}/${res.body.schemeVersionId}`, { session: member });
    expect(scheme.status).toBe(200);
    expect(scheme.body).toMatchObject({
      versionNo: 1,
      implementationAssumption: true,
      scoreBasis: "points",
      questionCount: 25,
    });
    expect(scheme.body.responses.map((r: Body) => [r.key, r.credit])).toEqual([
      ["yes", "1"],
      ["no", "0"],
    ]);
  });
});

describe("REQ-PB-091: submission without three actions is rejected", () => {
  it("no actions -> 422 health_check.actions_required; two actions -> still 422; three -> submitted", async () => {
    const a = await startDraft();
    let cur = await answer(a, QUESTION_CODES, 12);
    const none = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, cur.version);
    expect(codeOf(none.res)).toEqual([422, "health_check.actions_required"]);
    cur = await setActions(cur, THREE_ACTIONS.slice(0, 2));
    expect(cur.actions).toHaveLength(2);
    const two = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, cur.version);
    expect(codeOf(two.res)).toEqual([422, "health_check.actions_required"]);
    expect((await readAssessment(a.id)).status).toBe("draft");
    cur = await setActions(cur, THREE_ACTIONS);
    const ok = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, cur.version);
    expect(ok.res.status, JSON.stringify(ok.res.body)).toBe(200);
    expect(ok.res.body.actions.map((x: Body) => [x.rank, x.actionText])).toEqual(
      THREE_ACTIONS.map((x) => [x.rank, x.actionText]),
    );
    // A submitted assessment is final: answers can no longer change.
    const late = await mutate(
      g.tl.session,
      "PUT",
      `${HC}/${a.id}/answers/q01`,
      { response: "no" },
      ok.res.body.version,
    );
    expect(codeOf(late.res)).toEqual([422, "health_check.not_draft"]);
  });
});

describe("REQ-PB-092: scores 21, 16, 10 and 9 map to the four B0152 band texts verbatim; reassessments are tracked", () => {
  const submitted: Body[] = [];
  it("each submitted score shows the band whose text is the playbook's, verbatim", async () => {
    const bands = b0152Bands();
    expect(bands.map(([r]) => r)).toEqual(["21-25", "16-20", "10-15", "0-9"]);
    for (const [i, score] of [21, 16, 10, 9].entries()) {
      const s = await submittedWithScore(score);
      submitted.push(s);
      expect(s.score).toBe(String(score));
      expect(s.band.rangeLabel).toBe(bands[i]![0]);
      expect(s.band.textEn).toBe(bands[i]![1]);
      expect(s.band.origin).toBe("source");
      expect(s.band.textAr.trim().length).toBeGreaterThan(0);
    }
  });

  it("reassessments are kept in sequence, each linked to the previous submitted one", async () => {
    const list = await send("GET", HC, { session: auditor });
    expect(list.status).toBe(200);
    const items = (list.body.items as Body[]).sort((x, y) => x.sequenceNo - y.sequenceNo);
    const seq = items.map((x) => x.sequenceNo);
    expect(seq).toEqual([...seq].sort((x, y) => x - y));
    expect(new Set(seq).size).toBe(seq.length);
    for (const s of submitted) {
      const row = items.find((x) => x.id === s.id)!;
      const previous = items.filter((x) => x.sequenceNo < row.sequenceNo && x.status === "submitted").at(-1);
      expect(row.previousAssessmentId).toBe(previous?.id ?? null);
    }
  });
});

describe("REQ-S16-021 (HealthAssessment) and the mutation rules: authorization, concurrency, audit", () => {
  it("authorization: AUD reads but cannot write (403); another organization gets 404; no session 401; one draft at a time", async () => {
    const a = await startDraft();
    // A second draft is refused while one is in progress.
    const second = await mutate(g.tl.session, "POST", HC, { assessmentDate: "2026-10-06" });
    expect(codeOf(second.res)).toEqual([409, "health_check.draft_exists"]);
    // AUD (transformation.read, no health_check.assess).
    expect((await send("GET", `${HC}/${a.id}`, { session: auditor })).status).toBe(200);
    const audCreate = await mutate(auditor, "POST", HC, { assessmentDate: "2026-10-06" });
    expect(audCreate.res.status).toBe(403);
    const audAnswer = await mutate(auditor, "PUT", `${HC}/${a.id}/answers/q01`, { response: "yes" }, a.version);
    expect(audAnswer.res.status).toBe(403);
    // The refusal itself is audited as a denial; nothing about the assessment was written.
    expect((await auditOfRequest(api.db, audAnswer.rid)).map((r) => r.action)).toEqual(["authorization.denied"]);
    // A Transformation Office user of another organization: not found (non-disclosure).
    expect((await send("GET", `${HC}/${a.id}`, { session: outsider })).status).toBe(404);
    expect(
      (await mutate(outsider, "PUT", `${HC}/${a.id}/answers/q01`, { response: "yes" }, a.version)).res.status,
    ).toBe(404);
    expect((await send("GET", `${HC}/${a.id}`)).status).toBe(401);
    // A response the scheme does not allow (v1 has yes/no only).
    const na = await mutate(g.tl.session, "PUT", `${HC}/${a.id}/answers/q01`, { response: "na" }, a.version);
    expect(codeOf(na.res)).toEqual([422, "health_check.response_not_allowed"]);
    expect((await readAssessment(a.id)).answers).toEqual([]);
  });

  it("concurrency: an answer without If-Match is 428, with a stale version 409; each accepted write is audited", async () => {
    const list = await send("GET", HC, { session: g.tl.session });
    const draft = (list.body.items as Body[]).find((x) => x.status === "draft");
    const a = await readAssessment(draft.id);
    const missing = await send("PUT", `${HC}/${a.id}/answers/q02`, {
      session: g.tl.session,
      body: { response: "yes" },
    });
    expect(missing.status).toBe(428);
    const ok = await mutate(g.tl.session, "PUT", `${HC}/${a.id}/answers/q02`, { response: "yes" }, a.version);
    expect(ok.res.status).toBe(200);
    expect(ok.res.body.version).toBeGreaterThan(a.version);
    expect((await auditOfRequest(api.db, ok.rid)).length).toBeGreaterThanOrEqual(1);
    const stale = await mutate(g.tl.session, "PUT", `${HC}/${a.id}/answers/q03`, { response: "yes" }, a.version);
    expect(stale.res.status).toBe(409);
    expect(await auditOfRequest(api.db, stale.rid)).toHaveLength(0);
    // Database state: one answer row, by the Lead.
    const rows = await api.db
      .selectFrom("health_assessment_answer")
      .select(["question_code", "response"])
      .where("assessment_id", "=", a.id)
      .execute();
    expect(rows).toEqual([{ question_code: "q02", response: "yes" }]);
    // Finish it so the scheme tests below can start their own assessment afterwards.
    const full = await answer(
      ok.res.body,
      QUESTION_CODES.filter((c) => c !== "q02"),
      0,
    );
    const withActions = await setActions(full, THREE_ACTIONS);
    const sub = await mutate(g.tl.session, "POST", `${HC}/${a.id}/submit`, undefined, withActions.version);
    expect(sub.res.status, JSON.stringify(sub.res.body)).toBe(200);
    expect((await auditOfRequest(api.db, sub.rid)).length).toBeGreaterThanOrEqual(1);
  });
});

describe("REQ-S14-003: a scheme that adds N/A must bring its own bands; existing assessments keep their scheme and band", () => {
  let v1: Body;
  let draftId: string;
  let before: Body[];
  const versionOf = async (id: string): Promise<number> =>
    (await send("GET", `${V}/${id}`, { session: methodAdmin })).body.version;
  const el = async (id: string, type: string, key: string, attributes: Body) =>
    send("PUT", `${V}/${id}/elements/${type}/${key}`, {
      session: methodAdmin,
      headers: ifm(await versionOf(id)),
      body: { origin: "admin", attributes },
    });
  const step = async (id: string, path: string, body?: Body) =>
    send("POST", `${V}/${id}/${path}`, {
      session: methodAdmin,
      headers: ifm(await versionOf(id)),
      ...(body !== undefined ? { body } : {}),
    });
  const sample = (yes: number, no: number, na: number) => {
    const keys = [...Array<string>(yes).fill("yes"), ...Array<string>(no).fill("no"), ...Array<string>(na).fill("na")];
    return {
      kind: "record",
      recordType: "health_assessment",
      input: { answers: Object.fromEntries(keys.map((k, i) => [QUESTION_CODES[i]!, k])) },
    };
  };

  beforeAll(async () => {
    const list = await send("GET", SCHEMES, { session: member });
    v1 = (list.body.items as Body[]).find((s) => s.key === "health-check" && s.versionNo === 1);
    const hist = await send("GET", HC, { session: g.tl.session });
    before = (hist.body.items as Body[]).filter((x) => x.status === "submitted");
  });

  it("scheme v1 is published with the four B0152 bands verbatim", () => {
    expect(v1, "seeded scheme health-check v1").toBeDefined();
    expect(v1.bands.map((b: Body) => [b.rangeLabel, b.textEn])).toEqual(b0152Bands());
    expect(before.length).toBeGreaterThanOrEqual(5);
  });

  it("a draft that adds N/A and keeps the four source bands is refused at preview (422 health_scheme.own_bands_required) and publishing it is rejected", async () => {
    const d = await send("POST", V, {
      session: methodAdmin,
      body: { basedOnVersionId: v1.versionId, changeSummary: "Synthetic QA: add N/A without new bands" },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    draftId = d.body.id;
    const patched = await send("PATCH", `${V}/${draftId}`, {
      session: methodAdmin,
      headers: ifm(d.body.version),
      body: { definition: { ...d.body.definition, scoreBasis: "percent_of_applicable", questionCount: 25 } },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(
      (await el(draftId, "health_response", "na", { credit: null, labelEn: "N/A", labelAr: "لا ينطبق" })).status,
    ).toBe(200);
    const pv = await step(draftId, "preview", { samples: [sample(15, 3, 7)] });
    expect(codeOf(pv)).toEqual([422, "health_scheme.own_bands_required"]);
    // Whatever route the administrator then takes, the scheme does not publish.
    await step(draftId, "preview", { samples: [] });
    await step(draftId, "compatibility-checks");
    const pub = await step(draftId, "publish");
    expect(pub.status, JSON.stringify(pub.body)).toBe(422);
    const read = await send("GET", `${V}/${draftId}`, { session: methodAdmin });
    expect(read.body.status).toBe("draft");
    const listed = await send("GET", SCHEMES, { session: member });
    expect((listed.body.items as Body[]).some((s) => s.versionId === draftId)).toBe(false);
    expect((await send("GET", `${SCHEMES}/${draftId}`, { session: member })).status).toBe(404);
  });

  it("with its own bands (the source bands removed) it publishes; v1 and every existing assessment keep their scheme, score and band", async () => {
    for (const key of ["b0152_21_25", "b0152_16_20", "b0152_10_15", "b0152_0_9"]) {
      const r = await send("POST", `${V}/${draftId}/elements/health_band/${key}/remove`, {
        session: methodAdmin,
        headers: ifm(await versionOf(draftId)),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    for (const [key, min, label] of [
      ["qa_high", "75", "75-100"],
      ["qa_mid", "50", "50-74.99"],
      ["qa_low", "0", "0-49.99"],
    ] as const) {
      const r = await el(draftId, "health_band", key, {
        minScore: min,
        rangeLabel: label,
        textEn: `Synthetic QA band ${key}`,
        textAr: `نطاق تجريبي ${key}`,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const pv = await step(draftId, "preview", { samples: [sample(15, 3, 7)] });
    expect([pv.status, pv.body.result], JSON.stringify(pv.body)).toEqual([201, "pass"]);
    const compat = await step(draftId, "compatibility-checks");
    expect(compat.status).toBe(201);
    expect(compat.body.result).not.toBe("fail");
    const sub = await step(draftId, "submit-review", {});
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const decided = await send("POST", `${V}/${draftId}/reviews/${sub.body.id}/decision`, {
      session: reviewerTo,
      headers: ifm(sub.body.version ?? 1),
      body: { outcome: "approve" },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const pub = await step(draftId, "publish");
    expect([pub.status, pub.body.status], JSON.stringify(pub.body)).toEqual([200, "published"]);
    const v2 = await send("GET", `${SCHEMES}/${draftId}`, { session: member });
    expect(v2.body.versionNo).toBeGreaterThan(1);
    expect(v2.body.bands.map((b: Body) => b.origin)).toEqual(["admin", "admin", "admin"]);
    // v1 is unchanged (published versions are immutable) ...
    const v1Again = await send("GET", `${SCHEMES}/${v1.versionId}`, { session: member });
    expect(v1Again.body).toEqual(v1);
    // ... and every existing assessment keeps its scheme version, score and band.
    const hist = await send("GET", HC, { session: g.tl.session });
    for (const b of before) {
      const now = (hist.body.items as Body[]).find((x) => x.id === b.id);
      expect([now.schemeVersionId, now.schemeVersionNo, now.score, now.band]).toEqual([
        v1.versionId,
        1,
        b.score,
        b.band,
      ]);
    }
    // An assessment started now uses the transformation's pin, else v1 ("never the latest"): still v1 here.
    const a = await startDraft("2026-10-20");
    expect([a.schemeVersionId, a.schemeVersionNo]).toEqual([v1.versionId, 1]);
  });
});
