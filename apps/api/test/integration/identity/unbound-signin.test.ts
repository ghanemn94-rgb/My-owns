// T-C15 (ADR-0064 §8; p7-work-split §C.2, §C.6; REQ-S19-016 M0364 "rebind corporate identity subjects under IT
// control"; T-DG7-BE-D): a user carried by a migration import holds an `unbound` identity_binding_hold and cannot sign
// in, through the OIDC callback (the fake OpenID Provider) or the dev login, until IT applies a mapping line with
// `mth-db rebind-identity` (`applyRebind`, the CLI's body). Then the rebound user signs in with the new subject and the
// old subject no longer resolves to them; a retained user signs in with the confirmed one. An invalid mapping line
// changes nothing. Own scratch database (one organization). Every user, subject and issuer is SYNTHETIC. A sign-in is
// not an approval (no G1-G6, Finance or IT approval) and nothing here touches DG0-DG7.
import { randomBytes } from "node:crypto";
import { applyRebind, createDb, createPool, DEV_ISSUER, rebindLines, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../../../packages/db/test/helpers.ts";
import { FakeIdp } from "../../support/fake-idp.ts";
import { call, createOrg, createUser, startApi, type TestApi } from "../../support/harness.ts";
import { seedSyntheticImport, type SyntheticImport } from "../contract/p7-exercises-be-d.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let oidcApi: TestApi;
let devApi: TestApi;
let ownerDb: Db;
let orgId: string;
let seeded: SyntheticImport;
const oidcUser = { id: "", subject: `carried-${randomBytes(5).toString("hex")}`, holdId: uuidv7() };

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_unbound_signin");
  const ownerUrl = roleUrl(adminUrl, dbName, "mth_owner");
  await migrate(ownerUrl);
  ownerDb = createDb(createPool(ownerUrl, { max: 2 }));
  idp = await new FakeIdp().start();
  oidcApi = await startApi({
    database: dbName,
    env: {
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_CLIENT_SECRET: idp.clientSecret,
    },
  });
  devApi = await startApi({ database: dbName });
  orgId = (await createOrg(oidcApi.db, "UNBOUND")).id;
  // The import's record and two holds (one dev-issuer user unbound, one rebound), as an import would write them.
  seeded = await seedSyntheticImport(oidcApi.owner, oidcApi.db, orgId);
  // A carried user of the corporate issuer (the fake OP), held unbound by the same import.
  const u = await createUser(oidcApi.db, orgId);
  oidcUser.id = u.id;
  await oidcApi.owner.query(`UPDATE user_identity SET issuer = $1, subject = $2 WHERE user_id = $3`, [
    idp.issuer,
    oidcUser.subject,
    u.id,
  ]);
  const c = await oidcApi.owner.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO identity_binding_hold (id, user_id, migration_import_id) VALUES ($1, $2, $3)`, [
      oidcUser.holdId,
      u.id,
      seeded.importId,
    ]);
    await c.query(
      `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
       VALUES ($1, 'system', 'identity.binding_held', 'identity_binding_hold', $2, 1, 'cli')`,
      [uuidv7(), oidcUser.holdId],
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}, 120_000);

afterAll(async () => {
  await oidcApi?.close();
  await devApi?.close();
  await idp?.stop();
  await ownerDb?.destroy();
  if (dbName) await dropScratchDatabase(adminUrl, dbName);
});

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const h = res.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
}

async function oidcLogin(subject: string) {
  const start = await call(oidcApi.app, "GET", "/api/v1/auth/login");
  expect(start.status).toBe(302);
  const loginCookie = setCookies(start)
    .find((c) => c.startsWith("mth_login="))!
    .split(";")[0]!;
  const { code, state } = idp.issueCode(String(start.headers["location"]), { sub: subject });
  const cb = await call(oidcApi.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, {
    headers: { cookie: loginCookie },
  });
  const session =
    setCookies(cb)
      .find((c) => c.startsWith("mth_session="))
      ?.split(";")[0] ?? null;
  return { cb, session };
}

const devLogin = (username: string) => call(devApi.app, "POST", "/api/v1/auth/dev-login", { body: { username } });

async function sessionsOf(userId: string): Promise<number> {
  const r = await ownerDb
    .selectFrom("session")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

async function lastLoginFailure(userId: string) {
  return ownerDb
    .selectFrom("audit_event")
    .select(["reason", "changes", "actor_user_id"])
    .where("action", "=", "session.login_failed")
    .where("actor_user_id", "=", userId)
    .orderBy("seq", "desc")
    .executeTakeFirst();
}

const holdOf = (id: string) =>
  ownerDb.selectFrom("identity_binding_hold").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("T-C15: an unbound user cannot sign in; rebind-identity binds under IT control", () => {
  it("OIDC: the carried subject ends at /login?error=identity_unbound, no session, session.login_failed", async () => {
    const { cb, session } = await oidcLogin(oidcUser.subject);
    expect(cb.status).toBe(302);
    expect(cb.headers["location"]).toBe("/login?error=identity_unbound");
    expect(session).toBeNull();
    expect(await sessionsOf(oidcUser.id)).toBe(0);
    const failure = await lastLoginFailure(oidcUser.id);
    expect(failure?.reason).toBe("OIDC sign-in refused: identity_unbound");
    expect(failure?.changes).toEqual({ error: { from: null, to: "identity_unbound" } });
  });

  it("dev login: the same hold refuses the synthetic user, with the same audit error", async () => {
    const res = await devLogin(seeded.unbound.subject);
    expect(res.status).toBe(401);
    expect(await sessionsOf(seeded.unbound.id)).toBe(0);
    const failure = await lastLoginFailure(seeded.unbound.id);
    expect(failure?.changes).toEqual({ error: { from: null, to: "identity_unbound" } });
    // A rebound user (resolved hold) signs in: the check is the hold state, not the presence of a hold.
    expect((await devLogin(seeded.rebound.subject)).status).toBe(204);
  });

  it("an invalid mapping line refuses the whole file and changes nothing", async () => {
    const newSubject = `rebound-${randomBytes(5).toString("hex")}`;
    const mapping = [
      "user_id,action,new_issuer,new_subject",
      `${oidcUser.id},rebind,${idp.issuer},${newSubject}`,
      `${uuidv7()},retain,x,y`,
      `${seeded.rebound.id},retain,${DEV_ISSUER},${seeded.rebound.subject}`,
      `${seeded.unbound.id},replace,${DEV_ISSUER},${seeded.unbound.subject}`,
    ].join("\n");
    const auditBefore = await ownerDb
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    const outcome = await applyRebind(ownerDb, Buffer.from(mapping, "utf8"), "Synthetic IT operator");
    expect(outcome.ok).toBe(false);
    const lines = rebindLines(outcome);
    expect(lines[0]).toBe("rebind-identity: refused: 3 invalid lines; nothing was changed");
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(/^line 3: unknown user [0-9a-f-]{36}$/),
      `line 4: user ${seeded.rebound.id} has no unbound hold`,
      "line 5: action must be rebind or retain",
    ]);
    expect((await holdOf(oidcUser.holdId)).state).toBe("unbound");
    const identity = await ownerDb
      .selectFrom("user_identity")
      .select("subject")
      .where("user_id", "=", oidcUser.id)
      .executeTakeFirstOrThrow();
    expect(identity.subject).toBe(oidcUser.subject);
    const auditAfter = await ownerDb
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    expect(auditAfter.n).toBe(auditBefore.n);
  });

  it("after the rebind the user signs in with the new subject; the old one no longer resolves to them", async () => {
    const newSubject = `rebound-${randomBytes(5).toString("hex")}`;
    const mapping = [
      "user_id,action,new_issuer,new_subject",
      `${oidcUser.id},rebind,${idp.issuer},${newSubject}`,
      `${seeded.unbound.id},retain,${DEV_ISSUER},${seeded.unbound.subject}`,
      "",
    ].join("\n");
    const outcome = await applyRebind(ownerDb, Buffer.from(mapping, "utf8"), "Synthetic IT operator");
    expect(rebindLines(outcome)).toEqual(["rebind-identity: rebound 1, retained 1; 0 users remain unbound"]);
    const hold = await holdOf(oidcUser.holdId);
    expect(hold).toMatchObject({ state: "rebound", version: 2, operator_name: "Synthetic IT operator" });
    const events = await ownerDb
      .selectFrom("audit_event")
      .select(["action", "record_id", "prior_version", "new_version", "source", "changes"])
      .where("action", "in", ["identity.rebound", "identity.retained"])
      .where("record_id", "in", [oidcUser.holdId, seeded.unbound.holdId])
      .orderBy("seq")
      .execute();
    expect(events.map((e) => [e.action, e.record_id, e.prior_version, e.new_version, e.source])).toEqual([
      ["identity.rebound", oidcUser.holdId, 1, 2, "cli"],
      ["identity.retained", seeded.unbound.holdId, 1, 2, "cli"],
    ]);
    expect((events[0]!.changes as Record<string, { to: unknown }>)["identity"]!.to).toEqual({
      issuer: idp.issuer,
      subject: newSubject,
    });
    const rebindEvent = await ownerDb
      .selectFrom("identity_rebind_event")
      .selectAll()
      .where("identity_binding_hold_id", "=", oidcUser.holdId)
      .executeTakeFirstOrThrow();
    expect(rebindEvent).toMatchObject({ old_subject: oidcUser.subject, new_subject: newSubject, action: "rebound" });

    const fresh = await oidcLogin(newSubject);
    expect(fresh.cb.headers["location"]).toBe("/");
    expect(fresh.session).not.toBeNull();
    expect(await sessionsOf(oidcUser.id)).toBe(1);
    // The old subject: never this user again (with one organization, an unknown subject is provisioned just in time
    // as a NEW user without role assignments, the DG1 rule; it never reaches the carried user).
    await oidcLogin(oidcUser.subject);
    const old = await ownerDb
      .selectFrom("user_identity")
      .select("user_id")
      .where("issuer", "=", idp.issuer)
      .where("subject", "=", oidcUser.subject)
      .executeTakeFirst();
    expect(old?.user_id).not.toBe(oidcUser.id);
    expect(await sessionsOf(oidcUser.id)).toBe(1);
    // The retained dev user signs in with the confirmed subject.
    expect((await devLogin(seeded.unbound.subject)).status).toBe(204);
  });

  it("a hold that is no longer unbound cannot be rebound again (rebound and retained are terminal)", async () => {
    const mapping = `user_id,action,new_issuer,new_subject\n${oidcUser.id},rebind,${idp.issuer},again-${randomBytes(3).toString("hex")}\n`;
    const outcome = await applyRebind(ownerDb, Buffer.from(mapping, "utf8"), "Synthetic IT operator");
    expect(rebindLines(outcome)).toEqual([
      "rebind-identity: refused: 1 invalid lines; nothing was changed",
      `line 2: user ${oidcUser.id} has no unbound hold`,
    ]);
  });
});
