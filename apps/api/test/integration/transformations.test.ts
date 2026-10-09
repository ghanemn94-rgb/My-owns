// Transformation CRUD (REQ-PB-003 increment, REQ-S16-026, REQ-S16-032, REQ-S12-004 outbox, first cases of A14).
// Each mutation is checked for: authorization (positive + negative), validation, optimistic concurrency, exactly
// one audit event with the right versions, and (create) exactly one outbox event in the same transaction.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
let office: Session;
let auditor: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
});
afterAll(() => api.close());

type Problem = { type?: string; errors?: { pointer: string; code: string }[]; currentVersion?: number };
type T = {
  id: string;
  code: string;
  version: number;
  status: string;
  currentPhase: string;
  timezone: string;
  currency: string;
  archivedAt: string | null;
  name: string;
} & Problem;
const create = (body: Record<string, unknown>, session = office, headers: Record<string, string> = {}) =>
  call<T>(api.app, "POST", "/api/v1/transformations", { session, body, headers });
const patch = (id: string, body: Record<string, unknown>, ifMatch?: string, session = office) =>
  call<T>(api.app, "PATCH", `/api/v1/transformations/${id}`, {
    session,
    body,
    headers: ifMatch === undefined ? {} : { "if-match": ifMatch },
  });

describe("create", () => {
  it("persists a draft End-to-End record in Diagnose with organization defaults (Asia/Riyadh, SAR) and a generated code", async () => {
    const res = await create({ businessUnitId: w.a1, name: "Roaming uplift (synthetic)", mode: "end_to_end" });
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`/api/v1/transformations/${res.body.id}`);
    expect(res.body).toMatchObject({
      status: "draft",
      currentPhase: "diagnose",
      timezone: "Asia/Riyadh",
      currency: "SAR",
      version: 1,
      archivedAt: null,
    });
    expect(res.body.code).toMatch(/^TR-\d{4}$/);
    const second = await create({ businessUnitId: w.a1, name: "Second", mode: "end_to_end" });
    expect(Number(second.body.code.slice(3))).toBe(Number(res.body.code.slice(3)) + 1);
  });

  it("writes exactly one audit event and one outbox event, in the same transaction", async () => {
    const res = await create({
      businessUnitId: w.a2,
      name: "Audited create",
      mode: "modular",
      entryPhase: "design",
      standaloneDeliverableType: "target_operating_model",
    });
    expect(res.status).toBe(201);
    expect(res.body.currentPhase).toBe("design");
    const audit = await auditOf(api.db, res.body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "transformation.create",
      actor_type: "user",
      actor_user_id: w.office.id,
      new_version: 1,
      prior_version: null,
      transformation_id: res.body.id,
      source: "api",
    });
    expect(audit[0]!.request_id).toBe(res.headers["x-request-id"]);
    expect((audit[0]!.changes as Record<string, { to: unknown }>)["mode"]!.to).toBe("modular");
    const outbox = await api.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("aggregate_id", "=", res.body.id)
      .execute();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: "transformation.created",
      schema_version: 1,
      idempotency_key: `transformation.created:${res.body.id}`,
      published_at: null,
    });
    expect(outbox[0]!.payload).toMatchObject({
      transformationId: res.body.id,
      mode: "modular",
      entryPhase: "design",
      createdBy: w.office.id,
    });
  });

  it("rolls back record, audit and outbox together when a rule fails (duplicate code -> 409)", async () => {
    const first = await create({ businessUnitId: w.a1, name: "Coded", mode: "end_to_end", code: "SYN-DUP-1" });
    expect(first.status).toBe(201);
    const dup = await create({ businessUnitId: w.a1, name: "Coded again", mode: "end_to_end", code: "SYN-DUP-1" });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ type: "urn:mth:problem:duplicate", code: "duplicate.code" });
    // Scope-local assertions (F-DG1-110): only what THIS request could have written is counted, so a concurrent or
    // late audit write elsewhere (e.g. another test's denial audit) cannot make the check flaky.
    const dupRequestId = (dup.body as { requestId?: string }).requestId;
    expect(dupRequestId).toBeTruthy();
    expect(await auditOfRequest(api.db, dupRequestId!)).toEqual([]);
    const sameCode = await api.db
      .selectFrom("transformation")
      .select(["id", "name"])
      .where("organization_id", "=", w.orgA.id)
      .where("code", "=", "SYN-DUP-1")
      .execute();
    expect(sameCode).toEqual([{ id: first.body.id, name: "Coded" }]);
    expect((await auditOf(api.db, first.body.id)).map((a) => a.action)).toEqual(["transformation.create"]);
    const outbox = await api.db
      .selectFrom("outbox_event")
      .select("aggregate_id")
      .where("organization_id", "=", w.orgA.id)
      .where(sql<boolean>`payload->>'transformationId' NOT IN (SELECT id::text FROM transformation)`)
      .execute();
    expect(outbox).toEqual([]);
  });

  it.each([
    [{ businessUnitId: "not-a-uuid", name: "x", mode: "end_to_end" }, "/businessUnitId"],
    [{ name: "x", mode: "end_to_end" }, "/businessUnitId"],
    [{ businessUnitId: "01920000-0000-7000-8000-000000000001", name: "", mode: "end_to_end" }, "/name"],
    [{ businessUnitId: "01920000-0000-7000-8000-000000000001", name: "x", mode: "modular" }, "/entryPhase"],
    [
      { businessUnitId: "01920000-0000-7000-8000-000000000001", name: "x", mode: "end_to_end", entryPhase: "design" },
      "/entryPhase",
    ],
    [
      { businessUnitId: "01920000-0000-7000-8000-000000000001", name: "x", mode: "end_to_end", timezone: "Mars/Base" },
      "/timezone",
    ],
    [
      { businessUnitId: "01920000-0000-7000-8000-000000000001", name: "x", mode: "end_to_end", currency: "sar" },
      "/currency",
    ],
    [{ businessUnitId: "01920000-0000-7000-8000-000000000001", name: "x", mode: "end_to_end", extra: 1 }, ""],
  ])("rejects invalid input %j with 400 and a field pointer", async (body, pointer) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.type).toBe("urn:mth:problem:validation");
    expect(res.body.errors!.map((e) => e.pointer)).toContain(pointer);
  });

  it("refuses an inactive business unit (422) and unknown sponsor/lead users (422)", async () => {
    await api.db.updateTable("business_unit").set({ status: "inactive" }).where("id", "=", w.a1x).execute();
    const inactive = await create({ businessUnitId: w.a1x, name: "x", mode: "end_to_end" });
    expect([inactive.status, inactive.body.code]).toEqual([422, "transformation.business_unit_inactive"]);
    const badUser = await create({
      businessUnitId: w.a1,
      name: "x",
      mode: "end_to_end",
      sponsorUserId: "01920000-0000-7000-8000-0000000000aa",
    });
    expect([badUser.status, badUser.body.code]).toEqual([422, "transformation.user_invalid"]);
  });

  it("requires a session (401) and CSRF + same Origin (403) on create", async () => {
    expect(
      (
        await call(api.app, "POST", "/api/v1/transformations", {
          body: { businessUnitId: w.a1, name: "x", mode: "end_to_end" },
        })
      ).status,
    ).toBe(401);
    const noCsrf = await call(api.app, "POST", "/api/v1/transformations", {
      session: office,
      csrf: false,
      body: { businessUnitId: w.a1, name: "x", mode: "end_to_end" },
    });
    expect([noCsrf.status, noCsrf.body.type]).toEqual([403, "urn:mth:problem:csrf"]);
    const badOrigin = await call(api.app, "POST", "/api/v1/transformations", {
      session: office,
      origin: "https://evil.example",
      body: { businessUnitId: w.a1, name: "x", mode: "end_to_end" },
    });
    expect([badOrigin.status, badOrigin.body.type]).toEqual([403, "urn:mth:problem:csrf"]);
  });
});

describe("Idempotency-Key on create", () => {
  it("replays the original 201 for the same key and body, creating one record, one audit event and one outbox event", async () => {
    const body = { businessUnitId: w.a2, name: "Idempotent create", mode: "end_to_end" };
    const key = { "idempotency-key": "synthetic-key-0001" };
    const first = await create(body, office, key);
    const again = await create(body, office, key);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body).toEqual(first.body);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(
      await api.db.selectFrom("transformation").select("id").where("name", "=", "Idempotent create").execute(),
    ).toHaveLength(1);
    expect(await auditOf(api.db, first.body.id)).toHaveLength(1);
    expect(
      await api.db.selectFrom("outbox_event").select("id").where("aggregate_id", "=", first.body.id).execute(),
    ).toHaveLength(1);
  });

  it("rejects the same key with a different body (422) and a malformed key (400)", async () => {
    const key = { "idempotency-key": "synthetic-key-0002" };
    expect((await create({ businessUnitId: w.a2, name: "K2 a", mode: "end_to_end" }, office, key)).status).toBe(201);
    const other = await create({ businessUnitId: w.a2, name: "K2 b", mode: "end_to_end" }, office, key);
    expect([other.status, other.body.code]).toEqual([422, "idempotency.key_reused"]);
    expect(
      (await create({ businessUnitId: w.a2, name: "x", mode: "end_to_end" }, office, { "idempotency-key": "bad key!" }))
        .status,
    ).toBe(400);
  });
});

describe("update with optimistic concurrency (A14)", () => {
  let id: string;
  beforeAll(async () => {
    id = (await create({ businessUnitId: w.a1, name: "Concurrency target", mode: "end_to_end" })).body.id;
  });

  it("needs If-Match: missing -> 428, malformed -> 400", async () => {
    const missing = await patch(id, { name: "no precondition" });
    expect([missing.status, missing.body.type]).toEqual([428, "urn:mth:problem:precondition-required"]);
    expect((await patch(id, { name: "weak" }, 'W/"1"')).status).toBe(400);
  });

  it("applies a fresh update, bumps the version by exactly one and audits the field diff", async () => {
    const res = await patch(id, { name: "Renamed", status: "active" }, '"1"');
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body).toMatchObject({ version: 2, name: "Renamed", status: "active" });
    const audit = (await auditOf(api.db, id)).at(-1)!;
    expect(audit).toMatchObject({ action: "transformation.update", prior_version: 1, new_version: 2 });
    expect(audit.changes).toEqual({
      name: { from: "Concurrency target", to: "Renamed" },
      status: { from: "draft", to: "active" },
    });
  });

  it("rejects a stale If-Match with 409 and currentVersion, writing nothing and auditing nothing", async () => {
    const auditBefore = (await auditOf(api.db, id)).length;
    const stale = await patch(id, { name: "Lost update" }, '"1"');
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      type: "urn:mth:problem:version-conflict",
      code: "version_conflict",
      currentVersion: 2,
    });
    const row = await api.db
      .selectFrom("transformation")
      .select(["name", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Renamed", version: 2 });
    expect((await auditOf(api.db, id)).length).toBe(auditBefore);
  });

  it("serializes two simultaneous writers holding the same version: exactly one wins", async () => {
    const [a, b] = await Promise.all([patch(id, { name: "Writer A" }, '"2"'), patch(id, { name: "Writer B" }, '"2"')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await api.db
      .selectFrom("transformation")
      .select("version")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(3);
  });

  it("enforces explicit status transitions (422 invalid-transition)", async () => {
    const res = await patch(id, { status: "draft" }, '"3"');
    expect([res.status, res.body.type]).toEqual([422, "urn:mth:problem:invalid-transition"]);
  });

  it("rejects fields that are not editable here (mode, currentPhase) with 400", async () => {
    expect((await patch(id, { mode: "modular" }, '"3"')).status).toBe(400);
    expect((await patch(id, { currentPhase: "define" }, '"3"')).status).toBe(400);
    expect((await patch(id, {}, '"3"')).status).toBe(400);
  });

  it("denies an update without transformation.update (auditor: 403) before looking at If-Match", async () => {
    const res = await patch(id, { name: "x" }, undefined, auditor);
    expect(res.status).toBe(403);
  });
});

describe("closure is not a status edit (F-DG1-001: closure needs the G6 business approval, absent in P1)", () => {
  it.each(["active", "on_hold"] as const)(
    "refuses %s -> closed with 422 invalid-transition; the record keeps its state, version and audit trail",
    async (prior) => {
      const t = (await create({ businessUnitId: w.a1, name: `Close attempt from ${prior}`, mode: "end_to_end" })).body;
      expect((await patch(t.id, { status: "active" }, '"1"')).status).toBe(200);
      let version = 2;
      if (prior === "on_hold") {
        expect((await patch(t.id, { status: "on_hold" }, '"2"')).status).toBe(200);
        version = 3;
      }
      const auditBefore = await auditOf(api.db, t.id);

      const res = await patch(t.id, { status: "closed" }, `"${version}"`);
      expect([res.status, res.body.type, (res.body as { code?: string }).code]).toEqual([
        422,
        "urn:mth:problem:invalid-transition",
        "invalid_transition",
      ]);
      // Seam 15 (D-089; ADR-0034 §7; T-DG4-BE-J): the second sentence points at the governed closure action.
      expect((res.body as { detail?: string }).detail).toBe(
        "A transformation cannot be closed by a status edit. Closure requires the G6 (Sustain) business approval " +
          "with validated benefits; use the closure action.",
      );
      // The same refusal when the close rides along with an otherwise valid edit: nothing at all is written.
      const mixed = await patch(t.id, { name: "Renamed while closing", status: "closed" }, `"${version}"`);
      expect(mixed.status).toBe(422);

      const row = await api.db
        .selectFrom("transformation")
        .select(["status", "version", "name"])
        .where("id", "=", t.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: prior, version, name: `Close attempt from ${prior}` });
      // A rejected business rule is not an authorization event: no audit row (existing 422 pattern), no change.
      expect(await auditOf(api.db, t.id)).toEqual(auditBefore);
      const read = await call<T>(api.app, "GET", `/api/v1/transformations/${t.id}`, { session: office });
      expect([read.body.status, read.body.version]).toEqual([prior, version]);
    },
  );

  it("refuses a close from draft as well (no path to closed exists in P1)", async () => {
    const t = (await create({ businessUnitId: w.a1, name: "Draft close attempt", mode: "end_to_end" })).body;
    const res = await patch(t.id, { status: "closed" }, '"1"');
    expect([res.status, res.body.type]).toEqual([422, "urn:mth:problem:invalid-transition"]);
  });
});

describe("archive", () => {
  it("needs a reason, If-Match and transformation.archive; archived records are read-only and hidden by default", async () => {
    const t = (await create({ businessUnitId: w.a2, name: "To archive", mode: "end_to_end" })).body;
    const url = `/api/v1/transformations/${t.id}/archive`;
    expect(
      (await call(api.app, "POST", url, { session: office, headers: { "if-match": '"1"' }, body: { reason: "x" } }))
        .status,
    ).toBe(400);
    expect(
      (await call(api.app, "POST", url, { session: office, body: { reason: "Duplicate of another record" } })).status,
    ).toBe(428);
    expect(
      (
        await call(api.app, "POST", url, {
          session: auditor,
          headers: { "if-match": '"1"' },
          body: { reason: "Auditor tries" },
        })
      ).status,
    ).toBe(403);
    const ok = await call<T>(api.app, "POST", url, {
      session: office,
      headers: { "if-match": '"1"' },
      body: { reason: "Duplicate of another record" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    expect(ok.body.archivedAt).not.toBeNull();
    const audit = (await auditOf(api.db, t.id)).filter((e) => e.action === "transformation.archive");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: "Duplicate of another record", prior_version: 1, new_version: 2 });

    expect((await patch(t.id, { name: "edit archived" }, '"2"')).body.code).toBe("transformation.archived");
    const again = await call(api.app, "POST", url, {
      session: office,
      headers: { "if-match": '"2"' },
      body: { reason: "Archive twice" },
    });
    expect([again.status, again.body.code]).toEqual([422, "transformation.already_archived"]);

    const listed = async (q: string) =>
      (
        await call<{ items: { id: string }[] }>(api.app, "GET", `/api/v1/transformations?limit=100${q}`, {
          session: office,
        })
      ).body.items.map((i) => i.id);
    expect(await listed("")).not.toContain(t.id);
    expect(await listed("&includeArchived=true")).toContain(t.id);
    expect((await call(api.app, "GET", `/api/v1/transformations/${t.id}`, { session: office })).status).toBe(200);
  });
});

describe("list: filters, sorting and cursor pagination", () => {
  it("pages through a stable order without duplicates or gaps", async () => {
    for (let i = 0; i < 5; i++) await create({ businessUnitId: w.a2, name: `Page item ${i}`, mode: "end_to_end" });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: { id: string; name: string }[]; nextCursor: string | null } } = await call(
        api.app,
        "GET",
        `/api/v1/transformations?q=Page%20item&limit=2&sort=name:asc${cursor ? `&cursor=${cursor}` : ""}`,
        { session: office },
      );
      seen.push(...res.body.items.map((i) => i.name));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["Page item 0", "Page item 1", "Page item 2", "Page item 3", "Page item 4"]);
  });

  it("supports updatedAt ordering both ways and repeatable status filters", async () => {
    const desc = (
      await call<{ items: { updatedAt: string }[] }>(api.app, "GET", "/api/v1/transformations?limit=100", {
        session: office,
      })
    ).body.items.map((i) => i.updatedAt);
    expect([...desc].sort().reverse()).toEqual(desc);
    const asc = (
      await call<{ items: { updatedAt: string }[] }>(
        api.app,
        "GET",
        "/api/v1/transformations?limit=100&sort=updatedAt:asc",
        { session: office },
      )
    ).body.items.map((i) => i.updatedAt);
    expect([...asc].sort()).toEqual(asc);
    const statuses = (
      await call<{ items: { status: string }[] }>(
        api.app,
        "GET",
        "/api/v1/transformations?limit=100&status=active&status=draft",
        { session: office },
      )
    ).body.items.map((i) => i.status);
    expect(new Set(statuses).size).toBeGreaterThan(0);
    expect(statuses.every((st) => st === "active" || st === "draft")).toBe(true);
  });

  it("rejects a cursor reused with other filters, unknown query parameters and an out-of-range limit (400)", async () => {
    const first = await call<{ nextCursor: string }>(api.app, "GET", "/api/v1/transformations?limit=1", {
      session: office,
    });
    expect(first.body.nextCursor).toBeTruthy();
    expect(
      (
        await call(api.app, "GET", `/api/v1/transformations?limit=1&mode=modular&cursor=${first.body.nextCursor}`, {
          session: office,
        })
      ).status,
    ).toBe(400);
    expect((await call(api.app, "GET", "/api/v1/transformations?bogus=1", { session: office })).status).toBe(400);
    expect((await call(api.app, "GET", "/api/v1/transformations?limit=101", { session: office })).status).toBe(400);
  });
});

describe("audit trail endpoint", () => {
  it("lists events newest first with actor names, paginated; needs audit.read (TO yes, others 403/404)", async () => {
    const t = (await create({ businessUnitId: w.a2, name: "Trail", mode: "end_to_end" })).body;
    await patch(t.id, { name: "Trail 2" }, '"1"');
    await patch(t.id, { name: "Trail 3" }, '"2"');
    const page1 = await call<{
      items: { action: string; newVersion: number; actor: { displayName: string } }[];
      nextCursor: string;
    }>(api.app, "GET", `/api/v1/transformations/${t.id}/audit?limit=2`, { session: office });
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((i) => i.newVersion)).toEqual([3, 2]);
    expect(page1.body.items[0]!.actor.displayName).toMatch(/^Synthetic /);
    const page2 = await call<{ items: { action: string }[]; nextCursor: string | null }>(
      api.app,
      "GET",
      `/api/v1/transformations/${t.id}/audit?limit=100&cursor=${page1.body.nextCursor}`,
      { session: office },
    );
    // Oldest last: the create itself, preceded (newer) by the 23 audited rows of the P2 starter structure created in
    // the same transaction (ADR-0016 §4: 1 methodology pin, 6 T01 rows, 10 canvas boxes, 6 product gate instances)
    // and, since T-DG3-BE-A (p3_instantiate_transformation), the 5 P3 rows (four B0079 waves, T06 weight set v1).
    const actions = page2.body.items.map((i) => i.action);
    expect(actions.at(-1)).toBe("transformation.create");
    expect(actions.slice(0, -1).sort()).toEqual(
      [
        "transformation_config_pin.create",
        ...Array<string>(6).fill("diagnostic_item.create"),
        ...Array<string>(10).fill("tom_canvas_cell.create"),
        ...Array<string>(6).fill("gate_instance.create"),
        ...Array<string>(4).fill("roadmap_wave.create"),
        "scoring_weight_set.create",
        // T-DG4-BE-C (ADR-0026 §7): POST /transformations runs p4_instantiate_transformation, which adds the P4 starter
        // structure: 2 governance-matrix headers, the 4 T11 rows, the 6 T12 deliverables with their 36 cells, and the
        // 5 seeded forums of slice D (0044 extends the same function).
        ...Array<string>(2).fill("governance_matrix.create"),
        ...Array<string>(4).fill("transformation_decision_right.create"),
        ...Array<string>(6).fill("transformation_raci_deliverable.create"),
        ...Array<string>(36).fill("transformation_raci_assignment.create"),
        ...Array<string>(5).fill("forum.create"),
      ].sort(),
    );
    expect(page2.body.nextCursor).toBeNull();
    // Auditor (AUD) holds audit.read; a technical admin cannot even see that the record exists.
    expect((await call(api.app, "GET", `/api/v1/transformations/${t.id}/audit`, { session: auditor })).status).toBe(
      200,
    );
    const admin = await signIn(api.app, w.admin.subject);
    expect((await call(api.app, "GET", `/api/v1/transformations/${t.id}/audit`, { session: admin })).status).toBe(404);
  });
});
