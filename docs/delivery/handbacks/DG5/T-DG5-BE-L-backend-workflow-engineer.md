# Handback T-DG5-BE-L: notification policy, preferences, delivery and digests (backend-workflow-engineer)

- **Stage:** P5 / DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §E.3 (and the shared rules in §2).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-L-backend-workflow-engineer-20261015T024522Z-883bd95b","session_id":"883bd95b-9eef-453f-850f-1f3f76fa0cde"}`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-BE-L.md`, sha256 `cbefe1f32d29b4717917c8121a0202eebfc60362ea457e01699dadfbc3f866d6` (verified before starting).
- **Working tree:** `/home/user/wt/dg5-be-l`, branch `dg5/be-l`, base `HEAD` `5b4597ccb9477a521c1683a3bf5d91c99eb53208`. The changes are **uncommitted**, as the assignment asks.
- **Time:** start `Thu Oct 15 02:45:34 UTC 2026`; end `Thu Oct 15 04:32:27 UTC 2026` (about 107 minutes; the full integration run took 33 minutes of it).
- **Requirement:** REQ-S12-025 (the BE-L half; FE-D completes it with the preferences screen).
- **Migrations:** none. `0079` was left unused: the delivery logic and the digest job needed no database change beyond `0075` (p5-work-split §E.5).
- **Business approvals:** none. Every value in the tests is synthetic. The digest job, the delivery decision and the tests approve nothing. Product gates G1–G6 and engineering gates DG0–DG7 are not touched.

## 1. Changed files

| File | Status | Purpose |
|---|---|---|
| `packages/shared/src/notifications/delivery.ts` | new | The pure delivery decision `decideDelivery(now, input)` (ADR-0044 §5): urgent → delivered at once; otherwise the earliest instant at or after `now` that is outside quiet hours (user zone, may span midnight), on a working day of the organization's default calendar when the policy says so (08:00, or the day's first allowed instant when quiet hours or a digest apply), and at a digest time when a digest is on. Also the wall-clock and time-zone helpers (no dependency) and the 15-minute digest window. Bounded search with a documented fallback for combinations that can never be satisfied. |
| `packages/shared/src/notifications/delivery.test.ts` | new | 15 unit and property tests. The ADR cases are pinned in Asia/Riyadh: no settings; quiet hours + daily digest; urgent; spans midnight with an exclusive end; inside one day; daily and twice daily; business days with a holiday and with no calendar; the never-satisfiable fallback; DST in America/New_York. Seeded property tests (2000 cases each) run in Asia/Riyadh, America/New_York and Asia/Kolkata. The "release satisfies every rule" property checks each unsatisfied case exhaustively against the candidate instants. |
| `packages/shared/src/schemas/notifications.ts` | new | Zod mirrors of `NotificationSettings`, `NotificationPreferences`, `NotificationPreferencesPut`, `NotificationPolicy`, `NotificationPolicyPut`, `NotificationDigestItem`, `NotificationDigest`. It re-exports the delivery decision, so the API, worker and web share one import path (`@mth/shared/schemas`; `package.json` exports unchanged). |
| `packages/shared/src/schemas/index.ts` | +2 lines | Barrel line. |
| `apps/api/src/modules/tasks/notification-policy.ts` | filled (BE-A stub) | `GET/PUT /me/notification-preferences` and `GET/PUT /admin/notification-policy`; `effectiveSettingsOf` and `loadDeliveryInput` (the database half of the decision); registers the digest read. |
| `apps/api/src/modules/tasks/digests.ts` | new | `GET /me/notification-digests/{digestId}` (own digests only; anyone else 404). |
| `apps/api/src/modules/tasks/service.ts` | named lines | Delivery lines in `createWorkItemOnce`: the notification gets `urgency`, `delivery_state` and `deliver_after`. The two new audit-change keys are `delivery_state` and `deliver_after`. The work item itself is never held. |
| `apps/api/src/modules/tasks/routes.ts` | 2 named lines | The DG4 inbox list and its unread count read only `delivery_state = 'delivered'` rows. |
| `apps/worker/src/kit.ts` | named lines | The twin delivery lines in the worker's `createWorkItemOnce`, plus the twin loaders `effectiveDeliverySettings` and `loadDeliveryInput` (the worker imports no API code). |
| `apps/worker/src/handlers/digests.ts` | new | The `notification.digest` job: per user, under lock 730261 on `"<userId>:<windowStartIso>"` plus the UNIQUE backstop. Digest on: one digest notification, one `notification_digest` row, and held → digested. Digest off: held → delivered. Every row is audited. |
| `apps/worker/src/handlers/index.ts` | 2 named lines | Import and register `DIGESTS_HANDLERS`. |
| `apps/worker/src/queues/digests.ts` | new | The `notification.digest` queue spec. **Not named in §E.3** but needed: pg-boss refuses to schedule a queue that does not exist. This is the BE-J `queues/portfolio.ts` precedent. |
| `apps/worker/src/queues/index.ts` | 2 named lines | Import and register `DIGESTS_QUEUES`. **Not named in §E.3**; same reason. |
| `apps/api/src/modules/tasks/tasks.test.ts` | edited | The tasks module now registers 10 routes (5 DG4 + 5 BE-L). |
| `apps/api/src/server.test.ts` | 1 named line (+1 comment) | Tasks route pin 5 → 10. **Not named in §E.3**; the KBE-C and BE-H precedent of a task updating its own module's pin in this file. |
| `apps/api/test/integration/tasks/notification-delivery.test.ts` | new | 11 integration tests against PostgreSQL (§2), including the extended parity test of the two `createWorkItemOnce` twins. |
| `apps/api/test/integration/contract/p5-exercises-be-l.ts` | filled | Contract exercises for the five operations, with mirrors. |
| `apps/api/test/support/p5-pending-be-l.ts` | emptied | All five operations routed. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-L-backend-workflow-engineer.md`, `…/T-DG5-BE-L-evidence/*` | new | This handback, its logs and the proposed contract patch. |

The working tree also shows untracked `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md` at the top level. I did not create them; they are environment artifacts. Don't integrate them.

## 2. Behaviour delivered (REQ-S12-025)

**Acceptance text (requirements.csv, quoted):** "Non-urgent notifications respect quiet hours and digests; urgent escalations follow their own policy". **A09:** "a non-urgent reminder due in quiet hours is delivered in the next digest; an urgent escalation is delivered immediately".

ADR-0044 §5 keeps the four settings separate:

- **Business-day timing:** `notification_policy.non_urgent_working_days_only` (organization; default off). Working days come only from the organization's active default calendar and its active holidays. With no calendar the rule holds nothing (Unknown, never guessed), and it never counts elapsed days.
- **Quiet hours:** the user's own row, else the organization defaults, in the user's time zone. The time zone is taken from the preference row, else the user's profile, else the organization's default, else `DEFAULTS.timezone` (Asia/Riyadh). Quiet hours may span midnight; the end time itself is outside them.
- **Digest:** `off`, `daily` or `twice_daily` (at `digestTime` and 12 hours later). The organization default uses 08:00.
- **Urgent escalation:** `work_item_kind.urgency = 'urgent'` is always delivered at once (`urgent_delivery = immediate`), whatever the quiet hours, digest or calendar.

No preference and no policy holds nothing, which is the DG4 behaviour.

The literal tests of §E.3, all in `apps/api/test/integration/tasks/notification-delivery.test.ts` unless stated:

| §E.3 literal test | Where | Result |
|---|---|---|
| A non-urgent reminder created in quiet hours (digest daily) is delivered in the next digest, and the digest job run twice in the window creates one digest | "a non-urgent reminder in quiet hours is delivered in the next digest; the job twice in the window creates one digest; My Work shows the task at once" | PASS |
| An urgent escalation (`approval_escalated`) in quiet hours is delivered immediately (API and worker twins) | "an urgent escalation (approval_escalated) in quiet hours is delivered immediately"; also `delivery.test.ts` | PASS |
| With no preference and no policy every notification is delivered at once (DG4 regression on the inbox list) | "with no preference and no policy every notification is delivered at once (DG4 regression on the inbox list)"; the DG4 suite `tasks/work-items.test.ts` | PASS |
| Quiet start = end → 422 `notification_preference.quiet_hours_invalid` | "refusals: …" (also half-set quiet hours); policy test; contract exercise | PASS |
| The work item is visible in My Work while its notification is held | the digest test lists `/me/work-items` while the reminder is held and the inbox is empty | PASS |
| AUD 403 on `PUT /me/notification-preferences` | "AUD gets 403 on PUT (and a user with no role)…"; contract exercise | PASS |
| `If-Match "0"` creates; 409 stale | "version 0 with the defaults when none stored; If-Match \"0\" creates; then 409 stale; one audit event per write" | PASS |
| Property tests of the pure decision in Asia/Riyadh and another zone | `packages/shared/src/notifications/delivery.test.ts` (Asia/Riyadh, America/New_York with DST, Asia/Kolkata at UTC+5:30) | PASS |
| The parity test of the `createWorkItemOnce` twins, extended | "parity: … held and delivered rows: same state, same release instant (to the minute), same audit keys"; the DG4 parity test still passes | PASS |

Shared rule §2.4 (every mutation) is covered for both PUTs:

- **Authorization at commit time:** grants are reloaded in the transaction. The test "commit-time: a grant revoked while the PUT waited is 403; nothing written" uses the `afterIdentity` technique.
- **Validation:** 400 on the schema; 422 on quiet hours and the time zone.
- **`If-Match`:** 428 when missing, 409 when stale; `"0"` creates.
- **Audit:** one event per row (`notification_preference.create/update`, `notification_policy.create/update`), asserted.
- **No remote I/O** inside the transaction.

AUD and users with no role get 403 on the preference write. Only ADM_TECH (`notification_policy.configure` in the caller's own organization) reads or writes the policy; AUD and TO get 403.

Refusal codes and texts are exactly ADR-0044 §10's:

- `notification_preference.quiet_hours_invalid`: "Quiet hours need a start time and a different end time."
- `notification_preference.timezone_unknown`: "The time zone is not a known time zone."

The digest job, exactly once:

- It holds lock 730261 (`digestWindow`) on `"<userId>:<windowStartIso>"`, and `notification_digest_window_key` is the UNIQUE backstop.
- A window that already has the user's digest creates nothing more; rows that become due later wait for the next window.
- The digest notification's dedupe key is `notification.digest:<userId>:<windowStart>`.
- A failed user rolls back alone, and the job rethrows, so pg-boss retries it.
- With the digest off, due held rows move held → delivered (no digest).
- The digest read lists the digested notifications, oldest first. Anyone else gets 404, an unknown id 404 and a malformed id 400.

Unknown is never 0: a working-day release that can't be computed (no calendar) holds nothing rather than guessing a date.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL is the disposable cluster from `tests/qa/support/with-pg.sh` on harness ports 23850–23899. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-L-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (at start) | 0 | `PASS gate DG4 (historical)` (`validate-historical-DG4-start.log`) |
| 1a | `pnpm -r typecheck` | 0 | every package (`pnpm-r-typecheck.log`) |
| 1b | `pnpm -r build` | 0 | all packages built (`pnpm-r-build.log`) |
| 1c | `pnpm lint` | 0 | `eslint . --max-warnings=0`, no problems (`pnpm-lint.log`) |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier-check.log`) |
| 1e | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (`openapi-lint.log`) |
| 2 | `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) and with `LANG=LC_ALL=C.UTF-8` | 0 and 0 | Same counts both times, three Vitest invocations: unit-node 108 files, **1917 passed**; unit-web 72 files, **1400 passed**; unit-formula-nocodegen 3 files, **259 passed, 2 skipped**. The 2 skips are the pre-existing `it.skipIf(NOCODEGEN)` cases in `packages/shared/src/formula/fuzz.test.ts`. (`pnpm-test-locale-unset.log`, `pnpm-test-c-utf8.log`) |
| 3 | `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration` (PostgreSQL 16.13, port 23860, first attempt) | **1** | 237 files: 236 passed, 1 failed. **2304 passed, 2 failed** (2306). Both failures are in `contract.test.ts` and are exactly the two in §3 and §5: (a) the media-type pin `[363, 362, 1]` vs `[361, 360, 1]`, the orchestrator's to reconcile (§4); (b) the undeclared-media-type sweep hitting the `ETag` contract defect (§5.1). All other suites pass, including the DG4 `tasks/work-items.test.ts` regression and parity tests, the worker suites and the 11 tests of `notification-delivery.test.ts`. (`test-integration.log`) |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (at end) | 0 | `PASS gate DG4 (historical)` (`validate-historical-DG4-end.log`) |

Disclosed failures and fixes during the work:

- **Delivery property test (fixed).** The first version of the delivery property test found a real defect. When the digest was on, moving a non-working-day notification to 08:00 skipped digest slots earlier in the working day. The same happened when 08:00 fell inside long quiet hours. Both made some calendars cycle without converging. The working-day move now goes to midnight when quiet hours or a digest apply; the property test now checks unsatisfiable cases exhaustively.
- **First `pnpm test` run (fixed).** The first run had 4 failures from my change, all fixed before the recorded runs:
  - `architecture.test.ts`: a computed member key; now a `Map`.
  - `advisory-locks.test.ts`: a comment spelled the lock number; it now names the lock class.
  - `tasks.test.ts` and `server.test.ts`: the tasks route count, 5 → 10.
- **Contract test (open; orchestrator).** `contract.test.ts` fails on the unpatched contract for two reasons, explained in §5: the media-type pin, and the `ETag` header of the two version-0 GETs. Logs: `contract-test-unpatched-openapi.log` (2 failed, 72 passed) and `contract-test-with-proposed-openapi-patch.log` (1 failed, the pin only; 73 passed). To verify that run I applied the proposed patch temporarily, then restored `openapi.yaml` byte for byte from a copy (`git status` shows it unmodified).

## 4. Operations routed (delta to `p5-pending-be-l.ts`)

`p5-pending-be-l.ts` went from 5 entries to 0. Each operation is exercised through the validating client in `p5-exercises-be-l.ts`:

| Operation | Success | Refusals exercised |
|---|---|---|
| `getMyNotificationPreferences` | 200 (version 1) | 400 |
| `putMyNotificationPreferences` | 200 (`If-Match "0"` creates) | 400, 428, 403 (AUD), 422 quiet_hours_invalid, 422 timezone_unknown, 409 |
| `getMyNotificationDigest` | 200 (a real digest from the worker job) | 400, 404 (unknown id; another user's digest) |
| `getNotificationPolicy` | 200 (a row exists) | 400, 403 (AUD) |
| `putNotificationPolicy` | 200 | 400, 428, 403 (AUD, TO), 422 quiet_hours_invalid, 409 |

401 is covered by the platform sweep and by `notification-delivery.test.ts`. The declared 404 on the two PUTs is not reachable: the caller's own row or organization always exists.

**Pinned-count deltas for the orchestrator (D-079):**

- **Media-type triple** in `contract.test.ts` "the contract: every route accepts exactly the request media types its operation declares": `[361, 360, 1]` → **`[363, 362, 1]`**. That is +2 JSON bodies (`putMyNotificationPreferences`, `putNotificationPolicy`); the other three operations are GETs. Suggested comment line: `// T-DG5-BE-L: + putMyNotificationPreferences, putNotificationPolicy (2 JSON bodies; the other three BE-L operations are GETs).`
- **Rate-limit floor** (`>= 285`): unchanged (it is a floor).
- **Operation count** (846): unchanged.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **Contract defect (blocks one `contract.test.ts` case until applied).** `getMyNotificationPreferences` and `getNotificationPolicy` say "version 0 when none stored". Their PUTs take `IfMatchOrZero`, but their 200 responses declare the `ETag` header (pattern `"[1-9]…"`) instead of `ETagOrZero`.
   - **Why no response passes:** while nothing is stored, the GET can neither send `"0"` (pattern violation) nor omit the header (declared, so "must send header ETag"). The shared undeclared-media-type sweep reads both GETs with users who have no row, so it fails.
   - **What I implemented:** the ARCH-R1 rule: ETag `"0"` while nothing is stored, else the version. This follows the rag-policy and change-control precedent.
   - **Proposed two-line patch:** `T-DG5-BE-L-evidence/proposed-openapi-etag-or-zero.patch` (the D-149 precedent). I verified it: with the patch, the contract test fails only on the expected media-type pin.
   - **Test workaround:** until the patch lands, my own tests read the version-0 GETs with `contract: false` (`VERSION_ZERO_READ`, documented in the test). Every other call is contract-validated.
2. **No new problem code, no migration, no dependency.**
3. **Delivery paths outside my ownership that still deliver at once** (DG4 behaviour, never held). These bypass `createWorkItemOnce`, so quiet hours and digests don't apply to them:
   - the `notify` automation action (`apps/worker/src/automation/actions/notify.ts`, BE-H2);
   - three DG4 standalone-notice helpers: `notifyOnce` in `apps/worker/src/handlers/escalations.ts` and `gates.ts`, and `notifyCalendarMissing` in `meetings.ts`.

   ADR-0044 §5 names the `notify` action as a caller of the decision. Wiring it is a named-line change to that file (call `loadDeliveryInput` from `kit.ts` and `decideDelivery`, then set the three columns as `createWorkItemOnce` does). I did not edit these files because they are not in §E.3. Urgent kinds are unaffected: they are delivered at once anyway.

## 6. User-facing texts

- **No en/ar string made untrue.** No web string calls quiet hours, digests or notification preferences planned or later. The nav entry `notificationPreferences` (`apps/web/src/app/nav.ts`, `p5Feature`) is a shell placeholder whose screen is FE-D's (p5-plan §5.1). It stays correct while that screen is missing.
- **For the web i18n owner (FE-D).** The digest notification carries message key `notifications.digest` with params `{count}`, and links to `/me/notification-digests/<id>`. The web inbox renders `messageKey` through `renderMessage` (`apps/web/src/pages/my-work/messages.ts`). An en/ar translation of `notifications.digest` (e.g. en "{{count}} notifications in your digest") is needed in the web `myWork` resources, and a digest view for the link. Both are web files outside my ownership.

## 7. What remains

- The orchestrator applies the `ETagOrZero` contract patch (§5.1) and reconciles the media-type pin (§4). Once the patch lands, `VERSION_ZERO_READ` in `notification-delivery.test.ts` can be removed.
- FE-D: the notification-preferences screen, the policy fields in the admin area, the `notifications.digest` translation and the digest view (§6).
- Optional follow-up for the owners of the files in §5.3: route the `notify` action, and optionally the DG4 standalone notices, through the delivery decision.
- `0079` is unused. BE-L2 may still take it under §E.5.
- Nothing in §E.3 is left unimplemented.

## 8. Final check results (summary)

- Acceptance 1 (typecheck, build, lint, prettier, openapi:lint): **all exit 0**.
- Acceptance 2 (`pnpm test`, locale unset and `C.UTF-8`): **exit 0 both**; 1917 + 1400 + 259 passed (2 designed skips) each time.
- Acceptance 3 (`test:integration`): **exit 1**. 2304 passed, 2 failed, both in `contract.test.ts`.
  - **Media-type pin** (the pinned-count change, +2 JSON bodies): the orchestrator reconciles it per D-079 (§4).
  - **`ETag` defect in the frozen contract** (§5.1). Its patch is proposed and was verified: with it applied, `contract.test.ts` has only the pin failure (`contract-test-with-proposed-openapi-patch.log`).
  - Applying the patch and updating the pin, both orchestrator-owned, makes acceptance 3 green. I didn't edit either file, because both are outside my ownership.
- Acceptance 4 (`validate.mjs --historical --stage DG4`): **exit 0** at start and at end.
- **Evidence timing:** the two `contract-test-*.log` runs were made before the last cosmetic edits: an audit-diff helper rewritten with a `Map`, and comment wording. The full integration run in `test-integration.log` is on the final tree.
- **Concurrency disclosure:** the final typecheck, lint, prettier and validator ran while the integration suite was running. The suite showed no flaky or timed-out test.
