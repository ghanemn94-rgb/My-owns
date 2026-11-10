# T-DG6-FE-Z16 handback: frontend-ux-engineer

- **Task:** T-DG6-FE-Z16. A truthful message on a stale-token refusal (F-DG6-700, F-DG6-740; D-235).
- **Stage:** DG6 (P6), state FIXING after review round 11.
- **Invocation:** `DG6-T-DG6-FE-Z16-frontend-ux-engineer-20261109T223456Z-648f8410`, session `648f8410-8047-431f-a123-7383e1630f5a`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-Z16.md`. Its sha256 matched: `2f95f39b…7c23`.
- **Base:** worktree `/home/user/wt/dg6-fe-z16`, branch `dg6/fe-z16`, `HEAD` `0978f01e7d7ccc5512288e8a56f0fb1490a8d7df`. The tree was clean at the start.
- **Time:** started 2026-11-09T22:35:10Z, ended about 23:12Z (about 37 minutes).
- **Changes:** uncommitted, as the brief asks.

All data in tests and probes is synthetic. Nothing here grants a business approval (G1–G6), and nothing here concerns DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/automation/RulePage.tsx` | `EditContent` now handles a 409 and a 422 `automation_rule.restricted_token_stale` separately. **409:** unchanged; it shows the `workflowsP5.rules.changedReapply` banner. **Stale-token 422:** it shows the problem's own text in the form's one alert (`FormAlert`, `data-problem`, `role="alert"`), never `changedReapply`. Both paths still reload the current version (`GET` the version) into the form. The page-level runner alert is cleared, so the form has one alert (S-7). The form alert is cleared on the next submit. |
| `apps/web/src/i18n/en/problems.json` | `automation_rule__restricted_token_stale` is corrected so that its instruction is true in the editor flow (see §6). |
| `apps/web/src/i18n/ar/problems.json` | The same correction in Arabic. The Arabic stays provisional, as before. |
| `apps/web/src/pages/automation/rule-editor-tokens-z14.test.tsx` | Covers the stale-token 422 in en and ar for three tokens: one pasted from another version, one from another rule, and one in the retired pre-0127 form. Also asserts the corrected text, en and ar. The 409 case now also asserts that the stale-token text is not shown. The two old cases that asserted the untrue "changed" text for a 422 are replaced, and the header comment is updated. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Z16-evidence/**` | Logs, screenshots and the after-fix real-browser probe (`zz-fe-z16-stale-token.spec.ts.txt`). |

There is no API, schema, contract, migration or dependency change.

## 2. Behaviour delivered, per requirement row

### REQ-S15-011

Acceptance text: *"A14;A20: component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals"*. The row's procedure is *"each list and detail view renders a designed state for … error, stale, conflict …"*.

The rule editor now renders two distinct states:

- **Conflict (409):** "This rule changed after you opened it…". The form reloads the current version.
- **Error (422, stale token):** the problem's own en/ar text. The form reloads the version as it is stored, which is unchanged.

Before this fix the 422 was rendered as a conflict, which was untrue because If-Match had matched. The six-state and draft-label evidence of earlier tasks is untouched.

### REQ-S20-014

Acceptance text: *"A14: Conflicting updates show a recoverable conflict rather than silently overwriting accepted changes"*.

- **409:** still the recoverable conflict, with the "changed, re-apply" message and the reloaded current version. Asserted in the unit tests (en and ar) and on the real stack (probe step E, en and ar).
- **Stale-token 422:** it is not a conflict and is no longer presented as one. Nothing is stored; the probe checks the stored conditions before and after.

### The assignment's items

1. **422 `restricted_token_stale`: the problem text is shown, not `changedReapply`.** Done, in en and ar. The editor still reloads the current version so that the author can re-apply.
   - **Was the instruction true?** No; see §6. Corrected in both languages.
2. **409 keeps "changed, re-apply".** Done.
3. **Tests.** Done.
   - The unit tests cover each path in en and ar: a token pasted from another version, a token from another rule, a retired pre-0127 token, and a 409. Before-fix and after-fix logs are in §3.
   - The a13 e2e spec passes.
4. **No API, schema or contract change.** Confirmed.

## 3. Checks actually run (all from `/home/user/wt/dg6-fe-z16`, Node 24.21.0, offline)

The logs are under `docs/delivery/handbacks/DG6/T-DG6-FE-Z16-evidence/`.

| # | Command | Env | Exit | Result | Log |
|---|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (at start) | — | 0 | `PASS gate DG5 (historical)` | `00-validate-historical-DG5-start.log` |
| 1 | `npx vitest run src/pages/automation/rule-editor-tokens-z14.test.tsx` (in `apps/web`), **before the fix** (tests changed, source not) | — | 1 | 8 failed, 7 passed (15). All 8 new Z16 cases fail, en and ar: 3 token paths and the text-truth case. The strengthened 409 case passes, as expected, because 409 behaviour is unchanged (see #3). | `01-before-fix-web-unit.log` |
| 2 | Same file, **after the fix** | — | 0 | 15 passed (15) | `02-after-fix-web-unit.log` |
| 3 | Same file with `-t "409"`, on a **mutant** (`RulePage.tsx`: a 409 sets the form alert instead of the `changedReapply` banner), then restored (`cmp` shows it identical to the fixed file) | — | 1 | 2 failed (409 en, 409 ar), 13 skipped. This shows that the 409 test can fail. | `03-mutant-M1-409-shows-problem.log` |
| 4 | `pnpm -r build` | — | 0 | all packages built | `10-build.log` |
| 5 | `pnpm -r typecheck` | — | 0 | — | `11-typecheck.log` |
| 6 | `pnpm lint` | — | 0 | — | `12-lint.log` |
| 7 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | — | 0 | all files formatted | `13-prettier.log` |
| 8 | `pnpm openapi:lint` | — | 0 | — | `14-openapi-lint.log` |
| 9 | `e2e/support/with-demo-stack.sh npx playwright test e2e/zz-fe-z16-stale-token.spec.ts --workers=1` (after-fix probe; ports 31451/31452, pool 31453–31499) | locale unset | 0 | 2 passed (chromium-en, chromium-ar), 38.9 s. Step F: 422 stale, the form alert shows the problem text, no `rule-changed-reapply`, the form reloaded, stored conditions unchanged, re-apply and save gives 200, the alert clears. Step E: 409 with `changedReapply`, and no stale-token alert. axe passes on both. | `20-e2e-z16-probe-demo-unset.log` |
| 10 | `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a13-automation-recovery.spec.ts e2e/a22-p6-operability.spec.ts --workers=1` (real stack and the production worker) | locale unset | 0 | 4 passed: a13 en and ar, a22 en and ar (4.0 m) | `21-e2e-a13-a22-unset.log` |
| 11 | `pnpm test` | `LANG`/`LC_*` unset | 0 | unit-node: 191 files, 2902 passed. unit-web: 125 files, 2111 passed. unit-formula-nocodegen: 3 files, 259 passed, 2 skipped. | `30-pnpm-test-unset.log` |
| 12 | `pnpm test` | `LANG=LC_ALL=C.UTF-8` | 0 | the same counts | `31-pnpm-test-cutf8.log` |
| 13 | `tests/qa/support/with-pg.sh npx vitest run --project integration <12 files>` (QA_PG_PORT 31460, list below) | locale unset | 0 | 12 files, 99 passed | `40-integration-files.log` |
| 14 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/text-scan` (it reads `problems.json`) | locale unset | 0 | 4 files, 41 passed | `41-integration-text-scan.log` |
| 15 | `node tools/gates/validate.mjs --historical --stage DG5` (at end) | — | 0 | `PASS gate DG5 (historical)` | `50-validate-historical-DG5.log` |

**Notes on these runs:**

- **The 2 skipped tests (rows 11 and 12)** are in the pre-existing `packages/shared/src/formula/fuzz.test.ts` (`111 tests | 2 skipped`). They are unrelated to this change, and the same count appears under both locales.
- **The integration files in row 13:**
  - the worker job file: `apps/worker/test/integration/job-runs.test.ts`;
  - failure queue: `apps/worker/test/integration/automation-failure-queue.test.ts` and `apps/api/test/integration/automation/automation-failures.test.ts`;
  - automation recovery: `tests/qa/integration/a13-durable-automation.test.ts`;
  - operations: `apps/api/test/integration/jobs/job-operations.test.ts` and `tests/qa/integration/a22-p6-operability.test.ts`;
  - operational exceptions: `apps/api/test/integration/operations/{exceptions,exception-last-known-value,concurrent-exception-recurrence}.test.ts`;
  - the BE-Z6 race test: `apps/api/test/integration/operations/exception-recurrence-race.test.ts`;
  - the related API token suites: `apps/api/test/integration/access/automation-restricted-tokens-z14.test.ts` and `-z15.test.ts`.
- **Before the tests,** an empty `apps/web/.claude/.cc-writes` directory was found and removed, as the brief says.
- **Not run:**
  - the full `pnpm test:integration`: the brief says the orchestrator runs it;
  - the e2e specs under `C.UTF-8`: the brief asks for both *locales* (en and ar) on the real stack, and both ran. The unit suites ran under both locale settings.
- There were no flaky tests, retries or timeouts in the cited logs.
- **Before-fix real-browser reproduction:** QA round-11 runs `docs/delivery/test-evidence/DG6/qa/round-11/40-e2e-demo-unset.log` and `41-e2e-demo-cutf8.log` (step F), and domain round-11 `probe-editor-tokens.log` (part C). I did not rebuild the pre-fix web to re-run my adapted probe on it.

### Visual evidence: Playwright, real demo stack, after the fix

- **Stale-token 422** (the problem text in the form alert, no "changed" banner):
  - `screens/Z16-F-rule-editor-foreign-token-en.png` (LTR)
  - `screens/Z16-F-rule-editor-foreign-token-ar.png` (RTL)
- **409** (the "changed, re-apply" banner kept):
  - `screens/Z16-E-rule-editor-409-reapply-en.png`
  - `screens/Z16-E-rule-editor-409-reapply-ar.png`
- **Unchanged earlier steps of the probe:** `screens/{B,C,C2,D}-*-{en,ar}.png`.
- **a13 and a22 screenshots:** `e2e-shots/`.

### Interaction checks run in the browser (probe steps E and F, en and ar)

**Step F (stale-token 422):**

1. Click "Add a condition", type a token from another rule into Value 2, then click "Save the draft".
2. The response is 422 `restricted_token_stale`.
3. One `role="alert"` with `data-problem` appears inside the form, holding the corrected text.
4. `[data-state='rule-changed-reapply']` count is 0, and the `changedReapply` text count is 0.
5. The form reloads (Value 2 disappears and Value 1 is this version's own token), and the stored conditions are unchanged.
6. Click "Save the draft" again: 200, the foreign token is not sent, and the alert is gone.

`<html dir>` is rtl for ar, and axe reports 0 serious or critical issues.

**Step E (409):** the banner shows `changedReapply` with `role="alert"`, and there is no stale-token alert. Re-apply and save gives 200.

## 4. Operations routed (pending-list delta)

None. This is a web-only change: no operation was routed, and no `p6-pending-*.ts` or `p6-exercises-*.ts` file was touched.

## 5. Contract, schema or dependency needs (for the orchestrator)

None. Nothing needs a migration.

## 6. User-facing texts made untrue, and what I did

**1. `problems.automation_rule__restricted_token_stale` (en and ar): corrected.**

- Old text: "… (it comes from an earlier save, another version or another rule): reload the version and re-apply your change."
- In the editor flow this instruction is not true:
  - The editor already reloads the version itself.
  - "Re-apply your change", when the change was the pasted token, gives the same 422 again. Domain round 11 C5 showed exactly that loop.
- New en: "A condition value is a restricted-record token that was not issued for this version as it now stands (it comes from an earlier save, another version or another rule), so nothing was saved. The rule editor shows the version as it is stored now: re-apply your change using only the values shown for this version, and do not reuse a token copied from elsewhere."
- New ar: "قيمة أحد الشروط رمز سجل مقيد لم يصدر لهذا الإصدار بحالته الحالية (فهو من حفظ سابق أو من إصدار آخر أو من قاعدة أخرى)، لذلك لم يُحفظ أي شيء. يعرض محرر القواعد الإصدار بحالته المحفوظة الآن: أعد تطبيق تعديلك مستخدمًا القيم المعروضة لهذا الإصدار فقط، ولا تُعِد استخدام رمز منسوخ من مكان آخر."
  - The Arabic is provisional, like the text it replaces.
- The new text holds for all three UI paths:
  - **pasted from another version:** the probe shows that re-applying with this version's values saves;
  - **pasted from another rule:** the same;
  - **a pre-0127 token:** reloading issues a current token.
- **Caveat:** "the rule editor shows the version as it is stored now" assumes the reload `GET` succeeds. If that `GET` fails, the reload error is swallowed (unchanged from BE-Z14), and the form keeps the author's edits.

**2. The API's English `detail` still has the old instruction. Left as it is; the brief forbids API changes.**

- The text is in `apps/api/src/modules/automation/versions.ts` (`restrictedTokenStale`), and ADR-0051 amendment part A quotes it as the pinned English text (p6-work-split §2 rule 17).
- For a direct API client, "reload the version and re-apply your change" is accurate: the client must GET the version to obtain current tokens.
- The web translates by `code` and never shows the API `detail`, so the API text and the web catalogue wording now differ. No test pins them to each other: `text-scan` passes.
- **For the architect / orchestrator:** decide whether ADR-0051 should note the web's catalogue wording.

**3. Documents left for their owners (I did not edit them):**

- **ADR-0051, amendment of 2026-11-09, part B, third bullet.** It says the editor shows `changedReapply` after a 409 *or a 422 `restricted_token_stale`*. That is now untrue. Proposed correction: "After a 409 it reloads the current version and shows `workflowsP5.rules.changedReapply`. After a 422 `restricted_token_stale` (If-Match matched; the rule did not change) it reloads the version and shows the problem text `problems.automation_rule__restricted_token_stale` in the form's alert (T-DG6-FE-Z16, D-235)."
- **ADR-0051 part A** ("the editor asks the author to reload") stays broadly true.
- The comment in `packages/db/migrations/0127_p6_automation_restricted_token_key.sql` ("the editor asks the author to reload and re-apply") is in a merged migration, which must not be edited (rule 18). It is not user-facing.
- `workflowsP5.rules.changedReapply` is unchanged and is true for the 409 that now alone shows it.

## 7. What remains

- **Reviewer verification:** F-DG6-700 and F-DG6-740 stay OPEN until a non-author reviewer verifies them. The domain and QA probes cited above are ready to re-run.
- **ADR-0051 part B:** the text correction in §6.3 is for the ADR owner.
- **Orchestrator:** the full `pnpm test:integration` on the merged tree.
- **Merge:** no migration and no ordering constraints. The diff touches 4 files under `apps/web/src`. Expect conflicts only if another task edits `RulePage.tsx` `EditContent` or the same `problems.json` key.
