# Notifications: the in-app inbox (always on) and the optional email channel (P6)

This guide is for Mobily IT. It explains how users are notified, what the optional email channel needs, how to
configure and test it, and what happens when it is missing or failing. Design: ADR-0025 (inbox and outbox),
ADR-0044 §5 (delivery policy), ADR-0051 §3 (deep links), ADR-0054 §3 (channels). Requirement: REQ-S12-023 (M0241).
Decisions: D-195 Q7, D-197 item 2.

> **Scope and honesty.**
>
> - **Not tested against live mail.** The SMTP adapter (nodemailer 10.2.1, MIT-0) has been run only against the
>   in-process fake SMTP server (`apps/api/test/support/fake-smtp.ts`). It has not been run against a Mobily mail
>   service or any other live relay. Live mail and enterprise messaging are **residuals**
>   (`docs/delivery/environment.md`, "P6 residuals").
> - **No approval.** "IT-configured channel" names a slot that Mobily IT fills. Nothing here claims that IT approved
>   or connected a mail server.
> - A Compose demonstration is not proof of high-availability production readiness. Product gate G6 never implies
>   engineering gate DG7.

## 1. In-app always, channels optional

| Channel | Status in P6 | Configured by |
|---|---|---|
| **In-app inbox** (My Work > Inbox) | **Always on.** Every notification is written to the inbox in the same database transaction as the change that caused it, as in DG4/DG5. It is not a channel row and cannot be turned off. | Nothing to configure |
| **Email** (SMTP) | Optional adapter, **off** until IT configures and enables it | Administration > Notifications (§3) |
| **Enterprise messaging** | **Port only.** No adapter ships in P6, so it **cannot be enabled**: the API answers 422 `notification_channel.adapter_unavailable`, and the database refuses it too (`notification_channel_no_messaging_adapter`). | — |

**With no channel configured, nothing breaks (A21).** With no channel row, or a disabled one, the hub sends nothing
and writes no delivery record. Every workflow (lifecycle, approvals, calculations, reports, escalations) completes,
and notifications appear in the inbox. A mail outage, a wrong password or a rejected recipient never blocks or rolls
back the change that produced the notification: sending happens after that change has committed (§4).

## 2. What Mobily IT supplies for email

| Item | Notes |
|---|---|
| **SMTP relay host and port** | An internal relay the hub may submit to, typically port 587 (STARTTLS) or 465 (implicit TLS). Host up to 253 characters; port 1–65535. |
| **Security mode** | `starttls` (the upgrade is **required**: a server that does not offer it fails with `smtp.tls_failed`), `tls` (implicit TLS) or `none`. **`none` is refused when `NODE_ENV=production`** (422 `notification_channel.insecure_transport`), and the adapter refuses it at send time too. TLS 1.2 is the minimum, and certificates are always verified. |
| **TLS trust** | If the relay's certificate is issued by a corporate CA, the runtime must trust it. Node.js reads extra CA certificates from the file named by `NODE_EXTRA_CA_CERTS` at process start. This has **not** been exercised against a corporate CA here. Verification is never switched off. |
| **Credentials** (optional) | A username and password for SMTP AUTH, **both or neither**. They are stored as secret **references**, never values (§5). Leave both empty for a relay that authorizes the hub by network address. |
| **Sender address** | The `From` address, for example `transformation-hub@<mobily domain>`. Up to 254 characters, a plain address. Its SPF, DKIM and DMARC alignment is set up by IT's mail team on the relay and in DNS. The hub signs nothing. |
| **Network route** | From every **worker** process (it sends the notifications) and every **API** process (it sends the "test to me" message) to the relay. No other outbound route is needed. |
| **Recipient addresses** | Each user's email address held by the hub (`app_user.email`, normally taken from the identity provider's `email` claim). A user with no address is skipped (`no_address`). |
| **`APP_BASE_URL`** | The public base URL of the hub (ADR-0011). Deep links in messages are built on it. |

## 3. Configuring and testing (Administration > Notifications)

Channels are configured **per organization**, at that organization's scope.

| Operation | Permission | What it does |
|---|---|---|
| `GET /api/v1/admin/notification-channels` (`listNotificationChannels`) | `notification_channel.configure`, or `operations.read` for read-only (AUD) | Both channels with `configured`, `enabled` and `adapterAvailable`. A never-configured channel shows as not configured and disabled (ETag `0`). The inbox is not listed: it is always on. |
| `GET` / `PUT /api/v1/admin/notification-channels/{channelKind}` (`getNotificationChannel`, `putNotificationChannel`) | read as above; PUT needs `notification_channel.configure` (ADM_TECH) | PUT saves the SMTP settings and the enabled flag, with a reason of 3–1,000 characters. `If-Match: 0` creates the row; later saves need the current version (428 if missing, 409 if stale). Audit event: `notification_channel.changed`. |
| `POST /api/v1/admin/notification-channels/email/test` (`testNotificationChannel`) | `notification_channel.configure` (ADM_TECH) | Sends **one** test message to the caller's own address through the **saved, enabled** channel, outside any database transaction. Returns `sent` or `failed` with an error code (§6), never server text. Audit event: `notification_channel.tested`. |
| `GET /api/v1/admin/notification-deliveries` (`listNotificationDeliveries`) | `notification_channel.configure` or `operations.read` | External deliveries, newest first: status, attempts, timestamps, skip reason and error code. **Never** the message text or the recipient address. |

Steps:

1. IT provides the relay details and puts any credentials into the secret store (§5).
2. A technical administrator (ADM_TECH) opens **Administration > Notifications > Email**, enters host, port, security
   mode, sender and (optionally) the two credential references, ticks **Enabled** and saves with a reason.
3. They use **Send test to me** and confirm that the message arrives. If it fails, the error code says why (§6).
4. To stop email, save the channel with **Enabled** off. The inbox is unaffected.

**Refusals** (problem+json; the English texts are fixed by ADR-0054 §4, and Arabic is shown in the UI):

| Status | Code | When |
|---|---|---|
| 422 | `notification_channel.email_incomplete` | Enabling without host, port, security and sender; or only one of the two credential references |
| 422 | `notification_channel.adapter_unavailable` | Enabling or configuring `enterprise_messaging` |
| 422 | `notification_channel.insecure_transport` | Security `none` when `NODE_ENV=production` |
| 422 | `storage.secret_ref_invalid` | A credential that is not a `{provider, name}` reference, or that names a provider not registered in the API (the shared credential-reference code of ADR-0054 §4) |
| 422 | `notification_channel.not_configured` | A test while the channel is not configured or not enabled |
| 422 | `notification_channel.no_recipient_address` | A test by a user who has no email address |
| 422 | `admin.reason_required` | The reason is missing, or not 3–1,000 characters |
| 403 / 404 / 409 / 428 | shared problems | No permission (AUD gets 403 on every write); unknown resource; stale version; missing `If-Match` |

## 4. How a notification reaches email

1. The producing change writes the inbox notification and, in the same transaction, an outbox event
   `inbox_notification.created`.
2. After commit, the worker's notifications handler reads the organization's **enabled** channels. It records one
   delivery per enabled channel: `pending`, or `skipped` with a reason (`no_address`, `recipient_restricted`,
   `channel_disabled`, `recipient_disabled`). This step runs exactly once per notification. A replay of the event
   creates nothing, and the database backstop is the unique `(notification, channel)` key.
3. The send happens **outside any transaction**, under a per-delivery lock. Only a still-`pending` delivery is sent.
   It ends `sent` or `failed` with an error code, and every attempt is counted exactly once.
4. Retryable failures (§6) are retried with backoff, up to 5 attempts (ADR-0008 §4). After that the delivery stays
   `failed`, and an operational exception on the notifications queue is visible in Administration > Operations.
5. The P5 delivery policy still applies. A notification held for quiet hours or a digest fans out when it is
   released, not before.

**What a message contains.** The subject and text are rendered at send time from the notification's message key, in
the recipient's language (Arabic or English). The message is plain text, with the headers `Auto-Submitted:
auto-generated` and `Content-Language`. It carries the deep link `<APP_BASE_URL>/links/<token>`, which checks the
reader's access again when opened, and **never** a record's values. If the recipient can no longer read the item, the
text is the generic "You no longer have access to this item." and no detail is included. No message body is stored.

## 5. Credentials are references, never values

`usernameRef` and `passwordRef` are `{ "provider": "<id>", "name": "<NAME>" }`. The database accepts only that shape,
so a value cannot be stored there. Values are resolved at send time through the `SecretProvider` registry
(ADR-0052 §5; `configuration.md`, "Secret providers"):

- `env`: for example `{ "provider": "env", "name": "MTH_SMTP_PASSWORD" }`. Set `MTH_SMTP_PASSWORD_FILE` (a container
  secret) or `MTH_SMTP_PASSWORD`.
- `file`: for example `{ "provider": "file", "name": "mth_smtp_password" }`. Place the file directly inside
  `SECRETS_DIR`.
- Another provider (IT's vault) is used only if IT registers its own adapter. The product ships none.

The names are examples. Provide the values to **both** the API (test) and the worker (sends). A reference that
cannot be resolved fails the send with `smtp.secret_unavailable`, naming no value. The adapter's own logging is off,
and no SMTP server text, password or message body is logged or stored. **Rotation:** replace the value under the same
name and restart the processes. If the name changes, save the channel again.

## 6. Error codes (deliveries list and test result)

| Code | Retried | Usual cause |
|---|---|---|
| `smtp.connection_failed` | yes | Relay unreachable, connection dropped (including mid-message), DNS failure |
| `smtp.timeout` | yes | Connect, greeting or socket timeout (10 s, 10 s, 20 s) |
| `smtp.temporary_failure` | yes | A 4xx reply from the relay |
| `smtp.protocol_error` | yes | An unexpected SMTP exchange |
| `smtp.unknown` | yes | An unclassified error |
| `smtp.tls_failed` | no | STARTTLS not offered, handshake failure or certificate not trusted (§2) |
| `smtp.auth_failed` | no | Credentials refused |
| `smtp.recipient_rejected` | no | The relay refused the recipient, or the address or sender is not a plain address |
| `smtp.message_rejected` | no | A 5xx reply to the message |
| `smtp.secret_unavailable` | no | A credential reference does not resolve (§5) |
| `smtp.configuration_invalid` | no | An invalid setting, or `none` security in production |

## 7. Restricted networks

The only outbound route email needs is from the worker and the API to IT's relay. No public mail service, CDN or
builder-hosted service is involved. In the no-egress Compose variant (`compose.no-egress.yaml`), the relay must be
reachable on a route IT allows. With email disabled, the hub makes no SMTP connection at all.

## 8. Status of each piece in this release

This guide was written against tree `135ff1d` (DG6, W7). The status of each piece at that revision:

| Piece | Status at `135ff1d` | Owner |
|---|---|---|
| In-app inbox (always on) | Delivered (DG4/DG5, unchanged) | — |
| Channel port, SMTP adapter, rendering, fake SMTP, adapter contract test; channel configuration, get, list and **test** operations (§3) | Delivered, tested only against the fake | BE-I |
| `notification_channel`, `notification_delivery` and their histories (`0102`); `notification_channel.configure` (`0103`) | Delivered | ARCH-02 |
| Fan-out after commit (§4: the outbox event, the worker handler, retries) and `listNotificationDeliveries` | **Not yet on this tree.** Enabling email at this revision sends only the test message, and no notification reaches email yet. The handler and the deliveries route are stubs. | BE-I2 (p6-work-split §J/C.11) |
| Administration > Notifications page | FE-B | FE-B |
| Live SMTP relay; enterprise messaging adapter | **Residual**: not exercised; no messaging adapter ships | Mobily IT / a later release |

§4 describes the behaviour ADR-0054 §3 fixes for the BE-I2 delivery. Re-check it against the release notes of the
build you install.
