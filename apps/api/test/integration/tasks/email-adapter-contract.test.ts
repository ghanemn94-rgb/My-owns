// The email adapter's contract (ADR-0054 §3; REQ-S12-023; p6-work-split §J/C.10; T-DG6-BE-I) against the in-process
// fake SMTP server (apps/api/test/support/fake-smtp.ts). The literal cases of §J/C.10:
//  - plain SMTP; STARTTLS where the fake offers it (a throwaway certificate made with the openssl CLI, trusted through
//    the adapter's `tls.ca`, never `rejectUnauthorized: false`); `starttls` against a server without it fails;
//  - AUTH accepted (credentials resolved from SecretRefs at send time) and AUTH refused (non-retryable);
//  - the connection dropped mid-DATA is a retryable failure;
//  - a restricted recipient gets the `inbox.restricted` text and no messageParams value, in the subject, the text or the
//    raw message;
//  - the worker twins (apps/worker/src/channels/**) are byte-identical and render identically (ADR-0002 rule 5).
// Also: 4xx/5xx recipient replies, a refused connection, `none` refused when insecure transport is refused, an
// unresolvable secret, header-injection safety, and no secret value in any result. Live mail is a residual (D-195 Q7):
// nothing here talks to a real mail server. All data is SYNTHETIC; nothing approves anything or touches DG0-DG7.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifySmtpError, createEmailChannel } from "../../../src/modules/tasks/channels/email.ts";
import type { ChannelSecretRef, SmtpSettings } from "../../../src/modules/tasks/channels/port.ts";
import {
  DEFAULT_CHANNEL_CATALOGUE,
  renderNotificationMessage,
  renderTestMessage,
  type ChannelCatalogue,
  type RenderNotificationInput,
} from "../../../src/modules/tasks/channels/render.ts";
import * as workerRender from "../../../../worker/src/channels/render.ts";
import { decodedBody, decodedSubject, FakeSmtp } from "../../support/fake-smtp.ts";

const TIMEOUTS = { connection: 5_000, greeting: 5_000, socket: 5_000 };
const SECRET_CANARY = "synthetic-canary-secret-7f3a91";
const USER_REF: ChannelSecretRef = { provider: "env", name: "MTH_TEST_SMTP_USER" };
const PASS_REF: ChannelSecretRef = { provider: "env", name: "MTH_TEST_SMTP_PASS" };
const secrets = new Map<string, string>([
  ["env:MTH_TEST_SMTP_USER", "synthetic-user"],
  ["env:MTH_TEST_SMTP_PASS", SECRET_CANARY],
]);
const resolveSecret = (ref: ChannelSecretRef) =>
  Promise.resolve(
    secrets.has(`${ref.provider}:${ref.name}`)
      ? { reveal: () => secrets.get(`${ref.provider}:${ref.name}`)!, toString: () => "[secret]" }
      : undefined,
  );

const LINK = "https://hub.example.invalid/links/synthetic-token";
const CATALOGUE: ChannelCatalogue = {
  ...DEFAULT_CHANNEL_CATALOGUE,
  messages: new Map([
    ["test.synthetic_due", { en: "{{title}} is due on {{dueDate}}.", ar: "{{title}} مستحق في {{dueDate}}." }],
  ]),
};
const notification = (over: Partial<RenderNotificationInput> = {}): RenderNotificationInput => ({
  notificationId: "0192f000-0000-7000-8000-000000000001",
  recipientUserId: "0192f000-0000-7000-8000-000000000002",
  locale: "en",
  messageKey: "test.synthetic_due",
  messageParams: { title: "SYNTHETIC-SECRET-TITLE", titleAr: "عنوان-سري", dueDate: "2026-11-02" },
  restricted: false,
  deepLinkUrl: LINK,
  ...over,
});

function settings(port: number, over: Partial<SmtpSettings> = {}): SmtpSettings {
  return {
    host: "127.0.0.1",
    port,
    security: "none",
    usernameRef: null,
    passwordRef: null,
    fromAddress: "hub-noreply@example.invalid",
    ...over,
  };
}

let fake: FakeSmtp;
let tlsDir: string | null = null;
let tlsMaterial: { key: string; cert: string } | null = null;

beforeAll(async () => {
  fake = await new FakeSmtp().start();
  // A throwaway self-signed certificate for 127.0.0.1 (deleted afterwards); without openssl the STARTTLS case is skipped
  // and says so.
  try {
    tlsDir = mkdtempSync(join(tmpdir(), "mth-fake-smtp-"));
    const key = join(tlsDir, "key.pem");
    const cert = join(tlsDir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore", timeout: 30_000 },
    );
    tlsMaterial = { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
  } catch {
    tlsMaterial = null;
  }
});
afterAll(async () => {
  await fake.stop();
  if (tlsDir) rmSync(tlsDir, { recursive: true, force: true });
});

const restricted = DEFAULT_CHANNEL_CATALOGUE.texts.en.restricted;

describe("the email adapter against the fake SMTP server", () => {
  it("sends one plain message: envelope, subject, text with the deep link, no record value by default", async () => {
    fake.configure({});
    const before = fake.messages.length;
    const channel = createEmailChannel({
      settings: settings(fake.port),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    });
    const message = renderNotificationMessage(notification());
    const result = await channel.send(message, "recipient@example.invalid");
    expect(result).toEqual({ ok: true });
    expect(fake.messages).toHaveLength(before + 1);
    const got = fake.messages.at(-1)!;
    expect(got.mailFrom).toBe("hub-noreply@example.invalid");
    expect(got.rcptTo).toEqual(["recipient@example.invalid"]);
    expect(got.tls).toBe(false);
    expect(got.authUser).toBeNull();
    expect(decodedSubject(got.data)).toBe("Transformation Hub: you have a new notification");
    const text = decodedBody(got.data);
    expect(text).toContain(LINK);
    expect(text).toContain(DEFAULT_CHANNEL_CATALOGUE.texts.en.generic);
    // The default catalogue has no per-key template: no messageParams value reaches the message.
    expect(got.data).not.toContain("SYNTHETIC-SECRET-TITLE");
    expect(got.data).toMatch(/^Auto-Submitted: auto-generated$/im);
    expect(got.data).toMatch(/^Content-Language: en$/im);
  });

  it("upgrades with STARTTLS where the fake offers it, verifying the certificate", async (ctx) => {
    if (!tlsMaterial) {
      ctx.skip(); // openssl unavailable: reported, never counted as a pass
      return;
    }
    fake.configure({ starttls: tlsMaterial });
    const before = fake.messages.length;
    const ok = await createEmailChannel({
      settings: settings(fake.port, { security: "starttls" }),
      resolveSecret,
      refuseInsecure: true,
      tls: { ca: tlsMaterial.cert },
      timeouts: TIMEOUTS,
    }).send(
      renderTestMessage({ recipientUserId: "u", locale: "en", linkUrl: "https://hub.example.invalid/" }),
      "a@example.invalid",
    );
    expect(ok).toEqual({ ok: true });
    expect(fake.messages).toHaveLength(before + 1);
    expect(fake.messages.at(-1)!.tls).toBe(true);
    // Without the CA the certificate is not trusted: a TLS failure, never a silent downgrade.
    const untrusted = await createEmailChannel({
      settings: settings(fake.port, { security: "starttls" }),
      resolveSecret,
      refuseInsecure: true,
      timeouts: TIMEOUTS,
    }).send(
      renderTestMessage({ recipientUserId: "u", locale: "en", linkUrl: "https://hub.example.invalid/" }),
      "a@example.invalid",
    );
    expect(untrusted).toMatchObject({ ok: false });
    expect(fake.messages).toHaveLength(before + 1);
  });

  it("refuses to continue in plaintext when starttls is required and the server does not offer it", async () => {
    fake.configure({});
    const before = fake.messages.length;
    const result = await createEmailChannel({
      settings: settings(fake.port, { security: "starttls" }),
      resolveSecret,
      refuseInsecure: true,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(result).toEqual({ ok: false, errorCode: "smtp.tls_failed", retryable: false });
    expect(fake.messages).toHaveLength(before);
  });

  it("authenticates with credentials resolved from SecretRefs at send time", async () => {
    fake.configure({ auth: { user: "synthetic-user", pass: SECRET_CANARY } });
    const before = fake.messages.length;
    const result = await createEmailChannel({
      settings: settings(fake.port, { usernameRef: USER_REF, passwordRef: PASS_REF }),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(result).toEqual({ ok: true });
    expect(fake.messages).toHaveLength(before + 1);
    expect(fake.messages.at(-1)!.authUser).toBe("synthetic-user");
  });

  it("AUTH refused: a non-retryable failure that names no credential", async () => {
    fake.configure({ auth: "reject" });
    const before = { messages: fake.messages.length, failures: fake.authFailures };
    const result = await createEmailChannel({
      settings: settings(fake.port, { usernameRef: USER_REF, passwordRef: PASS_REF }),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(result).toEqual({ ok: false, errorCode: "smtp.auth_failed", retryable: false });
    expect(fake.authFailures).toBeGreaterThan(before.failures);
    expect(fake.messages).toHaveLength(before.messages);
    expect(JSON.stringify(result)).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(result)).not.toContain("synthetic-user");
  });

  it("an unresolvable secret reference fails before any connection, without a value", async () => {
    fake.configure({ auth: { user: "synthetic-user", pass: SECRET_CANARY } });
    const connections = fake.connections;
    const result = await createEmailChannel({
      settings: settings(fake.port, {
        usernameRef: USER_REF,
        passwordRef: { provider: "env", name: "MTH_TEST_NOT_SET" },
      }),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(result).toEqual({ ok: false, errorCode: "smtp.secret_unavailable", retryable: false });
    expect(fake.connections).toBe(connections);
    const throwing = await createEmailChannel({
      settings: settings(fake.port, { usernameRef: USER_REF, passwordRef: PASS_REF }),
      resolveSecret: () => Promise.reject(new Error(`provider failed for ${SECRET_CANARY}`)),
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(throwing).toEqual({ ok: false, errorCode: "smtp.secret_unavailable", retryable: false });
  });

  it("a connection dropped mid-DATA is a retryable failure, and nothing is recorded as delivered", async () => {
    fake.configure({ dropDuringDataAfterBytes: 64 });
    const before = fake.messages.length;
    const result = await createEmailChannel({
      settings: settings(fake.port),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect((result as { errorCode: string }).errorCode).toMatch(/^smtp\.(connection_failed|timeout)$/);
    expect(fake.messages).toHaveLength(before);
  });

  it("recipient replies: 5xx is permanent, 4xx is retryable", async () => {
    const send = () =>
      createEmailChannel({
        settings: settings(fake.port),
        resolveSecret,
        refuseInsecure: false,
        timeouts: TIMEOUTS,
      }).send(renderNotificationMessage(notification()), "a@example.invalid");
    fake.configure({ rcptReply: 550 });
    expect(await send()).toEqual({ ok: false, errorCode: "smtp.recipient_rejected", retryable: false });
    fake.configure({ rcptReply: 451 });
    expect(await send()).toEqual({ ok: false, errorCode: "smtp.temporary_failure", retryable: true });
    fake.configure({});
  });

  it("a refused connection is retryable; `none` is refused before connecting when insecure transport is refused", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const refused = await createEmailChannel({
      settings: settings(port),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(refused).toMatchObject({ ok: false, errorCode: "smtp.connection_failed", retryable: true });
    const connections = fake.connections;
    const insecure = await createEmailChannel({
      settings: settings(fake.port),
      resolveSecret,
      refuseInsecure: true,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid");
    expect(insecure).toEqual({ ok: false, errorCode: "smtp.configuration_invalid", retryable: false });
    expect(fake.connections).toBe(connections);
  });

  it("a malformed recipient address (a header injection attempt) is refused before connecting", async () => {
    const connections = fake.connections;
    const result = await createEmailChannel({
      settings: settings(fake.port),
      resolveSecret,
      refuseInsecure: false,
      timeouts: TIMEOUTS,
    }).send(renderNotificationMessage(notification()), "a@example.invalid\r\nBcc: b@example.invalid");
    expect(result).toEqual({ ok: false, errorCode: "smtp.recipient_rejected", retryable: false });
    expect(fake.connections).toBe(connections);
  });

  it("classifies errors by code and reply only, never by server text", () => {
    expect(classifySmtpError({ code: "ECONNECTION" })).toEqual({
      errorCode: "smtp.connection_failed",
      retryable: true,
    });
    expect(classifySmtpError({ code: "ETIMEDOUT" })).toEqual({ errorCode: "smtp.timeout", retryable: true });
    expect(classifySmtpError({ code: "EAUTH", responseCode: 535 })).toEqual({
      errorCode: "smtp.auth_failed",
      retryable: false,
    });
    expect(classifySmtpError({ code: "EMESSAGE", responseCode: 552 })).toEqual({
      errorCode: "smtp.message_rejected",
      retryable: false,
    });
    expect(classifySmtpError({ code: "EMESSAGE", responseCode: 452 })).toEqual({
      errorCode: "smtp.temporary_failure",
      retryable: true,
    });
    expect(classifySmtpError(new Error("anything"))).toEqual({ errorCode: "smtp.unknown", retryable: true });
    for (const code of ["ECONNECTION", "ETLS", "EAUTH", "EENVELOPE", "EPROTOCOL", "ECONFIG", "X"])
      expect(classifySmtpError({ code }).errorCode).toMatch(/^[a-z][a-z0-9_.]*$/);
  });
});

describe("rendering (ADR-0054 §3; ADR-0051 §3)", () => {
  it("a restricted recipient gets the inbox.restricted text and no messageParams value", async () => {
    fake.configure({});
    for (const locale of ["en", "ar"] as const) {
      const before = fake.messages.length;
      const message = renderNotificationMessage(notification({ restricted: true, locale }), CATALOGUE);
      expect(message.text.split("\n")[0]).toBe(CATALOGUE.texts[locale].restricted);
      for (const value of ["SYNTHETIC-SECRET-TITLE", "عنوان-سري", "2026-11-02"]) {
        expect(message.subject).not.toContain(value);
        expect(message.text).not.toContain(value);
      }
      expect(message.text).toContain(LINK);
      const result = await createEmailChannel({
        settings: settings(fake.port),
        resolveSecret,
        refuseInsecure: false,
        timeouts: TIMEOUTS,
      }).send(message, "recipient@example.invalid");
      expect(result).toEqual({ ok: true });
      expect(fake.messages).toHaveLength(before + 1);
      const raw = fake.messages.at(-1)!.data;
      const body = decodedBody(raw);
      expect(body).toContain(CATALOGUE.texts[locale].restricted);
      for (const value of ["SYNTHETIC-SECRET-TITLE", "عنوان-سري", "2026-11-02"]) {
        expect(raw).not.toContain(value);
        expect(body).not.toContain(value);
      }
    }
    expect(restricted).toBe("You no longer have access to this item.");
  });

  it("an admitted recipient gets the per-key template with its parameters, in the recipient's locale", () => {
    const en = renderNotificationMessage(notification(), CATALOGUE);
    expect(en.text.split("\n")[0]).toBe("SYNTHETIC-SECRET-TITLE is due on 2026-11-02.");
    const ar = renderNotificationMessage(notification({ locale: "ar" }), CATALOGUE);
    expect(ar.text.split("\n")[0]).toBe("عنوان-سري مستحق في 2026-11-02.");
    expect(ar.subject).toBe("Transformation Hub: لديك إشعار جديد");
    // The subject never carries a parameter, and control characters of a product name never reach a header.
    const injected = renderNotificationMessage(
      notification({ productName: "Hub\r\nBcc: x@example.invalid" }),
      CATALOGUE,
    );
    expect(injected.subject).not.toMatch(/[\r\n]/);
    expect(injected.subject).not.toContain("SYNTHETIC-SECRET-TITLE");
  });

  it("the worker twins are byte-identical and render identically", () => {
    for (const file of ["port.ts", "email.ts", "render.ts"]) {
      const api = readFileSync(new URL(`../../../src/modules/tasks/channels/${file}`, import.meta.url), "utf8");
      const worker = readFileSync(new URL(`../../../../worker/src/channels/${file}`, import.meta.url), "utf8");
      expect(worker, file).toBe(api);
    }
    const cases: RenderNotificationInput[] = [
      notification(),
      notification({ locale: "ar" }),
      notification({ restricted: true }),
      notification({ restricted: true, locale: "ar" }),
      notification({ messageKey: "unknown.key", messageParams: {} }),
      notification({ messageParams: { title: null, dueDate: "2026-11-02" } }),
      notification({ productName: "منصة موبايلي للتحوّل", locale: "ar" }),
    ];
    for (const c of cases) {
      expect(workerRender.renderNotificationMessage(c, CATALOGUE)).toEqual(renderNotificationMessage(c, CATALOGUE));
      expect(workerRender.renderNotificationMessage(c)).toEqual(renderNotificationMessage(c));
    }
    const t = { recipientUserId: "u", locale: "ar" as const, linkUrl: "https://hub.example.invalid/" };
    expect(workerRender.renderTestMessage(t)).toEqual(renderTestMessage(t));
  });
});
