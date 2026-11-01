// code-security-reviewer DG6 round 1 reproduction (F-DG6-123). NOT part of the candidate; copied into a disposable
// clone's tests/qa/integration by checks.sh (step repro2) and removed afterwards. Demo data is SYNTHETIC.
//
// ADR-0051 §2: a record GET of a sensitive record the caller is not admitted to is 404 (existence not disclosed).
// forms/compare.ts applies that rule to T14 (benefit) records, but the other P5 form-record routes do not: their read
// gate forms/history.ts requireRecordRead checks transformation.read and existence only. Claim: a TL who gets 404 on a
// sensitive benefit gets 200 on .../form-records/T14/{id}/versions, /comments (with the comment text) and
// /attachments, and can still POST a comment on it.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const BENEFIT = "01995000-4401-7000-8000-000000000001"; // a demo benefit of T (the F-DG6-121 run used it)
const FR = `/api/v1/transformations/${T}/form-records/T14/${BENEFIT}`;

let scratch = "";
let api: TestApi;
let tl: Session;
let to: Session;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r1_forms");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const l = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, l.id, "TL", { type: "transformation", id: T } as never, ORG);
  tl = await signIn(api.app, l.subject);
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("F-DG6-123: P5 form-record routes ignore the sensitivity clause", () => {
  it("a TL with 404 on the sensitive benefit reads its versions, comments and attachments and comments on it", async () => {
    const exists = await sql<{ n: string }>`SELECT count(*)::text AS n FROM benefit WHERE id = ${BENEFIT}::uuid AND transformation_id = ${T}::uuid`.execute(
      api.db,
    );
    expect(exists.rows[0]!.n).toBe("1");
    // Before the marking, the TL comments (a normal P5 action), so the record has a comment with text.
    const before = await call<Loose>(api.app, "POST", `${FR}/comments`, {
      session: tl,
      body: { body: "Synthetic remark: the supplier rebate is 4.2 MSAR." },
    });
    console.log("TL comment before marking", before.status);

    const mark = await call<Loose>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${BENEFIT}/sensitivity`, {
      session: to,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic: commercially sensitive figure." },
    });
    expect(mark.status).toBe(200);
    // The TO (admitted: sensitive_record.grant) comments after the marking.
    const toComment = await call<Loose>(api.app, "POST", `${FR}/comments`, {
      session: to,
      body: { body: "Synthetic: restricted - the final rebate figure is 5.1 MSAR." },
    });
    console.log("TO comment after marking", toComment.status);

    const record = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${BENEFIT}`, { session: tl });
    const compare = await call<Loose>(api.app, "GET", `${FR}/compare`, { session: tl, contract: false });
    const versions = await call<Loose>(api.app, "GET", `${FR}/versions`, { session: tl });
    const comments = await call<Loose>(api.app, "GET", `${FR}/comments`, { session: tl });
    const attachments = await call<Loose>(api.app, "GET", `${FR}/attachments`, { session: tl });
    const after = await call<Loose>(api.app, "POST", `${FR}/comments`, {
      session: tl,
      body: { body: "Synthetic: TL writes on a record it cannot open." },
    });
    console.log("TL GET benefit", record.status, "| compare", compare.status);
    console.log("TL GET versions", versions.status, JSON.stringify(versions.body).slice(0, 500));
    console.log("TL GET comments", comments.status, JSON.stringify(comments.body).slice(0, 700));
    console.log("TL GET attachments", attachments.status, JSON.stringify(attachments.body).slice(0, 300));
    console.log("TL POST comment after marking", after.status, JSON.stringify(after.body).slice(0, 200));

    expect(record.status).toBe(404);
    // The defect (a fixed product answers 404 to each of these, as the record GET does):
    expect(versions.status).toBe(200);
    expect(comments.status).toBe(200);
  }, 120_000);
});
