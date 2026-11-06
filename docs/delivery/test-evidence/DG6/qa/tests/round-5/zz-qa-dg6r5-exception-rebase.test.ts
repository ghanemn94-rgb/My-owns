// qa-verifier DG6 round 5 (T-DG6-REV-QA-R5): independent probe of T-DG6-BE-Z6 (D-213/D-214 open question), NOT part
// of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/operations/zz-qa-dg6r5-exception-rebase.test.ts and run on a disposable PostgreSQL
// (tests/qa/support/with-pg.sh npx vitest run --project integration <file>).
// Questions: does the "rebase over system recurrences" rule of acknowledge/resolve
//   (Q1) lose a system update (the occurrence count, last error, last occurrence written by a recurrence)?
//   (Q2) hide a real conflict when recurrences run CONCURRENTLY with the human action, or when two humans race with
//        stale versions?
//   (Q3) let a stale human write overwrite a newer human one?
//   (Q4) treat a recurrence attributed to a user (actorUserId set) as a system one?
//   (Q5) accept a malformed or out-of-range If-Match?
//   (Q6) record the loaded version in the audit event (changes.based_on_version)?
// Every value is SYNTHETIC. Acknowledging or resolving an exception approves nothing (no G1-G6 business approval) and
// never touches DG0-DG7 or a KPI value.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raiseOperationalException } from "../../../src/modules/operations/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/operations/exceptions";
const SERVICE = { actorUserId: null, actorType: "service" as const, requestId: "qa-r5:svc" };

let api: TestApi;
let w: World;
let admin: Session;
let admin2: Session;
let admin2Id: string;

const tag = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");
const get = async (id: string, s: Session = admin): Promise<Body> => {
  const r = await call<Body>(api.app, "GET", `${L}/${id}`, { session: s });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const act = (verb: "acknowledge" | "resolve", id: string, version: number | string, note: string | null, s = admin) =>
  call<Body>(api.app, "POST", `${L}/${id}/${verb}`, {
    session: s,
    body: { note },
    headers: typeof version === "number" ? ifm(version) : { "if-match": version },
  });
const rowOf = (id: string) =>
  api.db.selectFrom("operational_exception").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

function raiser(ctx: { actorUserId: string | null; actorType: "service" | "user"; requestId: string } = SERVICE) {
  const code = `qar5.ex_${tag()}`;
  let n = 0;
  return async (): Promise<string> => {
    n += 1;
    return (
      await api.db.transaction().execute((tx) =>
        raiseOperationalException(tx, ctx as never, {
          organizationId: w.orgA.id,
          sourceKind: "job",
          sourceCode: code,
          failureClass: "job_failed",
          errorCode: "automation.retries_exhausted",
          errorMessage: `Synthetic failure number ${n}.`,
        }),
      )
    ).exceptionId;
  };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  const u = await createUser(api.db, w.orgA.id);
  admin2Id = u.id;
  await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
  admin2 = await signIn(api.app, u.subject);
});
afterAll(async () => {
  await api?.close();
});

describe("QA-R5 BE-Z6 rebase probe", () => {
  it("Q1+Q6: a rebased acknowledge keeps every recurrence's fields and records based_on_version", async () => {
    const raise = raiser();
    const id = await raise();
    const loaded = await get(id);
    for (let i = 0; i < 3; i++) await raise();
    const before = await rowOf(id);
    expect(before.occurrence_count).toBe(4);
    const ack = await act("acknowledge", id, loaded.version, "QA R5 synthetic acknowledgement");
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    const after = await rowOf(id);
    console.log(
      `QA-R5 Q1 loaded v${loaded.version} count ${loaded.occurrenceCount}; before ack v${before.version} count ${before.occurrence_count} ` +
        `msg ${JSON.stringify(before.last_error_message)}; after ack v${after.version} count ${after.occurrence_count} ` +
        `msg ${JSON.stringify(after.last_error_message)} status ${after.status}`,
    );
    expect(after.occurrence_count).toBe(before.occurrence_count);
    expect(after.last_error_message).toBe(before.last_error_message);
    expect(after.last_occurred_at.toISOString()).toBe(before.last_occurred_at.toISOString());
    expect(after.version).toBe(before.version + 1);
    const ev = (await auditOf(api.db, id)).filter((a) => a.action === "operational_exception.acknowledged");
    expect(ev).toHaveLength(1);
    const changes = typeof ev[0]!.changes === "string" ? JSON.parse(ev[0]!.changes as string) : ev[0]!.changes;
    console.log(`QA-R5 Q6 audit prior ${ev[0]!.prior_version} new ${ev[0]!.new_version} changes ${JSON.stringify(changes)}`);
    expect([ev[0]!.prior_version, ev[0]!.new_version]).toEqual([before.version, before.version + 1]);
    expect(changes.based_on_version).toEqual({ from: loaded.version, to: before.version });
    // An exact If-Match writes no based_on_version.
    const res = await act("resolve", id, after.version, "QA R5 synthetic resolution");
    expect(res.status).toBe(200);
    const rv = (await auditOf(api.db, id)).filter((a) => a.action === "operational_exception.resolved")[0]!;
    const rch = typeof rv.changes === "string" ? JSON.parse(rv.changes as string) : rv.changes;
    expect(rch.based_on_version).toBeUndefined();
  });

  it("Q2: 20 concurrent recurrences around a rebased acknowledge: the ack applies once, no recurrence is lost, no 500", async () => {
    const raise = raiser();
    const id = await raise();
    const loaded = await get(id);
    const results = await Promise.allSettled([
      ...Array.from({ length: 10 }, () => raise()),
      act("acknowledge", id, loaded.version, "QA R5 concurrent acknowledgement"),
      ...Array.from({ length: 10 }, () => raise()),
    ]);
    const ackR = results[10] as PromiseFulfilledResult<{ status: number; body: Body }>;
    const rejected = results.filter((r) => r.status === "rejected");
    const row = await rowOf(id);
    console.log(
      `QA-R5 Q2 ack ${ackR.value.status} ${ackR.value.status !== 200 ? JSON.stringify(ackR.value.body) : ""}; ` +
        `raise rejections ${rejected.length}; final v${row.version} count ${row.occurrence_count} status ${row.status}`,
    );
    console.log(`QA-R5 Q2 rejection reasons: ${rejected.map((r) => String((r as PromiseRejectedResult).reason?.message ?? (r as PromiseRejectedResult).reason).slice(0, 400)).join(' | ')}`);
    expect(rejected).toEqual([]);
    expect(ackR.value.status).toBe(200);
    expect(row.status).toBe("acknowledged");
    expect(row.occurrence_count).toBe(21);
    expect(row.version).toBe(loaded.version + 20 + 1);
    const trail = (await auditOf(api.db, id)).map((a) => a.action);
    expect(trail.filter((a) => a === "operational_exception.recurred")).toHaveLength(20);
    expect(trail.filter((a) => a === "operational_exception.acknowledged")).toHaveLength(1);
  });

  it("Q2+Q3: two humans acting concurrently on the same stale version after recurrences: exactly one wins", async () => {
    for (let round = 0; round < 5; round++) {
      const raise = raiser();
      const id = await raise();
      const seen = (await get(id)).version;
      await raise();
      await raise();
      const [a, b] = await Promise.all([
        act("acknowledge", id, seen, "QA R5 admin one", admin),
        act("resolve", id, seen, "QA R5 admin two", admin2),
      ]);
      const statuses = [a.status, b.status].sort();
      const row = await rowOf(id);
      console.log(`QA-R5 Q3 round ${round}: ack ${a.status} resolve ${b.status}; final ${row.status} v${row.version}`);
      expect(statuses).toEqual([200, 409]);
      const winner = a.status === 200 ? "acknowledged" : "resolved";
      expect(row.status).toBe(winner);
      const humanEvents = (await auditOf(api.db, id)).filter((x) =>
        ["operational_exception.acknowledged", "operational_exception.resolved"].includes(x.action as string),
      );
      expect(humanEvents).toHaveLength(1);
    }
  });

  it("Q3: a stale human resolve after another human's acknowledge plus recurrences is 409 and changes nothing", async () => {
    const raise = raiser();
    const id = await raise();
    const seen = (await get(id)).version;
    expect((await act("acknowledge", id, seen, "QA R5 first human", admin2)).status).toBe(200);
    await raise();
    await raise();
    const before = await rowOf(id);
    const stale = await act("resolve", id, seen, "QA R5 stale human");
    console.log(`QA-R5 Q3b stale resolve ${stale.status} ${JSON.stringify(stale.body?.code)} current ${stale.body?.currentVersion}`);
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(before.version);
    expect(await rowOf(id)).toEqual(before);
    expect((await rowOf(id)).acknowledged_by).toBe(admin2Id);
  });

  it("Q4: a recurrence attributed to a user is not treated as a system recurrence (409, conservative)", async () => {
    const userCtx = { actorUserId: w.admin.id, actorType: "user" as const, requestId: "qa-r5:user" };
    const raise = raiser(userCtx);
    const id = await raise();
    const seen = (await get(id)).version;
    await raise();
    const r = await act("acknowledge", id, seen, null, admin2);
    console.log(`QA-R5 Q4 user-attributed recurrence then stale ack: ${r.status} ${JSON.stringify(r.body?.code)}`);
    expect(r.status).toBe(409);
  });

  it("Q5: If-Match 0, negative, non-numeric, weak or a far-ahead version is refused; nothing is written", async () => {
    const raise = raiser();
    const id = await raise();
    await raise();
    const before = await rowOf(id);
    const out: string[] = [];
    for (const v of [0, -1, 999, '"abc"', 'W/"1"', '"1.5"', "*"]) {
      const r = await act("acknowledge", id, v as number | string, null);
      out.push(`${JSON.stringify(v)} -> ${r.status} ${r.body?.code ?? ""}`);
      expect(r.status === 400 || r.status === 409 || r.status === 428, `${v}: ${r.status}`).toBe(true);
    }
    console.log(`QA-R5 Q5 ${out.join("; ")}`);
    expect(await rowOf(id)).toEqual(before);
  });
});
