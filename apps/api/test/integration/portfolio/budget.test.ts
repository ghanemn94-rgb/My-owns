// Budget lines (T-DG4-BE-E; ADR-0031 §7, §9-§11, §13; REQ-S09-007 A05 "budget/actual/forecast use decimal SAR").
// Proves, against the run's disposable PostgreSQL:
//  - budget, actual and forecast round-trip as decimal strings (numeric(20,4)); null is Unknown, never 0;
//  - the line's currency is the organization default at creation (SAR here), and changing the default never rewrites
//    an existing line (S-5);
//  - the exact ADR-0031 §11 refusals: 422 budget_line.amount_invalid (negative, > 16 integer or > 4 fraction digits),
//    422 budget_line.period_invalid, 409 budget_line.duplicate, 422 budget_line.archived; a JSON number is 400;
//  - every mutation: TL and FIN may write; AUD 403; WL, TO and BO (no budget.edit) 403; ADM-only and outsiders 404 (and
//    on every read); If-Match 428/409; one audit event per change; the write authorised again at commit time.
// All data is SYNTHETIC. Nothing here is a business or Finance approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { insertInitiative, seedExecutionWorld, type ExecWorld } from "./execution-fixtures.ts";
import { createUser, grant, signIn } from "../../support/harness.ts";

let api: TestApi;
let w: World;
let x: ExecWorld;
let ini: string;
let L: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await seedExecutionWorld(api, w);
  ini = await insertInitiative(api.db, x, "INI-01");
  L = `/api/v1/initiatives/${ini}/budget-lines`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const AMOUNT_INVALID = "Amounts must be zero or more, with at most 16 digits before and 4 after the decimal point.";
const PERIOD_INVALID = "The month must be given as its first day (YYYY-MM-01).";
const ARCHIVED = "This budget line is archived and can no longer be changed.";
const DUPLICATE = "An active budget line with this label and month already exists for the initiative.";

let seq = 0;
const label = () => `Synthetic line ${++seq}`;
const create = async (body: Record<string, unknown>, session = x.s.tl) => {
  const r = await call(api.app, "POST", L, { session, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; currency: string };
};
const lineCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("budget_line")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("initiative_id", "=", ini)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("create and read: decimal strings, Unknown, currency", () => {
  it("TL creates a line: amounts round-trip as numeric(20,4) decimal strings, null stays null; SAR; version 1; audited", async () => {
    const r = await call(api.app, "POST", L, {
      session: x.s.tl,
      body: {
        label: "Synthetic licences",
        periodMonth: "2026-10-01",
        budgetAmount: "100000.25",
        actualAmount: "0.1",
        forecastAmount: null,
        ownerUserId: x.users.fin.id,
        note: "Synthetic note",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.etag).toBe('"1"');
    expect(r.headers.location).toBe(`/api/v1/budget-lines/${r.body.id}`);
    expect(r.body).toMatchObject({
      initiativeId: ini,
      transformationId: x.transformationId,
      label: "Synthetic licences",
      periodMonth: "2026-10-01",
      currency: "SAR",
      budgetAmount: "100000.2500",
      actualAmount: "0.1000",
      forecastAmount: null,
      ownerUserId: x.users.fin.id,
      status: "active",
      archivedAt: null,
      version: 1,
      createdBy: x.users.tl.id,
    });
    const row = await api.db
      .selectFrom("budget_line")
      .select(["budget_amount", "actual_amount", "forecast_amount", "currency"])
      .where("id", "=", r.body.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      budget_amount: "100000.2500",
      actual_amount: "0.1000",
      forecast_amount: null,
      currency: "SAR",
    });
    const audit = await auditOf(api.db, r.body.id);
    expect(audit.map((a) => [a.action, a.actor_user_id, a.new_version])).toEqual([
      ["budget_line.create", x.users.tl.id, 1],
    ]);
    const got = await call(api.app, "GET", `/api/v1/budget-lines/${r.body.id}`, { session: x.s.auditor });
    expect([got.status, got.headers.etag, got.body.budgetAmount]).toEqual([200, '"1"', "100000.2500"]);
  });

  it("FIN creates a whole-initiative line (no month); every amount may be Unknown", async () => {
    const b = await create({ label: label() }, x.s.fin);
    const got = await call(api.app, "GET", `/api/v1/budget-lines/${b.id}`, { session: x.s.tl });
    expect([got.body.periodMonth, got.body.budgetAmount, got.body.actualAmount, got.body.forecastAmount]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("the currency is the organization default at creation; changing the default never rewrites a line (S-5)", async () => {
    const before = await create({ label: label(), budgetAmount: "5" });
    await api.owner.query("update organization set default_currency = 'USD' where id = $1", [w.orgA.id]);
    try {
      const after = await create({ label: label(), budgetAmount: "5" });
      expect(after.currency).toBe("USD");
      const again = await call(api.app, "GET", `/api/v1/budget-lines/${before.id}`, { session: x.s.tl });
      expect(again.body.currency).toBe("SAR");
      // The currency is not a request field.
      const bad = await call(api.app, "POST", L, { session: x.s.tl, body: { label: label(), currency: "EUR" } });
      expect(bad.status).toBe(400);
    } finally {
      await api.owner.query("update organization set default_currency = 'SAR' where id = $1", [w.orgA.id]);
    }
  });

  it("lists the initiative's lines with a status filter and cursor paging; AUD reads, ADM-only and outsiders get 404", async () => {
    const all = await call(api.app, "GET", L, { session: x.s.auditor });
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThanOrEqual(3);
    const p1 = await call(api.app, "GET", `${L}?limit=1&status=active`, { session: x.s.tl });
    expect([p1.body.items.length, typeof p1.body.nextCursor]).toEqual([1, "string"]);
    const p2 = await call(
      api.app,
      "GET",
      `${L}?limit=1&status=active&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      {
        session: x.s.tl,
      },
    );
    expect(p2.body.items[0].id > p1.body.items[0].id).toBe(true);
    for (const s of [x.s.admin, x.s.outsider]) {
      expect((await call(api.app, "GET", L, { session: s })).status).toBe(404);
      expect((await call(api.app, "GET", `/api/v1/budget-lines/${p1.body.items[0].id}`, { session: s })).status).toBe(
        404,
      );
    }
  });
});

describe("refusals (ADR-0031 §11, exact codes and texts)", () => {
  it("a negative amount, more than 16 integer or 4 fraction digits -> 422 budget_line.amount_invalid at the field", async () => {
    const before = await lineCount();
    for (const [field, value] of [
      ["budgetAmount", "-1"],
      ["actualAmount", "12345678901234567"],
      ["forecastAmount", "1.12345"],
    ] as const) {
      const r = await call(api.app, "POST", L, { session: x.s.tl, body: { label: label(), [field]: value } });
      expect([r.status, r.body.code, r.body.detail]).toEqual([422, "budget_line.amount_invalid", AMOUNT_INVALID]);
      expect(r.body.errors[0].pointer).toBe(`/${field}`);
    }
    // The largest amount that fits numeric(20,4) is accepted unchanged; "-0" is zero.
    const max = await create({ label: label(), budgetAmount: "9999999999999999.9999", actualAmount: "-0" });
    const got = await call(api.app, "GET", `/api/v1/budget-lines/${max.id}`, { session: x.s.tl });
    expect([got.body.budgetAmount, got.body.actualAmount]).toEqual(["9999999999999999.9999", "0.0000"]);
    expect(await lineCount()).toBe(before + 1);
  });

  it("a JSON number is not a decimal string (400); a blank label is 400", async () => {
    expect(
      (await call(api.app, "POST", L, { session: x.s.tl, body: { label: label(), budgetAmount: 1.5 } })).status,
    ).toBe(400);
    expect((await call(api.app, "POST", L, { session: x.s.tl, body: { label: "   " } })).status).toBe(400);
  });

  it("a month that is not the first day -> 422 budget_line.period_invalid at /periodMonth (create and update)", async () => {
    const r = await call(api.app, "POST", L, { session: x.s.tl, body: { label: label(), periodMonth: "2026-10-15" } });
    expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
      422,
      "budget_line.period_invalid",
      PERIOD_INVALID,
      "/periodMonth",
    ]);
    const b = await create({ label: label() });
    const u = await call(api.app, "PATCH", `/api/v1/budget-lines/${b.id}`, {
      session: x.s.tl,
      headers: ifm(1),
      body: { periodMonth: "2026-11-02" },
    });
    expect([u.status, u.body.code]).toEqual([422, "budget_line.period_invalid"]);
  });

  it("a second active line with the same label (any case) and month -> 409 budget_line.duplicate; archived lines free it", async () => {
    const first = await create({ label: "Synthetic Cloud", periodMonth: "2026-12-01" });
    const dup = await call(api.app, "POST", L, {
      session: x.s.tl,
      body: { label: "synthetic cloud", periodMonth: "2026-12-01" },
    });
    expect([dup.status, dup.body.code, dup.body.detail, dup.body.type]).toEqual([
      409,
      "budget_line.duplicate",
      DUPLICATE,
      "urn:mth:problem:duplicate",
    ]);
    await create({ label: "Synthetic Cloud", periodMonth: "2027-01-01" }); // another month is another line
    const other = await create({ label: "Synthetic Cloud 2", periodMonth: "2026-12-01" });
    const rename = await call(api.app, "PATCH", `/api/v1/budget-lines/${other.id}`, {
      session: x.s.tl,
      headers: ifm(1),
      body: { label: "SYNTHETIC CLOUD" },
    });
    expect([rename.status, rename.body.code]).toEqual([409, "budget_line.duplicate"]);
    const arch = await call(api.app, "POST", `/api/v1/budget-lines/${first.id}/archive`, {
      session: x.s.fin,
      headers: ifm(1),
      body: { reason: "Synthetic: replaced" },
    });
    expect(arch.status).toBe(200);
    await create({ label: "synthetic cloud", periodMonth: "2026-12-01" });
  });
});

describe("update and archive: If-Match, audit, archived is final", () => {
  it("update needs If-Match (428), refuses a stale one (409 with currentVersion), then changes amounts (audited)", async () => {
    const b = await create({ label: label(), budgetAmount: "10" });
    const I = `/api/v1/budget-lines/${b.id}`;
    expect((await call(api.app, "PATCH", I, { session: x.s.tl, body: { actualAmount: "1" } })).status).toBe(428);
    const stale = await call(api.app, "PATCH", I, { session: x.s.tl, headers: ifm(7), body: { actualAmount: "1" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const ok = await call(api.app, "PATCH", I, {
      session: x.s.fin,
      headers: ifm(1),
      body: { actualAmount: "2.5", forecastAmount: "12", budgetAmount: null },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([
      ok.headers.etag,
      ok.body.budgetAmount,
      ok.body.actualAmount,
      ok.body.forecastAmount,
      ok.body.updatedBy,
    ]).toEqual(['"2"', null, "2.5000", "12.0000", x.users.fin.id]);
    const audit = await auditOf(api.db, b.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["budget_line.create", null, 1],
      ["budget_line.update", 1, 2],
    ]);
    expect(audit[1]!.changes).toMatchObject({
      budget_amount: { from: "10.0000", to: null },
      actual_amount: { from: null, to: "2.5000" },
    });
    expect((await call(api.app, "PATCH", I, { session: x.s.tl, headers: ifm(2), body: {} })).status).toBe(400);
  });

  it("archive needs a reason and If-Match; an archived line is frozen (422 budget_line.archived on update and archive)", async () => {
    const b = await create({ label: label(), budgetAmount: "3" });
    const A = `/api/v1/budget-lines/${b.id}/archive`;
    expect((await call(api.app, "POST", A, { session: x.s.tl, headers: ifm(1), body: {} })).status).toBe(400);
    expect((await call(api.app, "POST", A, { session: x.s.tl, body: { reason: "Synthetic reason" } })).status).toBe(
      428,
    );
    const done = await call(api.app, "POST", A, {
      session: x.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect([done.body.status, done.body.archivedBy, done.body.archiveReason, done.body.version]).toEqual([
      "archived",
      x.users.tl.id,
      "Synthetic reason",
      2,
    ]);
    const again = await call(api.app, "POST", A, {
      session: x.s.tl,
      headers: ifm(2),
      body: { reason: "Synthetic again" },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([422, "budget_line.archived", ARCHIVED]);
    const upd = await call(api.app, "PATCH", `/api/v1/budget-lines/${b.id}`, {
      session: x.s.tl,
      headers: ifm(2),
      body: { budgetAmount: "4" },
    });
    expect([upd.status, upd.body.code]).toEqual([422, "budget_line.archived"]);
    expect((await auditOf(api.db, b.id)).map((a) => a.action)).toEqual(["budget_line.create", "budget_line.archive"]);
    const archivedOnly = await call(api.app, "GET", `${L}?status=archived`, { session: x.s.tl });
    expect(archivedOnly.body.items.some((i: { id: string }) => i.id === b.id)).toBe(true);
  });
});

describe("authorization (ADR-0031 §9: budget.edit = TL, FIN)", () => {
  it("AUD, WL, TO and BO get 403 on create, update and archive; ADM-only and outsiders 404; nothing written", async () => {
    const b = await create({ label: label(), budgetAmount: "1" });
    const before = await lineCount();
    for (const s of [x.s.auditor, x.s.wl, x.s.to, x.s.bo]) {
      expect((await call(api.app, "POST", L, { session: s, body: { label: label() } })).status).toBe(403);
      expect(
        (
          await call(api.app, "PATCH", `/api/v1/budget-lines/${b.id}`, {
            session: s,
            headers: ifm(1),
            body: { budgetAmount: "2" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(api.app, "POST", `/api/v1/budget-lines/${b.id}/archive`, {
            session: s,
            headers: ifm(1),
            body: { reason: "Synthetic" },
          })
        ).status,
      ).toBe(403);
    }
    for (const s of [x.s.admin, x.s.outsider]) {
      expect((await call(api.app, "POST", L, { session: s, body: { label: label() } })).status).toBe(404);
      expect(
        (
          await call(api.app, "PATCH", `/api/v1/budget-lines/${b.id}`, {
            session: s,
            headers: ifm(1),
            body: { budgetAmount: "2" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(api.app, "POST", `/api/v1/budget-lines/${b.id}/archive`, {
            session: s,
            headers: ifm(1),
            body: { reason: "Synthetic" },
          })
        ).status,
      ).toBe(404);
    }
    expect(await lineCount()).toBe(before);
    expect((await auditOf(api.db, b.id)).length).toBe(1);
  });

  it("an unknown initiative or line is 404", async () => {
    const none = "01900000-0000-7000-8000-000000000000";
    expect((await call(api.app, "GET", `/api/v1/initiatives/${none}/budget-lines`, { session: x.s.tl })).status).toBe(
      404,
    );
    expect(
      (
        await call(api.app, "POST", `/api/v1/initiatives/${none}/budget-lines`, {
          session: x.s.tl,
          body: { label: "x" },
        })
      ).status,
    ).toBe(404);
    expect((await call(api.app, "GET", `/api/v1/budget-lines/${none}`, { session: x.s.tl })).status).toBe(404);
  });

  it("budget.edit is re-checked at commit time: a grant revoked while the request waits -> 403, nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "FIN", { type: "transformation", id: x.transformationId }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    const before = await lineCount();
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", L, { session, body: { label: label() }, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await lineCount()).toBe(before);

    const b = await create({ label: label(), budgetAmount: "1" });
    const u2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u2.id, "TL", { type: "transformation", id: x.transformationId }, w.orgA.id);
    const s2 = await signIn(api.app, u2.subject);
    const upd = await afterIdentity(
      api,
      u2.id,
      () =>
        call(api.app, "PATCH", `/api/v1/budget-lines/${b.id}`, {
          session: s2,
          headers: ifm(1),
          body: { budgetAmount: "9" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u2.id),
    );
    expect(upd.status).toBe(403);
    const row = await api.db
      .selectFrom("budget_line")
      .select(["budget_amount", "version"])
      .where("id", "=", b.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ budget_amount: "1.0000", version: 1 });
  });
});
