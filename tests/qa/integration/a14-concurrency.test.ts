// A14 (REQ-S20-014 first cases; REQ-S16-026): optimistic-concurrency conflicts.
//
// Derived from docs/api/openapi.yaml "Concurrency (ADR-0003)" and the IfMatch / VersionConflict / PreconditionRequired
// components:
//   - mutable resources carry an integer `version` and a strong ETag `"<version>"`;
//   - a fresh If-Match update succeeds and increments `version` by one;
//   - a stale If-Match gives 409 `urn:mth:problem:version-conflict` with `currentVersion`, and NOTHING is written;
//   - a missing If-Match gives 428 `urn:mth:problem:precondition-required`, and nothing is written;
//   - two writers racing on the same version: exactly one wins.
// Checked on the transformation PATCH, the transformation archive and the user's own preferences (PUT /me/preferences).
// All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createBu,
  createOrg,
  createTransformation,
  createUser,
  expectProblem,
  grant,
  patchTransformation,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../support/api.ts";

let api: TestApi;
let office: Session;
let officeUserId: string;
let bu: string;

async function dbRow(id: string) {
  return api.db
    .selectFrom("transformation")
    .select(["version", "name", "description", "status", "archived_at", "updated_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function trail(id: string) {
  return (await auditOf(api.db, id)).map((e) => ({ action: e.action, prior: e.prior_version, next: e.new_version }));
}

async function newTransformation(name: string) {
  const r = await createTransformation(api.app, office, { businessUnitId: bu, name, mode: "end_to_end" });
  expect(r.status).toBe(201);
  return r;
}

beforeAll(async () => {
  api = await startApi();
  const org = await createOrg(api.db);
  bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const u = await createUser(api.db, org.id);
  officeUserId = u.id;
  await grant(api.db, grantor.id, u.id, "TO", { type: "organization", id: org.id }, org.id);
  office = await signIn(api.app, u.subject);
});

afterAll(async () => {
  await api?.close();
});

describe("A14 transformation PATCH", () => {
  it("create returns version 1 with a strong ETag", async () => {
    const r = await newTransformation("QA A14 create");
    expect(r.body.version).toBe(1);
    expect(r.headers["etag"]).toBe('"1"');
    expect((await dbRow(r.body.id)).version).toBe(1);
  });

  it("fresh If-Match succeeds and bumps version; stale If-Match is 409 with currentVersion; missing is 428", async () => {
    const created = await newTransformation("QA A14 original");
    const id = created.body.id as string;

    // Fresh update: version 1 -> 2, ETag follows, audited with prior/new version.
    const ok = await patchTransformation(api.app, office, id, { name: "QA A14 first writer" }, '"1"');
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.body.name).toBe("QA A14 first writer");
    const afterOk = await dbRow(id);
    expect(afterOk.version).toBe(2);
    expect(afterOk.name).toBe("QA A14 first writer");
    const trailOk = await trail(id);
    expect(trailOk).toContainEqual({ action: "transformation.update", prior: 1, next: 2 });

    // Stale update (a second writer still holding version 1).
    const stale = await patchTransformation(api.app, office, id, { name: "QA A14 stale writer" }, '"1"');
    expectProblem(stale, 409, "urn:mth:problem:version-conflict");
    expect(stale.body.currentVersion).toBe(2);
    expect(await dbRow(id)).toEqual(afterOk);
    expect(await trail(id)).toEqual(trailOk);

    // No If-Match at all.
    const missing = await patchTransformation(api.app, office, id, { name: "QA A14 no precondition" }, null);
    expectProblem(missing, 428, "urn:mth:problem:precondition-required");
    expect(await dbRow(id)).toEqual(afterOk);
    expect(await trail(id)).toEqual(trailOk);

    // A future version is just as stale as an old one.
    const future = await patchTransformation(api.app, office, id, { name: "QA A14 future" }, '"99"');
    expectProblem(future, 409, "urn:mth:problem:version-conflict");
    expect(future.body.currentVersion).toBe(2);

    // The loser re-reads and re-applies on the current version: succeeds, 2 -> 3.
    const reread = await call(api.app, "GET", `/api/v1/transformations/${id}`, { session: office });
    expect(reread.headers["etag"]).toBe('"2"');
    const retry = await patchTransformation(
      api.app,
      office,
      id,
      { description: "QA A14 re-applied" },
      String(reread.headers["etag"]),
    );
    expect(retry.status).toBe(200);
    expect(retry.body.version).toBe(3);
    expect(retry.body.name).toBe("QA A14 first writer"); // the other writer's change is kept
    expect(retry.body.description).toBe("QA A14 re-applied");
  });

  it("two writers racing on the same version: exactly one 200, the rest 409, version bumped once", async () => {
    const created = await newTransformation("QA A14 race");
    const id = created.body.id as string;
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        patchTransformation(api.app, office, id, { name: `QA A14 racer ${i}` }, '"1"'),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.currentVersion).toBe(2);
    const winner = results.find((r) => r.status === 200)!;
    const row = await dbRow(id);
    expect(row.version).toBe(2);
    expect(row.name).toBe(winner.body.name);
    expect((await trail(id)).filter((e) => e.action === "transformation.update")).toHaveLength(1);
  });
});

describe("A14 transformation archive", () => {
  it("stale If-Match is 409, missing is 428, fresh archives and bumps version", async () => {
    const created = await newTransformation("QA A14 archive");
    const id = created.body.id as string;
    const upd = await patchTransformation(api.app, office, id, { description: "bump" }, '"1"');
    expect(upd.body.version).toBe(2);
    const before = await dbRow(id);

    const stale = await call(api.app, "POST", `/api/v1/transformations/${id}/archive`, {
      session: office,
      body: { reason: "QA A14 stale archive" },
      headers: { "if-match": '"1"' },
    });
    expectProblem(stale, 409, "urn:mth:problem:version-conflict");
    expect(stale.body.currentVersion).toBe(2);

    const missing = await call(api.app, "POST", `/api/v1/transformations/${id}/archive`, {
      session: office,
      body: { reason: "QA A14 archive without precondition" },
    });
    expectProblem(missing, 428, "urn:mth:problem:precondition-required");
    expect(await dbRow(id)).toEqual(before);

    const ok = await call(api.app, "POST", `/api/v1/transformations/${id}/archive`, {
      session: office,
      body: { reason: "QA A14 archive" },
      headers: { "if-match": '"2"' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(3);
    expect(ok.body.archivedAt).not.toBeNull();
    expect((await dbRow(id)).archived_at).not.toBeNull();
  });
});

describe("A14 own preferences (PUT /me/preferences)", () => {
  it("missing If-Match is 428, stale is 409 with currentVersion, fresh succeeds", async () => {
    const me = await call(api.app, "GET", "/api/v1/me", { session: office });
    expect(me.status).toBe(200);
    const v = me.body.user.version as number;
    const loc = async () =>
      await api.db
        .selectFrom("app_user")
        .select(["preferred_locale", "version"])
        .where("id", "=", officeUserId)
        .executeTakeFirstOrThrow();
    const before = await loc();

    const missing = await call(api.app, "PUT", "/api/v1/me/preferences", {
      session: office,
      body: { preferredLocale: "en" },
    });
    expectProblem(missing, 428, "urn:mth:problem:precondition-required");
    expect(await loc()).toEqual(before);

    const ok = await call(api.app, "PUT", "/api/v1/me/preferences", {
      session: office,
      body: { preferredLocale: before.preferred_locale === "en" ? "ar" : "en" },
      headers: { "if-match": `"${v}"` },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(v + 1);

    const stale = await call(api.app, "PUT", "/api/v1/me/preferences", {
      session: office,
      body: { preferredLocale: "ar" },
      headers: { "if-match": `"${v}"` },
    });
    expectProblem(stale, 409, "urn:mth:problem:version-conflict");
    expect(stale.body.currentVersion).toBe(v + 1);
    expect((await loc()).version).toBe(v + 1);
  });
});
