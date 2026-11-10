# Handback T-DG6-BE-P (backend-workflow-engineer): the search index, its feed and reindex jobs, their service identities

- **Stage / gate:** P6 "Integration and system hardening", DG6 (BUILDING). Section: `docs/architecture/p6-work-split.md` §H/G.1.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-P-backend-workflow-engineer-20261029T042018Z-9174daaf","session_id":"9174daaf-508f-47ee-8cf1-1a0a8f33508d"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-P.md` (sha256 `0e369425f922d1dcf0fd61cf8c40cba3a78c9d714dfe2e1c57f2d10bc2661f16`, verified).
- **Base:** branch `dg6/be-p`, `HEAD` `bf7a2347929dbdc479dc22eef1eb77c7f0b18fa6`. Changes left **uncommitted**.
- **Time:** start `2026-10-29T04:20:33Z`; end: see §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0, at the start (`T-DG6-BE-P-evidence/validate-historical-dg5-start.log`) and again after the work (`validate-historical-dg5.log`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Indexing approves nothing; no G1–G6 business approval, Finance validation or IT approval is involved. All test data is synthetic (the demo dataset of ADR-0050 plus synthetic fixtures).

## 1. Files changed

| File | Status | Purpose |
|---|---|---|
| `packages/db/migrations/0115_p6_search_index_jobs.sql` | new | The two `job_schedule` rows (`search.index_feed` `* * * * *`, `search.reindex` `30 2 * * 0`, Asia/Riyadh, `owner_module` `search`, en/ar descriptions), each with its migration audit event (the `0028` pattern); the two job service identities (`job:search.index_feed`, `job:search.reindex`; platform scope; `transformation.read`; `sensitive_access` `none`; the declared exception stated in `reason`), each with its `service_identity.create` audit event (the `0114` pattern). **Id 0115** = next above the highest file on this branch (0114), D-196. |
| `apps/worker/src/search/documents.ts` | new | The per-type document builders of ADR-0057 §1 (exactly the §1 columns, shared `truncateText`/`hasText`), the scoped reads through the job's service identity, the declared sensitive-read exception (`SEARCH_SENSITIVE_READ_EXCEPTION`), `upsertDocument` (monotonic: feed / reindex modes) and `deleteDocument`. **Placement deviation, §5.1.** |
| `apps/worker/src/handlers/search.ts` | filled (BE-A stub) | `search.index_feed` and `search.reindex` per ADR-0057 §2: per type under advisory lock 730318 (`hashtext(<recordType>)`), batches of 500, no remote I/O; failure marking; both registered through `defineJob` (own identity). Test hook `beforeCommit` (QA-C's A13 hook). |
| `apps/worker/src/queues/search.ts` | filled (BE-A stub) | The two queues (standard bounded retry, `ops.failed` dead letter). No outbox event (the audit trail is the feed). |
| `apps/worker/src/kit.ts` | 2 lines + comment | The two `declare(...)` lines in `JOB_SERVICE_IDENTITIES` (ADR-0053 §1: "a queue added later declares its identity in the same change"; `defineJob` refuses an undeclared queue). **Outside the listed files, §5.2.** |
| `apps/worker/src/service-identities.test.ts` | edited | Reads the seeded identities of 0114 **and** 0115; queue count 40 → 42. **Outside the listed files, §5.2.** |
| `apps/worker/test/integration/schedules.test.ts` | 3 lines | `P6_SEARCH_JOBS` added to the expected `unhandled` list (the two new rows have no handler in that test). This is how I read §H/G.1's "`schedules.ts` declaration lines for the two codes" (§5.3). |
| `apps/worker/src/search/documents.test.ts` | new (unit-node) | The builders equal the ADR-0057 §1 table row by row; the 12 types equal `0108`; no value column name; `is_archived` rules; `truncateText` at 500/1000/40 without splitting a surrogate pair; blank text absent; the exception covers exactly the two search job codes and the three sensitive types; queues, handlers, lock 730318, the 0115 schedule rows. 9 tests. |
| `apps/api/test/integration/search/index-feed.test.ts` | new (integration) | The database-backed proofs of §H/G.1 "Tests" on a scratch database with the real synthetic demo dataset (§2). 17 tests. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-P-backend-workflow-engineer.md`, `T-DG6-BE-P-evidence/*` | new | This handback and its logs. |

Not changed: `apps/worker/src/schedules.ts` (it has no per-code declaration; it syncs every `job_schedule` row whose queue has a handler, and `SEARCH_HANDLERS` now provides both), `apps/worker/src/handlers/index.ts` and `queues/index.ts` (BE-A already spread `SEARCH_HANDLERS`/`SEARCH_QUEUES`), `p6-pending-be-p.ts` and `p6-exercises-be-p.ts` (BE-P routes no operation; BE-P2 empties the list), `openapi.yaml`, `schema.ts`, `catalogue.test.ts`.

## 2. Behaviour delivered

**REQ-S15-010** — acceptance (binding, quoted): "A12;A14: search as a user scoped to transformation X returns no Y records; a bulk update touching a stale record reports a conflict for that record only; a draft survives a browser reload". Procedure: "Search returns only records the user may read; …".

This task delivers the **index half** of the "search" clause; the A12 assertion itself is a query-time property proven by BE-P2 (`searchRecords`, the parity test) and QA-B. The other two clauses (bulk, drafts) belong to BE-Q2 and FE-D2. **REQ-S15-010 is therefore not complete after this task** and must not be marked so. What this task makes true, each with its test (`index-feed.test.ts` unless named):

| §H/G.1 test | How it is met | Test |
|---|---|---|
| A write to each of the 12 types appears as a document after one feed run, with the §1 columns only | After the real `search.index_feed` handler (through `defineJob`, its own identity row) every row of each of the 12 types has exactly one document whose content equals the builder's output for the current row; then one further write to a row of each type appears after the next feed run, with `source_audit_seq` = that record's highest audit `seq`. | "one feed run per batch window…", "a further write to one row of each type…" |
| No money, rate or KPI column value appears in any document | Structural, not by sampling: the source columns each builder reads are listed (`sourceColumnsOf`) and none of them is a numeric column of its table (read from `information_schema` on the migrated database); the document table's only numeric columns are `record_version`, `source_audit_seq`, `version`; the content of every document equals exactly the §1 columns of its row. | "no value column is ever read…"; unit "never name a value column" |
| An archive sets `is_archived` | A lesson published then archived → `is_archived` true, `record_status` `archived`; a change request withdrawn → `is_archived` true (§1: change_request archives at `withdrawn`). | "an archive sets is_archived…", "a withdrawn change request…" |
| A removed record's document is deleted | A document whose record no longer exists, with an audit event for it, is deleted by the next feed run. | "a removed record's document is deleted…" |
| Replaying the same batch changes nothing (row hashes identical) | Every type is rewound to `last_audit_seq` 0 (through `reindexing`, the only backward move the guard allows) and the feed re-reads every audit event: `md5(row(d.*))` of every document is identical. A second reindex also rewrites nothing. | "replaying every batch from sequence 0…"; reindex test |
| Two concurrent feed runs of one type serialize (lock) | A third connection holds `pg_advisory_xact_lock(730318, hashtext('initiative'))`; two feed runs are observed waiting in `pg_locks` (not timed); after release exactly one consumes the write and the document's version steps once. | "a run waits while another holds the type's lock…" |
| A reindex rebuilds exactly the current rows and leaves `last_audit_seq` at its start sequence | With a lost, a damaged and a stray document, a reindex in batches of 7 restores exactly the current rows, removes the stray, and leaves `last_audit_seq` = the audit maximum captured before the run, `idle`, `documents_count` = the row count, started/finished stamps set. The weekly job through `defineJob` indexes all 12 types. | "rebuilds exactly the current rows…", "the reindex job runs as its own identity…" |
| A failure sets `failed` with its code and the next run recovers | Feed: a failure inside the batch rolls it back; the type is `failed` with `search.index_failed` and `last_error_at`, `last_audit_seq` unchanged; the next run indexes the write and sets `idle` with both error columns null. Reindex: `failed`, the consumed sequence restored (a forward move from 0) so the feed resumes; the next reindex completes. | the two "a failure sets failed…" tests |
| The job identity reads nothing outside its declared scope (ADR-0053 Q13) | (a) A grant without `transformation.read` is refused **before any read**: `service_identity.out_of_scope`, the type `failed` with that code, nothing indexed; (b) for each of the 12 types, the scope of a principal of another organization admits 0 rows (SQL predicate) and the read throws `ServiceScopeViolation` (an out-of-scope row is never mistaken for a removed one, so no document is deleted); (c) a benefit marked sensitive is read by `job:search.index_feed` (the declared exception) and refused for `job:kpi.recalculate` (no exception); the sensitive benefit stays indexed (its readers are filtered at query time, ADR-0057 §3). Writes: only `search_document` and `search_index_state`. | the three Q13 tests |
| A13 hook for QA-C: a worker killed mid-batch re-runs the batch with no duplicate and no gap | `SearchJobHooks.beforeCommit` throws inside the batch transaction (batch size 4): nothing commits, `last_audit_seq` unchanged; the re-run leaves one document per record, each with `source_audit_seq` = its record's last audit `seq`. **And no gap from out-of-order commits:** a writer that took a LOWER audit `seq` but has not committed is never skipped; the feed stops before it and indexes it after it commits. | the two A13 tests |

**Design refinement disclosed (no gap).** ADR-0057 §2 says "read … `seq > last_audit_seq` in `seq` order". `seq` is an identity column, so a transaction can take a lower `seq` and commit after a higher one; a plain `seq >` cursor would then skip it forever. The feed therefore consumes events in `seq` order only up to the first event whose writing transaction is not *settled* (its xid not older than the snapshot `xmin`, compared with the wrap-safe `age()`), and the reindex captures S0 by the same rule. Limits, stated: the snapshot `xmin` is cluster-wide, so a long-running transaction anywhere on the cluster delays the feed (the index then honestly reads `stale` through `last_incremental_at`, which is set only when a type is caught up); the rule relies on a writer having its xid before it takes its audit `seq`, which holds for every record mutation (the record row is written before its audit row).

**Exactly once (rule 10):** the feed's document writes and the state advance are one transaction; upserts are keyed by record (`search_document_record_key`) and change a document only for a newer `source_audit_seq` (feed) or different content (reindex), never to an older sequence or record version (`search_document_monotonic`), and the version steps by 1. No `processed_message` entry is needed.

**Not audited, by design** (ADR-0057 §1): `search_document` and `search_index_state` are derived copies; the jobs write no audit event. The migration's schedule and identity rows are audited.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; disposable PostgreSQL 16.13 via `tests/qa/support/with-pg.sh` on ports 24510–24549 (my range); empty `.claude/.cc-writes` directories removed before the test runs. Logs in `docs/delivery/handbacks/DG6/T-DG6-BE-P-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` (start and end) | `validate-historical-dg5-start.log`, `validate-historical-dg5.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (a first run showed 2 unformatted files of mine; I had read only its tail; formatted them and re-ran) | `prettier.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (unchanged) | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node 163 files / 2510 tests; unit-web 96 / 1768; unit-formula-nocodegen 3 files / 259 passed + 2 skipped | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2510; 1768; 259 + 2 skipped | `unit-locale-c-utf8.log` |
| 9 | `QA_PG_PORT=24520 MTH_PORT_POOL=24521-24549 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 339 files: 336 passed, 3 failed; 3459 tests: 3453 passed, 4 failed, 1 skipped, 1 todo. Classified in §8 | `integration.log` |
| 10 | the 3 failing files alone (`contract.test.ts`, `response-validation.test.ts`, `tests/qa/integration/a15-demo-transformation-outputs.test.ts`), ports 24530–24549 | **1** | 217 tests: 215 passed, 2 failed (the same pinned-count test in both contract files); a15 7/7 | `integration-rerun-3-files.log` |

Targeted runs during development (same harness): `index-feed.test.ts` 17/17 passed; `schedules.test.ts` + `service-identity-scope.test.ts` 12/12 passed; `documents.test.ts` + `service-identities.test.ts` 15/15 passed. Early development runs of `index-feed.test.ts` failed on my own fixtures (the demo dataset has no lessons and no change requests; one change-request fixture hit `change_request_one_open_per_subject`); I added synthetic fixtures and they pass. One attempt to run tests against a cluster started in a separate background command failed with `ECONNREFUSED` (each command has its own network namespace); every reported run starts its own cluster.

**Pinned counts:** unit-node gains 9 tests (`documents.test.ts`); integration gains 17 (`index-feed.test.ts`). No contract pin changes: operation count 932, media types, rate-limit floor and CSRF-exempt routes are untouched.

## 4. Operations routed (delta to `p6-pending-be-p.ts`)

None. BE-P routes no operation (§H/G.1 "Operations: none (BE-P2 routes them)"). `P6_PENDING_BE_P` stays `["searchRecords", "getSearchIndexStatus"]` for BE-P2; `p6-exercises-be-p.ts` is untouched.

## 5. For the orchestrator: deviations, contract, schema, dependency

1. **`documents.ts` lives in the worker, not in `apps/api/src/modules/search/`.** The only writers of `search_document` are the worker handlers (ADR-0057 §1), and the worker imports no API code (ADR-0002 rule 5; `apps/worker/tsconfig.build.json` has `rootDir: src`, so an import of `apps/api/src/**` cannot build). The builders are therefore at `apps/worker/src/search/documents.ts`. The API needs no builder (BE-P2's query reads `search_document` directly). No API file was created.
2. **Two files outside §H/G.1's list were necessary:** `apps/worker/src/kit.ts` (the two `JOB_SERVICE_IDENTITIES` lines; without them `defineJob` throws at load time and the 0115 rows would not match the code) and `apps/worker/src/service-identities.test.ts` (it hard-coded 40 queues and read only 0114). Expect a merge overlap if another W8 task (BE-M) also adds a queue: the two lists and the count must be summed.
3. **`schedules.ts`:** §H/G.1 names "`apps/worker/src/schedules.ts` declaration lines for the two codes (after BE-J's)". `schedules.ts` holds no per-code declaration and BE-J added none; the only per-code list is the expected-`unhandled` list in `apps/worker/test/integration/schedules.test.ts`, which I extended. `schedules.ts` is unchanged.
4. **`apps/worker/test/search-index.test.ts`** (the split's path) would match no Vitest project (`unit-node` takes `apps/worker/src/**`; `integration` takes `apps/*/test/integration/**`), so it would never run. The pure tests are in `apps/worker/src/search/documents.test.ts` and the database tests in `apps/api/test/integration/search/index-feed.test.ts` (the split's second file), which covers every §H/G.1 test.
5. **The declared exception has no `sensitive_access` value.** `service_identity.sensitive_access` allows only `none | aggregate_only` (0101 CHECK; `SensitiveAccess` in BE-J's `service-scope.ts`). Neither fits: `aggregate_only` would admit sensitive rows into aggregates, which these jobs do not compute. I seeded `none`, stated the exception in each row's `reason` ("Declared exception (ADR-0057 §2, D-199): reads only the indexed columns … of sensitive benefits, business cases and evidence; no value column; every reader is filtered at query time."), and enforced it in code: `SEARCH_SENSITIVE_READ_EXCEPTION` admits sensitive rows only for the two search job codes and only through the §1 column reads. **Option for the orchestrator** (a schema change, so not done here, §H/G.11): a later migration adding `'index_columns'` to the CHECK, plus the `SensitiveAccess` type, so the Administration > Service identities view shows the exception as data rather than as a reason text.
6. **Migration id:** 0115 (next above 0114 on this branch). Renumber at merge if a W8 task (BE-M) also took 0115; the file has no id-dependent content except its own row ids (`01920006-0115-…`), which are arbitrary UUIDs and need not change.
7. **No contract, zod-mirror, `schema.ts` or dependency change.** No new problem code: the failure codes written to `search_index_state.last_error_code` are `search.index_failed` (an internal operations code, not a problem+json code; it matches the 0108 format) and the ADR-0053 `service_identity.out_of_scope` / `service_identity.missing`. BE-P2 / FE may want an en/ar label for `search.index_failed` where `getSearchIndexStatus` shows it.
8. **Operational note:** a reindex killed after its first transaction leaves the type `reindexing` (the feed skips it and the index reads `stale`) until pg-boss retries the job or the next reindex runs; the next run starts over. This is ADR-0057 §2's "the next run starts over", stated.

## 6. User-facing texts

My work ships no user-facing feature (the search page and route are BE-P2/FE-D), so no existing en/ar string became untrue; a search of `apps/web/src/i18n` for search described as planned or later found nothing. The new texts are the two bilingual `job_schedule` descriptions and the two identity labels in `0115` (Arabic provisional, like every P6 Arabic text).

## 7. What remains

- **BE-P2:** `searchRecords` (the query, `ReadScope` per type with the live named-party join, `indexedThrough`/`stale`, `search.query_too_short`, `search.index_unavailable`, the A12 and parity tests) and `getSearchIndexStatus`; empty `p6-pending-be-p.ts`.
- The orchestrator's decisions on §5.5 (a `sensitive_access` value) and the merge items §5.2 and §5.6.
- REQ-S15-010 stays incomplete until BE-P2, BE-Q, BE-Q2, BE-R, FE-D, FE-D2 and QA-B/QA-C are done.

## 8. Integration run, its failures, and end time

The full run (check 9) **exited 1**. Every failure is outside this task's code:

| Failure | Full run | Alone (check 10) | Cause |
|---|---|---|---|
| `contract.test.ts` and `response-validation.test.ts` › "the contract: every route accepts exactly the request media types its operation declares": `expected [ 405, 404, 1 ] to deeply equal [ 403, 402, 1 ]` (`contract.test.ts:1070`) | fail | **fail** (deterministic) | A pinned count of JSON-body routes left from an earlier merge. This task adds **no route**: no file under `apps/api/src` is changed (`git diff --name-only HEAD` plus the untracked files: §1), and `registerSearchRoutes` still returns `[]`. So the same two routes are already counted at `HEAD` `bf7a234`. The orchestrator owns the pin (D-079 precedent; the D-201 pattern, 394 → 397). **My delta to the pin: 0.** I did not run the file on a clean clone of `HEAD`: an attempted clone filled the shared disk towards 97 % (1.2 GB free) while the suite ran, so I deleted it at once. |
| `response-validation.test.ts` › "P5 BE-J operations (p5-exercises-be-j.ts)": `expected [] to have a length of 1` | fail | pass | The load-attributed failure D-201 already records ("the P5 BE-J length", passed alone). |
| `response-validation.test.ts` › "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written": 30 s timeout | fail | pass | Load (D-201 records the same 30 s timeout). |
| `tests/qa/integration/a15-demo-transformation-outputs.test.ts`: hook timeout at line 124 (all 7 tests passed) | fail | pass (7/7) | A teardown over the 30 s hook budget under load. **Disclosure:** during that window my clone attempt above (about 1.4 GB written) added disk I/O to the shared host, which may have contributed. |

The new and changed tests of this task all passed in the full run: `index-feed.test.ts` 17/17, `schedules.test.ts`, `service-identity-scope.test.ts` (and `documents.test.ts` and `service-identities.test.ts` in both unit runs).

**Merge note:** reconcile the media-type pin `[403, 402, 1]` with the merged route set (it is `[405, 404, 1]` on this branch without any change by BE-P).

**End:** `2026-10-29T06:22:31Z` (`date -u`; about 2 h 02 min, just past the 2 h limit because of the re-run of the failing files). Everything in §2 is complete for BE-P; what remains is §7.
