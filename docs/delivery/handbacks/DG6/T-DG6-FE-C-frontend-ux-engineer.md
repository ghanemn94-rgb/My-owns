# Handback T-DG6-FE-C (frontend-ux-engineer): slice B and A screens

- **Stage:** DG6 (BUILDING). **Task:** T-DG6-FE-C, p6-work-split §B/A.9 (the FE-C bullet).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-C-frontend-ux-engineer-20261030T160825Z-b2d6e9bc","session_id":"b2d6e9bc-11b4-4b8f-8fa3-8db7832fc474"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-FE-C.md`, sha256 `99e7b132870a0d3eb867e0b9dda14ce2fcb9a9ab7f49eb42134100a16fc2f8c1` (verified).
- **Base:** branch `dg6/fe-c`, HEAD `6a10be6a7080ce7657e1f697a7674d38315e0142`. The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-30T16:08:51Z`; end `2026-10-30T18:24:49Z`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0 at the start (`validate-dg5-start.log`). It was re-run at the end (§4).
- **Data:** all data is synthetic. Nothing here grants a business, Finance or IT approval. Nothing touches DG0–DG7, and nothing is called "live" or "connected to Mobily".

## 0. A dependency gap, disclosed

§B/A.9 orders FE-C after FE-A, which should have shipped the B/A shell: the route entries, the API client and query keys for the 34 operations, and the `nav`/`problems` B/A blocks. At this HEAD, FE-A had shipped only the E/F/J/C shell (`P6_PLANNED_ROUTES`, `api/p6.ts`). No B/A route, client entry or problem text existed.

FE-C therefore:

- wrote its own clients in `pages/integrations/api.ts` and `pages/imports/api.ts` (the `api/p6.ts` header convention), and never edited `api/**`;
- added the B/A route, nav and i18n entries itself. These are the shared files that the assignment says the orchestrator reconciles at merge.

If an FE-A B/A block arrives in parallel, expect overlap in `app/router.tsx`, `app/nav.ts`, `i18n/{en,ar}/{nav,problems}.json` and `i18n/index.ts` (§6).

## 1. Changed files

New:

| File | Purpose |
|---|---|
| `apps/web/src/pages/integrations/api.ts` | Contract types, paths, query keys and read hooks for the 21 connector, run, mapping, webhook and outbound operations; `outboundDisplayStatus` (requested/pending → "Pending confirmation"). |
| `apps/web/src/pages/integrations/ui.tsx` | `Count` (null → Unknown), `VerificationChip`, `LastSuccess` ("Never succeeded"), status and reconciliation chips, `ActionableErrorPanel` (which run, why, what to do, two fallback links), `SecretRefText`, `IntegrationsTabs` with the honest-status note, and `PagedTable` (cursor pager, page sort, column picker). |
| `apps/web/src/pages/integrations/ConnectorsPage.tsx` | Connector list (organization picker, status filter); connector detail (status, verification, last success, newest run, actionable error, configuration version, credential references with resolves/does not/Not checked, Test now, Run now with an Idempotency-Key, Edit, Enable/Disable with a reason, run history); run detail (Unknown counts, reconciliation, retry chain, Retry, status history). |
| `apps/web/src/pages/integrations/ConnectorFormPage.tsx` | Create and edit a connector: secret references only, test-adapter mode and confirm settings, target transformation, cadence, retries, commit mode, reconciliation rule, reason. If-Match on edit. One form-level alert. |
| `apps/web/src/pages/integrations/MappingsPage.tsx` | Mappings editor (source column → template target, each target once, reason, new configuration version, If-Match); read-only table for readers. |
| `apps/web/src/pages/integrations/WebhooksPage.tsx` | Webhook endpoints: list, create (secret reference, tolerance), detail (receive path, signature headers, current and previous reference, grace), rotate (If-Match), disable (final, reason). |
| `apps/web/src/pages/integrations/OutboundWritesPage.tsx` | Outbound writes: transformation entry, list (status filter) and detail (status history). "Check confirmation" (confirmOutboundWrite, If-Match) is for `outbound_write.execute` only; there is no manual confirmation. |
| `apps/web/src/pages/integrations/integrations.css` | Layout for these screens and the panel. Tokens and logical properties only. |
| `apps/web/src/pages/integrations/provisional-ar.ts` | The provisional-Arabic label of every B/A text, with its source (be-o, kbe-a, fe-c). |
| `apps/web/src/pages/imports/api.ts` | Types, paths, keys and hooks for the 8 import operations, and the same-origin template download URL. |
| `apps/web/src/pages/imports/ui.tsx` | Batch, row and commit status chips; `reasonText` (row reason → en/ar text, field named by its localized template label, DG4 "expected" phrase and actual status localized, `_noParams` fallback, never a raw placeholder). |
| `apps/web/src/pages/imports/ImportsPage.tsx` | Strategy and KPIs > Imports: transformation entry; templates (columns, CSV/XLSX download); upload (`createImport`, raw body, X-File-Name, 10 MiB client check, one alert); batch list (status and source filters, Unknown counts). |
| `apps/web/src/pages/imports/ImportPage.tsx` | Batch detail: source, size, SHA-256, pinned form schema, counts (Unknown while staging; polls while staging); "Staged – not committed" label; commit (If-Match, optional note; hidden with a "no valid row" text when 0 valid); cancel (reason); rows (validation filter, reasons en/ar, duplicate pointer, commit status, lineage link, raw cells). |
| `apps/web/src/components/external-confirmation/ExternalConfirmationPanel.tsx` | Deliverable panel: Not flagged / Unconfirmed / Confirmed by reviewed evidence / Confirmed by connector result, with provenance; flag, change and withdraw (If-Match `0` creates); confirm with verified evidence (If-Match). |
| `apps/web/src/i18n/{en,ar}/{integrations,imports,externalChange}.json` | New namespaces: 300 + 149 + 34 keys per language, identical key sets. |
| `apps/web/src/pages/integrations/integrations-i18n.test.ts` | ADR texts verbatim, Arabic present, provisional label, no "live"/DG wording, contract parity of every path. |
| `apps/web/src/pages/integrations/integrations.test.tsx` | Rendered behaviour, en and ar (17 tests). |
| `apps/web/src/components/external-confirmation/external-confirmation.test.tsx` | Panel on the Initiative Card, en and ar (8 tests). |
| `apps/web/e2e/p6-integrations-imports.spec.ts` | Real-stack journey with axe and EN/AR screenshots (2 tests × 2 languages). |

Modified (shared files: named lines only):

| File | Change |
|---|---|
| `apps/web/src/app/router.tsx` | 14 lazy pages and 14 routes (`admin/integrations/**`, `transformations/:id/outbound-writes[/:writeId]`, `strategy-kpis/imports`, `transformations/:id/imports[/:importId]`). |
| `apps/web/src/app/nav.ts` | Sub-page ids `integrations` (Administration, `connector.read`) and `imports` (Strategy and KPIs, `import.read`); an Imports link on the Strategy "actuals" contents item. |
| `apps/web/src/i18n/{en,ar}/nav.json` | `nav.sub.integrations` and `nav.sub.imports`. |
| `apps/web/src/i18n/{en,ar}/problems.json` | 40 B/A problem keys (§5). |
| `apps/web/src/i18n/index.ts` | Registers the three namespaces. |
| `apps/web/src/pages/portfolio/roadmapParts.tsx` | One named line (plus its import) mounting `ExternalConfirmationPanel` beside each deliverable's DG3 acceptance. |

## 2. Behaviour delivered, per requirement

FE-C's part of each row is listed below. **No row is complete from FE-C alone.** QA-A's A17/A11/A21 runs are still owed.

### REQ-S17-001

Acceptance: *"A17: a test connector run records last success, row counts, errors and retries, all visible in the UI"*.

- Last success is shown, or "Never succeeded" (`[data-last-success=never]`).
- Row counts appear in the run history and run detail as numbers, or "Unknown" when null (never 0; unit-tested).
- Errors appear as the error code's short text, with the actionable error on the connector and run pages.
- Retries: the retry policy, the attempt number, the retry chain ("Retry of" / "Retried by" links) and a Retry button (`connector.run`, failed and not yet retried).
- Reconciliation shows "Not checked", "Matched", "Mismatched" or "Not applicable" with the source and staged totals.
- Verification is "Not verified" until a test succeeds. Credentials appear as provider:name only, with resolves / does not resolve / Not checked.
- Admins configure in the UI: create, edit, mappings, enable, disable, test.
- **Proven in e2e:** "Test now" on a stopped test adapter records a failed run with Unknown counts. The page stays Not verified / Never succeeded.
- **Not proven by FE-C:** a *succeeded* run's counts and last success in a real-stack e2e. The only real run used a stopped adapter. The succeeded case is covered by unit tests only.

### REQ-S17-005

Acceptance: *"A17;A21: with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message"*.

- The connector page (and the run page) shows which run (trigger, attempt, time, link), why, and what to do. The texts are ADR-0055 §4 verbatim in English; the Arabic is provisional.
- The two fallback links are "Enter the KPI actual by form" (`/transformations/{target}/kpis`) and "Import a file" (`/transformations/{target}/imports`).
- **Proven in e2e** with the test adapter `stopped`, in en and ar.
- The imports page opens while the connector is stopped. Form submission while stopped is BE-O's API test and QA-A's A17/A21; FE-C did not re-prove it.

### REQ-S17-002

Acceptance: *"A17: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons"*.

- Upload stages a batch. The batch page shows each row with its validation status, its reasons in en/ar, the duplicate pointer ("Duplicate of row {firstRow}"), the commit status and lineage (a link to the KPI actual it created).
- Commit sends the valid rows only, with If-Match. Invalid and duplicate rows stay visible.
- **Proven in e2e:** a real CSV upload, with the reasons rendered in the page language.
- **Not proven by FE-C:** the 8/1/1 commit on the real stack. The dev stack has no KPI or reporting-period fixture for valid rows; that is QA-A's A17. Commit with If-Match is unit-tested.

### REQ-S17-003

Acceptance: *"A17: CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is rejected"*.

- The UI side: CSV/XLSX upload (media type from the extension), CSV/XLSX template download, and webhook endpoint administration (secret references only, rotation with grace, disable). The receiving path and signature headers are shown.
- Signing and receipt are API-only (BE-N). XLSX upload was not exercised in e2e.

### REQ-S01-005

Acceptance: *"A11;A17: marking the task complete leaves the deliverable Unconfirmed; a filename-only link does not confirm it; reviewed evidence or a test-adapter confirmation sets it and records the source"*.

- The panel sits beside the DG3 acceptance on every deliverable of the Initiative Card, never replacing it.
- An accepted deliverable with an unconfirmed flag shows both states. "Unconfirmed" uses the amber at-risk chip, never green.
- Confirmation by reviewed evidence (picker of verified evidence) or by connector result shows its source system and reference.
- A filename-only refusal (`external_change.evidence_not_verified`) is the form's one alert.
- Unit-tested en/ar. Not exercised in e2e.

### Cross-cutting

- One form-level alert per form (unit-tested on run-now and confirm).
- AUD sees read-only views (unit test, and e2e on the connector page). The server's 403 remains the authority.
- Every action uses `beginSessionGuard` or `useSessionBoundAction`.
- Every table has a scroll region, page sort, a column picker and a pager.
- Status always has a text label and an icon.
- A failed test is announced in the warning style, never the success style (fixed after the first screenshots showed a green banner).

## 3. Interaction checks run (e2e, real stack) and screenshots

Command:

```
E2E_PG_PORT=26121 E2E_API_PORT=26122 MTH_PORT_POOL=26123-26149 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p6-integrations-imports.spec.ts --workers=1
```

Result: **4 passed, exit 0** (`e2e-p6-integrations-imports.txt`).

Interactions:

- dev.admin signs in and opens the connector list (Not verified, Never succeeded), then the connector.
- **Clicks "Test now"**: the warning notice appears, then the actionable error with why/what-to-do and both fallback hrefs.
- **Clicks the run link**: the run page shows "First attempt".
- Opens the imports page.
- Signs out, signs in as dev.auditor: read-only, no Test button.
- A synthetic KDS user **uploads a CSV through the file input**: navigates to the batch, sees the `kpi_unknown`, `required_missing` and `value_not_decimal` reasons in the page language, "Staged – not committed", the "no valid row" text and no Commit button.
- axe found no serious or critical violation on 5 screens × 2 languages.

Screenshots (`docs/delivery/handbacks/DG6/T-DG6-FE-C-evidence/screenshots/{en,ar}/`): `fec-connectors.png`, `fec-connector-actionable-error.png`, `fec-run.png`, `fec-connector-aud.png`, `fec-import-batch.png`.

Not captured in screenshots: the connector form, the mappings editor, the webhook pages, the outbound writes and the external-confirmation panel. These are covered by unit tests only.

**Budget (rule 13/15):** 120 s per test.

- Worst loaded measurement: 17.2 s for the connector test (load average 18–22, other agents running). The import test took 6.2–8.7 s.
- 120 s is about 7× the worst case.
- An earlier run of the same spec failed two tests on **my own wrong assertion**: it expected the first reason to be `kpi_unknown`, but the first was a real "Scope id is required.". The assertion was corrected. Both runs are disclosed; the log kept is the final run.

## 4. Checks (exit codes; logs in `T-DG6-FE-C-evidence/`)

| Check | Command | Exit | Result |
|---|---|---|---|
| Historical validation (start) | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` (`validate-dg5-start.log`) |
| Historical validation (end) | same | 0 | PASS (`validate-dg5-end.log`) |
| Typecheck | `pnpm -r typecheck` | **137, 137, then 0** | Runs 1 and 2 were **killed by the kernel (OOM)**: `apps/api` and then `apps/web` showed "Killed". The machine has 15 GB; other agents' processes held about 12.9 GB and my integration run was active. Neither run reported a type error. Run 3 used `pnpm -r --workspace-concurrency=1 typecheck` on the final tree: all 8 packages, **exit 0**. Logs: `typecheck-run1-oom.log`, `typecheck-run2-oom.log`, `typecheck.log`. |
| Build | `pnpm -r build` | 0 | The first run (before the last edits) exited 0: `build-run1-before-final-edits.log`. The final tree, built with `--workspace-concurrency=1`, exited 0: `build.log`. |
| Lint | `pnpm lint` | **1, then 0** | The first run found a real error in my new test (an unused `screen` import), which I fixed. The re-run exited 0 (`lint.log`). |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| OpenAPI lint | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (unchanged) |
| Unit tests, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | see §4.1 | `test-locale-unset.log` |
| Unit tests, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | see §4.1 | `test-locale-cutf8.log` |
| Integration tests | `QA_PG_PORT=26130 MTH_PORT_POOL=26131-26149 tests/qa/support/with-pg.sh pnpm test:integration` | **124 (my 3,000 s `timeout`)** | **Not completed: this is not a pass.** See §4.2. |
| e2e (new spec) | §3 | 0 | 4/4 |
| Targeted web unit run (my files and the shell, i18n, styles and table-region tests) | `npx vitest run src/components/table-regions.test.tsx src/i18n src/pages/integrations src/components/external-confirmation src/app src/styles` | 0 | 15 files, 178 tests |

**First full `unit-web` run (before the fixes):** 1847 passed, 2 failed (`web-unit-first-run.log`). Both failures were mine and are fixed:

- `table-regions.test.tsx`: five raw tables were not inside a `TableScrollRegion`. They are now wrapped.
- `glossary.test.ts`: the Arabic used "تحول" without the shadda. It now uses "تحوّل".

### 4.1 Unit test counts (per Vitest invocation)

| Run | `unit-node` | `unit-web` | `unit-formula-nocodegen` | `pnpm test` exit |
|---|---|---|---|---|
| Locale unset (`test-locale-unset.log`) | 2736 passed, **1 failed** | 1849/1849 | 259 passed, 2 skipped | **1** |
| Locale unset, `unit-node` re-run (`test-locale-unset-unit-node-rerun.log`) | 2737/2737 | — | — | 0 (`npx vitest run --project unit-node`) |
| C.UTF-8 (`test-locale-cutf8.log`) | 2737/2737 | 1849/1849 | 259 passed, 2 skipped | 0 |

**The one locale-unset failure was environmental, not a code defect.** It was `apps/api/src/architecture.test.ts` ("has only mapped module directories"): `expected [ '.claude' ] to deeply equal []`.

- Cause: an empty `.claude/.cc-writes` directory under `apps/api/src/modules`, recreated by the write guard during my edits. The assignment says to remove these before tests.
- I removed every such directory under `apps/` and `packages/`.
- After the removal, the C.UTF-8 run and a locale-unset re-run of the failed invocation (`unit-node`) both passed 2737/2737.
- I did not repeat the whole locale-unset `pnpm test`: out of time. The other two invocations had already passed in it.

### 4.2 Integration run (incomplete)

The run was stopped by my own 3,000 s `timeout` (exit 124) while the machine was loaded (load average 18–26, other agents running).

At that point, 213 files had finished: **1232 tests passed and 4 failed**, all in API tests. This task changed no API, database or contract file. The 4 failures:

1. `contract/response-validation.test.ts`, "the rate limiter's 429 is a declared RateLimited problem": a 30 s timeout.
2. `contract/response-validation.test.ts`, "P5 BE-J operations": `expected [] to have a length of 1`. The same case **passed** in `contract.test.ts` in the same run. D-201 recorded this pair (a 30 s timeout and the P5 BE-J length) as passing when re-run alone and attributed them to load.
3. `contract/contract.test.ts`, "an undeclared request media type is a declared 400 validation.content_type": `Test timed out in 30000ms`.
4. `assistant/conversations.test.ts`, "over the per-minute budget a post is 429 with Retry-After …": `expected { …(8) } to match object { …(5) }`. This is a rate-limit window assertion and may depend on timing.

I did **not** re-run these files alone (out of time), so none of the four is cleared here. The orchestrator's merged-tree run decides.

**Pinned counts:** no change. No operation was routed. No contract, media-type, rate-limit or CSRF pin is touched, and no `p6-pending-*` / `p6-exercises-*` change was made (see §5).

## 5. Operations routed, contract, schema and dependency needs

- **Operations routed (pending-list delta):** none. FE-C is a web task: it consumes the 34 B/A operations that BE-L … BE-O already routed, and the 3 deliverable-confirmation operations. It owns no `p6-pending-*.ts` file.
  - `integrations-i18n.test.ts` checks the method and path of 32 operations against `docs/api/openapi.yaml`: the 21 in `INTEGRATION_OPERATIONS`, the 8 in `IMPORT_OPERATIONS` (the template download is used as a same-origin link) and the 3 deliverable-confirmation operations.
  - Of the 37 B/A and confirmation operations in the contract, two are not called by any screen: `executeOutboundWrite` (see §7) and `receiveWebhook` (machine-only, signed). Unused filter parameter: `listOutboundWrites`'s `deliverableId`.
- **Migrations:** none. **Dependencies:** none. **Schema/contract change:** none.
- **i18n added to shared catalogues** (`problems.json`, en/ar):
  - every code of ADR-0055 §9 (16) and ADR-0056 §9 (16), English verbatim;
  - `_noParams` variants for `{max}`, `{template}` and `{rows}`;
  - three proposed codes, with the texts their owners proposed: `connector.adapter_unavailable` (BE-L), `import.csv_malformed` and `import.form_schema_changed` (BE-M);
  - `webhook.connector_not_webhook` (BE-L/BE-N).
- **Row-reason texts** (`imports.json`): the 18 ADR-0056 §5 texts verbatim, plus three proposed codes the targets already send: `text_length`, `reviewer_unavailable` (KBE-A) and `source_record_id_too_long` (BE-M). The Arabic is KBE-A's proposal.
- **Arabic:** every B/A Arabic text is **provisional** and labelled so, with its source, in `pages/integrations/provisional-ar.ts`; a test enforces this.
- **Contract question for the orchestrator:** `createImport` reads `X-File-Name` as free text with no percent-decoding. An HTTP header cannot carry a non-Latin-1 file name, so the UI sends a non-ASCII name percent-encoded, and it is stored encoded. Evidence uploads encode and decode. Suggestion: `createImport` decodes it the same way (owner: BE-M2's route).
- **Not used, so not needed:** `kpi.actual.imported_from` (KBE-A §5.7, the lineage text on the KPI actual page). FE-C does not own `pages/kpi/**`; the owner of that page should add it.

## 6. User-facing texts made untrue, and merge notes

- **Texts made untrue:** none found. A search of `apps/web/src/i18n/{en,ar}/*.json` for integration, import, connector or webhook texts calling them planned, later or "not available" found nothing. The P6 placeholder texts (`nav.p6.*`) name only E/F/J/C features, and no B/A route was ever a placeholder.
- **Merge overlaps to expect (shared files):** `app/router.tsx` (one lazy block and one route block, after the AI assistant lines), `app/nav.ts` (the union, two `NAV_SUBPAGES` entries and the Strategy "actuals" contents link), `i18n/index.ts`, `i18n/{en,ar}/{nav,problems}.json`, and one line in `pages/portfolio/roadmapParts.tsx`. If an FE-A B/A block lands too, keep one copy of each problem key; the texts here are ADR-verbatim and the i18n test checks them.

## 7. What remains (not done)

1. **Integration suite to completion** on the merged tree, plus a solo re-run of the 4 failing API tests (§4.2).
2. **`executeOutboundWrite` from the UI** is not built. The outbound-writes screens list, show and re-check confirmation only. Executing a `deliverable_status_push` (TD) from the deliverable panel is the separable second half if the orchestrator wants it in DG6. REQ-S17-006 is BE-N2's row and is not assigned to FE-C.
3. **e2e coverage gaps** (unit-tested only): the connector create/edit form, the mappings editor, webhook create/rotate/disable, outbound writes, the external-confirmation panel, XLSX upload, and a commit on the real stack (which needs KPI and reporting-period fixtures; QA-A A17).
4. **Server-side sorting** is not offered by the contract for these lists. The tables sort the loaded page and say so.
5. **REQ rows:** none is complete from FE-C alone. QA-A's A11/A17/A21 runs are owed.

## 8. End

- Start: `2026-10-30T16:08:51Z`. End: `2026-10-30T18:24:49Z`. This is past the 2-hour limit; the extra time went to waiting for the loaded test runs.
- Changes are uncommitted on `dg6/fe-c`.
