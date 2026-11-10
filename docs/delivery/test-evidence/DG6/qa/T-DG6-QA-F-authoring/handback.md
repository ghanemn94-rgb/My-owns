# T-DG6-QA-F handback: REQ-S15-014 clause 2 term scan (A05;A20), qa-verifier authoring

- **Task:** T-DG6-QA-F, slice L (p6-plan §5.1). This is an **authoring** task, not the DG6 gate review: the independent DG6 QA review is a separate session.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-QA-F.md`, sha256 `73466bbd099887edcdfa07dc740c0623da1ba3a43bfe47d75f79a5b00fc55a12` (verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-QA-F-qa-verifier-20261031T041046Z-7e25d4f0","session_id":"7e25d4f0-32bb-4154-85ab-2ffc218bbab0"}`
- **Working tree:** `/home/user/wt/dg6-qa-f`, branch `dg6/qa-f`, `HEAD` `b8f61382910dcea7bd5a661e27b8aad05751cdc3`. Clean at the start; all changes below are **uncommitted**.
- **Time:** started `2026-10-31T04:12:16Z`; finished at the time given in §9.
- **Product source:** not edited. Product mutations were made only in a disposable copy under `$TMPDIR`, which was deleted afterwards. The other mutations are environment switches in my own spec.

## 1. Files written

| File | Purpose |
| --- | --- |
| `e2e/support/s15-014-terms.ts` | The scan's term list: ADR-0061 §8 verbatim (the stack-frame regex, `node_modules`, `ECONNREFUSED`, `ETIMEDOUT`, `SQLSTATE`, `PostgreSQL`, `postgres`, `Kysely`, `Fastify`, `pino`, `mth_app`, `mth_owner`, `outbox`, `advisory lock`, `localhost`, `127.0.0.1`, `TypeError`, `ReferenceError`, `[object Object]`, `S3`, `bucket`, `SMTP`), plus the assignment's "SQL keywords in error context" and "file paths". Also `scanTerms()` and the hostile 500 body `HOSTILE_DIAGNOSTICS`. Pure data, no product import. |
| `tests/qa/unit/a20-s15-014-term-list.test.ts` | Pins the list to ADR-0061 §8: every term is present and detected in leaked form, the extra patterns match, every line of the hostile body is flagged, and ordinary synthetic en/ar screen text is not flagged (26 tests). |
| `tests/qa/integration/a20-s15-014-no-infra-terms.test.ts` | API side, on the real Fastify app and a real PostgreSQL (own scratch database), with synthetic data. Covers: a real SQL failure (table renamed away: 42P01) on a read and on a write (nothing written); a real network failure (a second server whose `DATABASE_URL` points at a closed port: ECONNREFUSED); a 404; a malformed JSON body. Each must be a Problem with `type`, `title`, `code`, `requestId` and no §8 term in the payload or its decoded strings. The server's own (admin-side) log must show that the fault really happened (6 tests). |
| `e2e/a20-s15-014-term-scan.spec.ts` | The rendered-screen scan. Covers every non-admin route of the §7.2 set (`e2e/support/p6-axe-screens.ts` minus `/admin/**`: 21 routes) in chromium-en and chromium-ar, each in three states: **normal**, **forced 500** (a hostile problem body) and **network failure** (`route.abort`). In each state it asserts `<html lang/dir>`, no pattern in `document.body.innerText` + title, axe 0 serious/critical, and no off-origin request. The 500 state must show the generic error title and one of the served request ids. The network state must show the translated network text (126 tests). |
| `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-F-authoring/**` | This handback, the logs, per-state scan JSON and a JPEG per scanned state (`e2e/<lang>/`). |

Nothing else is changed. `tests/qa/support/**` and `e2e/support/p6-axe-screens.ts` were reused but not modified.

## 2. Binding rows (stage DG6, citing REQ-S15-014)

I searched `docs/delivery/requirements.csv` for every row whose text cites `REQ-S15-014`: `grep -n "REQ-S15-014" docs/delivery/requirements.csv` finds **one row**, line 312. No other DG6 row cites it in `acceptance`, increments or notes.

- **REQ-S15-014** (status `SPECIFIED`, stage DG6). Acceptance, binding: "A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms". This task covers **clause 2** only. Clause 1 is FE-F's (`apps/web/src/components/explanation/explanation.test.tsx`, per the row's analyst note); I did not re-verify it.

## 3. Requirement → test table

| Row / clause | Test that proves it | Result |
| --- | --- | --- |
| REQ-S15-014 clause 2, "non-admin screens show no stack traces or infrastructure terms": **rendered text, normal state**, en and ar | `e2e/a20-s15-014-term-scan.spec.ts` › `<route>` › "normal: no stack trace or infrastructure term" (21 routes × 2 languages) | PASS (42/42) |
| ... **forced server error**, ADR-0061 §8 "shows the generic error state with its request id only" | same spec › "forced 500: the generic error state with its request id only" (21 × 2) | PASS (42/42) |
| ... **network failure** (the assignment: "force a 500 and a network failure") | same spec › "network failure: the error state with the network text" (21 × 2) | PASS (42/42) |
| ... the server never sends a stack trace or infrastructure term in a real failure (what the error state can render) | `tests/qa/integration/a20-s15-014-no-infra-terms.test.ts` (SQL fault read and write, DB-unreachable read and sign-in, 404, malformed JSON) | PASS (6/6) |
| ... the term list is ADR-0061 §8, complete | `tests/qa/unit/a20-s15-014-term-list.test.ts` | PASS (26/26) |
| ... axe on every scanned state (assignment acceptance 2) | `expectAccessible` inside every e2e test above | 0 serious/critical in all 126 states |
| REQ-S15-014 clause 1 (explanations E1/E2 in en and ar) | NOT COVERED by this task: out of scope (assignment item 1 names clause 2). Covered by FE-F's component test per the register note. | — |

**Routes scanned in a degraded state, not populated** (disclosed in the spec's `scanned-as` annotation and in `e2e/term-scan-*.json`). On this stack, these records cannot be created through the API without a channel send, file upload, P4 value chain or routed decision. The page is therefore opened with a fixed **synthetic unknown id**, and the state it shows (not-found, or invalid link) is what gets scanned:

- `/l/:token`
- `/transformations/:id/outbound-writes/:writeId`
- `/transformations/:id/imports/:importId`
- `/my-work/approvals/:approvalId`
- `/transformations/:id/benefits/:benefitId`

`/walkthrough` runs on a non-demo database and shows its "not a demo environment" state. The **500 and network states of these six routes are fully exercised** because they don't depend on the record existing. Populated detail views of these six are **not** scanned in their normal state. That is a remaining gap (§8).

## 4. Checks run (real exit codes)

All runs used Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Ports were 27200–27249 only. `df -h .` showed 7.9 G free on the worktree before every full run. The shared `$TMPDIR` volume dipped to 2.9 G once while other agents were running; it was 8.1 G a few minutes later.

**Deviation, disclosed.** `node_modules` in this worktree is read-only, so Vite cannot write `node_modules/.vite-temp` when it bundles `vitest.config.ts`. Every Vitest command below therefore adds `--configLoader runner`, which only changes how the config file is loaded. Without the flag, the run aborts at startup with `ENOENT: mkdir '/home/user/wt/dg6-qa-f/node_modules/.vite-temp'`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical-start.log` |
| 2 | `pnpm vitest run --configLoader runner --project unit-node tests/qa/unit/a20-s15-014-term-list.test.ts` | 0 | 26/26 | `unit-a20-s15-014-term-list.log` |
| 3 | `QA_PG_PORT=27200 MTH_PORT_POOL=27201-27239 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa/integration/a20-s15-014-no-infra-terms.test.ts` | 0 | 6/6 | `integration-a20-s15-014-single.log` |
| 4 | **Acceptance 1:** `QA_PG_PORT=27200 MTH_PORT_POOL=27201-27239 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | 43 files: 42 passed, **1 failed**; 409 tests: 408 passed, **1 failed** (1213 s). My file passed 6/6. The failure is in `a17-import-and-integration.test.ts`, which is not mine (see §6). | `integration-tests-qa-full.log`, `integration-per-file-counts.txt` |
| 4b | The failing file alone, same harness | **1** | 9/10, the same test fails again: deterministic, not load | `integration-a17-rerun-alone.log` |
| 5 | **Acceptance 2, run 1:** `E2E_PG_PORT=27240 E2E_API_PORT=27241 MTH_PORT_POOL=27242-27248 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a20-s15-014-term-scan.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | 0 | 126 passed (16.1 min), 0 term hits in 126 states | `e2e-term-scan-en-ar-run1.log` |
| 6 | **Acceptance 2, final run** (same command, after the walkthrough-note edit, see below) | 0 | 126 passed (14.8 min): 0 term hits in 126 states; axe 0 serious/critical in every state | `e2e-term-scan-en-ar-final.log`, `e2e/term-scan-chromium-{en,ar}.json`, `e2e/{en,ar}/*.jpeg` |
| 7 | `pnpm lint` (whole repository, `eslint . --max-warnings=0`) | 0 | clean | `pnpm-lint.log` |
| 8 | `npx eslint --max-warnings=0 <my 4 files>` | 0 | clean | `eslint-new-files.log` |
| 9 | **Acceptance 3:** `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (run before this handback existed; re-run on the evidence folder in §9) | `prettier-check-all.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` | `validate-dg5-historical-end.log` |

The only change between run 1 (#5) and the final run (#6) is the evidence note for `/walkthrough`. Run 1 labelled it "SYNTHETIC fixture"; it now reads "not a demo database: the walkthrough's not-demo state is scanned". No assertion changed.

**No e2e step hit the 30 s timeout. No test was flaky.** The only non-zero exits are #4/#4b (the A17 failure, §6) and the mutation runs (§5), which must fail.

## 5. Mutation checks

Each mutation breaks the asserted behaviour. Every one is **killed** (the suite fails) unless noted. Logs are in `mutation/`.

| ID | Mutation (where) | Suite run | Outcome | Killing assertion |
| --- | --- | --- | --- | --- |
| M-API-1 | API `problemForError` puts `error.stack` into the 500 `detail` (`apps/api/src/modules/platform/hooks.ts` **in a disposable copy**) | integration file | **Killed**: 3 failed / 3 passed (SQL read, SQL write, network) | `scanTerms(...)` must be `[]`; hits on stack frame, `node_modules`, file path, `ECONNREFUSED`, `127.0.0.1` |
| M-API-2a | Same, but `detail = error.message` (no stack) | integration file, **first version** of my test | **Survived** for the two SQL cases (killed only for the network case) | — |
| M-API-2b | Same mutant | integration file after the fix | **Killed**: 3 failed | `PostgreSQL error sentence` (`relation "transformation" does not exist`) and `ECONNREFUSED` |
| M-WEB-1 | Web `ErrorState` renders `error.problem.detail`, or else `error.stack`, instead of the translated text (built bundle `apps/web/dist/assets/index-*.js` **in a disposable copy**) | e2e, `/my-work`, `/search`, `/prioritization`, 500 + network, en+ar (12 tests) | **Killed**: 12/12 failed | 500: the §8 scan (stack frame, `node_modules`, `TypeError`...). Network: the translated network-text assertion. In Chromium the bundle's `NetworkError` stack carried no frames, so the scan alone would not have caught that case. |
| M-WEB-2 | Web `ErrorState` drops the request reference (`state__meta`) (bundle **in a disposable copy**) | e2e, the three routes, 500, en+ar (6 tests) | **Killed**: 6/6 | "a request reference is shown" |
| M-ENV-1 | **The assignment's mutation:** a stack frame (`at handler (/srv/app/node_modules/fastify/lib/route.js:12:34)`) injected into every rendered `ErrorState` (`QA_F_MUTATE=errorstate-stack`, in my spec, real stack) | e2e, three routes, 500 + network, en+ar (12) | **Killed**: 12/12 | the §8 scan (12 times) |
| M-ENV-2 | `connect ECONNREFUSED 127.0.0.1:5432` injected into `main#main` of a normal screen (`QA_F_MUTATE=screen-term`) | e2e, three routes, normal, en+ar (6) | **Killed**: 6/6 | the §8 scan (6 times) |
| M-UNIT-1 | `"SMTP"` removed from the term list (copy of `s15-014-terms.ts`) | unit file | **Killed**: 2 failed / 24 passed | "names every ADR-0061 §8 term", "detects SMTP" |

**Defect found in my own test by mutation (M-API-2a), fixed before integration.** The first integration test scanned only the raw JSON payload. There, a PostgreSQL sentence reads `relation \"transformation\" does not exist` with escaped quotes, so the quoted pattern missed it. The test now scans the payload **and** its decoded string values. M-API-2b proves the fix. Both logs are kept: `M-API-2a-...-SURVIVED-raw-json-scan.log` and `M-API-2b-...-after-decoded-scan.log`.

The disposable copy (`$TMPDIR/mut-api`: the worktree without `docs/`, plus `docs/api`) was removed after the mutation runs.

## 6. Product defects and observations

**No product defect was found for REQ-S15-014 clause 2.** Across all 126 rendered states (21 non-admin routes × 3 states × 2 languages), the scan found **0** matches. The real server's 500s carry only `{"type":"urn:mth:problem:internal","title":"Internal error","status":500,"code":"internal","requestId":"<uuid>"}`, and the stack stays in the admin-side server log.

Findings and observations for the orchestrator:

1. **Out-of-scope failing acceptance test (A17, REQ-S12-019), deterministic.** This is not my suite and I did not modify it.
   - **Test:** `tests/qa/integration/a17-import-and-integration.test.ts` › "failing connector (REQ-S12-019, A17)…" › "the failure chain opens exactly one operational exception linked to the stale KPI; nothing in the KPI data changes". Last changed by `d47bd8210` "T-DG6-QA-A2: A17 linked-KPI assertion reads as a transformation reader (D-202 option a)".
   - **Request:** `GET /api/v1/admin/operations/exceptions/{exceptionId}` (the suite's `EXCEPTIONS` path), as the KDS of the KPI's transformation and as the organization's AUD.
   - **Response:** 200 with `linkedKpis[0]` = `{"kpiDefinitionId":"01a1905f-33d4-7019-a5c4-018e17a22f63","transformationId":"01a1905e-ecf9-76ef-862d-669485d8d5b6","name":"Synthetic KPI cea8b3","unitKind":"count","freshness":"unknown","lastValue":null,"lastValueAt":null}`.
   - **Expected:** `freshness: "stale"`, `lastValue` `"250.75"`, `lastValueAt` on 2026-01-31 (Asia/Riyadh).
   - Reproduced alone (#4b). Proposed severity **High** for whoever owns REQ-S12-019: the A17 acceptance "the KPI shows Stale with its last value and date" is not met as asserted. That holds unless the assertion itself is wrong, which an independent reviewer should decide. I did not investigate the product cause.
2. **Observation (contract), proposed Low.** `docs/api/openapi.yaml` declares no 500 (or 503) response for `listTransformations`, `getTransformation`, `createTransformation` or `devLogin`, and no `default` response. A real server fault therefore produces a status the contract doesn't list, and the harness's contract check rejects it ("contract: listTransformations does not declare status 500"). My fault tests use `contract: false` and assert the Problem schema's required members themselves. Declaring a shared `default`/500 Problem response would be an additive contract change.
3. **Observation (ADR-0061 §8 wording).** §8 says the forced 500 comes "from a test route in the e2e stack". The API has no fault-injection route (`grep` for one in `apps/api/src` finds nothing), so the e2e forces it with browser-side interception. A **real** server 500 is covered by the integration suite instead, through real database faults. If a server-side test route is wanted, that is a product task.

## 7. Merge instructions

- Add the four new files and this evidence folder. There are no migrations, no product changes and no dependency changes.
- New files only; nothing existing was edited, so no conflicts are expected.
- To run:
  - Integration: `QA_PG_PORT=<p> MTH_PORT_POOL=<range> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa/integration/a20-s15-014-no-infra-terms.test.ts`.
  - e2e: `apps/web/e2e/support/with-stack.sh npx playwright test e2e/a20-s15-014-term-scan.spec.ts --workers=1`.
  - Add `--configLoader runner` to Vitest only where `node_modules` is read-only, as in this worktree.
- The e2e run takes about 16 minutes for en+ar (126 tests at roughly 7 s each, mostly the 500/network retries of React Query plus axe).

## 8. What remains

- Normal-state scans of **populated** detail views for `/l/:token`, an outbound write, an import batch, an approval request and a benefit, plus the demo walkthrough. These need records this stack cannot create through the API without a channel send, file upload, routed decision, P4 value chain or demo database. They are scanned today in their not-found or invalid-link state; their 500 and network states are covered.
- Administration screens are excluded by design (ADR-0061 §8: "catalogues used only by Administration pages ... are allowed to name those terms").
- Clause 1 of REQ-S15-014 is not in this task.
- The A17 failure (§6 item 1) needs an owner. The register row REQ-S15-014 stays for the analyst/orchestrator to update; I don't edit delivery records.

## 9. End of run

- Finished `2026-10-31T05:29:45Z` (about 77 minutes after the start, within the 2-hour limit).
- `git rev-parse HEAD` at the end: `b8f61382910dcea7bd5a661e27b8aad05751cdc3` (unchanged). All work is uncommitted.
- Temporary directories (the mutant copy, trial evidence and mutant Playwright output) were removed. The empty `test-results/` directory was removed from the worktree.
