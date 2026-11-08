# T-DG6-BE-Z13 handback: automation marker tokens, inbox redaction, label copy (backend-workflow-engineer)

- **Stage:** DG6 (P6), FIXING after review round 8. Engineering delivery gate only: nothing here grants or implies a product gate G1–G6 or any business, Finance or IT approval. All test data is SYNTHETIC.
- **Invocation:** `claude-code-cli-session`, run `DG6-T-DG6-BE-Z13-backend-workflow-engineer-20261108T205023Z-50c5cf18`, session `50c5cf18-25f9-4f95-8c14-a6b2fd802961`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z13.md` (sha256 `5fdf5864…2a292`, verified at start).
- **Base:** branch `dg6/be-z13` at `dac280fd0db6bef158eb81ba0ecb307831598760`, clean tree at start. Changes are left **uncommitted**.
- **Time:** started `2026-11-08T20:50:34Z`. The end time is in §8.
- **Findings addressed:** F-DG6-520, F-DG6-541, F-DG6-560 (one defect), F-DG6-540, F-DG6-561. An author never closes their own finding: verification is for the reviewers.
- **Migrations:** none. **New dependencies:** none. **New endpoints:** none.

## 1. Changed files

### API (`apps/api/src`)

| File | Purpose |
| --- | --- |
| `modules/automation/versions.ts` | D-226. `redactConditionLiterals` shows each hidden literal as `[restricted:k]` (k = 1-based ordinal among the version's hidden literals, in reading order) and returns a private token→literal map. `resolveRestrictedTokens` (replaces `keepRestrictedLiterals`) maps each token back wherever the condition now sits. An unknown token, the bare `[restricted]` text or any other marker-like text is refused 422 `automation_rule.restricted_marker_unknown`, with a JSON pointer. The summary renders a token as "a restricted record" / "سجل مقيد". |
| `modules/automation/rules.ts` | `createAutomationRule` runs `resolveRestrictedTokens` with no stored version, so marker text is refused on create too. |
| `modules/tasks/deep-links.ts` | `restrictedNotifications`: the one decision for a notification. It is restricted when the target is unreadable (`readableTargets`), or any id in the link, params or stored target names a sensitive record or any `SENSITIVE_CHILD_SOURCES` child the reader is not admitted to (`restrictedIdsAmong`), or the announced work item is restricted. `restrictedWorkItems` now also checks every id in the work item's link. `resolveDeepLink` uses `restrictedNotifications` (403 for a child route of a restricted record). |
| `modules/tasks/routes.ts` | `notificationFor`: `inbox.restricted`, params `{}`, `linkPath` = the transformation home (else `/my-work`) and `includesRestrictedRecords: true`. Used by `listMyInbox` and by `markInboxNotificationRead`, which was unredacted before. |
| `modules/tasks/index.ts` | Exports `restrictedNotifications`. |

### Shared, contract, web

| File | Purpose |
| --- | --- |
| `packages/shared/src/schemas/automation.ts` | `AUTOMATION_RESTRICTED_LITERAL` is now the bare text, never shown and refused. New `automationRestrictedToken(k)`, `AUTOMATION_RESTRICTED_TOKEN_PATTERN` and `looksLikeRestrictedMarker`. |
| `packages/shared/src/schemas/tasks.ts` | `InboxNotification.includesRestrictedRecords` (optional literal `true`). |
| `docs/api/openapi.yaml` | Updates the condition `value` and `AutomationRuleVersion.includesRestrictedRecords` descriptions (tokens, mapping, 422), the new `InboxNotification.includesRestrictedRecords`, the `listMyInbox` and `markInboxNotificationRead` summaries, and `restricted_marker_unknown` in the create and update summaries. |
| `apps/web/src/components/sensitivity/RestrictedRecordsLabel.tsx` | F-DG6-561: `scope` prop. `"total"` (default) keeps the total text; `"item"` uses the new `adminP6.restricted.hintItem`. The scope is exposed as `data-restricted-scope`. |
| 12 item call sites: `ExternalConfirmationPanel`, `ActionsPage`, `DesignPage`, `LaunchPlanPage`, `BenefitsPage`, `RegisterPages` (×2), `MeasurementPage`, `DispensationsPage`, `MyWorkSections`, `EvidenceRegisterPage`, `RulePage`, `ContentEditor` | `scope="item"` (a row, link, count of links or condition). |
| 7 total call sites: `Totals`, `TransformationDashboardPage` (×2), `DashboardsPage`, `dashboards/ui` (drill-down), `ExecutiveOverviewPage`, `reports/ui` | `scope="total"`, made explicit. |
| `apps/web/src/pages/automation/ContentEditor.tsx` | `conditionIsRestricted` follows the token pattern, never a value equal to the bare marker text. The label moves with the token when a condition is removed. |
| `apps/web/src/pages/my-work/MyWorkPage.tsx` | The inbox row shows the item-scoped restricted label when `includesRestrictedRecords`. |
| `apps/web/src/i18n/{en,ar}/adminP6.json` | `restricted.hintItem` (en, ar). |
| `apps/web/src/i18n/{en,ar}/problems.json` | `automation_rule__restricted_marker_unknown` (en, ar). |

### Tests

| File | Purpose |
| --- | --- |
| `apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts` (new, 9 tests) | Covers reading tokens; removing an earlier condition; reordering two hidden literals; removing the restricted condition itself; removing and reordering in-list elements; removing a hidden list element; 422 for an unknown token, the bare marker, case/space variants and a non-numeric token (value and in-list, nothing stored, also on create); 403 without `automation.configure`; and after a grant, real values plus a now-unknown token refused. |
| `apps/api/test/integration/tasks/inbox-restricted-z13.test.ts` (new, 7 tests) | Uses FIN, not admitted. Covers 404 controls on the benefit, Finance validation and overlap; `listMyInbox` redacting the Finance validation (worker producer shape), the overlap (the **real** `POST /benefit-overlaps` producer) and a benefit link, with no hidden id or code and stored rows unchanged; an open reminder left untouched; the work item linking home; `markInboxNotificationRead` returning the same redaction; the deep link refused 403; after a grant, the original text and link back; and 404 when another user marks the notification read. |
| `apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts` | Automation section moved to tokens. Marker text where no token stood is now 422 and nothing is stored. |
| `apps/api/test/integration/tasks/deep-links.test.ts` | The redacted inbox item now has the home link and the marker. The original link returns with access. |
| `apps/api/test/support/sensitive-reference-inventory.ts`, `.../sensitive-reference-inventory.test.ts` | New kind `"text"`: the catalog adds text columns named `link_path` / `href`. Adds rows `inbox_notification.link_path` and `work_item.link_path` (redacted). `inbox_notification.target_record_id` and `.message_params` now name `markInboxNotificationRead` (and `resolveDeepLink` where it applies), with this task's test as the exercise. KNOWN_OPEN and KNOWN_PENDING are still pinned **empty**. |
| `apps/web/src/pages/automation/fed.test.tsx`, `.../my-work/my-work.test.tsx`, `.../admin/security/p6-admin-screens.test.tsx` | Covers the token label and that the bare marker gets no label; the label following the token after a removal; the inbox restricted label and home link; and total vs item description (en and ar). |

## 2. Behaviour per requirement row

**REQ-S10-002.** Acceptance text, quoted: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". D-218, D-222 and D-226 apply.

### Automation conditions (F-DG6-520, F-DG6-541, F-DG6-560)

- A reader not admitted sees `[restricted:1]`, `[restricted:2]`, … in place, plus `includesRestrictedRecords: true`. The token reveals only the literal's position among the hidden literals, which the reader already sees on screen.
- A save maps each token back to its literal wherever it now sits. A token left out removes its literal.
- Anything marker-like that is not a token of the stored version is refused 422 with an en/ar problem text. This covers an unknown token, the bare `[restricted]` text, `[Restricted:1]`, ` [restricted:1] ` and `[restricted:x]`. The marker text is never stored.
- An admitted writer is never shown tokens, so for them any token is unknown (422).
- The web label follows the token.
- Covered by `automation-restricted-tokens-z13.test.ts` and by the reviewer probes (§3.2).

### Inbox (F-DG6-540)

- `listMyInbox` and `markInboxNotificationRead` return `inbox.restricted`, `{}`, the transformation home and `includesRestrictedRecords: true`. This holds for a direct target, any child source (Finance validation, benefit overlap, measurement and the rest of `SENSITIVE_CHILD_SOURCES`, whatever the route) and a restricted announced work item.
- `resolveDeepLink` refuses such a link with 403.
- Stored rows never change.

### Label copy (F-DG6-561)

- On totals: the existing text.
- On rows, links and conditions: en "This item refers to a record you are not admitted to. The record and its values stay hidden." / ar "يشير هذا العنصر إلى سجل غير مسموح لك به، ويبقى السجل وقيمه مخفيين."

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 31150–31199. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z13-evidence/`.

### 3.1 Acceptance checks

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5-start.log` |
| 1 | `pnpm -r typecheck` | 0 | clean | `10-typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `11-build.log` |
| 3 | `pnpm lint` | 0 | clean | `12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all formatted (re-run after this handback, see §8) | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | clean | `14-openapi-lint.log` |
| 6 | `pnpm test`, LANG unset | 0 | unit-node **190 files / 2899 passed**; unit-web **123 / 2086 passed**; unit-formula-nocodegen **3 / 259 passed, 2 skipped** | `20-test-lang-unset.log` |
| 7 | `LANG=C.UTF-8 pnpm test` | 0 | the same counts in every invocation | `21-test-lang-cutf8.log` |
| 8 | `tests/qa/support/with-pg.sh npx vitest run --project integration <68 files>` (LANG unset, QA_PG_PORT=31150) | 0 | **68 files / 571 passed** | `30-integration-touched.log` |
| 9 | `E2E_PG_PORT=31180 E2E_API_PORT=31185 MTH_PORT_POOL=31186-31199 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` | 0 | **4 passed** (4.0 m: a13 en 10.6 s, ar 7.0 s; a22 en 1.7 m, ar 1.8 m), no retry. It ran while run 8 was going. | `40-e2e-a22-a13.log` |

The file list for run 8 is in `30-integration-files.txt`. It covers:

- all of `apps/api/test/integration/automation/` (12 files), `tasks/` (6) and `operations/` (7), including the BE-Z6 race test `exception-recurrence-race.test.ts` and `exceptions.test.ts`;
- every `access/sensitive-*` file, including the sweep, the inventory and Z12B, plus the new token test;
- `contract/contract.test.ts`, `reporting/my-work.test.ts`, `approvals/reminders.test.ts` and `security/xss.test.ts`;
- worker `automation-failure-queue`, `job-runs`, `worker-attempt`, `outbox`, `starters`, `restart`, `schedules` and `benefits-queue`;
- `tests/qa/integration/a13-*` (11), `a22-*` (2) and `a21-p6-adapters-disabled`.

### 3.2 Reviewer reproductions, before and after

Script: `repro.sh.txt`. Each probe is copied into the tree, run on a disposable PostgreSQL and removed afterwards.

| Probe | Before (base `dac280fd`) | After |
| --- | --- | --- |
| CS `zz-cs-r8-automation-resave` | 1 failed, exit 1 | **1 passed**, exit 0 |
| CS `zz-cs-r8-inbox-text` (P1, P1b real producer, P1c, P2) | 3 failed / 2 passed, exit 1 | **5 passed**, exit 0 |
| Domain `dom-r8-condition-resave` | 2 failed / 1 passed, exit 1 | 3 failed, exit 1 (see below) |
| Domain, D-226 adaptation | n/a | **3 passed**, exit 0 |
| QA `zz-qa-dg6r8-condition-ordinal-resave` | 1 failed, exit 1 | 1 failed, exit 1 (see below) |
| QA ordinal, D-226 adaptation | n/a | **1 passed**, exit 0 |
| QA `zz-qa-dg6r8b-condition-resave-pairing` (P0–P3) | 3 failed / 1 passed, exit 1 | 3 failed / 1 passed, exit 1 (see below) |
| QA pairing, D-226 adaptation | n/a | **4 passed**, exit 0 |

The before logs are `repro-before-*.log`, the after logs `repro-after-*.log`, and the adaptation runs `repro-after-adapted-*.log`.

**Disclosed: why three unchanged probes still exit 1.**

- The domain and QA probes hard-code the superseded D-222 contract. They expect the shown value to equal `AUTOMATION_RESTRICTED_LITERAL` (`"[restricted]"`), and two of them send that text themselves.
- Under D-226 the server shows `[restricted:k]` and refuses the bare text with 422. The after logs show exactly that: `expected [ '[restricted:1]', '[restricted:2]' ] to deeply equal [ '[restricted]', '[restricted]' ]`, and the 422 `automation_rule.restricted_marker_unknown` body.
- For a fair after-run, I made copies under `adapted-d226/`. Each one says at the top what changed. Only the marker literals differ: the expected shown values are the tokens, and the sent marker is the token that was shown. Every scenario and every assertion on the **stored** literals is unchanged.
- All three copies pass.
- Before the fix the same scenarios failed on the stored literals (the before logs), which is the defect.

## 4. Operations routed (delta to the pending list)

None. No new operation. No `apps/api/test/support/p6-pending-*.ts` entry names any operation I touched (`listMyInbox`, `markInboxNotificationRead`, `resolveDeepLink`, `createAutomationRule`, `updateAutomationRuleVersion`, the version reads). `contract.test.ts` is green in run 8.

## 5. Contract, schema and dependency needs (for the orchestrator)

- **Contract (additive):** `InboxNotification.includesRestrictedRecords` (optional `const: true`) in OpenAPI and the zod mirror.
- **New problem code:** 422 `automation_rule.restricted_marker_unknown`, on `createAutomationRule` and `updateAutomationRuleVersion`, with en/ar text in `problems.json`.
- **Changed response content:** the automation condition literals (tokens instead of `[restricted]`) and the redacted inbox `linkPath`.
- **No** migration, **no** dependency.

**Residual race, a decision for the orchestrator.** D-226 fixes `k` as the ordinal among the version's hidden literals *for this reader*. That set can change between the author's read and save without the version's `If-Match` changing, because sensitivity and grants live on the benefit:

- **If a record becomes hidden in between:** the author still holds its plain id and sends it back as a plain literal, which is allowed (D-223). The ordinals of the other tokens can then shift.
- **If a record becomes visible in between:** a token can map to the next hidden literal.

Both are rare and bounded: drafts only, and publishing still needs a dry run, a configuration review and a person. Closing the race would need a stable k, for example the position among all literals of the version, or a token-set fingerprint. Either would change D-226's definition, so I did not deviate from it.

## 6. User-facing texts this work made untrue

- **Fixed (en and ar):** the restricted label's description on rows, links and conditions (F-DG6-561).
- **Fixed:** the OpenAPI descriptions of the condition value, `includesRestrictedRecords` and the inbox operations.
- **For the solution architect (owner of the file; not edited by me):** `docs/architecture/adr/ADR-0051-p6-authorization-boundary-read-scope-sensitive-records-deep-links.md` is now untrue in four places:
  - line 151: "Inbox redaction … shape unchanged". The shape now adds the optional `includesRestrictedRecords`, the link is the transformation home, and mark-read and child sources are covered.
  - line 324: the marker `"[restricted]"` is now the token `[restricted:k]`.
  - line 340: the D-222 (2) four-way pairing of `keepRestrictedLiterals` is replaced by token mapping and the 422 refusal (D-226).
  - line 400: `keepRestrictedLiterals` is renamed `resolveRestrictedTokens`.

## 7. What remains, and observations for routing

All three items of the brief are done. Nothing is left from my scope. Three observations from the work, none of them repaired here because they are outside the brief:

1. **Id-bearing event keys (new observation, same class as F-DG6-540).** Extending the inventory catalog to text columns showed that some key columns hold a record id. For example, outbox keys `benefit.variance_evaluated:<measurementId>` and `benefit.value_validated:<financeValidationId>` (both child ids) flow into columns that are served:
   - `operational_failure.idempotency_key` → `OperationalFailure.idempotencyKey` (failure queue);
   - `automation_action_result.idempotency_key` and `automation_execution.trigger_key` → `AutomationExecution` (`actionResults[].idempotencyKey`, `triggerKey`).

   A failure-queue or automation reader who is not admitted could see such a child id. I kept the new text kind to link columns (`link_path` / `href`), which is what the brief asked for, so that KNOWN_OPEN stays empty. I did not classify the key columns as safe. They need a decision and a repair: redact hidden ids inside the key and add the marker, or decide that ADR-0051 excludes them under D-219.
2. **Channel fan-out (from F-DG6-540's text, by code reading).** `apps/worker/src/handlers/notifications.ts` (`recipientCanRead`) decides "restricted" without the child-source check. An e-mail or Teams body for a Finance-validation or overlap notification could still carry the benefit code once a channel is enabled. Channels are off by default. The worker cannot import the API module, so this needs the same `restrictedIdsAmong` check in the worker.
3. **Action-register work items (from F-DG6-540's text).** `raid/actions.ts` carries `{sourceCode}` and an `/action-register/` link for an action on a restricted corrective case. These are restricted now only if the action's link or params hold the case's id. Not verified here.

## 8. Final checks and time

The final validator run, the prettier re-check (with this handback) and the end time are in `90-final.log`.
