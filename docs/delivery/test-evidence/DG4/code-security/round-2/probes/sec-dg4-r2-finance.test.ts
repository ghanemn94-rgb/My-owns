// code-security-reviewer DG4 round-2 probe F (T-DG4-REV-SEC-R2). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/ (it imports the implementers' benefit fixtures read-only).
// All data is synthetic; nothing here is a real Finance approval, and nothing relates to DG0-DG7.
// Verifies F-DG4-101 (stale Finance correction accepted) on candidate 3f51b79d (source 93a7dd7):
//   F1  two Finance users decide the same queued value at once: exactly one 200; counted once.
//   F2  FIN-B amends with the approved ETag; FIN-A then amends with the SAME (stale) ETag: expected 409, nothing written.
//   F2a stale amend, then reverse: FIN-B amends; FIN-A reverses with the stale ETag: 409; total stays FIN-B's.
//   F2b stale reverse, then amend: FIN-B reverses; FIN-A amends with the stale ETag: 409 (not already_reversed
//       disclosure is fine too, but no row may be written); total stays 0.
//   F2c the fresh ETag (re-read of the original) is accepted, and each step leaves exactly one finance_validation.corrected
//       audit row whose prior/new versions chain.
//   F3  an amendment and a reversal at the same time with the same ETag: exactly one wins, consistent end state.
//   F3b two amendments at the same time with the same ETag: exactly one 201.
//   F4  a validated measurement edited in place: 409 benefit_measurement.validated_immutable.
//   F5  decimal: 900719925474099.1234 approved and amended by -0.0001 gives exactly ...099.1233.
//   G   migration 0061 as mth_app (the server's role), direct SQL against finance_validation:
//       G1 approved validation WITH a correction: version+1 and nothing else -> allowed (the repair path)
//       G2 same row: version+1 AND approved_amount changed -> refused
//       G3 same row: version+2 -> refused
//       G4 same row: version+1 AND decided_by changed -> refused
//       G5 same row: version+1 AND status 'rejected' -> refused
//       G6 approved validation WITHOUT any correction: version+1 -> refused
//       G7 a correction row (kind amendment): version+1 -> refused
//       G8 a rejected validation that is (forced) referenced: impossible to create, so check version+1 on a rejected row -> refused
//       G9 same row as G1: version+1 AND content changed -> refused
//       G10 same row: version+1, updated_by set to another user (residual: allowed by design, recorded)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue, type Body } from "../benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let FV: string;
let finB: { id: string; session: import("../../support/harness.ts").Session };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  FV = `${b.base}/finance-validations`;
  finB = await extraUser(api, w, b, "FIN");
}, 120_000);
afterAll(() => api.close(), 60_000);

let month = 0;
const period = () => {
  month += 1;
  const m = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(2036, month, 0)).getUTCDate();
  return { periodStart: `2036-${m}-01`, periodEnd: `2036-${m}-${end}` };
};
const validatedOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return (r.body.series as Body[]).find((s) => s.state === "validated");
};
const rowsOf = (benefitId: string) =>
  api.db.selectFrom("benefit_measurement").select(["kind", "amount", "measurement_no"]).where("benefit_id", "=", benefitId).orderBy("measurement_no").execute();
const approvedValue = async (amount = "1000") => {
  const ben = await measuredBenefit(api, b);
  const v = await submittedValue(api, b, ben.id, amount, period());
  const decided = await approve(api, b, v, amount);
  return { ben, v, etag: decided.version as number };
};
const amend = (session: unknown, id: string, etag: number, correctedAmount: string, reason = "Synthetic amendment") =>
  call<Body>(api.app, "POST", `${FV}/${id}/amendments`, { session: session as never, headers: ifm(etag), body: { correctedAmount, reason } });
const reverse = (session: unknown, id: string, etag: number, reason = "Synthetic reversal") =>
  call<Body>(api.app, "POST", `${FV}/${id}/reversals`, { session: session as never, headers: ifm(etag), body: { reason } });
const show = (r: { status: number; body: Body }) => `${r.status} ${r.body.approvedAmount ?? r.body.code}`;

describe("SEC-DG4-R2 probe F: Finance decision and correction integrity (F-DG4-101 re-verification)", () => {
  it("F1 two Finance users decide the same queued value at once: exactly one 200; counted once", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const body = { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "1000" };
    const res = await Promise.all([b.s.fin, finB.session].map((session) =>
      call<Body>(api.app, "POST", `${FV}/${v.validationId}/decision`, { session, headers: ifm(v.validationVersion), body }),
    ));
    const total = (await validatedOf(ben.id)).total.amount;
    console.log(`[probe-F] F1 ${JSON.stringify(res.map((r) => [r.status, r.body.code ?? r.body.status]))}; validated total ${total}`);
    expect(res.filter((r) => r.status === 200).length).toBe(1);
    expect(total).toBe("1000.0000");
  });

  it("F2 stale amend after another Finance user's amend: 409, nothing written", async () => {
    const { ben, v, etag } = await approvedValue();
    const byB = await amend(finB.session, v.validationId, etag, "900", "Synthetic: FIN-B finds a double count");
    const afterB = (await validatedOf(ben.id)).total.amount;
    const auditBefore = await api.db.selectFrom("audit_event").select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow();
    const stale = await amend(b.s.fin, v.validationId, etag, "1100", "Synthetic: FIN-A, from the screen loaded before FIN-B's change");
    const auditAfter = await api.db.selectFrom("audit_event").select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow();
    const afterA = (await validatedOf(ben.id)).total.amount;
    const original = await call<Body>(api.app, "GET", `${FV}/${v.validationId}`, { session: b.s.auditor });
    const rows = await rowsOf(ben.id);
    console.log(`[probe-F] F2 approved ETag ${etag}; FIN-B amend -> ${show(byB)}; total ${afterB}; FIN-A stale amend (If-Match ${etag}) -> ${show(stale)} etag-hdr ${stale.headers.etag ?? "-"}; total ${afterA}; original ETag now ${original.headers.etag}; rows ${rows.length}; audit rows written by the stale call ${Number(auditAfter.n) - Number(auditBefore.n)}`);
    expect(byB.status).toBe(201);
    expect(stale.status).toBe(409);
    expect(afterA).toBe("900.0000");
    expect(rows.map((r) => r.kind)).toEqual(["measurement", "amendment"]);
    expect(original.headers.etag).toBe(`"${etag + 1}"`);
  });

  it("F2a stale amend then stale reverse: the reverse is 409", async () => {
    const { ben, v, etag } = await approvedValue();
    const byB = await amend(finB.session, v.validationId, etag, "800");
    const stale = await reverse(b.s.fin, v.validationId, etag);
    const total = (await validatedOf(ben.id)).total.amount;
    const rows = await rowsOf(ben.id);
    console.log(`[probe-F] F2a FIN-B amend -> ${show(byB)}; FIN-A stale reverse (If-Match ${etag}) -> ${show(stale)}; total ${total}; rows ${JSON.stringify(rows.map((r) => r.kind))}`);
    expect([byB.status, stale.status, total]).toEqual([201, 409, "800.0000"]);
    expect(rows.map((r) => r.kind)).toEqual(["measurement", "amendment"]);
  });

  it("F2b reverse then stale amend: refused (409 or already_reversed), nothing written", async () => {
    const { ben, v, etag } = await approvedValue();
    const byB = await reverse(finB.session, v.validationId, etag);
    const stale = await amend(b.s.fin, v.validationId, etag, "1200");
    const total = (await validatedOf(ben.id)).total.amount;
    const rows = await rowsOf(ben.id);
    console.log(`[probe-F] F2b FIN-B reverse -> ${show(byB)}; FIN-A stale amend (If-Match ${etag}) -> ${show(stale)}; total ${total}; rows ${JSON.stringify(rows.map((r) => r.kind))}`);
    expect(byB.status).toBe(201);
    expect([409, 422]).toContain(stale.status);
    expect(total).toBe("0.0000");
    expect(rows.map((r) => r.kind)).toEqual(["measurement", "reversal"]);
  });

  it("F2c fresh ETag after re-read is accepted; corrected audit rows chain versions", async () => {
    const { ben, v, etag } = await approvedValue();
    const a1 = await amend(finB.session, v.validationId, etag, "900");
    const g1 = await call<Body>(api.app, "GET", `${FV}/${v.validationId}`, { session: b.s.fin });
    const e1 = Number(String(g1.headers.etag).replaceAll('"', ""));
    const a2 = await amend(b.s.fin, v.validationId, e1, "950");
    const g2 = await call<Body>(api.app, "GET", `${FV}/${v.validationId}`, { session: b.s.fin });
    const e2 = Number(String(g2.headers.etag).replaceAll('"', ""));
    const r3 = await reverse(finB.session, v.validationId, e2);
    const total = (await validatedOf(ben.id)).total.amount;
    const corrected = await api.db.selectFrom("audit_event").select(["action", "prior_version", "new_version", "actor_user_id"])
      .where("record_id", "=", v.validationId).where("action", "=", "finance_validation.corrected").orderBy("seq").execute();
    const orig = await api.db.selectFrom("finance_validation").select(["version", "approved_amount", "status", "decided_by"]).where("id", "=", v.validationId).executeTakeFirstOrThrow();
    console.log(`[probe-F] F2c ${etag}->${show(a1)}; ETag ${e1}->${show(a2)}; ETag ${e2}->reverse ${show(r3)}; total ${total}; original ${JSON.stringify(orig)}; corrected audit ${JSON.stringify(corrected)}`);
    expect([a1.status, a2.status, r3.status, total]).toEqual([201, 201, 201, "0.0000"]);
    expect([e1, e2, orig.version]).toEqual([etag + 1, etag + 2, etag + 3]);
    expect(orig.approved_amount).toBe("1000.0000");
    expect(corrected.map((c) => [c.prior_version, c.new_version])).toEqual([[etag, etag + 1], [etag + 1, etag + 2], [etag + 2, etag + 3]]);
  });

  it("F3 an amendment and a reversal at the same time with the same ETag: exactly one wins", async () => {
    const { ben, v, etag } = await approvedValue();
    const [am, rv] = await Promise.all([amend(finB.session, v.validationId, etag, "700"), reverse(b.s.fin, v.validationId, etag)]);
    const total = (await validatedOf(ben.id)).total.amount;
    const rows = await rowsOf(ben.id);
    console.log(`[probe-F] F3 amend ${show(am)}; reverse ${show(rv)}; total ${total}; rows ${JSON.stringify(rows)}`);
    expect([am.status, rv.status].filter((s) => s === 201).length).toBe(1);
    expect(rows.length).toBe(2);
    expect(total).toBe(rv.status === 201 ? "0.0000" : "700.0000");
  });

  it("F3b two amendments at the same time with the same ETag: exactly one 201", async () => {
    const { ben, v, etag } = await approvedValue();
    const res = await Promise.all([amend(finB.session, v.validationId, etag, "700"), amend(b.s.fin, v.validationId, etag, "1300")]);
    const total = (await validatedOf(ben.id)).total.amount;
    const rows = await rowsOf(ben.id);
    console.log(`[probe-F] F3b ${res.map(show).join(" / ")}; total ${total}; rows ${rows.length}`);
    expect(res.filter((r) => r.status === 201).length).toBe(1);
    expect(res.filter((r) => r.status === 409).length).toBe(1);
    expect(rows.length).toBe(2);
  });

  it("F4 a validated value is never edited in place (409)", async () => {
    const { v } = await approvedValue();
    const m = await api.db.selectFrom("benefit_measurement").select(["version"]).where("id", "=", v.measurementId).executeTakeFirstOrThrow();
    const res = await call<Body>(api.app, "PATCH", `${b.base}/benefit-measurements/${v.measurementId}`, { session: b.s.bo, headers: ifm(m.version), body: { amount: "5000" } });
    console.log(`[probe-F] F4 edit validated -> ${res.status} ${res.body.code}`);
    expect([res.status, res.body.code]).toEqual([409, "benefit_measurement.validated_immutable"]);
  });

  it("F5 decimal end to end: 900719925474099.1234 then -0.0001 is exactly ...099.1233", async () => {
    const { ben, v, etag } = await approvedValue("900719925474099.1234");
    const t1 = (await validatedOf(ben.id)).total.amount;
    const am = await amend(finB.session, v.validationId, etag, "900719925474099.1233", "Synthetic: rounding");
    const t2 = (await validatedOf(ben.id)).total.amount;
    console.log(`[probe-F] F5 approved total ${t1}; amendment ${show(am)}; total ${t2}`);
    expect([t1, am.body.approvedAmount, t2]).toEqual(["900719925474099.1234", "-0.0001", "900719925474099.1233"]);
  });

  it("G migration 0061 as mth_app: only version+1 (stamps) on an approved, corrected validation is admitted", async () => {
    const corrected = await approvedValue();
    await amend(finB.session, corrected.v.validationId, corrected.etag, "990");
    const plain = await approvedValue();
    const id = corrected.v.validationId;
    const cur = async (x: string) => (await api.db.selectFrom("finance_validation").selectAll().where("id", "=", x).executeTakeFirstOrThrow());
    const corrRow = await api.db.selectFrom("finance_validation").select(["id", "version"]).where("corrects_validation_id", "=", id).executeTakeFirstOrThrow();
    // a rejected validation
    const ben = await measuredBenefit(api, b);
    const rv = await submittedValue(api, b, ben.id, "1000", period());
    const rej = await call<Body>(api.app, "POST", `${FV}/${rv.validationId}/decision`, { session: b.s.fin, headers: ifm(rv.validationVersion), body: { decision: "rejected", items: { ...ALL_ACCEPTED, baseline: { decision: "rejected", note: "Synthetic" } }, note: "Synthetic rejection" } });
    const attempt = async (label: string, run: () => Promise<unknown>) => {
      try {
        await api.db.transaction().execute(async () => { await run(); });
        return `${label}: ALLOWED`;
      } catch (e) {
        const err = e as { constraint?: string; message: string };
        return `${label}: refused (${err.constraint ?? err.message.slice(0, 80)})`;
      }
    };
    const out: string[] = [];
    let c = await cur(id);
    out.push(await attempt("G2 v+1 & approved_amount", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, approved_amount: "5000" }).where("id", "=", id).execute()));
    out.push(await attempt("G3 v+2", () => api.db.updateTable("finance_validation").set({ version: c.version + 2 }).where("id", "=", id).execute()));
    out.push(await attempt("G4 v+1 & decided_by", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, decided_by: b.users.bo.id }).where("id", "=", id).execute()));
    out.push(await attempt("G5 v+1 & status rejected", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, status: "rejected" }).where("id", "=", id).execute()));
    out.push(await attempt("G9 v+1 & content", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, content: JSON.stringify({ tampered: true }) }).where("id", "=", id).execute()));
    out.push(await attempt("G9b v+1 & reason", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, reason: "tampered" }).where("id", "=", id).execute()));
    out.push(await attempt("G9c v-1 (step back)", () => api.db.updateTable("finance_validation").set({ version: c.version - 1 }).where("id", "=", id).execute()));
    out.push(await attempt("G6 uncorrected approved v+1", async () => { const p = await cur(plain.v.validationId); await api.db.updateTable("finance_validation").set({ version: p.version + 1 }).where("id", "=", p.id).execute(); }));
    out.push(await attempt("G7 correction row v+1", () => api.db.updateTable("finance_validation").set({ version: corrRow.version + 1 }).where("id", "=", corrRow.id).execute()));
    out.push(await attempt(`G8 rejected validation (${rej.status}) v+1`, async () => { const p = await cur(rv.validationId); await api.db.updateTable("finance_validation").set({ version: p.version + 1 }).where("id", "=", p.id).execute(); }));
    out.push(await attempt("G10 v+1 & updated_by other user (residual)", () => api.db.updateTable("finance_validation").set({ version: c.version + 1, updated_by: finB.id }).where("id", "=", id).execute()));
    c = await cur(id);
    out.push(await attempt("G1 v+1 only", () => api.db.updateTable("finance_validation").set({ version: c.version + 1 }).where("id", "=", id).execute()));
    console.log(`[probe-F] G ${JSON.stringify(out, null, 1)}`);
    // rev2: rev1 expected G1/G10 to commit, but a bare SQL step has no audit_event, so the 0010 deferred
    // p2_audit_required trigger refuses it at COMMIT. That is the ADR-0004 rule, not the 0061 guard: G1/G10 pass the
    // 0061 guard (they are NOT refused by finance_validation_status_step) and stop only at audit_required. The
    // audited API path that steps the version is proven by F2c. Every tamper case (G2-G9c) is refused by the 0061 guard.
    const by = (constraint: string) => out.filter((o) => o.endsWith(`(${constraint})`)).map((o) => o.split(":")[0]);
    expect(out.filter((o) => o.endsWith("ALLOWED"))).toEqual([]);
    expect(by("finance_validation_status_step").length).toBe(10);
    expect(by("finance_validation_audit_required")).toEqual(["G10 v+1 & updated_by other user (residual)", "G1 v+1 only"]);
    // G1 with its audit event in the same transaction: admitted (the repair path, without the API).
    const g1 = await api.db.transaction().execute(async (tx) => {
      const r = await tx.updateTable("finance_validation").set({ version: c.version + 1 }).where("id", "=", id).returning(["version"]).executeTakeFirstOrThrow();
      await tx.insertInto("audit_event").values({ id: crypto.randomUUID(), organization_id: b.organizationId, transformation_id: b.transformationId, actor_type: "user", actor_user_id: finB.id, action: "probe.g_one", record_type: "finance_validation", record_id: id, prior_version: c.version, new_version: r.version, request_id: "probe-g1", source: "api", changes: JSON.stringify({}) } as never).execute();
      return r.version;
    }).then((v) => `G1+audit: committed at version ${v}`, (e: { constraint?: string; message: string }) => `G1+audit: refused (${e.constraint ?? e.message.slice(0, 160)})`);
    console.log(`[probe-F] ${g1}`);
  });
});
