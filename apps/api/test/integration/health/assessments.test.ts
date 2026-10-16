// Health-check assessments, the HealthAssessment entity (P5 slice H; ADR-0048 §5, §7-§11; p5-work-split §H.4;
// T-DG5-KBE-G2). Proves, against the run's disposable PostgreSQL, the literal tests of §H.4:
//  - REQ-PB-091: the 25 questions render verbatim (B0150); an assessment with an unanswered question is labelled
//    incomplete and shows no band; submitting without three actions gives 422 health_check.actions_required;
//    reassessments are tracked in sequence, each naming the previous submitted one;
//  - REQ-S14-002: 24 answers give `completion {answered: 24, total: 25}` and `band: null` (and `score: null`, never 0);
//  - REQ-S14-001: 25 answers with 17 Yes give score "17" and band "16-20", with `scoringAssumption: true`;
//  - REQ-PB-092: scores 21, 16, 10 and 9 map to the four B0152 texts verbatim;
//  - REQ-S14-003 (A07 part): an assessment submitted under v1 keeps v1, its score and its band after v2 is published and
//    the pin migrated (ADR-0040, through the migration API); the next assessment uses v2;
//  - AUD (and SP, WL) get 403 on every write, an outsider 404; If-Match gives 428/409; one audit event per mutated
//    row; authorization is re-checked at commit time; the database refuses a score that differs from its own.
// All data is SYNTHETIC; a health-check score is an assessment, not a G1-G6 business approval, and nothing here
// touches the engineering gates DG0-DG7.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb, insertAuditEvent, sql } from "@mth/db";
import { healthCheck, healthCheckPage } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/index.ts";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  uniq,
  type RequestOptions,
  type TestApi,
  type World,
  startApi,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { setupApprovalWorld } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const V1_ID = "01920005-0860-7000-8000-000000000001";
const RATIONALE = "Synthetic demo decision; approves nothing real.";
const q = (n: number) => `q${String(n).padStart(2, "0")}`;
const list = (t: string) => `/api/v1/transformations/${t}/health-checks`;

/** The playbook source (read-only, D-142 Q5): the B0150 question cells and the B0152 band rows. */
const PLAYBOOK = readFileSync(new URL("../../../../../docs/source/playbook.md", import.meta.url), "utf8");
function b0150Questions(): string[] {
  const table = PLAYBOOK.slice(PLAYBOOK.indexOf("<!-- B0150 table -->"), PLAYBOOK.indexOf("Interpretation <!-- B0151"));
  const found = [...table.matchAll(/☐ (\d+)\. ([^|]+?)\s*\|/g)].map((m) => [Number(m[1]), m[2]!.trim()] as const);
  return found.sort((a, b) => a[0] - b[0]).map(([, text]) => text);
}
function b0152Bands(): Map<string, string> {
  const table = PLAYBOOK.slice(PLAYBOOK.indexOf("<!-- B0152 table -->"), PLAYBOOK.indexOf("REFERENCE <!-- B0153"));
  return new Map([...table.matchAll(/^\| (\d+-\d+) \| (.+?) \|$/gm)].map((m) => [m[1]!, m[2]!]));
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

async function create(p: P2World, session = p.lead.session, body: Body = { assessmentDate: "2026-10-16" }) {
  const r = await req("POST", list(p.transformationId), { session, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.headers.etag).toBe('"1"');
  expect(r.headers.location).toBe(`${list(p.transformationId)}/${r.body.id}`);
  return healthCheck.parse(r.body);
}

async function read(p: P2World, id: string, session = p.lead.session) {
  const r = await req("GET", `${list(p.transformationId)}/${id}`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.headers.etag).toBe(`"${r.body.version}"`);
  return healthCheck.parse(r.body);
}

/** Answers questions 1..n: the first `yes` Yes, the rest the `other` response. Returns the last body. */
async function answerAll(p: P2World, id: string, version: number, n: number, yes: number, other = "no") {
  let v = version;
  let last: Body = null;
  for (let i = 1; i <= n; i += 1) {
    const r = await req("PUT", `${list(p.transformationId)}/${id}/answers/${q(i)}`, {
      session: p.lead.session,
      headers: ifm(v),
      body: { response: i <= yes ? "yes" : other },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    last = r.body;
    v = r.body.version;
  }
  return last;
}

const THREE = {
  actions: [1, 2, 3].map((rank) => ({ rank, actionText: `Synthetic improvement action ${rank}` })),
};

async function setActions(p: P2World, id: string, version: number, body: Body = THREE) {
  const r = await req("PUT", `${list(p.transformationId)}/${id}/actions`, {
    session: p.lead.session,
    headers: ifm(version),
    body,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

const submit = (p: P2World, id: string, version: number, session = p.lead.session) =>
  req("POST", `${list(p.transformationId)}/${id}/submit`, { session, headers: ifm(version) });

/** A full assessment with `yes` Yes out of 25, three actions, submitted. Returns the submitted body. */
async function submitted(p: P2World, yes: number) {
  const a = await create(p);
  const answered = await answerAll(p, a.id, a.version, 25, yes);
  const withActions = await setActions(p, a.id, answered.version);
  const s = await submit(p, a.id, withActions.version);
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return healthCheck.parse(s.body);
}

/** A published synthetic health-check scheme version (owner role, origin seed, audited as 0086 does). */
async function seedScheme(
  key: string,
  versionNo: number,
  definition: unknown,
  elements: { type: string; key: string; origin: "source" | "admin"; attributes: Body }[],
): Promise<string> {
  const id = uuidv7();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_version")
        .values({
          id,
          key,
          version_no: versionNo,
          status: "published",
          title_en: `Synthetic health-check scheme v${versionNo}`,
          title_ar: `مخطط تقييم تجريبي ${versionNo}`,
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify(definition),
          content_sha256: randomBytes(32).toString("hex"),
          published_at: new Date(),
          config_kind: "health_check_scheme",
          origin: "seed",
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "methodology_version",
        recordId: id,
        organizationId: null,
        newVersion: 1,
      });
      for (const [i, e] of elements.entries()) {
        const elementId = uuidv7();
        await tx
          .insertInto("methodology_element")
          .values({
            id: elementId,
            methodology_version_id: id,
            element_type: e.type,
            stable_key: e.key,
            origin: e.origin,
            ordinal: i + 1,
            attributes: JSON.stringify(e.attributes),
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "methodology_element",
          recordId: elementId,
          organizationId: null,
          newVersion: 1,
        });
      }
    });
  return id;
}

/** Points the transformation's health_check_scheme pin at `versionId` (as if created on it; test-only, owner role). */
async function pinScheme(organizationId: string, transformationId: string, versionId: string, by: string) {
  const pinId = uuidv7();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await tx
        .deleteFrom("transformation_config_pin")
        .where("transformation_id", "=", transformationId)
        .where("kind", "=", "health_check_scheme")
        .where("last_migration_id", "is", null)
        .execute();
      await tx
        .insertInto("transformation_config_pin")
        .values({
          id: pinId,
          organization_id: organizationId,
          transformation_id: transformationId,
          kind: "health_check_scheme",
          methodology_version_id: versionId,
          pinned_by: by,
          created_by: by,
          updated_by: by,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "transformation_config_pin",
        recordId: pinId,
        organizationId,
        newVersion: 1,
      });
    });
}

// ------------------------------------------------------------------------------------------------ REQ-PB-091, S14-002

describe("REQ-PB-091 / REQ-S14-002: the 25 questions, incomplete assessments and the three actions", () => {
  it("the 25 questions render verbatim (B0150), in order, each with a provisional Arabic text", async () => {
    const p = await setupP2World(api, w);
    const r = await req("GET", "/api/v1/health-check-questions", { session: p.auditor.session });
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: Body) => x.textEn)).toEqual(b0150Questions());
    expect(r.body.items.map((x: Body) => x.code)).toEqual(Array.from({ length: 25 }, (_, i) => q(i + 1)));
    // The source's hyphen is kept (ADR-0048 §5).
    expect(r.body.items.map((x: Body) => x.textEn)).toContain("Are 3-5 business outcomes measurable?");
    expect(r.body.items.every((x: Body) => x.sourceRef === "B0150" && x.textAr.length > 0)).toBe(true);
  });

  it("a new assessment is a draft under scheme v1 (unpinned), version 1, incomplete (0/25), with no score or band", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    expect([a.status, a.sequenceNo, a.schemeVersionId, a.schemeVersionNo, a.previousAssessmentId]).toEqual([
      "draft",
      1,
      V1_ID,
      1,
      null,
    ]);
    expect([a.ownerUserId, a.assessmentDate, a.answers, a.actions]).toEqual([p.lead.id, "2026-10-16", [], []]);
    expect(a.completion).toEqual({ answered: 0, total: 25, complete: false });
    expect([a.score, a.scoreMax, a.band, a.scoringAssumption]).toEqual([null, null, null, true]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual(["health_assessment.create"]);
  });

  it("REQ-S14-002: 24 answers give completion {answered: 24, total: 25}, score null and band null; submit gives 422 incomplete", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const after = await answerAll(p, a.id, a.version, 24, 24); // 24 Yes: complete would be "Strong", but it is not
    expect(after.completion).toEqual({ answered: 24, total: 25, complete: false });
    expect([after.score, after.scoreMax, after.band]).toEqual([null, null, null]);
    const g = await read(p, a.id, p.auditor.session);
    expect([g.completion.answered, g.band, g.score]).toEqual([24, null, null]);
    const withActions = await setActions(p, a.id, after.version);
    expect(codeOf(await submit(p, a.id, withActions.version))).toEqual([422, "health_check.incomplete"]);
    const r = await submit(p, a.id, withActions.version);
    expect(r.body.detail).toBe("Answer all 25 questions before submitting the health check.");
    // The list says the same (summary rows).
    const page = healthCheckPage.parse(
      (await req("GET", list(p.transformationId), { session: p.auditor.session })).body,
    );
    expect([page.items[0]!.completion.answered, page.items[0]!.band, page.items[0]!.score]).toEqual([24, null, null]);
  });

  it("submitting a complete assessment without three actions gives 422 health_check.actions_required", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const answered = await answerAll(p, a.id, a.version, 25, 12);
    // A complete draft shows its computed score and band, not submitted.
    expect([answered.status, answered.score, answered.band.rangeLabel, answered.completion.complete]).toEqual([
      "draft",
      "12",
      "10-15",
      true,
    ]);
    const none = await submit(p, a.id, answered.version);
    expect(codeOf(none)).toEqual([422, "health_check.actions_required"]);
    expect(none.body.detail).toBe("Submit the health check with its top 3 actions.");
    const two = await setActions(p, a.id, answered.version, { actions: THREE.actions.slice(0, 2) });
    expect(codeOf(await submit(p, a.id, two.version))).toEqual([422, "health_check.actions_required"]);
    // A rank not sent keeps its action; the third completes the set.
    const three = await setActions(p, a.id, two.version, { actions: [THREE.actions[2]] });
    expect(three.actions.map((x: Body) => x.rank)).toEqual([1, 2, 3]);
    const ok = await submit(p, a.id, three.version);
    expect([ok.status, ok.body.status, ok.body.score]).toEqual([200, "submitted", "12"]);
  });

  it("validates bodies: duplicate ranks, blank text, unknown fields, bad dates, question codes (400)", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const A = `${list(p.transformationId)}/${a.id}`;
    const put = (u: string, body: Body) => req("PUT", u, { session: p.lead.session, headers: ifm(a.version), body });
    expect((await put(`${A}/actions`, { actions: [THREE.actions[0], THREE.actions[0]] })).status).toBe(400);
    expect((await put(`${A}/actions`, { actions: [{ rank: 1, actionText: "   " }] })).status).toBe(400);
    expect((await put(`${A}/actions`, { actions: [{ rank: 4, actionText: "x" }] })).status).toBe(400);
    expect((await put(`${A}/answers/q00`, { response: "yes" })).status).toBe(400);
    expect((await put(`${A}/answers/q01`, { response: "yes", evidenceNote: " " })).status).toBe(400);
    expect((await put(`${A}/answers/q01`, { response: "yes", extra: 1 })).status).toBe(400);
    const r = await req("POST", list(p.transformationId), {
      session: p.lead.session,
      body: { assessmentDate: "2026-13-01" },
    });
    expect(r.status).toBe(400);
    expect((await read(p, a.id)).version).toBe(a.version); // nothing was written
  });

  it("reassessments are tracked in sequence; at most one draft (409 draft_exists)", async () => {
    const p = await setupP2World(api, w);
    const first = await create(p);
    const dup = await req("POST", list(p.transformationId), {
      session: p.office.session,
      body: { assessmentDate: "2026-10-16" },
    });
    expect(codeOf(dup)).toEqual([409, "health_check.draft_exists"]);
    expect(dup.body.detail).toBe("This transformation already has a health check in progress.");
    const answered = await answerAll(p, first.id, first.version, 25, 20);
    const s1 = await submit(p, first.id, (await setActions(p, first.id, answered.version)).version);
    expect(s1.status).toBe(200);
    const second = await create(p, p.office.session, { assessmentDate: "2027-01-16", ownerUserId: p.lead.id });
    expect([second.sequenceNo, second.previousAssessmentId, second.ownerUserId]).toEqual([2, first.id, p.lead.id]);
    const page = healthCheckPage.parse(
      (await req("GET", list(p.transformationId), { session: p.auditor.session })).body,
    );
    expect(page.items.map((x) => [x.sequenceNo, x.status, x.score])).toEqual([
      [1, "submitted", "20"],
      [2, "draft", null],
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S14-001, PB-092

describe("REQ-S14-001 / REQ-PB-092: score and the four B0152 bands", () => {
  it("25 answers with 17 Yes give score 17, out of 25, band 16-20, and scoringAssumption true", async () => {
    const p = await setupP2World(api, w);
    const s = await submitted(p, 17);
    expect([s.status, s.score, s.scoreMax, s.band?.rangeLabel, s.band?.key, s.scoringAssumption]).toEqual([
      "submitted",
      "17",
      "25",
      "16-20",
      "b0152_16_20",
      true,
    ]);
    expect([s.submittedBy, typeof s.submittedAt]).toEqual([p.lead.id, "string"]);
    const stored = await api.db
      .selectFrom("health_assessment")
      .select(["score", "score_max", "band_key"])
      .where("id", "=", s.id)
      .executeTakeFirstOrThrow();
    expect([Number(stored.score), Number(stored.score_max), stored.band_key]).toEqual([17, 25, "b0152_16_20"]);
  });

  it("scores 21, 16, 10 and 9 map to the four B0152 texts verbatim", async () => {
    const p = await setupP2World(api, w);
    const bands = b0152Bands();
    expect([...bands.keys()]).toEqual(["21-25", "16-20", "10-15", "0-9"]);
    const seen: [string | null, string | undefined, string | undefined][] = [];
    for (const yes of [21, 16, 10, 9]) {
      const s = await submitted(p, yes);
      seen.push([s.score, s.band?.rangeLabel, s.band?.textEn]);
    }
    expect(seen).toEqual([
      ["21", "21-25", bands.get("21-25")],
      ["16", "16-20", bands.get("16-20")],
      ["10", "10-15", bands.get("10-15")],
      ["9", "0-9", bands.get("0-9")],
    ]);
    expect(seen[0]![2]).toBe(
      "Strong transformation discipline; focus on value acceleration and continuous improvement.",
    );
    // Each later one names the earlier submitted one (reassessments over time).
    const page = healthCheckPage.parse((await req("GET", list(p.transformationId), { session: p.lead.session })).body);
    expect(page.items.map((x) => x.sequenceNo)).toEqual([1, 2, 3, 4]);
    expect(page.items.slice(1).map((x) => x.previousAssessmentId)).toEqual(page.items.slice(0, 3).map((x) => x.id));
  });

  it("the database refuses a submitted score that differs from its own computation (500, nothing written)", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const answered = await answerAll(p, a.id, a.version, 25, 17);
    await setActions(p, a.id, answered.version);
    let caught: unknown = null;
    try {
      await api.db
        .updateTable("health_assessment")
        .set({ status: "submitted", score: "18", score_max: "25", band_key: "b0152_16_20" })
        .set({ submitted_at: new Date(), submitted_by: p.lead.id, version: sql<number>`version + 1` })
        .where("id", "=", a.id)
        .execute();
    } catch (e) {
      caught = e;
    }
    expect((caught as { constraint?: string }).constraint).toBe("health_assessment_score_matches");
    expect(mapDatabaseGuardError(caught as never)?.status).toBe(500);
    expect((await read(p, a.id)).status).toBe("draft");
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S14-003 (A07)

describe("REQ-S14-003 (A07 part): existing assessments keep their scheme version and band", () => {
  it("an assessment submitted under v1 keeps v1, its score and its band after v2 is published and the pin migrated", async () => {
    const p = await setupApprovalWorld(api, w);
    const t = p.transformationId;
    // v1 of a fresh key: a copy of the seeded scheme v1 (Yes = 1, No = 0, the four B0152 bands).
    const key = `test-health-${uniq("k").toLowerCase()}`;
    const base = await api.db
      .selectFrom("methodology_element")
      .select(["element_type", "stable_key", "origin", "attributes"])
      .where("methodology_version_id", "=", V1_ID)
      .orderBy("ordinal")
      .execute();
    const v1Def = await api.db
      .selectFrom("methodology_version")
      .select("definition")
      .where("id", "=", V1_ID)
      .executeTakeFirstOrThrow();
    const v1 = await seedScheme(
      key,
      1,
      v1Def.definition,
      base.map((e) => ({
        type: e.element_type,
        key: e.stable_key,
        origin: e.origin as "source" | "admin",
        attributes: e.attributes,
      })),
    );
    await pinScheme(w.orgA.id, t, v1, p.lead.id);

    const before = await submitted(p, 17);
    expect([before.schemeVersionId, before.schemeVersionNo, before.score, before.band?.rangeLabel]).toEqual([
      v1,
      1,
      "17",
      "16-20",
    ]);

    // v2: N/A with percent_of_applicable and its OWN bands (the source bands removed; ADR-0048 §6 rule 6).
    const own = (k: string, minScore: string, rangeLabel: string) => ({
      type: "health_band",
      key: k,
      origin: "admin" as const,
      attributes: { minScore, rangeLabel, textEn: `Synthetic band ${k}`, textAr: `نطاق تجريبي ${k}` },
    });
    const v2 = await seedScheme(key, 2, { scoreBasis: "percent_of_applicable", questionCount: 25 }, [
      { type: "health_response", key: "yes", origin: "source", attributes: { credit: "1" } },
      { type: "health_response", key: "no", origin: "source", attributes: { credit: "0" } },
      { type: "health_response", key: "na", origin: "admin", attributes: { credit: null } },
      own("strong", "80", "80-100"),
      own("solid", "60", "60-79.99"),
      own("risk", "40", "40-59.99"),
      own("reset", "0", "0-39.99"),
    ]);

    // The migration (ADR-0040): ADM_METHOD creates and submits, the Sponsor decides (synthetic), ADM_METHOD executes.
    const MIG = `/api/v1/transformations/${t}/methodology-migrations`;
    const admin = p.methodologyAdmin.session;
    const created = await req("POST", MIG, {
      session: admin,
      body: { configKind: "health_check_scheme", toVersionId: v2, reason: "Synthetic migration to scheme v2" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sub = await req("POST", `${MIG}/${created.body.id}/submit`, {
      session: admin,
      headers: ifm(created.body.version),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const dec = await req("POST", `${MIG}/${created.body.id}/decision`, {
      session: p.sponsor.session,
      headers: ifm(sub.body.version),
      body: { outcome: "approve", rationale: RATIONALE },
    });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    const ex = await req("POST", `${MIG}/${created.body.id}/execute`, {
      session: admin,
      headers: ifm(dec.body.version),
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(200);

    // The submitted assessment keeps v1, its score and its band.
    const after = await read(p, before.id, p.auditor.session);
    expect([after.schemeVersionId, after.schemeVersionNo, after.score, after.scoreMax, after.band]).toEqual([
      v1,
      1,
      "17",
      "25",
      before.band,
    ]);
    expect(after.version).toBe(before.version);

    // The next assessment uses v2: N/A is allowed and the score is a percentage of the applicable questions.
    const next = await create(p);
    expect([next.schemeVersionId, next.schemeVersionNo, next.previousAssessmentId]).toEqual([v2, 2, before.id]);
    let v = next.version;
    let last: Body = null;
    for (let i = 1; i <= 25; i += 1) {
      const response = i <= 15 ? "yes" : i <= 20 ? "no" : "na"; // 15 / 20 applicable = 75.00 %
      last = await req("PUT", `${list(t)}/${next.id}/answers/${q(i)}`, {
        session: p.lead.session,
        headers: ifm(v),
        body: { response },
      });
      expect(last.status, JSON.stringify(last.body)).toBe(200);
      v = last.body.version;
    }
    const done = await submit(p, next.id, (await setActions(p, next.id, v)).version);
    expect([done.status, done.body.score, done.body.scoreMax, done.body.band.key]).toEqual([200, "75", "100", "solid"]);
    // v1 never allowed N/A: the first assessment still refuses it (and is final anyway).
    expect(
      codeOf(
        await req("PUT", `${list(t)}/${before.id}/answers/q01`, {
          session: p.lead.session,
          headers: ifm(after.version),
          body: { response: "na" },
        }),
      ),
    ).toEqual([422, "health_check.not_draft"]);
  });

  it("a v1 draft refuses N/A (422 response_not_allowed); an all-N/A v2 assessment is not computable (422)", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const na = await req("PUT", `${list(p.transformationId)}/${a.id}/answers/q01`, {
      session: p.lead.session,
      headers: ifm(a.version),
      body: { response: "na" },
    });
    expect(codeOf(na)).toEqual([422, "health_check.response_not_allowed"]);
    expect(na.body.detail).toBe("This response is not allowed by the health check's scoring scheme.");

    const p2 = await setupP2World(api, w);
    const key = `test-health-${uniq("k").toLowerCase()}`;
    const vNa = await seedScheme(key, 1, { scoreBasis: "percent_of_applicable", questionCount: 25 }, [
      { type: "health_response", key: "yes", origin: "source", attributes: { credit: "1" } },
      { type: "health_response", key: "no", origin: "source", attributes: { credit: "0" } },
      { type: "health_response", key: "na", origin: "admin", attributes: { credit: null } },
      {
        type: "health_band",
        key: "all",
        origin: "admin",
        attributes: { minScore: "0", rangeLabel: "0-100", textEn: "Synthetic", textAr: "تجريبي" },
      },
    ]);
    await pinScheme(w.orgA.id, p2.transformationId, vNa, p2.lead.id);
    const b = await create(p2);
    expect(b.schemeVersionId).toBe(vNa);
    const all = await answerAll(p2, b.id, b.version, 25, 0, "na");
    expect([all.completion.complete, all.score, all.band, all.scoringAssumption]).toEqual([true, null, null, false]);
    const r = await submit(p2, b.id, (await setActions(p2, b.id, all.version)).version);
    expect(codeOf(r)).toEqual([422, "health_check.not_computable"]);
    expect(r.body.detail).toBe("No question is applicable, so no score can be computed.");
  });
});

// ------------------------------------------------------------------------------------------------ the mutation invariants

describe("authorization, If-Match, audit and commit-time re-authorization", () => {
  it("AUD, SP and WL get 403 on every write; an outsider 404; nothing is written", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const A = `${list(p.transformationId)}/${a.id}`;
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const session of [p.auditor.session, p.sponsor.session, p.contributor.session]) {
      expect(
        (await req("POST", list(p.transformationId), { session, body: { assessmentDate: "2026-10-16" } })).status,
      ).toBe(403);
      expect((await req("PATCH", A, { session, headers: ifm(1), body: { assessmentDate: "2026-10-18" } })).status).toBe(
        403,
      );
      expect(
        (await req("PUT", `${A}/answers/q01`, { session, headers: ifm(1), body: { response: "yes" } })).status,
      ).toBe(403);
      expect((await req("PUT", `${A}/actions`, { session, headers: ifm(1), body: THREE })).status).toBe(403);
      expect((await req("POST", `${A}/submit`, { session, headers: ifm(1) })).status).toBe(403);
    }
    expect((await req("GET", A, { session: outsider })).status).toBe(404);
    expect(
      (await req("PUT", `${A}/answers/q01`, { session: outsider, headers: ifm(1), body: { response: "yes" } })).status,
    ).toBe(404);
    expect((await req("GET", A, { session: p.auditor.session })).status).toBe(200); // AUD reads
    const after = await read(p, a.id);
    expect([after.version, after.answers, after.actions]).toEqual([1, [], []]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual(["health_assessment.create"]);
  });

  it("If-Match: 428 when missing, 409 when stale, on every write; two leaders answering at once get one 409", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const A = `${list(p.transformationId)}/${a.id}`;
    const s = p.lead.session;
    expect((await req("PATCH", A, { session: s, body: { assessmentDate: "2026-10-18" } })).status).toBe(428);
    expect((await req("PUT", `${A}/answers/q01`, { session: s, body: { response: "yes" } })).status).toBe(428);
    expect((await req("PUT", `${A}/actions`, { session: s, body: THREE })).status).toBe(428);
    expect((await req("POST", `${A}/submit`, { session: s })).status).toBe(428);
    expect(
      codeOf(await req("PATCH", A, { session: s, headers: ifm(9), body: { assessmentDate: "2026-10-18" } })),
    ).toEqual([409, "version_conflict"]);
    expect((await req("PUT", `${A}/actions`, { session: s, headers: ifm(9), body: THREE })).status).toBe(409);
    expect((await req("POST", `${A}/submit`, { session: s, headers: ifm(9) })).status).toBe(409);
    const [x, y] = await Promise.all([
      req("PUT", `${A}/answers/q01`, { session: s, headers: ifm(1), body: { response: "yes" } }),
      req("PUT", `${A}/answers/q02`, { session: p.office.session, headers: ifm(1), body: { response: "no" } }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await read(p, a.id)).completion.answered).toBe(1);
  });

  it("one audit event per mutated row, in the same transaction", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const A = `${list(p.transformationId)}/${a.id}`;
    const s = p.lead.session;
    const r1 = await req("PUT", `${A}/answers/q01`, {
      session: s,
      headers: ifm(1),
      body: { response: "yes", evidenceNote: "Synthetic note", ownerUserId: p.lead.id, actionNote: "Synthetic" },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.answers[0]).toMatchObject({ questionCode: "q01", response: "yes", ownerUserId: p.lead.id });
    const answerId = (
      await api.db
        .selectFrom("health_assessment_answer")
        .select("id")
        .where("assessment_id", "=", a.id)
        .executeTakeFirstOrThrow()
    ).id;
    const r2 = await req("PUT", `${A}/answers/q01`, { session: s, headers: ifm(2), body: { response: "no" } });
    expect([r2.status, r2.body.version, r2.body.completion.answered]).toEqual([200, 3, 1]);
    // The same answer again writes nothing.
    const r3 = await req("PUT", `${A}/answers/q01`, { session: s, headers: ifm(3), body: { response: "no" } });
    expect([r3.status, r3.body.version]).toEqual([200, 3]);
    const r4 = await req("PATCH", A, { session: s, headers: ifm(3), body: { assessmentDate: "2026-10-18" } });
    expect([r4.status, r4.body.version, r4.body.assessmentDate]).toEqual([200, 4, "2026-10-18"]);
    const r5 = await req("PUT", `${A}/actions`, { session: s, headers: ifm(4), body: THREE });
    expect([r5.status, r5.body.version]).toEqual([200, 5]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual([
      "health_assessment.create",
      "health_assessment.answer",
      "health_assessment.answer",
      "health_assessment.update",
      "health_assessment.actions",
    ]);
    expect((await auditOf(api.db, answerId)).map((e) => e.action)).toEqual([
      "health_assessment_answer.create",
      "health_assessment_answer.update",
    ]);
    const actionIds = await api.db
      .selectFrom("health_assessment_action")
      .select("id")
      .where("assessment_id", "=", a.id)
      .execute();
    for (const { id } of actionIds)
      expect((await auditOf(api.db, id)).map((e) => e.action)).toEqual(["health_assessment_action.create"]);
  });

  it("authorization is re-checked at commit time: a grant revoked while the request waits gives 403, nothing written", async () => {
    const p = await setupP2World(api, w);
    const a = await create(p);
    const res = await afterIdentity(
      api,
      p.lead.id,
      () =>
        req("PUT", `${list(p.transformationId)}/${a.id}/answers/q01`, {
          session: p.lead.session,
          headers: ifm(a.version),
          body: { response: "yes" },
        }),
      () => revokeAll(api, w.grantor.id, p.lead.id),
    );
    expect(res.status).toBe(403);
    expect(
      await api.db.selectFrom("health_assessment_answer").select("id").where("assessment_id", "=", a.id).execute(),
    ).toEqual([]);
  });
});
