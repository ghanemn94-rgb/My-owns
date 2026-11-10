// P6 slice C (T-DG6-BE-I; ADR-0054 §3; REQ-S12-023; D-195 Q7, D-197 item 2 Option A): the optional SMTP email adapter of
// the NotificationChannel port, on nodemailer 10.2.1 (MIT-0; exact-pinned by the orchestrator, T-DG6-DO-A2).
//  - Remote I/O only: the caller never holds a database transaction across `send` (§2 rule 4).
//  - Credentials are SecretRefs resolved through the SecretProvider registry at send time (ADR-0052 §5); a value never
//    appears in a log line, an error code or a return value. nodemailer's own logger is off.
//  - `tls` connects with implicit TLS; `starttls` requires the upgrade (a server that does not offer it fails with
//    `smtp.tls_failed`); `none` is plaintext, which the API refuses in production (422
//    notification_channel.insecure_transport) and which this adapter refuses too when `refuseInsecure` is set.
//    Certificates are verified (Node's default); a test passes its own CA through `tls`, never `rejectUnauthorized`.
//  - A failure is a stable code (`EMAIL_ERROR_CODES`) with `retryable`: connection drops (including mid-DATA), timeouts
//    and 4xx replies are retryable; authentication, TLS, configuration and 5xx replies are not. Server text is never
//    returned or stored.
// Live mail is a residual (D-195 Q7): this adapter is exercised against the in-process fake SMTP server
// (apps/api/test/support/fake-smtp.ts) only, and is never claimed to be integrated with a Mobily mail service.
// The worker holds an identical twin (apps/worker/src/channels/email.ts).
import { createTransport } from "nodemailer";
import type {
  ChannelMessage,
  ChannelSecretResolver,
  ChannelSendResult,
  EmailErrorCode,
  NotificationChannel,
  SmtpSettings,
} from "./port.ts";

export interface EmailChannelOptions {
  readonly settings: SmtpSettings;
  readonly resolveSecret: ChannelSecretResolver;
  /** Refuse `none` security (set when NODE_ENV=production). */
  readonly refuseInsecure: boolean;
  /** Extra TLS options (a test CA, PEM); certificate verification stays on. */
  readonly tls?: { readonly ca?: string; readonly servername?: string };
  /** Milliseconds; defaults 10 s connect and greeting, 20 s socket inactivity. */
  readonly timeouts?: { readonly connection?: number; readonly greeting?: number; readonly socket?: number };
  /** The EHLO name; defaults to nodemailer's (the host name). */
  readonly clientName?: string;
}

/** A plain mailbox (no display name, no CR/LF): the only form a recipient address takes here. */
const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

const failure = (errorCode: EmailErrorCode, retryable: boolean): ChannelSendResult => ({
  ok: false,
  errorCode,
  retryable,
});

/** Maps a nodemailer error to a stable code; never reads or returns the server's text. */
export function classifySmtpError(error: unknown): { errorCode: EmailErrorCode; retryable: boolean } {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const reply = typeof e.responseCode === "number" ? e.responseCode : null;
  const temporary = reply !== null && reply >= 400 && reply < 500;
  switch (code) {
    case "ECONNECTION":
    case "ESOCKET":
    case "EDNS":
    case "EPROXY":
      return { errorCode: "smtp.connection_failed", retryable: true };
    case "ETIMEDOUT":
      return { errorCode: "smtp.timeout", retryable: true };
    case "ETLS":
    case "EREQUIRETLS":
      return { errorCode: "smtp.tls_failed", retryable: false };
    case "EAUTH":
    case "ENOAUTH":
      return temporary
        ? { errorCode: "smtp.temporary_failure", retryable: true }
        : { errorCode: "smtp.auth_failed", retryable: false };
    case "EENVELOPE":
      return temporary
        ? { errorCode: "smtp.temporary_failure", retryable: true }
        : { errorCode: "smtp.recipient_rejected", retryable: false };
    case "EMESSAGE":
      if (temporary) return { errorCode: "smtp.temporary_failure", retryable: true };
      if (reply !== null) return { errorCode: "smtp.message_rejected", retryable: false };
      return { errorCode: "smtp.connection_failed", retryable: true };
    case "EPROTOCOL":
      return { errorCode: "smtp.protocol_error", retryable: true };
    case "ECONFIG":
      return { errorCode: "smtp.configuration_invalid", retryable: false };
    default:
      return temporary
        ? { errorCode: "smtp.temporary_failure", retryable: true }
        : { errorCode: "smtp.unknown", retryable: true };
  }
}

/** Resolves both credential references, or none; undefined when a reference cannot be resolved. */
async function credentials(
  settings: SmtpSettings,
  resolve: ChannelSecretResolver,
): Promise<{ user: string; pass: string } | null | undefined> {
  if (settings.usernameRef === null || settings.passwordRef === null) {
    return settings.usernameRef === null && settings.passwordRef === null ? null : undefined;
  }
  try {
    const [user, pass] = await Promise.all([resolve(settings.usernameRef), resolve(settings.passwordRef)]);
    if (user === undefined || pass === undefined) return undefined;
    return { user: user.reveal(), pass: pass.reveal() };
  } catch {
    // An unregistered provider or an unreadable secret: the error names a reference at most; it is not passed on.
    return undefined;
  }
}

/** The SMTP adapter of the NotificationChannel port (ADR-0054 §3). */
export function createEmailChannel(options: EmailChannelOptions): NotificationChannel {
  const { settings } = options;
  return {
    kind: "email",
    async send(message: ChannelMessage, address: string): Promise<ChannelSendResult> {
      if (settings.security === "none" && options.refuseInsecure) return failure("smtp.configuration_invalid", false);
      if (!ADDRESS.test(address) || !ADDRESS.test(settings.fromAddress))
        return failure("smtp.recipient_rejected", false);
      const auth = await credentials(settings, options.resolveSecret);
      if (auth === undefined) return failure("smtp.secret_unavailable", false);
      const transport = createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.security === "tls",
        requireTLS: settings.security === "starttls",
        ignoreTLS: settings.security === "none",
        ...(auth ? { auth } : {}),
        tls: { minVersion: "TLSv1.2", ...(options.tls ?? {}) },
        connectionTimeout: options.timeouts?.connection ?? 10_000,
        greetingTimeout: options.timeouts?.greeting ?? 10_000,
        socketTimeout: options.timeouts?.socket ?? 20_000,
        ...(options.clientName ? { name: options.clientName } : {}),
        logger: false,
        debug: false,
      });
      try {
        await transport.sendMail({
          from: settings.fromAddress,
          to: address,
          subject: message.subject,
          text: message.text,
          headers: { "Auto-Submitted": "auto-generated", "Content-Language": message.locale },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return { ok: true };
      } catch (error) {
        const { errorCode, retryable } = classifySmtpError(error);
        return failure(errorCode, retryable);
      } finally {
        transport.close();
      }
    },
  };
}
