# Handback T-DG6-BE-I2 — fan-out after commit, exactly once; A21; the deliveries list

- **Agent:** backend-workflow-engineer (project agent), stage DG6 (BUILDING), task T-DG6-BE-I2.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-I2-backend-workflow-engineer-20261030T153048Z-9a8dfe93","session_id":"9a8dfe93-99ec-45cf-ae40-5c619b188b31"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-I2.md` (sha256 `2d02558d30ae9702f01107ed29f5bbe9b6c8a7b4ebd4fe13e51ad6ec8f903826`, verified before starting).
- **Binding scope:** `docs/architecture/p6-work-split.md` §J/C.11 and §2; ADR-0054 §3–§6; ADR-0053 §1, §2; ADR-0051 §3; ADR-0044 §5; ADR-0008 §4; D-193 to D-197 read.
- **Base:** branch `dg6/be-i2` at `ee1cb45fe3e6996d103e1cad341ccc75c2793c64`, clean tree at start. All changes are **uncommitted**, as instructed.
- **Time:** `date -u` at the start: `Fri Oct 30 15:31:28 UTC 2026`; at the end: `Fri Oct 30 17:50:09 UTC 2026` (about 2 h 19 min, over the ~2 h limit while the full suites ran; see §8).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0, at the start (and again at the end, §4).
- **No business approval.** Nothing here grants, records or implies a G1–G6 business, Finance or IT approval. A channel delivery is a message, never an approval. Nothing reads or writes DG0–DG7. Product gate G6 never implies DG7. Every test datum is SYNTHETIC; mail goes only to the in-process fake SMTP server.

## 1. Changed files

| File | Status | Purpose |
|---|---|---|
| `apps/worker/src/handlers/notifications.ts` | stub → implemented | `notifications.fanout` (consumer of `inbox_notification.created`) and `notifications.delivery_sweep` (every minute): fan-out once under `runOnce`, send outside any transaction under session lock 730306, render at send time, lazy deep link (twin of the API's `issueDeepLink`), fail-closed recipient read check, retry with backoff, final-failure exception, `configureNotificationChannels`. |
| `apps/worker/src/queues/notifications.ts` | stub → implemented | The two queues; `inbox_notification.created` → `notifications.fanout`. |
| `apps/worker/src/handlers/notifications.test.ts` | new | Unit tests (no DB): registration, routing, identities, payload contract, keys/lock/backoff, retryable codes = adapter classification, deep-link target twin, 0120 text. |
| `apps/api/test/integration/tasks/channel-fanout.test.ts` | new | Integration tests (real PostgreSQL + fake SMTP): the §J/C.11 test list (§2). |
| `apps/api/test/integration/contract/p6-exercises-be-i2.ts` | new | Contract exercise of `listNotificationDeliveries` (200 ADM_TECH and AUD, filters, paging, 400 ×3, 401, 403, 404). |
| `apps/api/test/support/p6-pending-be-i2.ts` | edited | `["listNotificationDeliveries"]` → `[]`. |
| `apps/api/src/modules/admin/notification-channels.ts` | edited (after BE-I) | The `GET /api/v1/admin/notification-deliveries` route (`listNotificationDeliveries`) and its zod mirrors `notificationDeliveryView` / `notificationDeliveryPage`; header lines. |
| `apps/api/src/modules/tasks/service.ts` | edited (one site) | `createWorkItemOnce` writes the `inbox_notification.created` outbox row in the producing transaction (`enqueueNotificationCreated`; the tasks module may not import `jobs`, architecture.test.ts). |
| `apps/worker/src/kit.ts` | edited (after BE-J, BE-K lines) | The twin line in the worker `createWorkItemOnce` (through the existing `insertOutboxRow`), `INBOX_NOTIFICATION_CREATED_EVENT`, two `declare(...)` lines in `JOB_SERVICE_IDENTITIES` (49 queues) and one comment. |
| `apps/api/src/modules/tasks/notification-policy.ts` | edited (comment) | The "in-app only (email and messaging: P6 adapters)" header line replaced: the policy now governs external channels (held → fans out on release). |
| `packages/db/migrations/0120_p6_notification_fanout_jobs.sql` | new | Job schedule `notifications.delivery_sweep` (every minute, Asia/Riyadh) and the two job service identities, each audited (actor system, source migration). |
| `packages/shared/src/schemas/events.ts` | shared, additive | `inboxNotificationCreatedV1` (`{notificationId, recipientUserId}`, strict, ids only) registered in `OUTBOX_EVENT_SCHEMAS`. Needed by the relay. |
| `apps/worker/src/main.ts` | shared, one call | `configureNotificationChannels({ resolveSecret: secrets.resolve, appBaseUrl, refuseInsecure: NODE_ENV=production })` after DO-D's redacting registry; the stale "no worker job resolves a secret yet" comment corrected. |
| `apps/api/test/integration/contract/contract.test.ts` | shared seam | Import, mirror spread and `it(...)` line for `p6-exercises-be-i2.ts`. |
| `apps/api/src/modules/automation/outbox-registry.test.ts` | shared pin | New outbox write site `apps/api/src/modules/tasks/service.ts` (1); event `inbox_notification.created`. |
| `apps/api/src/modules/automation/samples.test.ts` | shared pin | `inbox_notification.created` added to `NOT_TRIGGERS` (internal plumbing; no catalogue trigger). |
| `apps/worker/src/service-identities.test.ts` | shared pin | Reads the 0120 identity table; pinned count 47 → 49. |
| `packages/db/src/seed.test.ts` | shared pin | Free-id example 0120 → 0121 (0120 is now shipped on this branch). |
| `apps/worker/test/integration/schedules.test.ts` | shared pin | `notifications.delivery_sweep` added to the list of seeded schedules the test runs without a handler. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-I2-*` | new | This handback and its evidence logs. |

No OpenAPI, `schema.ts`, `catalogue.test.ts` or `P6_OPERATION_IDS` change: the operation, the tables and their privileges were delivered by ARCH-02 (`0102`, `0103`).

## 2. Behaviour delivered, per requirement row

### REQ-S12-023 (shared with BE-I, FE-B)

- **Acceptance text (verbatim, `requirements.csv`):** "Every notification is written to the inbox; external channels are sent only when configured".
- **Test column:** "A21: with no email adapter configured all workflows complete and notifications appear in the inbox".
- **Section test list (§J/C.11):** no channel row → no delivery row and every DG4/DG5 notification test unchanged (A21); with email enabled, one notification → one `sent` delivery and one message at the fake; a relay replay and a handler retry create no second delivery and send no second message; a send failure never rolls back the producing workflow; a held (quiet-hours) notification fans out only when released.

What is delivered, and where it is proven (`apps/api/test/integration/tasks/channel-fanout.test.ts`, 10 tests, all against the disposable PostgreSQL):

1. **In-app first, the event in the producing transaction.** `createWorkItemOnce` (API and worker twin) still writes the work item and the inbox notification exactly as in DG4/DG5, plus one outbox row `inbox_notification.created` v1 (`{notificationId, recipientUserId}`; idempotency key `inbox_notification.created:<id>`, unique). No remote I/O and no channel read in the producing transaction.
2. **A21: no channel → nothing written.** "writes no delivery and no ledger row; the workflow completes and the notification is in the inbox": for the API and the worker producer, the fan-out answers `no_channel`, writes no `notification_delivery` and no `processed_message` row; the work item stays `open`, the notification is `delivered` and `GET /api/v1/me/inbox` lists it; the sweep does nothing; the fake receives nothing. "a disabled channel row is in-app only too": a configured-then-disabled email row → same. The DG4/DG5 notification suites are in the full integration run (§4).
3. **One notification → one `sent` delivery, one message.** With email enabled through `putNotificationChannel` (pointing at the fake): one delivery `sent`, `attempts 1`, `sent_at` set; one message at the fake, to the recipient's own address; the body carries `https://hub.example.invalid/links/<token>` (the token issued lazily on the notification, ADR-0051 §3) and **no `messageParams` value** (a canary param is absent); audit `notification_delivery.created` then `.sent`, actor `service`. Rendered in the recipient's locale (the synthetic users are `ar`, so the Arabic text is asserted).
4. **The deliveries list.** `listNotificationDeliveries` (ADM_TECH through `notification_channel.configure`, AUD through `operations.read`) shows status, attempts, timestamps, skip reason and error code, newest first, filterable by status and channel kind, cursor-paged; never the address and never the text (asserted on the body). Contract exercise: 200 ×2 roles, filters, paging, 400 (bad status, bad organization id, cursor of other filters), 401, 403, 404.
5. **Exactly once.** "a relay replay, a handler retry and a sweep create no second delivery and send no second message": the same envelope again → `duplicate`; a pg-boss retry of the job → `duplicate`; a sweep an hour later → nothing; 1 delivery, 1 ledger row, 1 message. "two concurrent consumers of the same event send exactly one message": three concurrent `runFanout` calls on the worker-twin event → one `fanned_out`, one delivery, one message (runOnce primary key + `notification_delivery_once_key` + session lock 730306 with the `pending` re-read).
6. **A send failure never rolls back or blocks the workflow.** A 550 at RCPT → delivery `failed`, `smtp.recipient_rejected`; the work item and the notification are still committed; the queue's operational exception `job_failed` (source `notifications.fanout`) is `open` with that code (ADR-0053 §2); the non-retryable failure is not retried by the sweep; the next successful send resolves the exception `recovered`. A 451 → `failed`, `smtp.temporary_failure`; the sweep does nothing before the 10 s backoff, retries after it (failed → pending, audited `notification_delivery.retried`), → `sent`, `attempts 2`, one message; a later sweep sends nothing more. After 5 attempts (ADR-0008 §4) a delivery stays `failed` and the exception opens.
7. **The delivery policy (ADR-0044 §5).** "a held (quiet-hours) notification fans out only when the digest job releases it": quiet hours set through `PUT /me/notification-preferences`; the notification is `held`; the fan-out answers `held` and writes nothing (no ledger row either); the sweep leaves it; after `runDigestWindow` releases it (`delivered`), the next sweep fans it out once (`sent`, one message); a further sweep adds nothing. A notification folded into a digest is never sent on its own; the digest notification is fanned out by the sweep.
8. **Restricted and disabled recipients.** A recipient with no grant reaching the transformation gets the `inbox.restricted` text (ADR-0051 §3), not the generic line; a reader gets the generic line; a disabled recipient's delivery is `skipped` / `recipient_disabled` with no send. A recipient without an address is `skipped` / `no_address`.
9. **Service identities (ADR-0053 §1).** Both jobs run through `defineJob` under `job:notifications.fanout` / `job:notifications.delivery_sweep` (0120: `transformation.read`, `user.read`, `access.read`, `operations.read`; never `notification_channel.configure`). "a narrowed grant fails the run with service_identity.out_of_scope before anything is written" (narrowed and restored through BE-J's audited `putServiceIdentity` route).

## 3. Mutations: authorization, validation, concurrency, audit

- `listNotificationDeliveries` is a read: `notification_channel.configure` or `operations.read` at the organization (403 otherwise, 404 unknown organization); strict query (400).
- The worker writes (`notification_delivery` insert/update, `inbox_notification.link_token`) are service-actor writes: each guarded by the job's service identity (checked before any write), optimistic (`WHERE version = $v AND status = 'pending'`; a lost race writes nothing), with one audit event in the same transaction (`notification_delivery.created|skipped|sent|failed|retried`, `inbox_notification.link_issued`), and the 0102/0098 triggers as backstops (ND02 once-key, ND07 final states, ND08 attempt step, deep-link once). The SMTP send is outside every transaction (§2 rule 4).
- No user-facing mutation route was added.

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL from `tests/qa/support/with-pg.sh` on harness ports 26001–26049. Logs in `docs/delivery/handbacks/DG6/T-DG6-BE-I2-evidence/`.

Evidence files are in `docs/delivery/handbacks/DG6/T-DG6-BE-I2-evidence/` (ANSI codes stripped).

| # | Command | Result | Evidence |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | exit 0, `PASS gate DG5 (historical)` both times | `validate-historical-DG5-start.txt`, `-end.txt` |
| 2 | `pnpm -r typecheck` | exit 0. Re-run on the final tree for `apps/api` (`tsc -p tsconfig.json`): exit 0 | `typecheck.txt`, `typecheck-api-final.txt` |
| 3 | `pnpm -r build` | exit 0 | `build.txt` |
| 4 | `pnpm lint` | exit 0 (`eslint . --max-warnings=0`). Re-run on the five files edited afterwards: exit 0 | `lint.txt`, `lint-final.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (final tree) | `format.txt`, `format-final.txt` |
| 6 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi.txt` |
| 7a | `pnpm test`, locale unset, run 1 | **exit 1**: unit-node 1 failed / 2741 passed (`samples.test.ts`: the new event needed its `NOT_TRIGGERS` entry; fixed); unit-web 1789/1789; formula-nocodegen 259 passed, 2 skipped | `unit-unset.txt` |
| 7b | `pnpm test`, `LC_ALL=C.UTF-8 LANG=C.UTF-8` (after the fix) | **exit 1**, all timeouts while the full integration suite and a second unit run shared the host: unit-node 1 failed / 2741 passed (`architecture.test.ts` "apps/web never imports @mth/db", 35 204 ms > 30 s); unit-web 7 failed / 1782 passed (the evidence dialogs ×2, the Finance note, Gates ×2, Evidence upload, FE-C3 extension fields; each a timeout of 6.9–31.4 s in files I did not touch); formula-nocodegen 259 passed, 2 skipped | `unit-cutf8.txt` |
| 7c | `pnpm test`, locale unset, run 2 (after the fix) | **exit 1, with no failed test**: unit-node 179/179 files, 2742/2742 tests, but 1 vitest "Unhandled Error: [vitest-worker]: Timeout calling \"onTaskUpdate\"" (a worker RPC timeout while the C.UTF-8 and integration runs shared the host), which makes the project exit 1; unit-web 99/99 files, 1789/1789; formula-nocodegen 3/3 files, 259 passed, 2 skipped | `unit-unset2.txt` |
| 8 | `QA_PG_PORT=26010 MTH_PORT_POOL=26011-26049 tests/qa/support/with-pg.sh pnpm test:integration` (full; started before the last four fixes) | **exit 1**: 384 files (5 failed), 3964 tests: 11 failed, 3950 passed, 1 skipped, 2 todo. Mine, fixed since: the BE-I2 exercise ×2 (the delivery fixture lacked its audit event), the two "covers every operation" checks and the pagination check (cascade: no validated `listNotificationDeliveries` success), `schedules.test.ts` ×2 (the new schedule row; pin added; 2/2 re-run). Not caused by this task, as far as I can tell: `security.test.ts` `getSecurityRateLimits` (webhook class lists `receiveWebhook`; a BE-N seam on the merged tree); `assistant/conversations.test.ts` rate-limit (`dataItems 1`/`answer` vs `0`/`no_sources`, retrieval finds data from other files of the shared database; also failed in run 2, not investigated further); P5 BE-J length and the media-type sweep's 30 s timeout under load (the D-201 classes) | `integration1.txt` |
| 9 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/tasks/channel-fanout.test.ts` | run 1 exit 1 (3 test bugs: the `ar` default locale, the preference fixture); **run 2 exit 0, 10/10** | `fanout1.txt`, `fanout2.txt` |
| 10 | Focused re-run: `contract.test.ts`, `response-validation.test.ts`, `assistant/conversations.test.ts`, `tasks/**` | exit 1 (it loaded the exercise before the v7-id fix): 5 failed / 294 passed | `integration-rerun.txt` |
| 11 | Final focused re-run: `contract.test.ts`, `response-validation.test.ts`, `tasks/**` (final exercise) | **exit 1**: 281 passed, 1 failed. The BE-I2 exercises pass in both files, and so do every coverage and pagination check. The one failure is the media-type sweep (`every operation: an undeclared request media type …`) timing out at 30 s while the full integration and unit suites ran concurrently | `integration-rerun2.txt` |
| 12 | `… vitest run --project integration apps/worker/test/integration/schedules.test.ts` | exit 0, 2/2 | `integration-schedules.txt` |
| 13 | Unit: `notifications.test.ts`, `service-identities.test.ts`, `outbox-registry.test.ts`, `seed.test.ts`, `architecture.test.ts` | 227 passed, 1 failed (the 47 → 49 identity pin); after the pin, `service-identities.test.ts` 6/6 | `unit1.txt`, `unit2.txt` |

**Pinned-count changes:** `service-identities.test.ts` 47 → 49; `outbox-registry.test.ts` +1 write site, +1 event type; `samples.test.ts` +1 `NOT_TRIGGERS`; `seed.test.ts` free-id example 0121; `schedules.test.ts` +1 unhandled schedule. `contract.test.ts` operation count unchanged (932).

**Not achieved on the final tree (acceptance items 2 and 3):** a clean `pnpm test` in both locales and a clean full `pnpm test:integration`. See §8.

## 5. Operations routed (delta to `p6-pending-be-i2.ts`)

- `listNotificationDeliveries` — removed from `P6_PENDING_BE_I2` (now `[]`), routed in `admin/notification-channels.ts`, exercised in `p6-exercises-be-i2.ts`.
- Pinned-count deltas for `contract.test.ts`: operation count unchanged (the operation was already in the contract, 932); no new media type, rate-limit class or CSRF-exempt route.

## 6. For the orchestrator: contract, schema, migration, dependency

- **Migration `0120_p6_notification_fanout_jobs.sql`** (next above 0119 on this branch; renumber at merge if a higher id shipped first; update the 0120 reference in `apps/worker/src/handlers/notifications.test.ts` and `service-identities.test.ts` and the seed.test.ts example with it). Data only (one `job_schedule`, two `service_identity` rows, audited); no schema change.
- **Outbox event `inbox_notification.created` v1** added to `OUTBOX_EVENT_SCHEMAS` (internal API → worker message, not the HTTP contract).
- **No OpenAPI change, no new dependency** (nodemailer 10.2.1 was already pinned by DO-A2, D-200).
- **Merge order:** `kit.ts` after BE-J → BE-K (this task's lines are in `createWorkItemOnce` and `JOB_SERVICE_IDENTITIES`); `admin/notification-channels.ts` after BE-I. Expect seam conflicts only in `contract.test.ts`, `outbox-registry.test.ts`, `samples.test.ts`, `service-identities.test.ts`, `seed.test.ts`.
- **Other notification producers (decision needed, not in my file ownership).** ADR-0054 §3 step 1 names two producer lines (`tasks/service.ts` and the kit twin), and that is what ships. Six worker files also insert `inbox_notification` directly and therefore emit no fan-out event: `automation/actions/notify.ts`, `handlers/operations.ts` (alerts), `handlers/escalations.ts`, `handlers/gates.ts`, `handlers/meetings.ts` and `handlers/digests.ts` (the digest notification; the sweep covers digests). Their notifications reach the inbox but no external channel. Options: (a) one line each calling a kit helper (owners BE-J2/J3, BE-K2), or (b) widen the sweep to every recent `delivered` notification without a ledger row in an organization with an enabled channel. I recommend (a).

## 7. User-facing texts

- No en/ar web string called channel delivery planned or later; `nav.json` "… email when configured, and the delivery log." is now true. No catalogue change needed.
- Code comments made untrue and corrected here: `tasks/notification-policy.ts` header ("In-app only (email and messaging: P6 adapters)"), `apps/worker/src/main.ts` ("No worker job resolves a secret yet").
- Still untrue, for their owners (not in my ownership): `apps/worker/src/handlers/digests.ts` line 11 ("email and messaging are P6 adapters") and `apps/worker/src/automation/actions/notify.ts` line 4 ("In-app only (D-142 Q11)"), both comments, both true only until item §6 "Other notification producers" is decided.

## 8. What remains / known gaps

1. **Re-run on a quiet host, on the final tree**: `pnpm test` with the locale unset and with `C.UTF-8`, and the full `pnpm test:integration`. My last full runs overlapped each other, and their only remaining failures are timeouts plus the two items in (2). I did not get a clean run of any of the three within the time limit, so I am **not** reporting acceptance items 2 and 3 as passed.
2. **Two integration failures outside my change, for the orchestrator:** `admin/security.test.ts` `getSecurityRateLimits` (the webhook class's `operationIds` now include `receiveWebhook`), and `assistant/conversations.test.ts` rate-limit (retrieval returns 1 data item instead of 0). I did not run either on the base revision, so whether they predate this change is unverified.
3. **Other notification producers** (§6): six worker files insert `inbox_notification` without the fan-out event, so their notifications are in-app only. This needs a decision, and the owners of those files.
4. **Recipient read check in the worker** (`recipientCanRead`): it restates ADR-0051 §3 fail-closed. It does not restate the ADR-0051 §2 party clause, so a party without an explicit sensitive-record grant gets the restricted text by email. That can hide a line but never reveals one, and the message carries no record value in either case. A parity test against the API's `readableTargets` is not written.
5. **Crash window:** a process crash after the SMTP server accepted a message and before `sent` is recorded leaves the delivery `pending`, and the sweep sends it again (at least once in that window; SMTP has no idempotency key). This is documented in the handler header.
6. **Live mail stays a residual** (D-195 Q7). Every send here is to the in-process fake SMTP. Nothing is claimed as live or as integrated with a Mobily mail service.
7. **e2e:** no e2e spec was added (backend-only task), so no budget is stated.
