# Handback T-DG6-BE-E2: the security suite (backend-workflow-engineer)

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Section `docs/architecture/p6-work-split.md` §E/F.8.
- **Invocation:** `DG6-T-DG6-BE-E2-backend-workflow-engineer-20261030T073114Z-0265174d`, session `0265174d-be25-4583-8d13-a3c61b51ec15`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-E2.md`, sha256 `a32745172c46645048b3f8fa1de842d645c6b5cb2e42a1d5c09bf8c017ccacdf` (verified).
- **Starting revision:** branch `dg6/be-e2` at `f3cb67321bf568fcce81edd937d9626978fc880e`, clean tree. The changes are left **uncommitted**.
- **Time:** started 2026-10-30 07:31:38 UTC; ended 2026-10-30 09:20 UTC (`date -u` at the end: see the last line of `prettier-check.log`).
- **Two gate systems.** Nothing here reads or writes the engineering gates DG0–DG7. No test grants a G1–G6 business, Finance or IT approval. All test data is synthetic.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)` (`T-DG6-BE-E2-evidence/validate-historical-DG5.log`). I ran it before I wrote any file.

## 1. Files changed

All six files are new. No existing file was edited.

| File | Purpose |
|---|---|
| `apps/api/test/integration/security/csrf.test.ts` | Clause **CSRF** (ADR-0052 §4): one non-public mutation per module, tested five ways; pins the public unsafe exemptions |
| `apps/api/test/integration/security/sql-injection.test.ts` | Clause **SQL injection** (ADR-0052 §11): the three payloads in every free-text query parameter of the list and search operations, plus stored body fields |
| `apps/api/test/integration/security/xss.test.ts` | Clause **XSS in rich text** (ADR-0052 §3): the six payloads on the four surfaces (a)–(d) round-trip byte-identical |
| `apps/api/test/integration/security/uploads.test.ts` | Clauses **disallowed upload type** and **oversized upload** (ADR-0052 §1, §11) |
| `apps/api/test/integration/security/rate-limits.test.ts` | Clause **rate limiting** (ADR-0052 §4, §11): each class with its budget set to 1 |
| `apps/web/src/security-source-scan.test.ts` | Web source scan (ADR-0052 §3): no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` outside test files |
| `docs/delivery/handbacks/DG6/T-DG6-BE-E2-backend-workflow-engineer.md`, `T-DG6-BE-E2-evidence/*.log` | This handback and its logs |

There is no migration, no new operation, no schema or contract change and no dependency. No production source was changed.

## 2. Behaviour delivered, per requirement row

### REQ-S16-030 (shared with BE-E, BE-D and DO-A)

> Acceptance (quoted): "A12: security tests cover CSRF, SQL injection, XSS in rich text, disallowed upload type, oversized upload and rate limiting, and all pass"

Each clause has its own named test, run on the API without the UI, against a real disposable PostgreSQL 16. Each prints exactly one `PASS REQ-S16-030 <clause>` line, and only after all of that clause's cases have passed: every clause file ends with a "clause summary" test that checks the earlier tests recorded a pass. These are the lines from my runs:

```
PASS REQ-S16-030 CSRF: 109 modules (contract tags), one mutation each, x 4 refusals -> 403 csrf; correct Origin and token -> not csrf
PASS REQ-S16-030 rate limiting: 6 classes (global, auth, upload, search, assistant, webhook) at budget 1 -> second call 429 rate_limited with Retry-After; export: no operation wired yet (todo)
PASS REQ-S16-030 SQL injection: 3 payloads in every free-text list/search query parameter and a body field: no 500, no extra rows, stored as text
PASS REQ-S16-030 XSS in rich text: 6 payloads x 4 surfaces round-trip byte-identical
PASS REQ-S16-030 disallowed upload type: .exe -> 422 type_not_allowed; renamed .exe -> 422 type_mismatch
PASS REQ-S16-030 oversized upload: policy limit + 1 byte -> 413 evidence.too_large (default and narrowed)
PASS REQ-S16-030 web source scan: 286 source files, 0 HTML sinks
```

What each clause tests:

1. **CSRF** (`csrf.test.ts`; ADR-0052 §4).
   - **The sample.** One non-public POST, PUT, PATCH or DELETE operation per module. I group by the operation's first OpenAPI tag, which is how the contract groups modules, and take the first route by path within each tag, so the sample is deterministic. That gives **109 operations**; the log names each one.
   - **The five cases.** Each sampled operation is called five times, each time with a fresh valid session:
     - without `Origin` → 403 `csrf`;
     - with the foreign Origin `https://attacker.example` → 403 `csrf`;
     - without `X-CSRF-Token` → 403 `csrf`;
     - with a wrong `X-CSRF-Token` → 403 `csrf`;
     - with Origin and token both correct → not 403 `csrf`.
   - **Nothing written.** Every refusal writes no audit event for its request.
   - **The exemptions are pinned.** The only public unsafe operations are `devLogin` and `receiveWebhook` (ADR-0056, HMAC-authenticated). `devLogin` refuses a missing or foreign Origin with 403 `csrf` and sets no cookie.
   - **No session.** A request without a session gets 401 `unauthenticated`.
   - Why a fresh session per operation: the sample includes `logout`, which ends its own session when it succeeds.
2. **SQL injection** (`sql-injection.test.ts`; ADR-0052 §11; payloads exactly `' OR 1=1 --`, `'; DROP TABLE audit_event; --`, `1) OR (1=1`).
   - **Which parameters.** The set comes from the contract: a GET whose operationId starts with `list` or `search`, and a string query parameter without enum, format or pattern. `cursor` is excluded because it is an opaque signed token.
   - **Coverage.** That gives **15 operations and 16 parameters, 48 probes**: `listUsers`, `listTransformations`, `listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`, `listJourneyPainPoints`, `listInitiatives`, `searchLessons` (`q`, `tag`), `searchMethodology` and `searchRecords`.
   - **The rule for each probe.** The payload must get exactly the answer that a plain no-match value gets, and never a 500. On a 200, there must be no extra row: every returned item is either a row this file stored with that same payload, or a row the same query returns for the payload's plain words. The plain-words allowance exists because `searchMethodology` is a full-text search and legitimately matches the word `1` in 14 playbook blocks. An injected `OR 1=1` would return rows that match neither.
   - **Body fields.** The T03 `gap` stores each payload and returns it byte-identical. A transformation **name** carrying the payload is also stored, and `listTransformations?q=<payload>` (a served text filter) returns exactly that transformation and not the lead's other one. So the payload is matched as literal text.
   - **`audit_event` survives.** Afterwards `audit_event` still exists, and each stored row has its one `*.create` audit event.
3. **XSS in rich text** (`xss.test.ts`; ADR-0052 §3). The six payloads are exactly the ADR's. Each is written to four surfaces:
   - (a) a P5 `rich_text` extension field on T01, through `putFormRecordCustomFields`, using a synthetic published form_schema pinned to a fixture transformation;
   - (b) the T03 `gap`;
   - (c) an evidence note body;
   - (d) a meeting action's title. The owner's inbox shows that title as `messageParams.title`.

   Every value is accepted under the free-text rules. Each read returns it **byte-identical**: the parsed value equals the payload, the raw body contains the payload's own JSON encoding, and no `&lt;`, `&gt;`, `&quot;`, `&#` or `&amp;` appears. The web half is the source scan (below). QA-D adds the e2e (§E/F.8).
4. **Disallowed upload type** (`uploads.test.ts`; ADR-0052 §1).
   - An `.exe` (`MZ` header), named `setup.exe` or `SETUP.EXE`, gets 422 `evidence.type_not_allowed` with the ADR text "This file type is not allowed. Allowed types: pdf, docx, xlsx, pptx, csv, txt, png, jpeg, gif, svg.".
   - The same bytes renamed `report.pdf` get 422 `evidence.type_mismatch` "The file's content does not match its extension .pdf.".
   - The control: a real PDF under the same name is accepted.
   - Each refusal stores nothing: no `evidence_content` row, the item's version unchanged, no audit event for the request.
5. **Oversized upload** (`uploads.test.ts`).
   - Under the default policy, 26214400 + 1 bytes gets 413 `evidence.too_large` "Evidence content is limited to 26214400 bytes per revision.".
   - Under an IT-narrowed policy of 1024 bytes (set through `putUploadPolicy` by ADM_TECH), 1025 bytes gets 413 with the text naming 1024, and exactly 1024 bytes is accepted.
   - Refusals store nothing.
6. **Rate limiting** (`rate-limits.test.ts`; ADR-0052 §4). Each class gets its own API instance with that class's budget set to 1. The first call is not 429. The second is 429 `rate_limited` (problem+json) with a positive `Retry-After`:

   | Class | Operation |
   |---|---|
   | global | `getMe`, keyed by IP |
   | auth | `devLogin` |
   | upload | `uploadEvidenceContent` |
   | search | `searchRecords` |
   | assistant | `postAssistantMessage` |
   | webhook | `receiveWebhook`; a second endpoint key is not counted against the first |

   A pin test compares the cases with `RATE_LIMIT_CLASSES`, so a class that later gets an operation cannot go untested. **The `export` class has no operation wired** (see §7). Its case is an explicit `it.todo` with the reason. It is never reported as a pass.

**Web source scan** (`apps/web/src/security-source-scan.test.ts`; ADR-0052 §3).
- **What it scans.** Every `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.html` file under `apps/web/src`, except `*.test.*` and the `src/test/**` support folder. Comments are included, so a sink cannot hide behind a computed access such as `el["innerHTML"]`.
- **What it fails on.** The five sinks, each matched as a whole identifier. `document.write` also matches `document.writeln`.
- **The self-check.** The scanner first proves on a sample that it detects each sink and ignores look-alike identifiers, so an empty result is not vacuous.
- **Result.** 286 files scanned, 0 sinks; it passes with the locale unset and with `C.UTF-8` (`web-source-scan-both-locales.log`).

**Status of the row.** BE-E2's six clauses are delivered and pass, except the export rate-limit class, which no operation uses yet (§7). The row's other parts belong to other owners: the controls (BE-E, BE-D), the CI dependency audit (DO-A, DO-A2) and the XSS e2e (QA-D).

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, worktree `/home/user/wt/dg6-be-e2`, harness ports 25400–25449 only. The integration run started while the unit runs were still going, so the machine was loaded.

Every log named below is in `docs/delivery/handbacks/DG6/T-DG6-BE-E2-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5.log` |
| 1a | `pnpm -r typecheck` (covers `apps/api/test/**` and `apps/web/src/**`) | **0** | all 9 packages Done | `typecheck.log` |
| 1b | `pnpm -r build` | **0** | | `build.log` |
| 1c | `pnpm lint` (`eslint . --max-warnings=0`) | **0** | | `lint.log` |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `prettier-check.log` |
| 1e | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (unchanged) | `openapi-lint.log` |
| 2a | `pnpm test`, locale unset, run 0 (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE timeout 1800 pnpm test`) | **124 (killed by my own 1800 s `timeout` wrapper)** | **Invalid run; disclosed.** unit-node: 175/176 files, 2721/2722 tests (1 failure: a 5 s timeout in `packages/reporting/src/branding-layout.test.ts`, see 2d). It was killed during unit-web because the concurrent integration run slowed the machine, so unit-web and nocodegen did not complete. No passing locale-unset `pnpm test` run exists (see §7). | `run0-test-unit-locale-unset-TIMEOUT124.log` |
| 2b | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **1** | **unit-node** 175/176 files, 2721/2722 tests (1 failed: `apps/api/src/architecture.test.ts` "apps/web never imports @mth/db…", a 30 s timeout). **unit-web** 98/99 files, 1788/1789 tests (1 failed: `pages/traceability/traceability.test.tsx` "Portfolios and workstreams (en)…", a Testing Library wait timeout). **nocodegen** 3/3 files, 259 passed, 2 skipped (existing). The new `security-source-scan.test.ts` passed in this run. | `test-unit-c-utf8.log` |
| 2c | the web scan alone, locale unset and `C.UTF-8` | **0, 0** | 2/2 each; `PASS … 286 source files, 0 HTML sinks` | `web-source-scan-both-locales.log` |
| 2d | the three failing unit files re-run alone | see note | `traceability.test.tsx` alone: **0**, 32/32. `architecture.test.ts` + `branding-layout.test.ts` alone, still under the integration load: architecture 141/141 passed; branding-layout failed again with its 5 s timeout. **Classification:** load-dependent, not deterministic. Each of the two unit-node files passed in the other locale's full run: branding-layout in 2b (5/5), architecture in 2a (141/141). None of these files is mine or touched by this task. | `rerun-traceability-web-alone.log`, `rerun-unit-node-failures-alone-locale-unset.log` |
| 3a | `QA_PG_PORT=25402 MTH_PORT_POOL=25403-25409 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/security` | **0** | **5/5 files, 26 passed, 1 todo (27)**; the six PASS lines above | `security-suite-integration.log` |
| 3b | `QA_PG_PORT=25410 MTH_PORT_POOL=25411-25449 tests/qa/support/with-pg.sh pnpm test:integration` (started 07:53 UTC) | **did not finish (not run to completion)** | At 09:15 UTC, 82 minutes in, **145 test files had reported; 4 of them had failures (7 failed tests)**, listed and classified below. **None is in a file of this task.** The new `security/*.test.ts` files had not been reached yet; they pass on their own (3a). No total count is claimed. | `test-integration-partial-snapshot.log` (frozen at handback; `test-integration.log` may keep growing until the session ends) |
| 3c | the deterministic integration failures re-run alone | **1, 1** | `adoption-below-trajectory.test.ts`: 13/14, the same registry failure. `operations-freshness.test.ts`: 5/7, the same 2 failures. Both are deterministic at `HEAD` and neither involves a file of this task (see the note below the table). | `rerun-adoption-below-trajectory-alone.log`, `rerun-operations-freshness-alone.log` |

**The failures seen in the partial full integration run (3b).** I changed no source file and no existing test, so every failure below reproduces at `HEAD` `f3cb6732`.

1. **`apps/worker/test/integration/adoption-below-trajectory.test.ts`** "the event-to-queue registry (D-102) … every other event keeps its one queue" fails with `connector.run_failed: expected 'integrations.connector_exception' to be 'automation.evaluate'`.
   - **Deterministic.** It fails alone too.
   - **Cause.** BE-K2 (`apps/worker/src/queues/automation.ts:27`) made `connector.run_failed` an automation trigger, and BE-L2 (`queues/integrations.ts:16`) gives it the domain queue `integrations.connector_exception`. In the merged registry the engine queue is not last, as the D-102/T-DG5-BE-H2 rule requires (or the test's rule needs a P6 update).
   - **Owner.** The orchestrator's merge seam (the outbox event registry, `apps/worker/**`). It is outside BE-E2's ownership and not fixed here.
2. **`apps/worker/test/integration/operations-freshness.test.ts`**: 2 failures.
   - "version 1 is unchanged published history…" expects the seeded id `01920006-0116-7000-8000-000000000001`, but the database has `01920006-0117-…`. This is consistent with a migration renumbered 0116 → 0117 at merge, with the test's pin not updated.
   - "a KPI older than staleAfterDays -> one data_stale exception…" fails with a deep-equal mismatch, probably the same cause.
   - **Deterministic.** Both fail alone too.
   - **Owner.** The orchestrator's merge seam (BE-K2's test after the renumber). Not fixed here.
3. **`apps/api/test/integration/contract/response-validation.test.ts`**: 3 failures.
   - Two are 30 s timeouts ("U+0000 in the query…", "an undeclared request media type…"), from load.
   - The third is "P5 BE-J operations … expected [] to have a length of 1". D-201 records the same failure under load, passing when the file is re-run alone.
   - I did not re-run this file alone: it took 512 s in the loaded run, which did not fit the time limit.
4. **`apps/api/test/integration/forms/form-records.test.ts`** "at most 5000 rows…" is a 60 s timeout under load.

## 4. Operations routed (pending-list delta)

**None.** §E/F.8 assigns BE-E2 no operation. `p6-pending-*.ts`, the `p6-exercises-*.ts` seams, `contract.test.ts`, `P6_OPERATION_IDS` and the outbox registry are untouched.

**Pinned counts:** no change. The operation count, media types, JSON-body pin, rate-limit floor and CSRF-exempt webhook routes are unchanged.

**New tests:** 27 integration tests (csrf 3, sql-injection 4, xss 5, uploads 6, rate-limits 9 of which 1 is a todo) in 5 files; and 2 unit-web tests in 1 file.

## 5. Contract, schema or dependency needs (for the orchestrator)

- **No dependency, migration, schema or contract change.**
- **Observation for BE-R (ADR-0057 §5; no action asked of BE-E2).** The contract declares the `RegisterQuery` parameter `q` on 10 register-kit lists: `listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`, `listJourneyPainPoints` and `listInitiatives`.
  - **At `HEAD` the server does not serve it.** `transformations/register-kit.ts` parses the query with a strict object that has no `q`, so any `q` value gets 400 `validation`.
  - **This is H/G.5 BE-R's scope** (server-side filters and sorts), which has not run yet.
  - **How the SQL-injection test handles it today.** For those parameters it asserts that each payload gets the same 400 `validation` as a plain value (never a 500, never a different refusal), and it prints them under "declared but not served yet".
  - **After BE-R lands.** They answer 200, and the same test applies the row check to them automatically. No edit to the test is needed.

## 6. User-facing texts made untrue

**None.** BE-E2 ships tests only, so no feature's availability changes. I searched `apps/web/src/i18n/en/*.json` for security, CSRF, injection, XSS, rate-limit and upload texts that call something planned, later or not yet available. There were no matches.

## 7. What remains

1. **The `export` rate-limit class has no operation.** `RATE_LIMIT_CLASSES` lists none for it. T-DG6-BE-E's handback §6 assigns the wiring of the export start operations (`reporting/exports/**`, ADR-0046) to that file's owner, which is outside BE-E2's ownership.
   - Today the clause covers 6 of the 7 classes, and the seventh is an explicit `it.todo`.
   - **When the owner wires it:** add `...rateLimitClass("export")` to the export start route and its operation id to `RATE_LIMIT_CLASSES`. The pin test in `rate-limits.test.ts` will then fail until a case for `export` is added to `CASES` (one entry, same shape as `upload`), and the todo is removed.
2. **The XSS e2e** belongs to QA-D (§E/F.8), not to this task.
3. **The `q` parameter of the 10 register lists** belongs to BE-R (§5 above).
4. **The full integration run did not complete in this task (acceptance item 3).**
   - **Why.** The machine was shared with concurrent agents and with this task's own unit runs. In about 80 minutes the run reached 145 reported test files, while BE-E's run on this suite took 55 minutes in total.
   - **What happens to it.** It ends with this session, because its disposable cluster lives in the run's `$TMPDIR`. The partial log is kept. My own five files pass on their own run (3a).
   - **Not claimed as passed:** the full `pnpm test:integration` and its total counts.
   - **Recommendation.** The orchestrator's merged-tree verification supplies the full run. The four pre-existing failures above should be expected in it until their merge seams are fixed.
5. **`pnpm test` with the locale unset has no valid complete run (acceptance item 2).** Run 0 was killed by my own 1800 s `timeout` wrapper. The `C.UTF-8` run completed with exit 1, on three load timeouts in files outside this task, each of which passed in another run or alone (2d). The new unit-web file passes in both locales (2c).

## 8. Merge instructions

- New files only. There is no migration and no shared-file overlap: openapi, contract pins, schema.ts, the pending lists, `P6_OPERATION_IDS` and `kit.ts` are all untouched.
- `csrf.test.ts` derives its sample from the routes and the contract. A merged branch that adds a new tag with a mutation grows the sample automatically, and the log shows the new count.
- `rate-limits.test.ts` pins `RATE_LIMIT_CLASSES`. If a branch merged before this one wires the `export` class, that pin fails on the merged tree until the one-entry case of §7 item 1 is added. That failure is intended.
