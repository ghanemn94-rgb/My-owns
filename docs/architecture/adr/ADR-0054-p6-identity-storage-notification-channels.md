# ADR-0054: P6 identity, storage and channels: issuer and audience rejection, the Keycloak test realm and its image, the SAML broker document and Administration > Identity; the S3-compatible `EvidenceStore` adapter, one contract suite for both adapters, the test store and Administration > Storage; the `NotificationChannel` port, the in-app inbox always, the optional email adapter, outbox fan-out with idempotency and Administration > Notifications

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-02), 2026-10-26.
- **Requirements (slice C of `docs/architecture/p6-plan.md`):** REQ-S16-007, REQ-S16-006, REQ-S12-023.
- **Sources (quoted where a design point has one):**
  - M0312 (§16) "Standards-based enterprise identity integration through OIDC, using the corporate identity provider. Where SAML is required, provide a documented compatible broker/adapter. A self-hosted identity provider such as Keycloak can be used for a portable integration test."
  - M0311 (§16) "An evidence-storage adapter with a private filesystem option and an optional IT-approved object-store adapter."
  - M0241 (§12) "Notification channels must include an in-app inbox. Optional email or enterprise messaging channels are adapters and require IT configuration; lack of those channels cannot break workflows. Deep links must enforce access."
  - M0314 (§16) "Verify current official documentation, support windows, licenses and security maintenance before selecting exact dependency versions. Pin compatible versions and lockfiles. Keep mandatory services runnable within company-controlled infrastructure."
  - M0330 (§16) "Avoid exposing secrets or private evidence URLs in client code or logs." M0390 (§20, A21) "Core lifecycle, approvals, calculations and reports still work with AI and external notification channels disabled".
  - Acceptance texts. REQ-S16-007: "A18;A12: e2e tests log in through the Keycloak test realm; a token from another realm is rejected". REQ-S16-006: "A18;A12: contract tests pass for both adapters; evidence is never served from a public URL". REQ-S12-023: "A21: with no email adapter configured all workflows complete and notifications appear in the inbox".
  - The playbook names no identity, storage or channel technology; nothing below is attributed to it.
- **Decisions applied:** D-195 (Q2 evidence links are API paths with bytes proxied in both modes; Q5 Keycloak; Q6 the S3 test target; Q7 the email adapter; R3), D-049 (Keycloak image BLOCKED), D-057 (no live registry install), D-196, D-193, D-088 §2, D-141, F-DG4-160.
- **Builds on:** ADR-0005 (OIDC code flow with PKCE, sessions), ADR-0010 (evidence store; §2 "never public or pre-signed URLs"; §3 S3 adapter planned; L-1 MinIO AGPL), ADR-0011 (configuration), ADR-0025 (inbox, outbox), ADR-0044 §5 (notification policy, delivery state), ADR-0051 §3 (deep links, `inbox.restricted`), ADR-0052 §5 (`SecretProvider`, `SecretRef`).
- **Physical model:** `packages/db/migrations/0102_p6_storage_notification_channels.sql`, `0103_p6_operations_channels_permissions.sql`; probe groups ST, NC, ND, PM in `docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/probe-output.txt`.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. "IT-approved" names a configuration slot that Mobily IT fills; no task claims that IT approved a store, an IdP or a mail server.

## Context

1. `identity/oidc.ts` runs the authorization-code flow with PKCE through `openid-client` (`authorizationCodeGrant` with `expectedState`, `expectedNonce`, `idTokenExpected`), which validates the ID token's issuer against the discovered issuer and its audience against the client id. A validation failure redirects to `/login?error=token_invalid` and writes the audit event `session.login_failed` (`identity/routes.ts`). Integration tests use the local fake OP (`apps/api/test/support/fake-idp.ts`). No test presents a token from another issuer.
2. `deploy/keycloak/realm-mth-test.json` ships realm `mth-test` (client `mth-hub`, synthetic users). `deploy/images.lock.json` lists `quay.io/keycloak/keycloak:26.4` with `digest: null` and a BLOCKED reason (quay.io was refused on 2026-10-01, D-049).
3. `evidence/store.ts` defines `EvidenceStore` (`put`, `receive`, `finalise`, `get`, `head`, `discardUncommitted`, `sweepStaleTemporaries`) and the filesystem adapter. `EVIDENCE_STORAGE_DRIVER=s3` makes every content operation 503 "by design". `evidence_content` has no column saying which store holds a file.
4. Every notification is written to `inbox_notification` (`0028`) with its P5 delivery state (ADR-0044 §5). No channel adapter or delivery record exists.

## Decision

### 1. Identity (REQ-S16-007)

**Issuer and audience rejection (additive; no login behaviour changes).** `identity/oidc.ts` (BE-G) keeps `openid-client`'s checks and adds an explicit post-validation check of the claims it returns: `iss` equals the configured issuer exactly; `aud` contains the client id; when `aud` has more than one value, `azp` equals the client id. A failure takes the existing path: redirect `/login?error=token_invalid`, audit `session.login_failed` with reason "OIDC token exchange or ID token validation failed", no session, no user created or bound. The token and its claims are never logged (ADR-0053 §4).

**Proof:**
- **Integration (BE-G, always runnable here):** the fake OP gains a second issuer (`/realms/mth-other`) with its own signing key. Three cases: an ID token issued by the other issuer, one with the right issuer but `aud` of another client, and one signed by the other issuer's key → each ends at `/login?error=token_invalid` with one `session.login_failed` event and no `session` row.
- **e2e (DO-B, `e2e/support/keycloak-login.ts`):** logs in through realm `mth-test` on the `test-idp` compose profile, and a second realm `mth-other` (DO-B adds `deploy/keycloak/realm-mth-other.json`) whose token is refused. It runs only where a container runtime and the pinned image are available (below).

**The Keycloak image (D-049, D-195 Q5). Evidence fetched by this task on 2026-10-26** (`T-DG6-ARCH-02-evidence/keycloak-image-evidence.txt`):
1. keycloak.org "Downloads" (version 26.8.1 shown) links its container image to `https://quay.io/repository/keycloak/keycloak`, and "Running Keycloak in a container" uses `quay.io/keycloak/keycloak` in every example. Neither page names Docker Hub. So the official documentation **does not** state that Docker Hub `keycloak/keycloak` is the vendor's publication. Under D-195 Q5 that verification **fails**.
2. quay.io is reachable from this task's sandbox today (its API answered HTTP 200). It reports `quay.io/keycloak/keycloak:26.4` = manifest list `sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007` (2025-12-01) and `26.8.1` = `sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b` (2026-10-23).
3. Docker Hub `keycloak/keycloak:26.4` reports the **same** digest `sha256:9409c59b…6007`. The organization `keycloak` gives `https://www.keycloak.org` as its profile URL. Content addressing makes the two images byte-identical, but that is a fact about the bytes, not the official-publication statement D-195 asks for.
4. The documentation version selector lists 26.8.1, 26.7.5 and 26.6.4; 26.4 is not among them. The licence is Apache-2.0 (as recorded in `deploy/images.lock.json`; not re-fetched).

**Decision for this slice:** pin the vendor-documented source, `quay.io/keycloak/keycloak`, by digest. DO-B (or the orchestrator, since `--resolve` is "an ORCHESTRATOR/IT step" per `deploy/images.lock.json`) runs `node deploy/scripts/pin-images.mjs --resolve keycloak` and records `digest` and `verifiedAt`, or BLOCKED with the exact error if quay.io refuses it then. It does not use Docker Hub, because Q5's condition failed. Moving the test pin from 26.4 to 26.8.1 (the current documented release) is recommended. That change and the choice of registry are raised to the orchestrator (handback §5); the digest is not written into `images.lock.json` by this task (DO-B's file). **Container runtime:** this sandbox has the `docker` client but no reachable daemon (`docker info` exit 1). So the Keycloak e2e cannot run here and stays a disclosed **BLOCKED** residual wherever no daemon exists. The cross-realm rejection is still proven by the integration test above (D-195 Q5).

**SAML broker (M0312 "documented compatible broker/adapter").** `docs/operations/identity-saml-broker.md` (DO-B) documents Keycloak as the broker: the corporate SAML IdP is configured as a Keycloak identity provider (SAML 2.0 identity brokering), Keycloak issues OIDC tokens to the hub, and the hub stays OIDC-only. It covers the attribute → claim mappers for `email` and `name`, the fixed `sub`, group → role-mapping input, signing-certificate rotation and logout. It states that the brokered SAML path is **not exercised live** in this repository (no SAML IdP here). The product contains no SAML code.

**Administration > Identity** (`getIdentitySettings`, read-only, `identity.read`): `authMode`, `issuer`, `clientId`, `clientSecretConfigured` (boolean only), `scopes`, `expectedAudience` (= client id), `pkceMethod` (`S256` in OIDC mode), the fixed claim mapping (`sub`, `email`, `name`) and the SAML document path. Never the client secret. No PUT: identity settings stay runtime configuration (ADR-0011).

### 2. Evidence storage (REQ-S16-006)

**Port.** The existing `EvidenceStore` interface is unchanged. BE-H moves the filesystem adapter to `evidence/stores/filesystem.ts` **without behaviour change** and adds `evidence/stores/s3.ts`. `evidence/store.ts` keeps the interface and the driver selection.

**S3-compatible adapter semantics (`stores/s3.ts`):**
- `receive` streams to the temporary key `<key>.part` with a single PUT, or with multipart upload above 8 MiB, while computing SHA-256 and enforcing `maxBytes` while streaming. On any failure the temporary object is deleted.
- `finalise` copies the temporary object to the final key, then deletes the temporary object. S3 has no rename; a crash between the copy and the delete leaves a temporary object for the sweep. **Ordering (as shipped, T-DG6-BE-H2):** the object-store `finalise` is remote I/O, so the upload route runs it **before** the upload transaction (p6-work-split §2 rule 4). The filesystem rename stays the last local step inside the transaction. A failure afterwards calls `discardUncommitted`.
- `get` streams the object; `head` returns its size or null; `discardUncommitted` deletes the final and the temporary key (idempotent).
- `sweepStaleTemporaries` lists `*.part` keys under the prefix and deletes those last modified more than `olderThanMs` ago. **Incomplete multipart uploads (amended 2026-10-30, T-DG6-ARCH-07; T-DG6-BE-H §5 item 3).** If the API process dies during a multipart `receive` (> 8 MiB), the store keeps an incomplete multipart upload. That is not an object, so the sweep cannot list it. The sweep does not call `ListMultipartUploads`. The deployment requirement instead: IT sets the bucket lifecycle rule `AbortIncompleteMultipartUpload` (for example after 1 day) on the evidence bucket. The operations runbook (`docs/operations/storage.md`, devops) must state it. At this revision it does not, and that is routed to the orchestrator.
- Keys are the same opaque `organization/transformation/evidence/uuid` keys as in filesystem mode, under the optional `s3_key_prefix`. Path-style addressing is the default (S3-compatible stores).
- **Never public, never pre-signed (ADR-0010 §2, D-195 Q2).** The adapter never creates a pre-signed URL and never sets an ACL. Every byte goes through the API route that applies the parent record's authorization (ADR-0051 §4), in both modes. `StorageSetting.publicUrls` is always `false`.

**Which store holds a file.** `evidence_content.storage_driver` (`0102`, NOT NULL DEFAULT `'filesystem'`, CHECK `filesystem` | `s3`; probe G04, ST09) is set at upload to the driver that wrote the bytes. Reads open the store the row names. Changing the setting affects new uploads only, so earlier files are never stranded. Copying existing files between stores is not in P6. **Export files stay on the filesystem store** under `EVIDENCE_STORAGE_PATH` in both modes (as shipped, T-DG6-BE-H2B): the setting selects the **evidence** store only, because `export_job` records no storage driver and moving exports would strand earlier files. Object-store exports would first need a per-job driver column, a later migration that is not in P6.

**Setting `storage_setting`** (`0102`; at most one row, the `singleton` UNIQUE CHECK; probe ST05): `driver`, `s3_endpoint`, `s3_region`, `s3_bucket`, `s3_key_prefix`, `s3_force_path_style`, `s3_access_key_ref`, `s3_secret_key_ref` (each a `SecretRef` `{provider, name}`, checked by `p6_secret_ref_valid`: exactly those two string keys, so no value can be stored; probe ST02), `reason`, `version`, stamps. History `storage_setting_change` (trigger-written, append-only). CHECK `storage_setting_s3_complete`: `s3` needs the endpoint, region, bucket and both references (ST01). **No row = the environment default** (`EVIDENCE_STORAGE_DRIVER`, `EVIDENCE_STORAGE_PATH`; ADR-0011). Every shipped profile defaults to `filesystem`, so behaviour equals DG5.

**Saving and testing.** `putStorageSetting` (storage.configure) requires that a `testStorageSetting` of the same values passed within the last 15 minutes in this API process, else 422 `storage.test_required`. The test runs **outside any transaction** under lock 730307 and performs: write a probe object, read it back, compare its checksum, delete it, and (s3) check that an unauthenticated GET of the probe key is refused. It records the audit event `storage_setting.tested` with the outcome and the check names, never a URL or key.

**One contract suite for both adapters** (`evidence/stores/contract.ts`, BE-H): one exported `describeEvidenceStoreContract(name, makeStore)` run for the filesystem adapter on a temporary directory and for the S3 adapter against the test store. Cases: round-trip bytes and SHA-256; `maxBytes` enforced while streaming (`EvidenceTooLarge`, nothing left behind); a temporary object is never readable through `get`; `finalise` makes it readable; `discardUncommitted` is idempotent; the sweep removes only old temporaries; `head` of a missing key is null; concurrent `receive` of two keys does not mix bytes; an anonymous read is refused (s3); the adapter returns no URL anywhere.

**The S3 test store (D-195 Q6).** An in-process S3-protocol fake in the test support (`apps/api/test/support/fake-s3.ts`, BE-H; no dependency): HTTP on a port from the harness pool, path-style PUT, GET, HEAD, DELETE, CopyObject, ListObjectsV2 and multipart upload. It **verifies AWS Signature Version 4**, so a request with wrong or missing credentials is 403, and anonymous GET is 403. A licence-reviewed external store for IT testing is documented by DO-C in `docs/operations/storage.md`: SeaweedFS (Apache-2.0) is the candidate named by D-195. That licence is **[UNVERIFIED]** by this task; DO-C verifies it from official sources before naming a version. MinIO server is AGPL-3.0 and is not bundled (ADR-0010 L-1). The live IT object store is a residual.

**S3 client dependency (decision needed; not added by this task).** Evidence fetched on 2026-10-26 (`npm-dependency-evidence.txt`, `support-window-evidence.txt`):
- `@aws-sdk/client-s3` latest `3.1156.0` (published 2026-10-22), licence Apache-2.0, `engines.node >=20.0.0` (the repository requires `>=22.18.0 <25`: compatible), 11 direct dependencies.
- AWS's version-support matrix lists "SDK for JavaScript 3.x | General Availability | 12/15/2020". The AWS SDKs maintenance policy says "AWS will support the GA version of an SDK for at least 24 months", that a maintenance announcement comes "at least 6 months before an SDK enters maintenance mode", and that "Maintenance mode has a default duration of 12 months".
- **Option A (recommended if the orchestrator provisions the registry, D-057):** pin `@aws-sdk/client-s3@3.1156.0` exactly (ADR-0001 `save-exact`), with the SBOM and licence inventory refreshed for its transitive tree (DO-A).
- **Option B (no dependency):** an in-house client for the seven operations above, signing with SigV4 over `node:crypto`, verified against AWS's published SigV4 test vectors.
- BE-H starts with the contract suite and the fake, which are the same for both options.

### 3. Notification channels (REQ-S12-023)

**Port** (`tasks/channels/port.ts`, BE-I):

```ts
export type ChannelKind = "email" | "enterprise_messaging";
export interface ChannelMessage {
  readonly notificationId: string; readonly recipientUserId: string; readonly locale: "en" | "ar";
  readonly subject: string; readonly text: string; readonly deepLinkUrl: string; // always the ADR-0051 §3 /links/<token> path
}
export interface NotificationChannel {
  readonly kind: ChannelKind;
  send(message: ChannelMessage, address: string): Promise<{ ok: true } | { ok: false; errorCode: string; retryable: boolean }>;
}
```

- **In-app is always on and is not a channel row.** Every notification is written to `inbox_notification` first, in the producing transaction, exactly as today (DG4/DG5 unchanged).
- **`email`** has an optional SMTP adapter (`tasks/channels/email.ts`). **`enterprise_messaging` has the port only**: no adapter ships in P6, so the database refuses to enable it (CHECK `notification_channel_no_messaging_adapter`, probe NC02) and the API answers 422 `notification_channel.adapter_unavailable`.
- **Message content.** `subject` and `text` are rendered at send time from the notification's `message_key` in the recipient's locale. **As shipped (stated 2026-10-30, T-DG6-BE-I §5 item 4):** `render.ts` (`apps/api/src/modules/tasks/channels/` and its worker twin `apps/worker/src/channels/`) supports per-key templates through `ChannelCatalogue.messages`, but the shipped catalogue holds none. The per-key texts live only in the web catalogue, which neither the API nor the worker imports. So an email today carries the generic text "You have a new notification in your inbox." (en, with its ar twin) plus the deep link, and never a record value. Per-key email texts need a shared catalogue in `packages/shared` or a build-time copy (routed). When the recipient can no longer read the target, the ADR-0051 §3 `inbox.restricted` text is used instead and no `messageParams` value appears. The message carries the deep link (re-authorized on open), never a record value. No message body is stored.

**Channel setting `notification_channel`** (`0102`): one row per `(organization, channel_kind)` (UNIQUE, probe NC06), `enabled`, `smtp_host`, `smtp_port`, `smtp_security` (`starttls` | `tls` | `none`), `smtp_username_ref` and `smtp_password_ref` (`SecretRef`, both or neither: `notification_channel_credentials_pair`, NC03), `from_address`, `reason`, `version`, stamps. Enabling email needs host, port, security and sender (`notification_channel_email_complete`, NC01); the kind never changes (NC07). History `notification_channel_change`. `none` security is refused by the API when `NODE_ENV=production` (422 `notification_channel.insecure_transport`). **No row or a disabled row = in-app only** (A21).

**Fan-out after commit, exactly once (lesson 10).**
1. The outbox relay delivers `inbox_notification.created` (BE-I adds this event in the producing transaction, in the API's `tasks/service.ts` and its worker twin `createWorkItemOnce` in `kit.ts`: one line each). **Scope as shipped (T-DG6-BE-I2 §6):** exactly these two producers emit the event. Six worker files insert `inbox_notification` directly and emit none: `automation/actions/notify.ts`, `handlers/operations.ts` (alerts), `handlers/escalations.ts`, `handlers/gates.ts`, `handlers/meetings.ts` and `handlers/digests.ts` (its digest notifications are fanned out by the `notifications.delivery_sweep` job of `0121`). Their notifications reach the inbox, but no external channel. Extending fan-out to them (one kit-helper line each) is routed to the orchestrator. The jobs and identities of this step are seeded by `0121_p6_notification_fanout_jobs.sql`.
2. The handler `apps/worker/src/handlers/notifications.ts` checks the organization's enabled channels and inserts one `notification_delivery` per enabled channel, `pending`, or `skipped` with `skip_reason` (`no_address`, `recipient_restricted`, `channel_disabled`, `recipient_disabled`). It runs inside `runOnce` keyed `notification:<notificationId>`.
3. The send runs **outside any transaction**: the handler takes lock 730306 on `<notificationId>:<channelKind>`, re-reads the row, and skips it unless it is still `pending`. It sends, then records `sent` (with `sent_at`) or `failed` (with `error_code`), counting `attempts` exactly once per send (`notification_delivery_attempt_step`, ND08). Retryable failures go back to `pending` by the retry job with backoff (ADR-0008 §4: 5 attempts). After that the delivery stays `failed` and an operational exception `job_failed` on the queue is visible (ADR-0053 §2).
4. **Backstop:** `notification_delivery_once_key` UNIQUE `(inbox_notification_id, channel_kind)`, so a replay creates nothing (ND02). `sent` and `skipped` are final (ND07). The organization must match the notification's (ND03).
5. **A21 / absence never breaks workflows:** with no channel row, step 2 inserts nothing. No producing transaction depends on a channel, and a send failure never rolls back or blocks the workflow that notified.
6. The P5 delivery policy (quiet hours, digests, urgency: ADR-0044 §5) is respected: a notification whose `delivery_state` is held fans out when it is released, not before.

**The SMTP adapter dependency (D-195 Q7; decision needed; not added by this task).** Evidence fetched on 2026-10-26: `nodemailer` latest `10.2.1` (published 2026-10-22), licence `MIT-0`, `engines.node >=20.0.0`, 0 dependencies. I found no published support window for it: the fetch of `nodemailer.com/about/` returned no text matching a support or licence statement, so the support window is **[UNVERIFIED]**. Q7 adopts "a vetted SMTP library only if the registry is provisioned". So BE-I pins `nodemailer@10.2.1` only after the orchestrator provisions it (and DO-A refreshes the SBOM). Otherwise BE-I writes a minimal in-house SMTP client (EHLO, STARTTLS through `node:tls`, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO, DATA with dot-stuffing, QUIT; no dependency).

**Test target.** `apps/api/test/support/fake-smtp.ts` (BE-I): an in-process SMTP server on a harness port that records envelopes and messages, can reject AUTH, and can drop the connection mid-DATA. The adapter contract test runs against it. Live mail is a residual (D-195 Q7).

**Administration > Notifications** (FE-B, `pages/admin/notification-channels/**`): both channels with their state, the email form (references, never values), the "Send test to me" action (`testNotificationChannel`, outside any transaction, audit `notification_channel.tested`), and the deliveries list (status, attempts, error code; never the text or the address).

### 4. Refusal codes (problem+json; English texts; Arabic labelled provisional in the catalogues)

| Status | Code | English text | Arabic (provisional) |
|---|---|---|---|
| 422 | `storage.s3_incomplete` | "The object store needs an endpoint, a region, a bucket and both credential references." | "يتطلب مخزن الكائنات عنواناً ومنطقة وحاوية ومرجعي بيانات الاعتماد." |
| 422 | `storage.secret_ref_invalid` | "A credential must be a reference to a secret (provider and name), never the secret itself." | "يجب أن تكون بيانات الاعتماد مرجعاً إلى سر (المزوّد والاسم)، وليس السر نفسه." |
| 422 | `storage.test_required` | "Run a successful storage test with these settings before saving them." | "أجرِ اختبار تخزين ناجحاً بهذه الإعدادات قبل حفظها." |
| 422 | `notification_channel.email_incomplete` | "Email needs an SMTP host, a port, a security mode and a sender address." | "يتطلب البريد الإلكتروني خادم SMTP ومنفذاً ونمط أمان وعنوان مرسل." |
| 422 | `notification_channel.adapter_unavailable` | "No adapter is installed for this channel. In-app notifications continue to work." | "لا يوجد محوّل مثبت لهذه القناة. تستمر الإشعارات داخل التطبيق في العمل." |
| 422 | `notification_channel.insecure_transport` | "Unencrypted SMTP is not allowed in production." | "لا يُسمح باستخدام SMTP غير المشفّر في بيئة الإنتاج." |
| 422 | `notification_channel.not_configured` | "Configure and enable this channel before sending a test." | "قم بإعداد هذه القناة وتفعيلها قبل إرسال اختبار." |
| 422 | `notification_channel.no_recipient_address` | "Your account has no email address to send the test to." | "لا يوجد عنوان بريد إلكتروني في حسابك لإرسال الاختبار إليه." |
| 422 | `admin.reason_required` | "Enter a reason of 3 to 1,000 characters." | "أدخل سبباً من 3 إلى 1000 حرف." |

`storage.secret_ref_invalid` also answers the notification-channel PUT (as shipped, T-DG6-BE-I §5 item 2), with pointer `/smtp/usernameRef` or `/smtp/passwordRef`, for three cases: a credential that is not an object (for example a string value), extra keys, or a provider that is not registered in this process. It stays a 422, not the 400 of the contract's `SecretRef` schema, because "never the secret itself" is this code's purpose. A malformed `smtp.host` or `fromAddress` (the `0102` patterns) is a 400 `validation` problem with a pointer.

An unreachable store keeps the existing DG2 503 problem `unavailable` ("Service unavailable", `problem.ts`), unchanged in both modes. 404, 409 version conflict and 428 are the ADR-0007 §5b shared problems. Sign-in refusals reuse `token_invalid` (§1).

### 5. Authorization summary (`0103`; permissions matrix §25)

| Action | Permission (category) | Seeded roles | AUD |
|---|---|---|---|
| Read Administration > Identity | `identity.read` (read) | ADM_TECH, ADM_ACCESS, AUD | read |
| Read, change and test storage | `storage.configure` (configure) | ADM_TECH | read through `operations.read` (GET only) |
| Read, change and test channels; read deliveries | `notification_channel.configure` (configure) | ADM_TECH | read through `operations.read` (GETs only) |

- Storage is installation-wide: `storage.configure` must be held at organization scope in at least one organization, re-checked at commit. Channels are per organization, at that organization's scope.
- **SoD:** none of these is an approval; technical admins gain no business approval (probe PM04). Every mutation: authorization re-checked at commit, validation, `If-Match` (`IfMatchOrZero` creates the row: 409/428), one audit event (`storage_setting.changed`, `storage_setting.tested`, `notification_channel.changed`, `notification_channel.tested`; worker `notification_delivery.created/sent/failed/skipped`, actor `service`), no remote I/O inside a transaction, a test for each.

### 6. Advisory locks (ADR-0016 §6)

730306 `channelDelivery` (`<notificationId>:<channelKind>`), 730307 `storageSetting` (`storage`). 730305 is ADR-0053's; 730308–730309 are reserved.

### 7. Decimal and Unknown semantics

No entity here holds money, a rate, FTE or a KPI value. `smtp_port`, `attempts` and byte sizes are integers. A channel that was never configured shows "Not configured", never "Enabled"; a storage test that was not run shows "Not tested".

### 8. Composition: one `SecretProvider` registry per process, and the connection log (as shipped 2026-10-31; T-DG6-ARCH-08)

Every credential reference in this ADR (`s3_access_key_ref`, `s3_secret_key_ref`, `smtp_username_ref`, `smtp_password_ref`) and in ADR-0055 and ADR-0059 is resolved through the `SecretProvider` registry of the process that needs it (ADR-0052 §5). Each composition root creates exactly one registry: `withSecretRedaction(createSecretProviderRegistry())`, then `registerBuiltInSecretProviders` (the `env` and `file` providers, BE-E), so every resolved value joins the log redaction set (ADR-0053 §4 item 1). An IT-supplied provider is registered on the same registry.

**API (`apps/api/src/server.ts`).** The one registry is handed to:
- the evidence store (`SelectingEvidenceStore`) and Administration > Storage (the test target), for the S3 references (§2);
- Administration > Notifications, for the SMTP references of the test send (§3);
- the integrations module, through `setConnectorSecretProviders(secrets)` (T-DG6-BE-X2; F-DG6-QA-A-1): connector credentials and webhook signing secrets (ADR-0055, ADR-0056). Before this line every reference was unresolvable;
- the assistant, through `setAssistantSecretProviders(secrets)` (T-DG6-BE-X3): the HTTP endpoint's `credentialRef` (ADR-0059 §2, §12). Before this line a configured reference never resolved.

**Worker (`apps/worker/src/main.ts`).** Its own registry, built the same way (the twin `apps/worker/src/secrets.ts`), resolves the SMTP references of the channel sends (`configureNotificationChannels`, T-DG6-BE-I2; §3 step 3). The worker executes no connector adapter and has no assistant code, so it hands the registry to neither.

**The A21 connection log** (ADR-0059 §12) is installed by both roots: in the API by `buildServer` (`holdApiConnectionLog`, one subscription per log file, held per composed app and removed by the last `onClose`), and in the worker right after `installConsoleRedaction()` and before the first database connection. It is a test instrument: ignored, with one warning, under `NODE_ENV=production`. So an outbound call that this ADR's adapters make (an S3 request, an SMTP connection) appears in that log when the variable is set, with the fields ADR-0059 §12 lists.

## Alternatives

- **Pre-signed object-store URLs for downloads.** Rejected: ADR-0010 §2, REQ-S16-006 "never served from a public URL", D-195 Q2.
- **Docker Hub `keycloak/keycloak` by digest.** Not taken: the D-195 Q5 condition (official documentation) failed, although the digest is identical (§1).
- **MinIO as the test store.** Rejected (AGPL-3.0, ADR-0010 L-1).
- **Storing SMTP or S3 credentials encrypted in the database.** Rejected: ADR-0052 §5 keeps values in `SecretProvider`; the database holds references only.
- **Sending email inside the producing transaction.** Rejected: remote I/O inside a transaction (lesson 4), and a mail outage would break workflows (M0241).

## Consequences

- With no setting rows, behaviour equals DG5: filesystem storage and in-app only (probe G04). `s3` configured through the environment without a setting row stays 503 until BE-H's driver lands; the DG2 comment "configuring it here makes every content operation 503" becomes untrue and is updated by BE-H (F-DG4-160).
- Two dependency decisions (S3 client, SMTP library) and the Keycloak registry choice are open for the orchestrator. The adapters' ports, fakes and contract suites do not wait for them.
- Live IdP, live object store, live SMTP and the brokered SAML path are residuals, never claimed live (p6-plan R3).

## Verification

- **Database (this task):** probe groups ST01–ST09, NC01–NC09, ND01–ND10, PM01–PM04: PASS in the 81/81 run.
- **Implementers:** BE-G (three-case other-realm test), DO-B (realms, e2e, image pin or BLOCKED, SAML document), BE-H (contract suite × 2 adapters, fake S3, driver selection, admin routes), BE-I (fan-out exactly once, A21 test with no channel, fake SMTP contract, admin routes), DO-C (profiles or fakes, storage and notification documents, residual rows), FE-B (pages). QA-D/QA-E: A12 (no public URL), A18, A21.
- **Dependencies:** none added. Evidence for the three candidates is in `T-DG6-ARCH-02-evidence/{keycloak-image-evidence,npm-dependency-evidence,support-window-evidence}.txt`.
