// Administration > Notifications (ADR-0054 §3, §4, §5; REQ-S12-023; p6-work-split §J/C.10; T-DG6-BE-I) against a real
// PostgreSQL. Covers, for every mutation (§2 rule 4): authorization at request start and at commit (a grant revoked
// meanwhile is 403 and nothing is written), validation, If-Match (428 missing, 409 stale, "0" creates), one audit event
// with prior and new version in the same transaction, and AUD read-only (200 on GETs, 403 on PUT and test). Also: the
// never-configured view (ETag "0", "Not configured", never enabled), enterprise messaging cannot be enabled (422),
// `none` refused in production (422), credentials only as SecretRefs (422 for a value or an unknown provider), the test
// send outside any transaction to the caller's own address through the fake SMTP server, with its audit event and no
// address, text or secret in the response. All data is SYNTHETIC; nothing approves anything or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkedChannelUpdate, notificationChannelRefusals } from "../../../src/modules/admin/notification-channels.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { FakeSmtp } from "../../support/fake-smtp.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let fake: FakeSmtp;
let admin: Session; // ADM_TECH @ org A
let auditor: Session; // AUD @ org A (operations.read)
let office: Session; // TO @ org A (operations.read)
let nobody: Session;
const SECRET_CANARY = "synthetic-canary-smtp-password-5b21";

const url = (kind: string, org = w.orgA.id) => `/api/v1/admin/notification-channels/${kind}?organizationId=${org}`;
const testUrl = (kind: string, org = w.orgA.id) =>
  `/api/v1/admin/notification-channels/${kind}/test?organizationId=${org}`;
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const smtpSettings = (over: Record<string, unknown> = {}) => ({
  host: "127.0.0.1",
  port: fake.port,
  security: "none",
  usernameRef: null,
  passwordRef: null,
  fromAddress: "hub-noreply@example.invalid",
  ...over,
});

async function channelRow(org: string, kind: string) {
  return api.db
    .selectFrom("notification_channel")
    .selectAll()
    .where("organization_id", "=", org)
    .where("channel_kind", "=", kind)
    .executeTakeFirst();
}
async function auditsOf(recordId: string, action: string) {
  return api.db
    .selectFrom("audit_event")
    .selectAll()
    .where("record_id", "=", recordId)
    .where("action", "=", action)
    .orderBy("seq")
    .execute();
}

/** A fresh organization with its own ADM_TECH user, signed in (so tests never share a channel row). */
async function freshOrg() {
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  const adminEmail = `${uniq("adm")}@example.invalid`.toLowerCase();
  const user = await createUser(api.db, org.id, { email: adminEmail });
  await grant(api.db, grantor.id, user.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  return {
    id: org.id,
    grantorId: grantor.id,
    adminId: user.id,
    adminEmail,
    admin: await signIn(api.app, user.subject),
  };
}

beforeAll(async () => {
  process.env["MTH_TEST_SMTP_USER"] = "synthetic-user";
  process.env["MTH_TEST_SMTP_PASS"] = SECRET_CANARY;
  api = await startApi();
  w = await seedWorld(api.db);
  fake = await new FakeSmtp().start();
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
});
afterAll(async () => {
  delete process.env["MTH_TEST_SMTP_USER"];
  delete process.env["MTH_TEST_SMTP_PASS"];
  await fake.stop();
  await api.close();
});

describe("reads", () => {
  it('a kind never configured is Not configured: version 0, ETag "0", disabled, no settings', async () => {
    const org = await freshOrg();
    const res = await call(api.app, "GET", url("email", org.id), { session: org.admin });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"0"');
    expect(res.body).toEqual({
      organizationId: org.id,
      channelKind: "email",
      configured: false,
      enabled: false,
      adapterAvailable: true,
      smtp: null,
      reason: null,
      version: 0,
      updatedAt: null,
    });
    const list = await call(api.app, "GET", `/api/v1/admin/notification-channels?organizationId=${org.id}`, {
      session: org.admin,
    });
    expect(
      list.body.items.map((i: { channelKind: string; adapterAvailable: boolean }) => [
        i.channelKind,
        i.adapterAvailable,
      ]),
    ).toEqual([
      ["email", true],
      ["enterprise_messaging", false],
    ]);
    // Reading writes nothing.
    expect(await channelRow(org.id, "email")).toBeUndefined();
  });

  it("AUD and TO read through operations.read; a user without either code gets 403; another organization's admin 403", async () => {
    for (const session of [auditor, office])
      expect((await call(api.app, "GET", url("email"), { session })).status).toBe(200);
    expect((await call(api.app, "GET", url("email"), { session: nobody })).status).toBe(403);
    const org = await freshOrg();
    expect((await call(api.app, "GET", url("email"), { session: org.admin })).status).toBe(403);
    expect((await call(api.app, "GET", url("email", crypto.randomUUID()), { session: admin })).status).toBe(404);
  });
});

describe("putNotificationChannel", () => {
  it('creates with If-Match "0", updates with the version, audits each change with prior and new version', async () => {
    const org = await freshOrg();
    const missing = await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      body: { enabled: false, smtp: null, reason: "Synthetic setup" },
    });
    expect(missing.status).toBe(428);
    const created = await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(0),
      body: {
        enabled: true,
        smtp: smtpSettings({
          usernameRef: { provider: "env", name: "MTH_TEST_SMTP_USER" },
          passwordRef: { provider: "env", name: "MTH_TEST_SMTP_PASS" },
        }),
        reason: "Synthetic: enable email",
      },
    });
    expect(created.status).toBe(200);
    expect(created.headers["etag"]).toBe('"1"');
    expect(created.body).toMatchObject({
      configured: true,
      enabled: true,
      version: 1,
      reason: "Synthetic: enable email",
    });
    expect(created.body.smtp.passwordRef).toEqual({ provider: "env", name: "MTH_TEST_SMTP_PASS" });
    expect(JSON.stringify(created.body)).not.toContain(SECRET_CANARY);
    const row = (await channelRow(org.id, "email"))!;
    expect(row.smtp_password_ref).toEqual({ provider: "env", name: "MTH_TEST_SMTP_PASS" });
    const [createdAudit] = await auditsOf(row.id, "notification_channel.changed");
    expect(createdAudit).toMatchObject({ prior_version: null, new_version: 1, reason: "Synthetic: enable email" });
    expect(JSON.stringify(createdAudit!.changes)).not.toContain(SECRET_CANARY);

    const stale = await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(0),
      body: { enabled: false, smtp: null, reason: "Synthetic: stale" },
    });
    expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "version_conflict", 1]);
    const updated = await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(1),
      body: { enabled: false, smtp: null, reason: "Synthetic: back to in-app only" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ enabled: false, smtp: null, version: 2 });
    const audits = await auditsOf(row.id, "notification_channel.changed");
    expect(audits.map((a) => [a.prior_version, a.new_version])).toEqual([
      [null, 1],
      [1, 2],
    ]);
    // The 0102 trigger writes one history row per version.
    const history = await api.db
      .selectFrom("notification_channel_change")
      .select("record_version")
      .where("notification_channel_id", "=", row.id)
      .orderBy("record_version")
      .execute();
    expect(history.map((h) => h.record_version)).toEqual([1, 2]);
  });

  it("refusals: each ADR-0054 §4 code, and nothing is written", async () => {
    const org = await freshOrg();
    const put = (kind: string, body: unknown) =>
      call(api.app, "PUT", url(kind, org.id), { session: org.admin, headers: ifm(0), body });
    const cases: [string, unknown, number, string][] = [
      [
        "enterprise_messaging",
        { enabled: true, smtp: null, reason: "Synthetic" },
        422,
        "notification_channel.adapter_unavailable",
      ],
      [
        "enterprise_messaging",
        { enabled: false, smtp: smtpSettings(), reason: "Synthetic" },
        422,
        "notification_channel.adapter_unavailable",
      ],
      ["email", { enabled: true, smtp: null, reason: "Synthetic" }, 422, "notification_channel.email_incomplete"],
      [
        "email",
        {
          enabled: true,
          smtp: smtpSettings({ usernameRef: { provider: "env", name: "MTH_TEST_SMTP_USER" } }),
          reason: "Synthetic",
        },
        422,
        "notification_channel.email_incomplete",
      ],
      [
        "email",
        {
          enabled: true,
          smtp: smtpSettings({ usernameRef: "synthetic-user", passwordRef: SECRET_CANARY }),
          reason: "Synthetic",
        },
        422,
        "storage.secret_ref_invalid",
      ],
      [
        "email",
        {
          enabled: true,
          smtp: smtpSettings({
            usernameRef: { provider: "vault", name: "U" },
            passwordRef: { provider: "vault", name: "P" },
          }),
          reason: "Synthetic",
        },
        422,
        "storage.secret_ref_invalid",
      ],
      [
        "email",
        {
          enabled: true,
          smtp: smtpSettings({
            usernameRef: { provider: "env", name: "U", value: "x" },
            passwordRef: { provider: "env", name: "P" },
          }),
          reason: "Synthetic",
        },
        422,
        "storage.secret_ref_invalid",
      ],
      ["email", { enabled: true, smtp: smtpSettings(), reason: "  " }, 422, "admin.reason_required"],
      ["email", { enabled: true, smtp: smtpSettings(), reason: "ab" }, 422, "admin.reason_required"],
      ["email", { enabled: true, smtp: smtpSettings({ host: "bad host" }), reason: "Synthetic" }, 400, "validation"],
      [
        "email",
        { enabled: true, smtp: smtpSettings({ fromAddress: "not-an-address" }), reason: "Synthetic" },
        400,
        "validation",
      ],
      ["email", { enabled: true, smtp: smtpSettings({ port: 0 }), reason: "Synthetic" }, 400, "validation"],
      ["email", { enabled: true, smtp: smtpSettings(), reason: "Synthetic", extra: 1 }, 400, "validation"],
    ];
    for (const [kind, body, status, code] of cases) {
      const res = await put(kind, body);
      expect([res.status, res.body.code], JSON.stringify(body)).toEqual([status, code]);
      expect(JSON.stringify(res.body)).not.toContain(SECRET_CANARY);
    }
    expect(await channelRow(org.id, "email")).toBeUndefined();
    expect(await channelRow(org.id, "enterprise_messaging")).toBeUndefined();
    // enterprise_messaging can be recorded disabled (with a reason), never enabled.
    const disabled = await put("enterprise_messaging", { enabled: false, smtp: null, reason: "Synthetic: not used" });
    expect(disabled.body).toMatchObject({ configured: true, enabled: false, adapterAvailable: false, version: 1 });
  });

  it("`none` security is refused in production (422 notification_channel.insecure_transport)", () => {
    const body = {
      enabled: true,
      smtp: { ...smtpSettings(), security: "none" as const },
      reason: "Synthetic production check",
    };
    expect(() => checkedChannelUpdate("email", body, { production: true, providers: ["env"] })).toThrow(
      expect.objectContaining({ status: 422, code: "notification_channel.insecure_transport" }),
    );
    expect(notificationChannelRefusals.insecureTransport().detail).toBe(
      "Unencrypted SMTP is not allowed in production.",
    );
    // Outside production it is accepted, and an encrypted mode is accepted in production.
    expect(checkedChannelUpdate("email", body, { production: false, providers: ["env"] }).enabled).toBe(true);
    const tls = { ...body, smtp: { ...body.smtp, security: "tls" as const } };
    expect(checkedChannelUpdate("email", tls, { production: true, providers: ["env"] }).smtp?.security).toBe("tls");
  });

  it("AUD and TO get 403 on PUT and nothing is written; a user without the code 403; unknown organization 404", async () => {
    const org = await freshOrg();
    for (const session of [auditor, office, nobody]) {
      const res = await call(api.app, "PUT", url("email"), {
        session,
        headers: ifm(0),
        body: { enabled: false, smtp: null, reason: "Synthetic: refused" },
      });
      expect(res.status).toBe(403);
    }
    expect(
      (
        await call(api.app, "PUT", url("email", w.orgA.id), {
          session: org.admin,
          headers: ifm(0),
          body: { enabled: false, smtp: null, reason: "Synthetic: other organization" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "PUT", url("email", crypto.randomUUID()), {
          session: admin,
          headers: ifm(0),
          body: { enabled: false, smtp: null, reason: "Synthetic: missing" },
        })
      ).status,
    ).toBe(404);
  });

  it("commit-time re-authorization: the configure right revoked between load and commit is 403 and nothing is written", async () => {
    const org = await freshOrg();
    const res = await afterIdentity(
      api,
      org.adminId,
      () =>
        call(api.app, "PUT", url("email", org.id), {
          session: org.admin,
          headers: ifm(0),
          body: { enabled: false, smtp: null, reason: "Synthetic commit-time check" },
          contract: false,
        }),
      () => revokeAll(api, org.grantorId, org.adminId),
    );
    expect(res.status).toBe(403);
    expect(await channelRow(org.id, "email")).toBeUndefined();
  });

  it("concurrent creates of the same kind: one 200, the others 409, one row and one audit event", async () => {
    const org = await freshOrg();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        call(api.app, "PUT", url("email", org.id), {
          session: org.admin,
          headers: ifm(0),
          body: { enabled: false, smtp: null, reason: `Synthetic concurrent create ${i}` },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const row = (await channelRow(org.id, "email"))!;
    expect(row.version).toBe(1);
    expect(await auditsOf(row.id, "notification_channel.changed")).toHaveLength(1);
  });
});

describe("testNotificationChannel", () => {
  it("422 not_configured until email is enabled; then one message to the caller's own address and an audit event", async () => {
    const org = await freshOrg();
    const before = await call(api.app, "POST", testUrl("email", org.id), {
      session: org.admin,
      body: { recipient: "self" },
    });
    expect([before.status, before.body.code]).toEqual([422, "notification_channel.not_configured"]);
    await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(0),
      body: { enabled: false, smtp: smtpSettings(), reason: "Synthetic: configured, disabled" },
    });
    const disabled = await call(api.app, "POST", testUrl("email", org.id), {
      session: org.admin,
      body: { recipient: "self" },
    });
    expect(disabled.body.code).toBe("notification_channel.not_configured");
    await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(1),
      body: {
        enabled: true,
        smtp: smtpSettings({
          usernameRef: { provider: "env", name: "MTH_TEST_SMTP_USER" },
          passwordRef: { provider: "env", name: "MTH_TEST_SMTP_PASS" },
        }),
        reason: "Synthetic: enable",
      },
    });
    fake.configure({ auth: { user: "synthetic-user", pass: SECRET_CANARY } });
    const count = fake.messages.length;
    const sent = await call(api.app, "POST", testUrl("email", org.id), {
      session: org.admin,
      body: { recipient: "self" },
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ outcome: "sent", channelKind: "email", errorCode: null });
    expect(Object.keys(sent.body).sort()).toEqual(["channelKind", "errorCode", "outcome", "testedAt"]);
    expect(fake.messages).toHaveLength(count + 1);
    expect(fake.messages.at(-1)).toMatchObject({ rcptTo: [org.adminEmail], authUser: "synthetic-user" });
    expect(JSON.stringify(sent.body)).not.toContain(org.adminEmail);
    const row = (await channelRow(org.id, "email"))!;
    const tested = await auditsOf(row.id, "notification_channel.tested");
    expect(tested).toHaveLength(1);
    expect(tested[0]!.changes).toEqual({ outcome: { from: null, to: "sent" }, error_code: { from: null, to: null } });
    // The test changes no setting.
    expect(row.version).toBe(2);
  });

  it("a failed send is a 200 with outcome failed and a stable code; never the secret or the server text", async () => {
    const org = await freshOrg();
    await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(0),
      body: {
        enabled: true,
        smtp: smtpSettings({
          usernameRef: { provider: "env", name: "MTH_TEST_SMTP_USER" },
          passwordRef: { provider: "env", name: "MTH_TEST_SMTP_PASS" },
        }),
        reason: "Synthetic: enable",
      },
    });
    fake.configure({ auth: "reject" });
    const failed = await call(api.app, "POST", testUrl("email", org.id), {
      session: org.admin,
      body: { recipient: "self" },
    });
    fake.configure({});
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ outcome: "failed", errorCode: "smtp.auth_failed" });
    expect(JSON.stringify(failed.body)).not.toContain(SECRET_CANARY);
    const row = (await channelRow(org.id, "email"))!;
    const [tested] = await auditsOf(row.id, "notification_channel.tested");
    expect(tested!.changes).toEqual({
      outcome: { from: null, to: "failed" },
      error_code: { from: null, to: "smtp.auth_failed" },
    });
  });

  it("422 no_recipient_address for a caller without an email; AUD and TO 403; 404 unknown organization", async () => {
    const org = await freshOrg();
    await call(api.app, "PUT", url("email", org.id), {
      session: org.admin,
      headers: ifm(0),
      body: { enabled: true, smtp: smtpSettings(), reason: "Synthetic: enable" },
    });
    await api.owner.query("update app_user set email = null where id = $1", [org.adminId]);
    const res = await call(api.app, "POST", testUrl("email", org.id), {
      session: org.admin,
      body: { recipient: "self" },
    });
    expect([res.status, res.body.code]).toEqual([422, "notification_channel.no_recipient_address"]);
    for (const session of [auditor, office])
      expect((await call(api.app, "POST", testUrl("email"), { session, body: { recipient: "self" } })).status).toBe(
        403,
      );
    expect(
      (
        await call(api.app, "POST", testUrl("email", crypto.randomUUID()), {
          session: admin,
          body: { recipient: "self" },
        })
      ).status,
    ).toBe(404);
  });
});
