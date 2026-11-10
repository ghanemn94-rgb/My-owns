// P6 slice C (T-DG6-BE-I; ADR-0054 §3; REQ-S12-023): the NotificationChannel port. The in-app inbox is always on and is
// not a channel: every notification is written to `inbox_notification` first, in the producing transaction, exactly as
// in DG4/DG5. An external channel is an optional adapter that IT configures; with no channel row (or a disabled one)
// nothing is sent and nothing is written (A21). `email` has an SMTP adapter (email.ts); `enterprise_messaging` has this
// port only: no adapter ships in P6, so it cannot be enabled (CHECK notification_channel_no_messaging_adapter; 422
// notification_channel.adapter_unavailable).
// The worker holds an identical twin of this file (apps/worker/src/channels/port.ts; ADR-0002 rule 5: the worker never
// imports the API). The parity test (apps/api/test/integration/tasks/email-adapter-contract.test.ts) keeps them equal.
// Nothing here approves anything, and nothing reads or writes DG0-DG7.

export const CHANNEL_KINDS = ["email", "enterprise_messaging"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Whether an adapter ships for the kind in this release (P6: email only). */
export function channelAdapterAvailable(kind: ChannelKind): boolean {
  return kind === "email";
}

export type ChannelLocale = "en" | "ar";

/** One rendered message. No message body is stored: it is rendered at send time (render.ts). */
export interface ChannelMessage {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly locale: ChannelLocale;
  readonly subject: string;
  readonly text: string;
  /** Always the ADR-0051 §3 `/links/<token>` path on APP_BASE_URL (re-authorized when opened). */
  readonly deepLinkUrl: string;
}

/** The outcome of one send. `errorCode` matches `notification_delivery.error_code` (`^[a-z][a-z0-9_.]*$`). */
export type ChannelSendResult = { readonly ok: true } | { readonly ok: false; errorCode: string; retryable: boolean };

export interface NotificationChannel {
  readonly kind: ChannelKind;
  send(message: ChannelMessage, address: string): Promise<ChannelSendResult>;
}

/** A reference to a secret held by a SecretProvider (ADR-0052 §5); never the value. */
export interface ChannelSecretRef {
  readonly provider: string;
  readonly name: string;
}

/** A resolved secret: only `reveal()` returns the value (SecretValue of ADR-0052 §5). */
export interface ChannelSecretValue {
  reveal(): string;
}

/** Resolves a reference through the process's SecretProvider registry. */
export type ChannelSecretResolver = (ref: ChannelSecretRef) => Promise<ChannelSecretValue | undefined>;

export const SMTP_SECURITY_MODES = ["starttls", "tls", "none"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number];

/** The SMTP part of a `notification_channel` row. Credentials are references, both or neither. */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly usernameRef: ChannelSecretRef | null;
  readonly passwordRef: ChannelSecretRef | null;
  readonly fromAddress: string;
}

/** The send error codes of the email adapter (stored as `notification_delivery.error_code`; never server text). */
export const EMAIL_ERROR_CODES = [
  "smtp.connection_failed",
  "smtp.timeout",
  "smtp.tls_failed",
  "smtp.auth_failed",
  "smtp.recipient_rejected",
  "smtp.message_rejected",
  "smtp.temporary_failure",
  "smtp.protocol_error",
  "smtp.secret_unavailable",
  "smtp.configuration_invalid",
  "smtp.unknown",
] as const;
export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];
