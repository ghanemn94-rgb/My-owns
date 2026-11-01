// code-security-reviewer DG6 round 1 reproduction (F-DG6-121, F-DG6-122). NOT part of the candidate; copied into a
// disposable clone's tests/qa/integration by checks.sh and removed afterwards. Demo data is SYNTHETIC.
//
// ADR-0051 §2: a reader who is not admitted to a sensitive record gets 404 on it, and "Lists, search, exports, assistant
// retrieval: the row is absent"; "the record and its individual value are never shown". ADR-0052 §8 redacts a sensitive
// record's events in /api/v1/audit-events.
// Claim 1 (F-DG6-121): GET /api/v1/transformations/{t}/audit (audit.read: TL, TO, AUD) applies no sensitivity rule at
//   all: a TL of the transformation who gets 404 on the sensitive benefit reads every event of that benefit with its
//   full `changes` and `reason`.
// Claim 2 (F-DG6-122): /api/v1/audit-events redacts only events whose OWN record is marked sensitive; the events of the
//   records that carry a sensitive benefit's or business case's values (benefit_measurement, business_case_line, ...)
//   are returned unredacted to an AUD who is not admitted (the export path, reporting/exports/jobs.ts, maps exactly
//   these children to their parent; the audit API does not).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;

let scratch = "";
let api: TestApi;
let aud: Session;
let tl: Session;
let to: Session;
let tlId = "";
let audId = "";

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r1_audit");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const a = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, a.id, "AUD", { type: "organization", id: ORG } as never, ORG);
  aud = await signIn(api.app, a.subject);
  audId = a.id;
  const l = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, l.id, "TL", { type: "transformation", id: T } as never, ORG);
  tl = await signIn(api.app, l.subject);
  tlId = l.id;
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function allTransformationAudit(session: Session): Promise<Loose[]> {
  const out: Loose[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i += 1) {
    const q: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const r = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/audit${q}`, { session });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    out.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) break;
  }
  return out;
}

describe("sensitive benefits and the audit trail", () => {
  it("F-DG6-121 and F-DG6-122", async () => {
    // A demo benefit of T that has audited child measurements, whose parties are not the TL or the AUD.
    const candidates = await sql<{ benefit_id: string; n: string }>`
      SELECT m.benefit_id, count(*)::text AS n
        FROM audit_event e JOIN benefit_measurement m ON m.id = e.record_id
       WHERE e.record_type = 'benefit_measurement' AND e.transformation_id = ${T}::uuid
       GROUP BY m.benefit_id ORDER BY count(*) DESC LIMIT 1`.execute(api.db);
    const benefitEvents = await sql<{ record_id: string; n: string }>`
      SELECT record_id, count(*)::text AS n FROM audit_event
       WHERE record_type = 'benefit' AND transformation_id = ${T}::uuid GROUP BY record_id ORDER BY count(*) DESC LIMIT 1`.execute(
      api.db,
    );
    console.log("measurement-audited benefit", JSON.stringify(candidates.rows));
    console.log("benefit with own events", JSON.stringify(benefitEvents.rows));
    const benefitId = candidates.rows[0]?.benefit_id ?? benefitEvents.rows[0]!.record_id;

    // The TO marks it sensitive (ADR-0051 §2), through the API.
    const mark = await call<Loose>(
      api.app,
      "PUT",
      `/api/v1/transformations/${T}/records/benefit/${benefitId}/sensitivity`,
      {
        session: to,
        headers: { "if-match": '"0"' },
        body: { isSensitive: true, reason: "Synthetic: commercially sensitive figure." },
      },
    );
    console.log("mark", mark.status, JSON.stringify(mark.body).slice(0, 300));
    expect(mark.status).toBe(200);

    // The benefit's owner (a named party, admitted) records a measurement value on the now-sensitive benefit.
    // The owner signs in through the dev sign-in (a fixture identity of the dev issuer, as the harness's createUser
    // makes; the demo seed's own identities belong to the demo IdP).
    const ownerId = (
      await sql<{ id: string }>`SELECT owner_user_id AS id FROM benefit WHERE id = ${benefitId}::uuid`.execute(api.db)
    ).rows[0]!.id;
    const g = await createUser(api.db, ORG);
    const devIssuer = (
      await sql<{ issuer: string }>`SELECT issuer FROM user_identity WHERE user_id = ${g.id}::uuid`.execute(api.db)
    ).rows[0]!.issuer;
    const ownerSubject = `cs-r1-owner-${ownerId.slice(-6)}`;
    await sql`INSERT INTO user_identity (id, user_id, issuer, subject) VALUES (${crypto.randomUUID()}::uuid, ${ownerId}::uuid, ${devIssuer}, ${ownerSubject})`.execute(
      api.db,
    );
    const owner = { id: ownerId, subject: ownerSubject };
    await grant(api.db, g.id, owner.id, "BO", { type: "transformation", id: T } as never, ORG).catch(() => undefined);
    const ownerSession = await signIn(api.app, owner.subject);
    const measured = await call<Loose>(api.app, "POST", `/api/v1/transformations/${T}/benefits/${benefitId}/measurements`, {
      session: ownerSession,
      body: {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        amount: "987654.32",
        attribution: "Synthetic attribution note for the reproduction.",
      },
    });
    console.log("owner measurement", measured.status, JSON.stringify(measured.body).slice(0, 300));
    expect(measured.status).toBe(201);

    // Neither the TL nor the AUD is admitted: 404 on the record itself.
    const tlGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, {
      session: tl,
    });
    const audGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, {
      session: aud,
    });
    console.log("record GET: TL", tlGet.status, "AUD", audGet.status, "(tl", tlId, "aud", audId, ")");
    expect(tlGet.status).toBe(404);
    expect(audGet.status).toBe(404);

    // Claim 1: the per-transformation audit trail shows the sensitive benefit's own events with their changes.
    const trail = await allTransformationAudit(tl);
    const own = trail.filter((e) => e.recordType === "benefit" && e.recordId === benefitId);
    const ownWithChanges = own.filter((e) => e.changes !== null && Object.keys(e.changes ?? {}).length > 0);
    console.log(
      "F-DG6-121 TL /transformations/{t}/audit: events of the sensitive benefit:",
      own.length,
      "with changes:",
      ownWithChanges.length,
      "sample:",
      JSON.stringify(ownWithChanges[0] ?? own[0] ?? null).slice(0, 700),
    );
    const children = trail.filter((e) => e.recordType === "benefit_measurement");
    console.log("F-DG6-121 TL also sees benefit_measurement events:", children.length);

    // Claim 2: /audit-events redacts the benefit's own events but not its measurements' events.
    const list = await call<Loose>(
      api.app,
      "GET",
      `/api/v1/audit-events?organizationId=${ORG}&transformationId=${T}&recordType=benefit_measurement&limit=100`,
      { session: aud },
    );
    expect(list.status).toBe(200);
    const measurementIds = (
      await sql<{ id: string }>`SELECT id FROM benefit_measurement WHERE benefit_id = ${benefitId}::uuid`.execute(
        api.db,
      )
    ).rows.map((r) => r.id);
    const ofSensitive = (list.body.items as Loose[]).filter((e) => measurementIds.includes(e.recordId));
    const tlMeasurement = trail.filter((e) => measurementIds.includes(e.recordId) && e.changes !== null);
    console.log(
      "F-DG6-121 TL /transformations/{t}/audit: measurement events of the sensitive benefit with changes:",
      tlMeasurement.length,
      "sample:",
      JSON.stringify(tlMeasurement[0] ?? null).slice(0, 900),
    );
    console.log(
      "F-DG6-122 AUD /audit-events benefit_measurement events of the sensitive benefit:",
      ofSensitive.length,
      "unredacted:",
      ofSensitive.filter((e) => e.redacted === false && e.changes !== null).length,
      "sample:",
      JSON.stringify(ofSensitive.find((e) => e.changes !== null) ?? null).slice(0, 700),
    );
    const ownList = await call<Loose>(
      api.app,
      "GET",
      `/api/v1/audit-events?organizationId=${ORG}&recordType=benefit&recordId=${benefitId}&limit=100`,
      { session: aud },
    );
    console.log(
      "control: AUD /audit-events of the benefit itself: redacted",
      (ownList.body.items as Loose[]).map((e) => e.redacted),
    );

    // The defects (each expectation is the leak; a fixed product makes these fail).
    expect(own.length).toBeGreaterThan(0);
    expect(ofSensitive.filter((e) => e.redacted === false && e.changes !== null).length).toBeGreaterThan(0);
  }, 120_000);
});
