# Handback: T-DG6-BE-Z14, version-bound restricted tokens, editor refresh, digest redaction (D-231)

- **Agent:** backend-workflow-engineer
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Z14-backend-workflow-engineer-20261109T060847Z-5fb3aee2","session_id":"5fb3aee2-cc8a-4745-9142-1065fe04fae9"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z14.md` (sha256 `d0512ce3…f96a87`, verified at the start).
- **Stage:** DG6 (FIXING after round 9).
- **Branch and base:** branch `dg6/be-z14`, base `HEAD` `8818c674b382f678bb98f1952e898b8a29bdf80c`.
- **State:** changes are left **uncommitted**.
- **Time (UTC):** started 06:09:01, finished 06:58.
- **Findings in scope:**
  - F-DG6-580 (and code-security observation 601, the same defect);
  - code-security observation 600 (the digest read is not redacted).
- **No approvals:** no product gate (G1–G6) and no engineering gate (DG0–DG7) is decided or implied. All test data is synthetic.

## 1. Before you start: preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` exited **0** (`PASS gate DG5 (historical)`). Log: `T-DG6-BE-Z14-evidence/00-validate-dg5-historical.log`.

## 2. Files changed

### API and shared contract

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/automation.ts` | The token becomes `[restricted:<version>:<k>]`: `automationRestrictedToken(version, k)` and `AUTOMATION_RESTRICTED_TOKEN_PATTERN` = `^\[restricted:([1-9][0-9]{0,9}):([1-9][0-9]{0,3})\]$`. |
| `packages/shared/src/schemas/notifications.ts` | `notificationDigestItem` gains the optional `includesRestrictedRecords: true` (zod mirror). |
| `apps/api/src/modules/automation/versions.ts` | `redactConditionLiterals` takes `{conditions, version}` per set and issues version-bound tokens. `resolveRestrictedTokens` takes the stored conditions and the stored row version. A token of another version is refused 422 `automation_rule.restricted_token_stale` (new `automationRefusals.restrictedTokenStale`). `updateVersion` passes `current.version`, which `If-Match` was already checked against. |
| `apps/api/src/modules/automation/rules.ts` | Rule reads pass each effective version's row version to `redactConditionLiterals`. |
| `apps/api/src/modules/tasks/deep-links.ts` | New `restrictedNotificationView`: the single D-226 redacted shape (`inbox.restricted`, params `{}`, the transformation home or `/my-work`, the marker). |
| `apps/api/src/modules/tasks/routes.ts` | `notificationFor` now uses `restrictedNotificationView`. The behaviour is unchanged. |
| `apps/api/src/modules/tasks/digests.ts` | `getMyNotificationDigest` selects the reference columns, makes one `restrictedNotifications` decision per read, and returns each item through `restrictedNotificationView`. |

### Web

| File | Purpose |
|---|---|
| `apps/web/src/pages/automation/RulePage.tsx` | `EditContent` holds `{from: version, draft}`, saves with `If-Match: from`, and reloads after each outcome:<br>• after a 200, from the saved response;<br>• after a 409 or a stale-token 422, from `GET` of the version, and shows `workflowsP5.rules.changedReapply` (`role="alert"`, `data-state="rule-changed-reapply"`).<br>`ContentEditor` is keyed by `from`. |
| `apps/web/src/pages/automation/ui.tsx` | `Runner.run` gains an optional `onError` callback, called after the existing refresh. |
| `apps/web/src/pages/automation/ContentEditor.tsx` | Doc comment only: the token format. |
| `apps/web/src/pages/notification-preferences/NotificationPreferencesPage.tsx` | The digest view shows `RestrictedRecordsLabel scope="item"` for `includesRestrictedRecords`, as the inbox does. |
| `apps/web/src/i18n/{en,ar}/workflowsP5.json` | New `rules.changedReapply` in en and ar. |
| `apps/web/src/i18n/{en,ar}/problems.json` | New `automation_rule__restricted_token_stale` in en and ar. The Arabic is provisional, as for the neighbouring keys. |

### Tests

| File | Purpose |
|---|---|
| `apps/api/test/integration/access/automation-restricted-tokens-z14.test.ts` | **New.** Real API with a disposable PostgreSQL, 5 tests. |
| `apps/api/test/integration/tasks/digest-restricted-z14.test.ts` | **New.** Real API and the real worker `runDigestWindow`, 4 tests. |
| `apps/api/src/modules/tasks/notification-serializers.test.ts` | **New.** The serializer guard (unit-node, 3 tests). |
| `apps/web/src/pages/automation/rule-editor-tokens-z14.test.tsx` | **New.** The editor in en and ar, 7 tests. |
| `apps/web/src/pages/notification-preferences/digest-restricted-z14.test.tsx` | **New.** The digest view in en and ar, 2 tests. |
| `apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts` | Moved to the version-bound tokens. Adds refusal cases for the retired `[restricted:1]` form and for an unclosed token. |
| `apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts` | Moved to the version-bound tokens. The marker-refusal step now builds on the saved response, whose tokens are current. |
| `apps/web/src/pages/automation/fed.test.tsx` | Token literals changed to `[restricted:3:k]`. |
| `apps/api/test/support/sensitive-reference-inventory.ts` | The note text on the token format and the new 422. |

### Design records

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | Descriptions of the token format and the stale-token 422 (condition value, `includesRestrictedRecords`, the `updateAutomationRuleVersion` summary). `NotificationDigestItem` gets descriptions plus the optional `includesRestrictedRecords`. Summary of `getMyNotificationDigest`. The `InboxNotification` marker description names the digest. |
| `docs/architecture/adr/ADR-0051-…-deep-links.md` | New amendment "version-bound automation tokens, the editor reload, and the digest read (D-231)". In-place pointers in the part A token text and the part B inbox bullet. |
| `docs/architecture/adr/ADR-0043-…-failure-queue.md` | A version-binding bullet under the restricted-marker refusal. |
| `docs/architecture/data-dictionary.md` | The token format and the new 422. |

**No migration.** The highest migration is still `0126`. **No new dependency.**

## 3. Behaviour delivered

### 3.1 Version-bound tokens (F-DG6-580; CS observation 601)

The binding requirement row is REQ-S10-002. Its acceptance text: "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant". The D-226/D-231 contract and the F-DG6-520/580 expectation also apply: "an edit that leaves the shown marker in place must go on testing the hidden record S, or the save must be refused".

**Read.** Every hidden literal is shown as `[restricted:<row version>:<k>]`. `k` is unchanged from D-228 (1).

**Write.** `updateAutomationRuleVersion` checks If-Match first (409). Then it treats each token as follows:
- **A token of the version being replaced:** resolved as before, wherever the condition now sits.
- **A token of any other version** (earlier, later, forged): **422 `automation_rule.restricted_token_stale`**, with a pointer to the value and the detail "…The rule changed since it was read: reload the version and re-apply your change." It is never resolved against another version's positions, and nothing is stored.
- **Unknown position, bare `[restricted]`, the retired unbound `[restricted:k]`, case or space variants, an unclosed token:** 422 `automation_rule.restricted_marker_unknown`, as before.
- **Any token on create:** still unknown.

Cases on the real API (`automation-restricted-tokens-z14.test.ts`):

| Case | What the test does | Result |
|---|---|---|
| read | — | `[P, [restricted:v:2], sev]`, marked; no hidden id in the version or the rule list |
| (a) one hidden literal | `[neq P, neq S, neq Q]`. Save 1 removes condition 1, which stores `[S, Q]`. Save 2 sends the same draft with the new If-Match. | Save 2 → **422 stale** at `/content/conditions/0/value`. Stored unchanged, and no marker text is stored. Reload and save → 200, still `[S, Q]`. |
| (b) two hidden literals | `[P, S1, S2, sev]`, then the same double save | Save 2 → **422 stale**, `[S1, S2, sev]` kept. A current token mixed with a stale one → 422 at the stale one (`/1/value`). A stale token in an `in` list → 422 at `/0/value/1`. Swapping the two current tokens stores `[S2, S1, sev]` exactly. |
| (c) re-save after 409 | A second tab removes condition 1. The first tab's save → 409. The same draft re-sent with the refreshed If-Match. | **422 stale**, stored unchanged. Reload and re-apply the severity edit → S kept and severity changed. |
| (d) other versions | Tokens naming version v−1, v+1 and 999999 while S sits at the same position | each **422 stale**. A current-version token at a position with no literal → `restricted_marker_unknown`. |

Authorization for this mutation (a configure-less writer gets 403 before any token is resolved) is still covered by z13's negative test, which passes (11/11).

### 3.2 Editor (F-DG6-580, `RulePage.tsx`)

`rule-editor-tokens-z14.test.tsx` covers each case in en and in ar:
- **After a successful save,** the form reloads from the saved response. The second PATCH sends If-Match `"3"` and `[restricted:3:1]`, never `[restricted:2:2]`.
- **After a 409,** the form reloads the current version (`GET …/versions/1`) and shows the bilingual alert:
  - en: "This rule changed after you opened it. The form now shows the current version: re-apply your change, then save the draft again."
  - ar: "تغيّرت هذه القاعدة بعد أن فتحتها. يعرض النموذج الآن الإصدار الحالي: أعد تطبيق تعديلك، ثم احفظ المسودة مرة أخرى."

  The next PATCH carries the current version's If-Match and tokens, with no stale token. The alert clears on the next save.
- **After a stale-token 422:** the same reload and alert.
- **Control:** another 422 (`condition_invalid`) keeps the author's draft and shows its problem text, without the alert.

### 3.3 Digest read (CS observation 600)

The binding requirement rows are REQ-S10-002 (above) and REQ-S12-025. REQ-S12-025's acceptance text: "A09: a non-urgent reminder due in quiet hours is delivered in the next digest; an urgent escalation is delivered immediately". That behaviour is unchanged: the contract and notification-delivery suites pass.

**What the digest read now returns** (`digest-restricted-z14.test.ts`, the CS-R9 setup: quiet hours, a real producer task, TO marks the benefit sensitive, the real worker digest job). For a restricted notification, `GET /me/notification-digests/{id}` returns:

```
{notificationId, messageKey: "inbox.restricted", messageParams: {}, linkPath: "/transformations/<T>", createdAt, includesRestrictedRecords: true}
```

- No hidden id (benefit, Finance validation, children) and no benefit code appears anywhere in the body.
- The stored row is unchanged.
- **Another user's digest:** 404, and the body names nothing.
- **After an explicit grant:** the same read returns the original key, params and link, with no marker.
- The response is validated against the OpenAPI contract (`call` without `contract: false`).

**Serializer sweep.** Every API response that serializes a notification:

| Operation | Serializer | Redaction |
|---|---|---|
| `listMyInbox` | `tasks/routes.ts` `notificationFor` | `restrictedNotifications` + `restrictedNotificationView` (BE-Z13, now through the shared view) |
| `markInboxNotificationRead` | `tasks/routes.ts` `notificationFor` | same |
| `getMyNotificationDigest` | `tasks/digests.ts` | **new in BE-Z14**: same decision and view |

Touches notifications but serializes no notification text:

| Where | Why it is not a serializer |
|---|---|
| `resolveDeepLink` (`tasks/deep-links.ts`) | Refuses 403 `deep_link.forbidden` by the same decision. For an unrestricted notification it returns only the link. |
| `tasks/service.ts` | Writes notifications only. |
| `tasks/channels/port.ts` | The port interface. Channel text is rendered by the worker under its twin decision, D-227 (2). |
| `listNotificationDeliveries` (`admin/notification-channels.ts`) | Delivery metadata: ids, status, attempts. No text. |
| Work items (`listMyWorkItems`, `getMyWork`, …) | Use `workItemFor` and part B of 2026-11-08. They are not notifications. |

**Guard** (`notification-serializers.test.ts`) has three checks:
1. **Source sweep.** Any API module that reads `inbox_notification` (query builder or raw SQL) or builds an `InboxNotification`, `NotificationDigest` or `NotificationDigestItem` must call `restrictedNotifications(` and `restrictedNotificationView(`. The only way out is the explicit, reasoned exception list, and every listed exception must still match.
2. **Contract sweep.** The OpenAPI operations whose responses reach a notification schema are exactly `getMyNotificationDigest`, `listMyInbox` and `markInboxNotificationRead`, so a new operation fails until it is reviewed.
3. **The redacted shape.**

**Web.** The digest view (`NotificationDigestPage`) shows the item-scoped restricted label on a redacted item, in en and ar (`digest-restricted-z14.test.tsx`).

## 4. Before-fix and after-fix logs (every new test)

All under `docs/delivery/handbacks/DG6/T-DG6-BE-Z14-evidence/`.

**How the before-fix runs were made.** The fixed source files were copied to the run's scratchpad. The HEAD version was written back with `git show HEAD:<file>`, the tests were run, and the fixed files were restored. `git diff --stat` was checked after each restore. No stash was used.

| Test | Before fix (expected to fail) | After fix |
|---|---|---|
| `automation-restricted-tokens-z14` (API) + CS probe `zz-cs-r9-token-stale` (copied temporarily into `tests/qa/integration/`, then removed) | `10-before-fix-tokens-api.log`: exit 1, **8 failed**, 1 passed. CS T1–T3 fail exactly as in CS log 43: S swapped for Q or "high". All 5 z14 tests fail. CS T4 (controls) passes. | `11-after-fix-tokens-api.log`: z14 **5/5**, z13 **11/11**, z12b **7/7**, CS **T1–T3 pass**. CS **T4 fails**, exit 1. The cause is that T4 hard-codes the retired format `expect(tok).toBe("[restricted:2]")`, and the server now issues `[restricted:1:2]`. This is the intended format change, not a defect. T4's other controls are covered by z13 and z14. |
| `rule-editor-tokens-z14` (web) | `20-before-fix-editor-unit.log`: exit 1, **6 failed**, 1 passed. The passing test is the control "another 422 keeps the draft", which is meant to pass both ways. | `21-after-fix-editor-unit.log`: exit 0, 7/7, plus `fed.test.tsx` 28/28. |
| `digest-restricted-z14` (API) | `31-before-fix-digest-api.log`: exit 1. The redaction test **fails**. The control (404 on the benefit), the negative (another user's digest) and the positive (after a grant) pass, as they are meant to both ways. | 4/4 inside `40-after-fix-integration-lang-unset.log` |
| `notification-serializers` (guard), with only `digests.ts` at HEAD | `30-before-fix-serializer-guard.log`: exit 1. The sweep **fails**: "notification serializers without the D-226 redaction" lists `modules/tasks/digests.ts`. The contract sweep and the shape check pass. | `34-after-fix-serializer-guard.log`: exit 0, 3/3 |
| `digest-restricted-z14` (web view) | `32-before-fix-digest-view-unit.log`: exit 1, 2 failed | `33-after-fix-digest-view-unit.log`: exit 0, 2/2 |

## 5. Checks (real exit codes)

- **Environment:** Node 24.21.0, offline. Ports 31350–31399 only.
- Empty `.claude/.cc-writes` directories were checked for before each test run, and none were found.

Logs are in `T-DG6-BE-Z14-evidence/`. "Final" means the final tree, after every source change.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start and final) | 0 / 0 | `PASS gate DG5 (historical)` | `00-…`, `85-final-…` |
| 2 | `pnpm -r typecheck` (final) | 0 | all packages done | `80-final-typecheck.log` (also `51-…`) |
| 3 | `pnpm -r build` (final) | 0 | all packages built | `81-final-build.log` (also `53-…`) |
| 4 | `pnpm lint` (final) | 0 | `eslint . --max-warnings=0`, clean | `82-final-lint.log` (also `50-…`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final) | 0 | "All matched files use Prettier code style!" | `84-final-prettier-check.log` (also `54-…`) |
| 6 | `pnpm openapi:lint` (final) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `83-final-openapi-lint.log` (also `52-…`) |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | unit-node 191 files, **2902 passed**; unit-web 125 files, **2103 passed**; unit-formula-nocodegen 3 files, **259 passed, 2 skipped** | `70-unit-lang-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2902 / 2103 / 259 + 2 skipped | `71-unit-c-utf8.log` |
| 9 | `QA_PG_PORT=31352 MTH_PORT_POOL=31350-31399 tests/qa/support/with-pg.sh npx vitest run --project integration <files>`, locale unset; the file list is below | 0 | **41 files, 384 tests passed** (312.7 s) | `40-after-fix-integration-lang-unset.log`, `40-after-fix-integration.files` |
| 10 | `E2E_PG_PORT=31360 E2E_API_PORT=31365 MTH_PORT_POOL=31366-31399 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --reporter=list --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker) | 0 | **4 passed** (4.0 min): a13 en 9.1 s, ar 7.3 s; a22 en 1.8 min, ar 1.8 min | `60-e2e-a22-a13.log` |
| 11 | Before-fix and after-fix runs | as in §4 | as in §4 | `10-…` to `34-…` |

The integration files of check 9:
- `access/automation-restricted-tokens-z14`, `-z13` and `sensitive-reference-pending-z12b`;
- `apps/api/test/integration/tasks/*` (9 files, including `digest-restricted-z14`, `inbox-restricted-z13`, `deep-links`, `notification-delivery`, `channel-fanout*`);
- `apps/api/test/integration/automation/*` (13 files, including `automation-failures`, the API side of automation recovery);
- `apps/api/test/integration/jobs/*` (`job-operations`, `job-schedules`, `worker-parity`);
- `apps/api/test/integration/operations/*` (`exceptions`, `exception-last-known-value`, `concurrent-exception-recurrence`, and `exception-recurrence-race`, the BE-Z6 race test);
- `contract/contract.test.ts` (105 tests);
- worker: `automation-failure-queue`, `worker-attempt`, `job-runs`, `outbox`, `restart`, `operations-freshness`, `connector-failure-exception`.

Disclosures:
- **CS-R9 T4:** the one non-zero after-fix exit (`11-after-fix-tokens-api.log`, exit 1) is reviewer probe T4. It hard-codes the retired token text (§4). It is not a candidate test, and it was removed from the tree after the run.
- **Formatting during check 9:** prettier `--write` reformatted 7 of the changed files while check 9 was running. The change was formatting only, and checks 2–8 ran on the final formatted tree.
- **Edits after check 9:** after check 9 two changes were made:
  - the web digest-view label;
  - an ADR sentence.

  Neither is in an integration file. Checks 2–8 and the unit tests in §4 cover them.
- **Console output:** the unit logs contain "The above error occurred in the `<RaciGrid>` / `<TotalsView>` component". This is React console output from existing error-boundary tests, which pass, and is not from files this task touched.
- **Flaky tests:** none observed. No test was retried.
- **End:** finished at 06:58 UTC (about 49 minutes).

## 6. Operations routed (delta to the pending list)

**None.** No new operation. `getMyNotificationDigest` and `updateAutomationRuleVersion` already exist and are exercised: `contract.test.ts` passes 105/105 in the integration run. Delta to my `p6-pending-*.ts` lists: **none added, none removed**.

## 7. For the orchestrator: contract, schema and dependency

**New problem code:** 422 `automation_rule.restricted_token_stale` on `updateAutomationRuleVersion`.
- en/ar text is in `problems.json`, and the code is named in the OpenAPI summary and the condition-value description.
- On `createAutomationRule` any token is still `restricted_marker_unknown`, because no stored version exists.

**New optional response field:** `NotificationDigestItem.includesRestrictedRecords` (`const: true`), in the zod mirror and in OpenAPI.

**Changed token text:**
- **Wire format:** `[restricted:k]` → `[restricted:<version>:<k>]`.
- **Effect on clients:** a client holding an old-format token gets 422 `restricted_marker_unknown`.
- **Persistence:** tokens are never stored, so no data migration is needed.

**Other:** no migration, no dependency, no configuration variable. The OpenAPI version string is unchanged (the operation count stays 932).

**Reviewer probes:** CS probe `zz-cs-r9-token-stale.test.ts` T4 and the domain probe `dom-r9-token-resave.test.ts.txt` assert the old token text. On re-run they need their token literals moved to the version-bound form. Their behaviour assertions hold.

## 8. User-facing texts

- **New texts (en and ar):**
  - `workflowsP5.rules.changedReapply`;
  - `problems.automation_rule__restricted_token_stale`.
- **Existing texts, checked:**
  - `problems.automation_rule__restricted_marker_unknown`: "…Reload the version and keep each restricted value as shown, or remove it." Still true.
  - `myWork.message.inbox__restricted`: now also shown in the digest view. True there.
  - `access.includesRestrictedRecords` and `adminP6.restricted.hintItem`: true on a digest item.
- **Planned/later strings:** no existing en/ar string calls these features planned or later, so none was made untrue.

## 9. What remains

- **Nothing from the assignment is left undone.**
- **Review:** F-DG6-580 and observations 600/601 need independent verification by a reviewer in round 10. The author does not close them.
- **Not run:** the full `pnpm test:integration`. The assignment says it is not required, and the orchestrator runs it on the merged tree. Only the 41 files in check 9 were run.
- **Ownership:** the web changes (`RulePage.tsx`, `ui.tsx`, `NotificationPreferencesPage.tsx`) are in frontend-ux-engineer's files. The assignment assigns the editor part to this task, and the domain finding allowed for that. The digest label was added for parity with the inbox marker (D-226 "the marker"). Please confirm ownership at merge.
- **Arabic texts:** the Arabic for the two new strings is provisional. The Arabic `problems.json` texts are marked provisional elsewhere in the repository too.

## 10. Merge instructions

- Apply as one change set. There is no migration.
- If another branch edits `NotificationPreferencesPage.tsx`, `RulePage.tsx` or `ui.tsx` (frontend-ux-engineer's files), expect small textual conflicts there:
  - `Runner.run` gains an optional `onError`;
  - `EditContent` form state.
- The token tests in z12b, z13 and `fed.test.tsx` depend on the new token format, so merge them together with `packages/shared/src/schemas/automation.ts`.
