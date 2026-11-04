# Handback T-DG6-FE-Z2 (frontend-ux-engineer): DG6 round-3 repair of F-DG6-222, F-DG6-221 and F-DG6-261

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-Z2-frontend-ux-engineer-20261104T193554Z-a4ced236","session_id":"a4ced236-7bf5-4c3e-a065-60d3934cadd2"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-Z2.md` (sha256 `6bff6191…252e7818`, verified).
- **Base:** branch `dg6/fe-z2` at `458402f81` ("DG6 merge T-DG6-BE-Z4"). The changes are **uncommitted**, as asked.
- **Time:** started 2026-11-04 19:36:12 UTC; finished 20:41:42 UTC (`99-end-time.log`). Well within the 2-hour limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (evidence `00-validate-historical-DG5.log`). Run before any change.
- **Scope:** web only. No API, schema, migration, OpenAPI or dependency change.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/lib/problem.ts` | Adds `SECRET_REF_FIELD_CODES`, `placeFieldErrors` and `unplacedMessages`. `placeFieldErrors` places a 400 `validation` answer's field errors on a form's fields and returns the ones no field takes; `unplacedMessages` gives the translated texts of those, each once. |
| `apps/web/src/components/UnplacedFieldErrors.tsx` (new) | `FormProblemAlert`: a form's one alert (S-7). It shows the problem's text plus the texts of any field errors the form has no field for, so the form never says "check the highlighted fields" with nothing highlighted. |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | en and ar texts for `validation.secret_ref_not_bound`, `validation.secret_ref_host_not_bound` and `validation.secret_ref_namespace`. |
| `apps/web/src/i18n/provisional-ar-p6.ts` | Registers the three Arabic texts as provisional, under a new source `fe-z2`. |
| `apps/web/src/pages/integrations/ConnectorFormPage.tsx` | `connectorFieldOf`: `/config/credentialRefs/<purpose>[/…]` → that credential row's secret-name field. The row gets `data-credential-row` and `data-invalid`. Other `/config/*` fields and the top-level fields map only while the form shows them; anything else goes to the alert. |
| `apps/web/src/pages/integrations/WebhooksPage.tsx` | `webhookFieldOf`: `/signingSecretRef[/…]` → the secret-name field, on both the create and the rotate form. Also maps `/connectorId`, `/label`, `/toleranceSeconds`, `/graceHours` and `/reason`. |
| `apps/web/src/pages/admin/security/shared.tsx` | `SecretRefFields` takes an optional `errorCode`: it shows that code's translated text (otherwise the generic text), sets `data-error-code`, and links both inputs to the error with `aria-describedby`. |
| `apps/web/src/pages/admin/storage/StoragePage.tsx` | `storageFieldOf`: `/s3/<field>` and `/candidate/<field>` (save and test). Server field errors come from `runner.error` at render time and mark the S3 text fields and both key references with the code's text. |
| `apps/web/src/pages/admin/notification-channels/NotificationChannelsPages.tsx` | `smtpFieldOf`: `/smtp/usernameRef`, `/smtp/passwordRef` and `/smtp/host` (plus port and sender). Same render-time placement as Storage. |
| `apps/web/src/pages/admin/assistant/AssistantSettingsPage.tsx` | Uses `placeFieldErrors` with its existing pointer table (`/credentialRef` → credential name, `/endpointUrl` → endpoint). An unplaced field error now reaches the alert instead of being dropped. |
| `apps/web/src/pages/admin/operations/OperationsPages.tsx` | F-DG6-221: `exceptionErrorText` and `ExceptionErrorText`. "Last error" shows `integrations.actionable.<code>.why` (the Connectors page's lookup), then `problems.<code>`, and otherwise the code itself as an LTR `<bdi>`. It never shows `lastErrorMessage`. |
| `apps/web/src/pages/reports/ReportsPage.tsx`, `apps/web/src/i18n/{en,ar}/reportsP5.json` | F-DG6-261 product fix: the snapshot-list filter is now labelled "Filter by output" / "التصفية حسب المخرَج" (new key `reportsP5.snapshots.filterOutput`). Only the Generate form's required select is named "Output", so screen-reader users no longer meet two controls with the same name. |
| `e2e/a02-demo-users-walkthrough.spec.ts` | F-DG6-261: step 10 is scoped to `form[data-form='generate-report']` with a strict locator (no `.first()`). It waits for the `charter` option, selects it, asserts the value and that "Generate snapshot" is enabled, then clicks. No assertion was removed or weakened. |
| `e2e/a17-failing-connector-exception.spec.ts` | F-DG6-221 e2e: on the exception page, "Last error" equals the catalogue text of the exception's `lastErrorCode` in the page language. In ar it is not the server's English message. |
| `e2e/a15-reporting.spec.ts` | Comment only: the snapshot list's select is now "Filter by output". |
| `apps/web/e2e/p6-secret-ref-unbound.spec.ts` (new) | F-DG6-222 e2e on the real API (en and ar, axe and screenshots). The connector form marks the unbound credential row. The Storage "Test these values" step marks both unbound key references. Budget 90 s, measured (see §3). |
| `apps/web/src/pages/integrations/integrations.test.tsx` | Unit tests (en and ar). Connector form: the named row is marked with the localized reason, and a host error the form has no field for is said in the alert. Webhook rotation: the signing-secret name is marked. |
| `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx` | Unit tests (en and ar): Operations "Last error" (catalogue text, code fallback, lookup order); the pointer mappers; `placeFieldErrors` and `unplacedMessages`; Storage and SMTP marking. |
| `apps/web/src/components/assistant/assistant.test.tsx` | Unit test (en and ar): the assistant credential name is marked with the localized reason. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Z2-*` | This handback and its evidence. |

## 2. Behaviour delivered, per requirement

### F-DG6-222 (Medium): REQ-S15-011

Acceptance text: *"A14;A20: component tests render each of the six states; a draft is labelled 'Draft - not submitted' and never counted in approved totals"*. The finding is about the error state being handled explicitly.

- **Connector form.** When the API answers `400 validation` with `validation.secret_ref_not_bound` at `/config/credentialRefs/api`:
  - the "api" credential row is marked (`data-invalid="true"`);
  - its secret-name input gets `aria-invalid="true"` and is described by the reason;
  - the reason shows in the page language. en: "IT has not bound this secret to this setting. Name a secret IT bound to it, or ask IT to bind this one: IT binds each secret to one kind of setting and one organization." ar: "لم يربط فريق تقنية المعلومات هذا السر بهذا الإعداد. …".
  - The banner's "Check the highlighted fields" is now true: exactly one field is marked.
  - A field error the form shows no field for is said inside the same single alert. Example: `validation.secret_ref_host_not_bound` at `/config/endpointUrl` on a test-adapter connector, which has no endpoint field.
  - The server's English message and the raw code are never shown.
- **The same on every other form that edits a SecretRef:**
  - Webhook create and rotate: `/signingSecretRef`.
  - SMTP: `/smtp/usernameRef`, `/smtp/passwordRef` and the host error at `/smtp/host`.
  - Storage save and test: `/s3/…` and `/candidate/…`, the key references and the host error at `…/endpoint`.
  - Assistant: `/credentialRef` and `/endpointUrl`.
- **Every pointer the API uses for these codes** (ADR-0052 amendment §C table) maps to a field each form shows. The one exception is the connector host pointer on a non-HTTP adapter, which goes to the alert.
- **Catalogue texts** exist in en and ar for all three SecretRef codes, `validation.secret_ref_namespace` included (the reviewer suggested it). The Arabic is provisional and is registered in `provisional-ar-p6.ts` as `fe-z2`.

### F-DG6-221 (Low): REQ-S15-007

Acceptance text: *"A20;A15: a test finds no missing ar or en key; a validation error returned by the API is shown in the selected language; an Arabic export keeps 'KPI-001' and '12.5%' readable"*.

- On the operational exception page, "Last error" is the catalogue text of `lastErrorCode` in the page language. It uses `integrations.actionable.<code>.why` (the Connectors page's text), then `problems.<code>`, and otherwise the code itself (LTR). It never shows `lastErrorMessage`.
- Verified in ar on the real stack: the a17 screenshot reads "آخر خطأ: لم يستجب نظام المصدر.".
- Tested in both locales: unit tests plus the a17 e2e assertion.

### F-DG6-261 (Low): REQ-DLV-038

Acceptance text: *"A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029"*.

- **Spec:** step 10 now waits for the Generate form's own select and its `charter` option, scoped and strict, before it selects. Every earlier assertion is kept, and three were added: the selected value, the enabled Generate button, and the strict locator.
- **Product:** the label was ambiguous for screen-reader users too, so the filter was renamed in both languages (see §1).
- **QA's deterministic reproduction**, replayed with the new step 10 and with the *old* `.first()` locator against the renamed label: with `GET /report-definitions` held back 0, 4 and 8 s, in en and ar, "charter" always lands in the Generate select, the filter stays empty, Generate is enabled, and exactly one control carries the name "Output" (`32-probe-output-label-late-definitions.log`). The probe was a temporary `e2e/zz-*` file, removed after the run; its source is kept as `probe-zz-fez2-output-label.spec.ts.txt`.
- **Repeated runs:** 5 runs per locale, **10 passed, 0 failed** (`40b-…`). An earlier attempt had one failure that I caused; see §3.

## 3. Checks actually run

Environment: Node 24.21.0, offline, the 4-core sandbox. Harness ports were 28951–28999 only. Logs are in `docs/delivery/handbacks/DG6/T-DG6-FE-Z2-evidence/`.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | `PASS gate DG5 (historical)`, exit 0 | `00-validate-historical-DG5.log` |
| 1 | `pnpm -r typecheck` (final tree) | exit 0 | `11-typecheck.log` |
| 2 | `pnpm -r build` (final tree) | exit 0 | `10-build.log` |
| 3 | `pnpm lint` (final tree) | exit 0 | `12-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (re-run after this handback was written) | `13-prettier.log` |
| 5 | `pnpm openapi:lint` | exit 0 | `14-openapi-lint.log` |
| 6 | `pnpm test`, LANG/LC_ALL/LC_CTYPE unset | exit 0. unit-node **2899 passed** (190 files); unit-web **2039 passed** (120 files); unit-formula-nocodegen **259 passed, 2 skipped** (3 files) | `20-pnpm-test-locale-unset.log` |
| 7 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | exit 0. 2899 passed; 2039 passed; 259 passed, 2 skipped | `21-pnpm-test-c-utf8.log` |
| 8 | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-secret-ref-unbound.spec.ts --workers=1` (both projects) | exit 0, **4 passed** (en and ar: connector 4.3 s / 4.3 s, storage 3.6 s / 3.7 s) | `30-e2e-secret-ref-run1.log` |
| 9 | `with-stack.sh` with `p6-secret-ref-unbound`, `p6-integrations-imports`, `p6-admin-screens`, `p5-reports-exports`, `p5-snapshot-page` (apps/web/e2e) and `e2e/a17-failing-connector-exception`, `e2e/a15-reporting`, `e2e/a07-historical-integrity`, chromium-en and chromium-ar | exit 0, **54 passed, 0 failed, 0 flaky** (5.3 min) | `31-e2e-touched-product-specs.log` |
| 10 | Late-definitions probe (temporary `e2e/zz-fez2-output-label-probe.spec.ts`, `with-stack.sh`, en and ar) | exit 0, 2 passed; the results are quoted in §2 | `32-probe-output-label-late-definitions.log` |
| 11a | `e2e/support/with-demo-stack.sh npx playwright test e2e/a02-demo-users-walkthrough.spec.ts --repeat-each=5 --workers=1` | **exit 1: 9 passed, 1 failed (en repeat 1). Caused by me, not by the spec;** explained below | `40a-e2e-a02-repeat5-interfered.log` |
| 11b | The same, isolated, with `--output="$TMPDIR/pw-a02-out"` | exit 0, **10 passed, 0 failed** (en 5/5, ar 5/5; 52–59 s each; load average 8.7 at the end, with run 6–7 running at the same time) | `40b-e2e-a02-repeat5-isolated.log` |

**Explanation of 11a.** The failed attempt (en, repeat 1) passed all twelve walkthrough steps, including step 10. It then failed at `p.context().close()` (spec line 663) with `ENOENT … test-results/.playwright-artifacts-1/traces/…`.

At that moment I had started the probe of row 10 in parallel, using the same default Playwright output directory `test-results/`. Playwright clears that directory when a run starts, so the probe removed the a02 run's trace files mid-test.

This interference was mine. It is not a product defect and not the F-DG6-261 race. Run 11b repeated the whole 5×2 set with its own output directory and nothing else using Playwright: 10 of 10 passed.

**e2e budgets.**
- `p6-secret-ref-unbound.spec.ts`: 90 s per test. The slowest measured run was 4.3 s (rows 8 and 9, en and ar); the measurement is stated in the spec header.
- a02 keeps its existing 300 s budget. Its runs took 52–59 s.
- The new wait in step 10 (`toHaveCount(1, { timeout: 30_000 })` on the charter option) covers a definitions answer held back 8 s (row 10).

**Interaction checks run** (Playwright, real API, en and ar):
- Connector: open Edit, add a credential row, fill purpose, provider, secret name and reason, then Save.
  - The response is a 400 with exactly the expected field error.
  - One alert, and exactly one `.field--invalid`.
  - The row's secret-name input is `aria-invalid` and its accessible description is the localized reason.
  - It can be reached by keyboard focus.
  - axe is run; no raw code and no server English on the page.
- Storage: choose S3, fill the fields, press "Test these values". The response is a 400 with two field errors, and both reference boxes are marked with the localized reason and an accessible description.
- a17: "Last error" equals the catalogue text, and in ar it differs from the server English.
- a02 step 10: as above.

**Screenshots** (`docs/delivery/handbacks/DG6/T-DG6-FE-Z2-evidence/screenshots/`):
- `en/p6-connector-unbound-secret.png`, `ar/p6-connector-unbound-secret.png`
- `en/p6-storage-unbound-secret.png`, `ar/p6-storage-unbound-secret.png`
- `en/a17-exception-data-owner.png`, `ar/a17-exception-data-owner.png`

## 4. Operations routed (pending-list delta)

None. This task changes no API operation, so no `apps/api/test/support/p6-pending-*.ts` or `p6-exercises-*.ts` file was touched.

## 5. Contract, schema or dependency needs (for the orchestrator)

- No OpenAPI, zod, schema, migration or dependency change. No migration id was taken.
- **Suggestion, not done (out of my files):** `problems-all.test.ts` collects field-error codes from string literals only. It missed these three because the API emits them through constants (`SECRET_REF_NOT_BOUND_CODE` and the others in `packages/config/src/secret-bindings.ts` and `platform/secrets.ts`). The three codes now have en/ar texts, and my tests require them (`SECRET_REF_FIELD_CODES` in `p6-admin-screens.test.tsx`). The test's owner may want it to read those constants as well.

## 6. User-facing texts made untrue, and what I did

- The snapshot list's filter was labelled "Output", the same as the Generate form's required select. It is now "Filter by output" / "التصفية حسب المخرَج" in both languages. No other en/ar string said these errors were planned or unavailable.
- `e2e/a15-reporting.spec.ts` had a comment naming the old label. I corrected it.
- The new Arabic texts are provisional, labelled in `provisional-ar-p6.ts`, and await a Mobily language review.

## 7. What remains

- Nothing of the assignment remains.
- **Observation, not in my scope and not changed:** on the connector edit screen as `dev.admin`, the "Target transformation" select shows "Choose…". The admin's transformation list does not include the target transformation the probe's lead created; the stored value is kept and saving is unaffected. You can see it in `ar/p6-connector-unbound-secret.png`. It predates this task. I'm reporting it for the owner of `ConnectorFormPage` / `useAllTransformations` to decide.
- **Merge:** no ordering constraints. `ConnectorFormPage.tsx`, `WebhooksPage.tsx`, `StoragePage.tsx`, `NotificationChannelsPages.tsx`, `AssistantSettingsPage.tsx`, `shared.tsx` and `OperationsPages.tsx` may conflict textually with any concurrent edit to the same forms (D-004 says none runs at the same time).

No business, Finance or IT approval was granted. All data used is synthetic. Product gates G1–G6 are not involved, and nothing here implies DG7.
