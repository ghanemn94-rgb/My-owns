// Amendments and reversals of approved values (T-DG4-KBE-E; ADR-0030 §4, §11). Proves, against the run's disposable
// PostgreSQL, REQ-S08-017 "an in-place edit of a validated value is 409; a reversal nets the total and both records
// remain visible": 240000.5 approved -> amended to 239500 (signed delta -500.5000; validated total 239500.0000) ->
// reversed (-239500.0000; validated total 0.0000) with all three validated rows visible and linked to the original;
// once reversed, nothing more; FIN only (BO, AUD, ADM-only 403); If-Match 428/409; one audit event per new row by FIN.
// F-DG4-101 (T-DG4-KBE-R5): each correction steps the original's version (`finance_validation.corrected`), so every
// correction names the ETag the previous one left, and a correction from a stale view is 409 with the current version.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import { approve, measuredBenefit, submittedValue, type Body } from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let FV: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  FV = `${b.base}/finance-validations`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

let month = 0;
const period = () => {
  month += 1;
  const m = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(2034, month, 0)).getUTCDate();
  return { periodStart: `2034-${m}-01`, periodEnd: `2034-${m}-${end}` };
};
const validatedOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return (r.body.series as Body[]).find((s) => s.state === "validated");
};

describe("REQ-S08-017: corrections are linked rows; the original stays visible", () => {
  it("amend 240000.5 -> 239500 (delta -500.5); reverse -> 0.0000; three validated rows; nothing more after", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "250000", period());
    const decided = await approve(api, b, v, "240000.5");
    expect((await validatedOf(ben.id)).total.amount).toBe("240000.5000");

    const amend = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(decided.version),
      body: { correctedAmount: "239500", reason: "Synthetic: one invoice double-counted" },
    });
    expect(amend.status, JSON.stringify(amend.body)).toBe(201);
    expect(amend.headers.location).toBe(`${FV}/${amend.body.id}`);
    expect(amend.body).toMatchObject({
      kind: "amendment",
      correctsValidationId: v.validationId,
      status: "approved",
      approvedAmount: "-500.5000",
      decidedBy: b.users.fin.id,
      reason: "Synthetic: one invoice double-counted",
    });
    expect(Object.keys(amend.body.content).sort()).toEqual(
      ["assumptions", "attribution", "baseline", "calculation", "evidence", "measurementPeriod"].sort(),
    );
    const v1 = await validatedOf(ben.id);
    expect([v1.total.amount, v1.count]).toEqual(["239500.0000", 2]);

    // F-DG4-101: each correction steps the original's version, so the next one names the new ETag.
    const unchanged = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(decided.version + 1),
      body: { correctedAmount: "239500.0000", reason: "Synthetic: no change" },
    });
    expect([unchanged.status, unchanged.body.code, unchanged.body.detail]).toEqual([
      422,
      "finance_validation.amendment_unchanged",
      "The corrected amount equals the current validated amount.",
    ]);

    // The refused (unchanged) amendment wrote nothing, so the original is still at decided.version + 1.
    const rev = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(decided.version + 1),
      body: { reason: "Synthetic: initiative cancelled, value withdrawn" },
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect([rev.body.kind, rev.body.approvedAmount, rev.body.correctsValidationId]).toEqual([
      "reversal",
      "-239500.0000",
      v.validationId,
    ]);
    const v2 = await validatedOf(ben.id);
    expect([v2.total.amount, v2.count]).toEqual(["0.0000", 3]);
    expect((v2.lines as Body[]).map((l) => l.amount)).toEqual(
      expect.arrayContaining(["240000.5000", "-500.5000", "-239500.0000"]),
    );
    // Both corrections are measurements linked to the original, visible in the list.
    const list = await call<Body>(api.app, "GET", `${b.base}/benefits/${ben.id}/measurements`, {
      session: b.s.auditor,
    });
    const rows = list.body.items as Body[];
    expect(rows.map((m) => [m.kind, m.status, m.correctsMeasurementId ?? null])).toEqual([
      ["reversal", "validated", v.measurementId],
      ["amendment", "validated", v.measurementId],
      ["measurement", "validated", null],
    ]);
    // Audit: one event per new row, actor FIN.
    for (const m of rows.filter((x) => x.kind !== "measurement"))
      expect((await auditOf(api.db, m.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
        [`benefit_measurement.${m.kind}`, b.users.fin.id],
      ]);
    expect((await auditOf(api.db, rev.body.id)).map((e) => e.action)).toEqual(["finance_validation.reversal"]);
    // The original stepped once per correction (amendment, reversal), each step audited by FIN; the refused one wrote none.
    expect(
      (await auditOf(api.db, v.validationId))
        .filter((e) => e.action === "finance_validation.corrected")
        .map((e) => [e.actor_user_id, e.prior_version, e.new_version]),
    ).toEqual([
      [b.users.fin.id, decided.version, decided.version + 1],
      [b.users.fin.id, decided.version + 1, decided.version + 2],
    ]);

    // Once reversed: no second reversal and no amendment.
    for (const [path, body] of [
      ["reversals", { reason: "Synthetic: again" }],
      ["amendments", { correctedAmount: "1", reason: "Synthetic: again" }],
    ] as const) {
      const r = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/${path}`, {
        session: b.s.fin,
        headers: ifm(decided.version + 2),
        body,
      });
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "finance_validation.already_reversed",
        "This value is already reversed.",
      ]);
    }
  });

  it("only an approved validation is corrected; FIN only; If-Match 428/409; a reason is required", async () => {
    const ben = await measuredBenefit(api, b);
    const queued = await submittedValue(api, b, ben.id, "100", period());
    const notApproved = await call<Body>(api.app, "POST", `${FV}/${queued.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    expect([notApproved.status, notApproved.body.code, notApproved.body.detail]).toEqual([
      422,
      "finance_validation.not_approved",
      "Only an approved validation can be amended or reversed.",
    ]);
    const v = await submittedValue(api, b, ben.id, "100", period());
    const d = await approve(api, b, v, "100");
    for (const s of [b.s.bo, b.s.auditor, b.s.admin, b.s.tl])
      expect(
        (
          await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
            session: s,
            headers: ifm(d.version),
            body: { reason: "Synthetic reason" },
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          headers: ifm(d.version + 5),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          headers: ifm(d.version),
          body: {},
        })
      ).status,
    ).toBe(400);
    const rows = await api.db
      .selectFrom("benefit_measurement")
      .select("id")
      .where("corrects_measurement_id", "=", v.measurementId)
      .execute();
    expect(rows).toEqual([]);
  });
});

// F-DG4-101 (T-DG4-KBE-R5; D-117): every amendment or reversal bumps the ORIGINAL validation's version in the same
// transaction, under the financeValidationQueue lock (730233), so If-Match names the chain's current state. A
// correction made from a view that predates another correction is 409 with the current version; nothing is written.
describe("F-DG4-101: a correction from a stale view is 409 with the current version", () => {
  const original = async (id: string) => {
    const r = await call<Body>(api.app, "GET", `${FV}/${id}`, { session: b.s.auditor });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.etag).toBe(`"${r.body.version}"`);
    return r.body as Body;
  };
  const correctionsOf = async (measurementId: string) =>
    api.db
      .selectFrom("benefit_measurement")
      .select(["kind", "amount"])
      .where("corrects_measurement_id", "=", measurementId)
      .orderBy("measurement_no")
      .execute();

  it("the reviewer's F2 case: FIN-B amends to 900 with ETag V; FIN-A, still holding V, gets 409 and 900 stands", async () => {
    const finB = await extraUser(api, w, b, "FIN");
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const decided = await approve(api, b, v, "1000");
    const held = decided.version as number; // both Finance users hold this ETag
    const amendB = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: finB.session,
      headers: ifm(held),
      body: { correctedAmount: "900", reason: "Synthetic: a double count found by FIN-B" },
    });
    expect([amendB.status, amendB.body.approvedAmount], JSON.stringify(amendB.body)).toEqual([201, "-100.0000"]);
    // The original's version stepped with FIN-B's correction (and its audit event names FIN-B and the reason).
    const after = await original(v.validationId);
    expect(after.version).toBe(held + 1);
    const bumped = (await auditOfRequest(api.db, String(amendB.headers["x-request-id"]))).filter(
      (e) => e.record_id === v.validationId,
    );
    expect(bumped.map((e) => [e.action, e.actor_user_id, e.prior_version, e.new_version, e.reason])).toEqual([
      ["finance_validation.corrected", finB.id, held, held + 1, "Synthetic: a double count found by FIN-B"],
    ]);
    const amendA = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { correctedAmount: "1100", reason: "Synthetic: FIN-A from a stale screen" },
    });
    expect([amendA.status, amendA.body.code, amendA.body.currentVersion]).toEqual([409, "version_conflict", held + 1]);
    expect((await validatedOf(ben.id)).total.amount).toBe("900.0000");
    expect(await correctionsOf(v.measurementId)).toEqual([{ kind: "amendment", amount: "-100.0000" }]);
    expect((await auditOfRequest(api.db, String(amendA.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
    // With the current ETag, FIN-A's correction is made against what FIN-B left: 1100 - 900 = +200.
    const retry = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held + 1),
      body: { correctedAmount: "1100", reason: "Synthetic: FIN-A re-applies on the current view" },
    });
    expect([retry.status, retry.body.approvedAmount]).toEqual([201, "200.0000"]);
    expect((await original(v.validationId)).version).toBe(held + 2);
    expect((await validatedOf(ben.id)).total.amount).toBe("1100.0000");
  });

  it("stale amend then reverse: after an amendment, a reversal with the pre-amendment ETag is 409; with the new one 201", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "500", period());
    const held = (await approve(api, b, v, "500")).version as number;
    const amend = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { correctedAmount: "450", reason: "Synthetic amendment" },
    });
    expect(amend.status, JSON.stringify(amend.body)).toBe(201);
    const stale = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { reason: "Synthetic reversal from a stale view" },
    });
    expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "version_conflict", held + 1]);
    expect((await validatedOf(ben.id)).total.amount).toBe("450.0000");
    expect(await correctionsOf(v.measurementId)).toEqual([{ kind: "amendment", amount: "-50.0000" }]);
    const rev = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(held + 1),
      body: { reason: "Synthetic reversal on the current view" },
    });
    expect([rev.status, rev.body.approvedAmount]).toEqual([201, "-450.0000"]);
    expect((await validatedOf(ben.id)).total.amount).toBe("0.0000");
    expect((await original(v.validationId)).version).toBe(held + 2);
  });

  it("stale reverse then amend: after a reversal, an amendment with the pre-reversal ETag is 409; with the new one 422", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "800", period());
    const held = (await approve(api, b, v, "800")).version as number;
    const rev = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { reason: "Synthetic reversal" },
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const stale = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { correctedAmount: "700", reason: "Synthetic amendment from a stale view" },
    });
    expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "version_conflict", held + 1]);
    expect(await correctionsOf(v.measurementId)).toEqual([{ kind: "reversal", amount: "-800.0000" }]);
    const current = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held + 1),
      body: { correctedAmount: "700", reason: "Synthetic amendment on the current view" },
    });
    expect([current.status, current.body.code]).toEqual([422, "finance_validation.already_reversed"]);
    expect((await validatedOf(ben.id)).total.amount).toBe("0.0000");
  });
  it("the database still keeps a decided validation final: only a correction's version step passes the guard", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "300", period());
    const held = (await approve(api, b, v, "300")).version as number;
    const step = () =>
      api.db
        .updateTable("finance_validation")
        .set({ version: held + 1 })
        .where("id", "=", v.validationId)
        .execute();
    // No correction yet: a bare version step of an approved validation is refused (finance_validation_status_step).
    await expect(step()).rejects.toThrow(/finance_validation_status_step|is final/);
    const amend = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(held),
      body: { correctedAmount: "250", reason: "Synthetic amendment" },
    });
    expect(amend.status, JSON.stringify(amend.body)).toBe(201);
    // With a correction, the decision, amount and items stay immutable; only a +1 version step is allowed.
    await expect(
      api.db
        .updateTable("finance_validation")
        .set({ approved_amount: "1", version: held + 2 })
        .where("id", "=", v.validationId)
        .execute(),
    ).rejects.toThrow(/finance_validation_status_step|is final/);
    await expect(
      api.db
        .updateTable("finance_validation")
        .set({ version: held + 3 })
        .where("id", "=", v.validationId)
        .execute(),
    ).rejects.toThrow(/finance_validation_status_step|is final/);
    expect((await original(v.validationId)).approvedAmount).toBe("300.0000");
  });
});
