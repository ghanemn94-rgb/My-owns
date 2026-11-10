# Handback T-DG6-FE-Z3 (frontend-ux-engineer): DG6 round-4 repair of F-DG6-320, F-DG6-301 and F-DG6-281

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-Z3-frontend-ux-engineer-20261105T084325Z-861f32a9","session_id":"861f32a9-aabe-49b0-95b1-c54f6d8529dc"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-Z3.md`. I verified sha256 `ae622048…74334292` before starting.
- **Base:** branch `dg6/fe-z3` at `920fe4029` ("DG6 merge T-DG6-BE-Z5"). The working tree was clean at the start. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 08:43:45 UTC (`date -u`, the first command). The end time is in `99-end-time.log`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. I ran it before any change and again for the log (`00-validate-historical-DG5.log`).
- **Scope:** web only, plus one new web e2e spec. There is no API, worker, schema, migration, OpenAPI or dependency change.

Evidence folder: `docs/delivery/handbacks/DG6/T-DG6-FE-Z3-evidence/` (below, `E/`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/i18n/problems-all.test.ts` | **The class test (item 3).** It now also collects (a) every `code: "…"` inside a `problems.validation( … )` call of `apps/api/src/modules/**` (`apiFieldErrorCodes`, a string-aware bracket match), and (b) every `errorCode` an operational exception is raised with: each `raiseOperationalException(` call in `apps/api/src/**` and each `raiseOperationalExceptionTwin(` call in `apps/worker/src/**` (`exceptionErrorCodes`). An `errorCode` is resolved from a string literal, from an exported code constant (`DATA_STALE_ERROR_CODE` → `kpi.stale`), or from one of three pinned derivations (`DERIVED_ERROR_CODES`). A raise it cannot resolve fails the test (`unresolved` must be `[]`). New cases: (1) the field-error codes join the en/ar completeness check; (2) no field-error code falls back to the generic `problems.validation__invalid` text through `fieldErrorMessage`; (3) every raise resolves, with known codes of each kind present; (4) the three derivations are pinned to their source lines, so a change there fails the test; (5) every exception code renders through the exception page's own `exceptionErrorText` as a non-empty en and ar text, with the Arabic in Arabic and different from the English. |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | 16 new en and ar texts. `kpi__stale` and `operations__heartbeat_missed` cover F-DG6-320. The 11 `smtp__*` texts are the "any other exception code the product raises" the test found (§2.1). `validation__commit_on_behalf_of`, `validation__credential_refs` and `validation__unknown_version` cover F-DG6-301. |
| `apps/web/src/i18n/provisional-ar-p6.ts` | A new source `fe-z3`. The 16 Arabic texts are listed as provisional, one key per line. |
| `apps/web/src/pages/integrations/ConnectorFormPage.tsx` | **F-DG6-281.** The stored target is `connector.config.targetTransformationId`. When it is not among the transformations the user can list, the required "Target transformation" select gets an extra option (`data-stored-target`), which is selected and **selectable** (not disabled). Its label is "A transformation you cannot view · `<id>`" / "تحوّل لا يمكنك عرضه · `<id>`", or "Saved target · `<id>`" while the list is still loading. A hint tells the user the target is kept on save unless they choose another, and `aria-describedby` links it to the select. No other read is made, so nothing more is disclosed. A save sends the stored id unchanged, which was already the case. |
| `apps/web/src/i18n/en/integrations.json`, `apps/web/src/i18n/ar/integrations.json` | `integrations.field.targetStored`, `targetUnreadable` and `targetStoredUnlistedHint` in en and ar. The existing `integrations.` entry in `pages/integrations/provisional-ar.ts` (`fe-c`) already marks this Arabic as provisional. |
| `apps/web/src/pages/integrations/integrations.test.tsx` | A new `describe.each(LOCALES)` block, "connector form: a target the administrator cannot view", with 3 tests per locale. (1) The target is shown as set, not "Choose…", in the page language. The hint describes the select, and the option is enabled. The user can choose nothing and then the stored target again, and the PUT carries `targetTransformationId` unchanged. No `GET /transformations/<id>` is made. (2) A listed target shows "code · name" with no extra option and no hint. (3) F-DG6-301 on the form: a 400 at `/config/commitOnBehalfOf` with `validation.commit_on_behalf_of` shows its own text, not the generic one, and never the server's English. |
| `apps/web/e2e/p6-connector-target-unlisted.spec.ts` (new) | F-DG6-281 e2e on the real API (with-stack.sh), en and ar. First it checks the precondition through the API: dev.admin's list lacks the transformation dev.lead created, and the direct read gives 403/404. The select then shows "A transformation you cannot view · id" with the hint as its accessible description. The user reselects by keyboard and saves. The PUT body keeps the target, the API answers 200, and a GET shows the same target with a new config version. Reopening the edit screen shows it again. The spec also checks that the transformation itself is never read, that there are no foreign requests, and that axe passes. It takes a screenshot in each language. The budget is 90 s, measured (§3). |

## 2. Behaviour delivered, per requirement row

### 2.1 REQ-S15-007 (F-DG6-320, F-DG6-301)

> Acceptance: "A20;A15: a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable"

- **"A test finds no missing ar or en key":** `problems-all.test.ts` now reaches the two code classes it could not see before:
  - **Field-error codes in `problems.validation([...])`:** 21 or more are collected; the test requires more than 15 and checks the three named codes.
  - **Operational-exception codes.** The scan resolves every raise call in the API and the worker, with 0 unresolved. These are the codes it finds:
    - `operations.heartbeat_missed`: a literal, `apps/api/src/modules/operations/heartbeat.ts`;
    - `kpi.stale`: the constant `DATA_STALE_ERROR_CODE`, `apps/worker/src/handlers/operations.ts`;
    - `automation.retries_exhausted`, `service_identity.missing` and `service_identity.out_of_scope`: `failureCodeOf(job.error)`, `apps/worker/src/kit.ts`;
    - the six `connector.*` codes: `p.errorCode` of the `connector.run_failed` event, `CONNECTOR_ERROR_CODES`;
    - the 11 `smtp.*` codes: the email adapter's result in `notifications.ts`, `EMAIL_ERROR_CODES`.
- **The 11 `smtp.*` codes were outside the finding's scope.** A notification-delivery exception (`sourceKind` `notification_delivery`) also showed its raw `smtp.*` code as "Last error", in both languages, and the finding did not name them. The assignment asks for "any other exception code the product raises", so they now have texts too.
- **Fail-before evidence:** I ran the test with the extension but without the new texts (`E/01-problems-all-before-texts.log`). It gives 3 failed and 7 passed:
  - "missing" lists the 3 `validation.*` codes, en and ar;
  - "fallback" lists the same 3 codes;
  - "Last error" lists 13 codes: `kpi.stale`, `operations.heartbeat_missed` and the 11 `smtp.*`.
- **After the texts:** `src/i18n/` gives 6 files and 62 tests passed (`E/02-i18n-after-texts.log`).
- **"A validation error returned by the API is shown in the selected language":** `validation.commit_on_behalf_of` now shows its own text on the connector form, in en and ar (the unit test above). `validation.credential_refs` and `validation.unknown_version` also have their own texts. The test checks that none of them falls back to the generic text.
- **On the screen.** In the touched-spec e2e run, a22-p6-operability opens a real `operations.heartbeat_missed` exception. The screenshot (`E/shots/{en,ar}/a22-p6-exception-resolved.png`) shows:
  - "Last error": "The background worker has sent no recent heartbeat, so scheduled jobs may not be running." in en, and "لم يُرسل العامل في الخلفية أي نبضة حديثة، لذا قد لا تكون المهام المجدولة قيد التشغيل." in ar;
  - "Error code" still shows the code, as a separate identifier.
- **Not touched:** the export part of this acceptance text, which is out of my scope.

### 2.2 REQ-S17-001 (F-DG6-281)

> Acceptance: "A17: a test connector run records last success, row counts, errors and retries, all visible in the UI"

The finding is about the stored *target*, which this row records ("connectors record their mappings and targets"). An administrator who cannot read the stored target transformation now sees that a target is set: "A transformation you cannot view · `<id>`", in en and ar. The option stays selectable, and a save keeps the stored value. What the administrator can read is not widened. The page shows only the id it already had, and the unit test and the e2e test both check that no read of the transformation is made. Evidence:

- `E/03-connector-form-unit.log`: the unit tests pass, 10 tests in the `connector form` blocks, en and ar.
- `E/04-connector-form-unit-without-fix.log`: with `ConnectorFormPage.tsx` at HEAD, the two "shows the stored target as set" tests fail (en and ar), so the test is not vacuous. I then restored the file.
- `E/10-e2e-connector-target-run1.log`: the e2e test passes, 2 of 2.
- Screenshots: `E/shots/{en,ar}/p6-connector-target-unlisted.png`.

## 3. Checks actually run

Node 24.21.0, offline. Harness ports were in 28950–28999 (`E2E_PG_PORT=28950`/`28970`, `E2E_API_PORT=28960`/`28980`, `MTH_PORT_POOL=28950-28999`). I removed empty `.claude/.cc-writes` folders before the tests.

| Command | Result | Evidence |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | `PASS gate DG5 (historical)`, **exit 0** | `E/00-validate-historical-DG5.log` |
| `pnpm -r typecheck` | **exit 0** | `E/20-typecheck.log` |
| `pnpm -r build` | **exit 0** | `E/24-build.log` |
| `pnpm lint` | **exit 0** (eslint, `--max-warnings=0`) | `E/21-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** ("All matched files use Prettier code style!") | `E/22-prettier.log` |
| `pnpm openapi:lint` | **exit 0** (OpenAPI 3.1.1, 932 operations) | `E/23-openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | see §3.1 | `E/30-pnpm-test-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | see §3.1 | `E/31-pnpm-test-c-utf8.log` |
| `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-connector-target-unlisted.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` | **2 passed**, exit 0: en 4.5 s, ar 4.3 s, load average 1.8 | `E/10-e2e-connector-target-run1.log` |
| `apps/web/e2e/support/with-stack.sh npx playwright test` on the 7 touched specs (list below), chromium-en and chromium-ar | **44 passed** (22 en, 22 ar), 0 failed, 0 flaky, exit 0, 4.0 min, load average 3.1–4.3 | `E/11-e2e-touched-product-specs.log` |
| `e2e/support/with-demo-stack.sh npx playwright test e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts --workers=1`, chromium-en and chromium-ar | **10 passed** (5 en, 5 ar), exit 0, 2.7 min | `E/12-e2e-a02-demo.log` |

The touched-spec run covered these 7 specs:

- `apps/web/e2e/p6-connector-target-unlisted.spec.ts`
- `p6-integrations-imports.spec.ts`
- `p6-secret-ref-unbound.spec.ts`
- `p6-admin-screens.spec.ts` (the operations screen)
- `e2e/a17-failing-connector-exception.spec.ts` (the exception page's "Last error" for a connector code)
- `e2e/a22-p6-operability.spec.ts` (a real heartbeat exception)
- `e2e/a22-operations-jobs.spec.ts`

**The new spec's budget:** 90 s per test. The measured times are 4.5 s (en) and 4.3 s (ar) running alone, and 3.8 s and 3.9 s inside the 44-test run. 90 s is 20 times the slowest measurement, and it allows for the 4–6x slow-down this host shows at a load average of about 18 (F-DG6-144). The measurements are written in the spec's header.

### 3.1 `pnpm test` counts

Each `pnpm test` runs three Vitest invocations: `unit-node`, `unit-web` and `unit-formula-nocodegen`.

| Run | `unit-node` | `unit-web` | `unit-formula-nocodegen` | Exit |
|---|---|---|---|---|
| Locale unset (`E/30-…`) | 190 files, **2899 passed** | 120 files, **2050 passed** | 3 files, **259 passed, 2 skipped** | **0** |
| `C.UTF-8` (`E/31-…`) | 190 files, **2899 passed** | 120 files, **2050 passed** | 3 files, **259 passed, 2 skipped** | **0** |

The 2 skipped tests are existing skips in `packages/shared/src/formula/fuzz.test.ts`. My change does not touch that file.

**A failure I caused and fixed, disclosed.** My first pair of `pnpm test` runs, kept in `E/superseded/`, each failed one test. The failure was in `unit-web`: `src/i18n/problems-p6.test.ts` › "labels every Arabic text of the P6 blocks provisional". I had registered the `smtp` texts as one prefix entry, `problems.smtp__`. That register accepts a prefix only for a nested object, and `problems.smtp__` is not one. I replaced it with the 11 keys, one per line, and `src/i18n/` passed again with 62 tests. I then re-ran both `pnpm test` invocations from scratch, and the counts above come from those re-runs. Before the fix, the other two invocations passed both times: `unit-node` 2899/2899 and `unit-formula-nocodegen` 259 passed, 2 skipped.

**Interaction checks I ran myself** (in the e2e above, en and ar):

- The select is reached and focused by keyboard (`focus` and `toBeFocused`).
- The user can choose nothing and then the stored target again.
- The hint is the select's accessible description.
- axe finds no serious or critical issue on the edit screen.
- The page makes no foreign requests.

I looked at all six screenshots. In Arabic the page is RTL, and the id stays readable LTR inside the option.

## 4. Operations routed (pending-list delta)

**None.** This is a web-only repair, so no `apps/api/test/support/p6-pending-*.ts` list changes and no `p6-exercises-*.ts` change is needed.

## 5. Contract, schema or dependency needs (for the orchestrator)

**None.** There is no OpenAPI, zod, migration or dependency change. The connector's API response carries only `targetTransformationId`, so the label shows the id rather than the code. Showing the code to a reader without `transformation.read` would need an API change that discloses it. The finding allows the id ("with its code or id"), so I did not ask for that change.

## 6. User-facing texts made untrue, and what I did

- **None made untrue.** The new texts describe what ships: the stale-data and heartbeat watches, the email adapter's codes, and the connector rules (`connectors.ts` messages).
- **Before this repair, the raw codes showed in the UI:**
  - `kpi.stale`, `operations.heartbeat_missed` and the `smtp.*` codes on the exception page's "Last error";
  - the generic "not valid" text for the 3 field-error codes.
  
  These are now catalogue texts.
- **The Arabic is provisional.** All 16 new Arabic problem texts are registered as provisional (`fe-z3`) and await a Mobily language review. The 3 new `integrations.field.*` texts are covered by the existing `fe-c` entry.

## 7. What remains, and notes for reviewers

- **Nothing in scope remains.**
- **`smtp.*` codes still show raw on two other screens.** The notification-channel **test result** and the **delivery list** in `NotificationChannelsPages.tsx` still show these codes as `<Code>`. Those are identifier columns ("Error code") on screens no finding names. Now that the codes have `problems.*` texts, a later change could show the text beside the code there. I did not change those screens because they are outside this assignment.
- **I did not edit `e2e/a22-p6-operability.spec.ts`.** It is QA-owned (p6-work-split §685, QA-D owns `e2e/**`), so it still does not *assert* the "Last error" text for the heartbeat exception, though the run's screenshot shows that text. The unit-level guarantee is `problems-all.test.ts`'s exception case, which renders through `exceptionErrorText` itself. QA may want to add a one-line `toHaveText(tr(lang, "problems.operations__heartbeat_missed"))` there.
- **The derivation map is a deliberate list.** `DERIVED_ERROR_CODES` covers the three non-literal `errorCode` expressions that exist today. A new raise with a new kind of expression fails the test as "unresolved" until someone maps it, which is the point.

## 8. Merge instructions

- There is no migration, and nothing to run.
- The files touched are web-only. Possible text conflicts:
  - `apps/web/src/i18n/{en,ar}/problems.json`: appended at the end;
  - `apps/web/src/i18n/{en,ar}/integrations.json`: 3 keys after `targetTransformation`;
  - `provisional-ar-p6.ts`: a new block after the `fe-z2` entries.
- The screenshots in `E/shots/` are the relevant six only. I deleted the others the touched-spec run produced.
