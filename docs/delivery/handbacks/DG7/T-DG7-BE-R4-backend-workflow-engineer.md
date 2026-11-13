# Handback T-DG7-BE-R4 (backend-workflow-engineer): chain rules, KPI evaluations, date-relative demo periods

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-BE-R4-backend-workflow-engineer-20261113T192623Z-4836b65d","session_id":"4836b65d-a336-483c-b228-54f4c49280d1"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-BE-R4.md`. I verified its sha256 as `777683182befb4d040963108586d57ebe157c198e746d06641b4b380776cebc1`.
- **Base:** `c3bae9f9bb81aa390361d374eb680d688cf603a4` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean except for this run's own `docs/delivery/runs/` folder.
- **Scope:** p7-work-split §C.15, which implements ADR-0064 Amendment 4 (A4.2–A4.7). The started and ended times are in §3.
- **Two gate systems.**
  - Nothing here grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes DG0–DG7.
  - The demo SP's acceptance in the test fixtures is a synthetic demo approval. It approves nothing real.
  - Every demo and fixture row is SYNTHETIC.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0152_p7_transfer_recheck_lineage_basis.sql` (new) | A4.5: re-adds `migration_reconciliation_delta_basis_check` with eleven values (adds `lineage`). The header states that nothing in it touches `audit_event`. |
| `packages/db/src/transfer/recheck.ts` | Sets `ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/4"`, adds `Allowance.lineage`, requires the eight keys and refuses `/1`–`/3`. Adds `RECHECK_LINEAGE_TABLES`, `RECHECK_LINEAGE_OUTBOX` and `RECHECK_CHAIN_MAX_DEPTH` (A4.2, verbatim), with `LineageTable`. Adds the A4.5 refusals and the key-tuple check in `validateAllowance`. Adds `RECHECK_LINEAGE_LINKS`, `RECHECK_LINEAGE_COLUMNS`, `checkLineageCatalogue` and `LineageLinkRefused` (A4.2 "At run time"). |
| `packages/db/src/transfer/recheck-automation.ts` | `automationChain` now runs the A4.2 fixed point (S2, L1, L2, L3, S3/S4, with depth) and returns `X`, `O`, `Run` and `K` with depths, plus `E*`, the A4.3 count differences and the executions that are too deep. Also adds `explainActionResults` (A4.4), `unexplainedFindings` (L4), `explainSignals` (L5), `lineageRunLine`, `ordinalLine` and `STARTER_HANDLER_ACTION`. |
| `packages/db/src/transfer/reconcile.ts` | `DeltaBasis` gains `lineage`. Mode 2 now runs in this order: catalogue check → `tables` → fixed point → `audited` (with E* and the A4.4 rules) → `children` → `lineage` (L1–L5 and the A4.3 counts) → `counters` → `operational`. It prints the A4.7 lines. The JSON report gains `lineageChain`, `signals`, and `depth` on every `automationChain` entry. |
| `packages/db/src/transfer/index.ts` | Export lines |
| `packages/db/src/transfer/recheck.test.ts` | The unit parts of T-R27. The fixtures move to `/4`. |
| `packages/db/test/integration/transfer-recheck-lineage.test.ts` (new) | T-R24, T-R25 (nine negatives) and T-R26 |
| `packages/db/test/integration/demo-periods.test.ts` (new) | T-R28, T-R29 and T-R30 |
| `packages/db/test/integration/transfer-recheck.test.ts`, `transfer-recheck-automation.test.ts` | The `/3` fixtures move to `/4` (`"lineage": []`). T-R19's expectations are unchanged. |
| `packages/db/test/integration/p7-transfer-guards.test.ts` | T-R9 for 0152: `lineage` is accepted, an unknown basis is refused, the eleven values are present, and the `audit_event` triggers and grants are unchanged. The 0151 block's value count becomes 11. |
| `packages/db/src/seed.test.ts` | 0152 is shipped, so the next free id is 0153. |
| `apps/api/src/modules/transfer/import/service.ts`, `docs/api/openapi.yaml` | Additive only: `lineage` added to `DELTA_BASES` (the zod mirror) and to the `basis` enum. `info.version` and the operation count (965) are unchanged. |
| `apps/api/test/integration/contract/p7-exercises-be-d.ts` | T-R12: the exercise seeds one `lineage` delta (`kpi_evaluation`) and expects it back. |
| `packages/db/src/demo/data/kpis.ts` | A4.6: `demoPeriodsFor(anchor, timeZone)` returns `DEMO_PERIODS` unchanged plus the generated months, and refuses an anchor beyond 2099-12. Adds `DemoPeriodAnchorRefused`, `isCalendarDate`, `dateInZone` and `startOfMonthIn`. `seedPeriods` seeds the run's periods. |
| `packages/db/src/demo/data/roaming.ts` | A4.6: one `ADM_ACCESS` grant at organization scope `SYN-ROAMING` for `DEMO_ACCESS_ADMIN` (`DEMO_ORG_ACCESS_GRANT`, fixture key `roaming.assignment_org.adm_access`, id `rtId(RT_BLOCK.scopedAssignment, 12)`). The organization's timezone now reads the constant. |
| `packages/db/src/demo/guard.ts` | `DEMO_ORGANIZATION_TIMEZONE = "Asia/Riyadh"`, the dataset constant the anchor reads |
| `packages/db/src/demo/seed.ts` | `DemoSeedOptions.asOf` and `resolvePeriodAnchor` (the seed's only read of the real clock, resolved before the transaction). The context gains `periodAnchor` and `timeZone`. The summary gains `periodAnchor`, `periodAsOf`, `periodTimezone` and `periodsGenerated`. |
| `packages/db/src/demo/reset.ts` | `asOf`: the anchor is resolved, and its range refused, before the database is dropped. The resolved date is passed to the seed. |
| `packages/db/src/demo/cli.ts` | `--as-of` is validated (exit 2), the range refusal exits 1, and the A4.6 line is printed after the existing lines |
| `packages/db/src/cli.ts` | `--as-of` is parsed for `seed-demo` and `reset-demo`, and the usage text and header gain it |
| `packages/db/test/integration/demo.test.ts`, `demo-roaming.test.ts`, `demo-numbers.test.ts` | Every seed/reset pair that compares checksums now passes the same `asOf` (`2026-09-01`, the legacy anchor). No expected number changed except the one grant row: `demo-roaming` asserted that no organization grant existed, and now asserts exactly the A4.6 grant. |
| `docs/architecture/data-dictionary.md`, `docs/architecture/erd.md` | The 0152 lines |
| `docs/handover/migration-catalogue.json`, `docs/handover/upgrades.md`, `docs/handover/data/coverage.json` | Regenerated by their tools, with no override. The tool classifies 0152 as `destructive` (DROP CONSTRAINT), as it did 0150 and 0151. |
| `docs/delivery/handbacks/DG7/T-DG7-BE-R4-evidence/*` | The logs (§3) |

Files I did not change:
- `demo-numbers-spec.test.ts`: it does not seed.
- `packages/db/src/schema.ts` and `catalogue.test.ts`: `basis` is a plain `string` in `schema.ts`, and `catalogue.test.ts` lists no basis values. The 0151 change did not touch either file, which is the precedent I followed.
- `coverage.ts`: no coverage condition names a period count.
- The `docs/handover/` operator text: no handover file lists the options of `seed-demo` or `reset-demo` (`grep -rn seed-demo docs/handover` finds nothing).
- `apps/api/test/support/p7-pending*.ts`: it has no BE-R4 entry to remove.

## 2. Behaviour delivered, per requirement

**REQ-S19-014 (M0362 "reconciliation") and REQ-S19-017 (B.9): T-R24, T-R25, T-R26, T-R27**

- **The fixed point (A4.2)** is computed once per recheck, inside its transaction. Every `timestamptz` comparison is made in SQL. Each round repeats these steps until none of `E*`, `O`, `Run`, `K` or `X` grows:
  - **S2:** added outbox rows explained by an `E*` event on their aggregate at the same instant.
  - **L1:** a run is explained by exactly one row of `O` with its idempotency key, with the trigger map's event and aggregate, its trigger record, its organization and (for `actual_accepted`) `payload->>'valueNo' = trigger_slot`.
  - **L2:** evaluations are explained through `(transformation_id, calculation_run_id)`.
  - **L3:** `kpi.values_recalculated:<run>` and `kpi.deviation_evaluated:<evaluation>` rows, for period-basis evaluations of a completed run only, with `o.created_at = r.completed_at`.
  - **S3/S4:** executions through `O`, with `d(x) = d(o) + 1`. An execution with `d(x) > 5` is not explained, its job's events do not join `E*`, and it gets the A4.7 depth line.
- **Depth (A4.4).** Events of `E` have depth 0. An event that joins through execution `x` takes `d(x)`. A run takes `d(o) + 1`, and evaluations and lineage outbox rows take the depth of their run.
- **The A4.3 counts** are checked for every added run before the fixed point, and only a run that passes can join `Run`:
  - the live evaluations equal `evaluation_count` and are all added;
  - the findings equal `finding_count`;
  - a completed run has exactly 1 `kpi.values_recalculated` and one `kpi.deviation_evaluated` per period evaluation, each a valid L3 row (key, organization, timestamp);
  - a failed run has none of them.

  A run that fails the check stays unexplained, and so does every row linked to it (its evaluations, its lineage outbox rows and their executions). The A4.7 line is printed under `calculation_run`.
- **L4.** A finding is explained through its run. A changed finding is explained only by an `E*` event at its version.
- **L5.** A signal needs:
  - exactly one row of `O` with its `source_event_key`, its `sourceKinds` event and its organization;
  - at least one consuming execution of `X`;
  - a case that is NULL or an explained `corrective_case` row.

  Lineage tables are append-only, so a changed or missing row of them is unexplained.
- **A4.4 action results.** Each added result needs an `E*` event on it, and its execution must be explained. That event's `request_id` must be in `R(x)` when `x ∈ X`, and must be in `E` when `x` was explained by `E`. Per execution:
  - no result has an attempt above the execution's;
  - the ordinals of each attempt are `1..m`;
  - a finished starter's current attempt has exactly one `starter_handler` row at ordinal 1.

  An ordinal or attempt violation makes every result row of `x` unexplained and prints the A4.7 line.
- **Allowance `/4` (A4.5).** It needs all eight keys. `/1`–`/3` are refused with `unsupported schema version`. The five new refusals produce the A4.7 texts (T-R27). The catalogue check exits 2 with `lineage link <name> does not match the schema` (T-R26). The JSON report gains `lineageChain`, `signals` (`{signalId, outboxEventId, executionIds}`) and `depth`.
- **What T-R24 measured** (`integration-be-r4.log`, line `T-R24 measured:`):
  - the real API route took the actual;
  - the worker's real `DOMAIN_HANDLERS`, with their starter wrappers, consumed each new outbox row through `QUEUES_FOR_EVENT` and `jobsForEvent`;
  - the recheck gives exit 0 with every lineage delta `allowed`;
  - the run is at depth 1 with 2 evaluations (period and cumulative) and 2 lineage outbox rows;
  - the second-hop executions are at depth 2 with exactly one action result each;
  - signals equal the `corrective_signal` rows of the deviation keys.
- **D-263 stop conditions.** None occurred:
  - every run's `completed_at` equalled its outbox rows' `created_at` (otherwise L3 or the counts would have failed T-R24);
  - the `kpi.actual_accepted` run's idempotency key was the outbox key (L1);
  - no starter execution had more than one result in an attempt.
- **Hard rules.**
  - No table is added to `RECHECK_OPERATIONAL_TABLES` (T-R27 asserts that none of the four lineage tables is there).
  - No worker or API audit event is added or re-attributed.
  - `rules.ts` is unchanged (`git diff --exit-code` exit 0).
  - The recheck code and 0152 contain no UPDATE, DELETE, TRUNCATE or INSERT on `audit_event` (`greps.log`).

**REQ-S18-001 and REQ-S18-002: T-R28, with T-R29 and T-R30**

- **The anchor** is the month of `asOf`, or else of the real date in `Asia/Riyadh`, read from `DEMO_ORGANIZATION_TIMEZONE`. It is the seed's only read of the real clock.
- **The four fixed periods are unchanged.** T-R28 compares their full rows (`to_jsonb`, without `seq`) between `--as-of 2026-11-13` and `--as-of 2026-09-01`, and they are equal.
- **The generated periods** run from 2026-10 to the anchor. Each is `open`, with id `kbeId(0x101, 4+n)`, label `YYYY-MM`, the dates of the month, due date end + 5, and `opened_at` and `created_at` at the start of month M+1, or of the anchor month for the current period, in Riyadh. Each is written through `ctx.insert` and then `seedUpdate(…, "open")`.
- **The CLI line** reads `mth-db seed-demo: reporting periods relative to 2026-11-13 (Asia/Riyadh): 2 generated, current period 2026-11 open`.
- **Seed, then reset twice** with the same `asOf` gives identical counts and checksum. Coverage is complete for both anchors.
- **`--as-of`** after today, or not a valid date, gives exit 2 with the A4.6 line, and nothing is touched. An anchor of 2100-01 is refused through `demoPeriodsFor`, and the CLI then exits 1 with the line.
- **T-R29.**
  - The access administrator holds `ADM_ACCESS` at organization scope `SYN-ROAMING` and still at the business unit.
  - Acting as that user, `POST /api/v1/role-assignments` of `TO` at organization scope returns 201, with one audit event by that user.
  - A business-unit-only `ADM_ACCESS` holder is refused the same call (403 or 404), and no row is written. That holder is the demo WL, given the role through the same audited route.
- **T-R30 (measurement):** the result is in §4.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, `MTH_PNPM_OFFLINE=1`, PostgreSQL 16.15 disposable clusters through `tests/qa/support/with-pg.sh` (ports 25411 and 26511). Started 19:26:33 UTC (`date -u`).

| Command | Exit | Result (log) |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (first) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`) |
| `npx vitest run packages/db/src/transfer/recheck.test.ts packages/db/src/seed.test.ts` | **0** | 90 passed. Of these, 16 are in `recheck.test.ts`, including T-R27. |
| `with-pg.sh npx vitest run --project integration transfer-recheck-lineage.test.ts` (runs 1–7 during development) | 1 | My own fixture defects, each fixed: dev sign-in on the imported target (the identity hold, then two carried identities), the submit body, the response shape, and a direct accept. These logs are kept as `integration-lineage-{1..7}.log`. |
| the same, run 8 | **0** | 11 passed: T-R24, the nine T-R25 negatives, T-R26 (`integration-lineage-8.log`) |
| `with-pg.sh … demo-periods.test.ts` (runs 1, 2) | **0**, **0** | 9 passed each time. Runs 1 and 2 measured T-R30 with a wrong request body. |
| `with-pg.sh npx vitest run --project integration` on the C.13/C.14 files (contract, unbound-signin, attachments, import-routes, catalogue, cli-stdout-drain, p7-transfer-guards, transfer-export, transfer-load, transfer-recheck-automation, transfer-recheck, transfer-roundtrip, financial-parity) plus transfer-recheck-lineage, demo-periods, demo, demo-roaming, demo-numbers and demo-numbers-spec | 1 | 18 files and 420 tests passed. 1 failed: `demo-roaming` asserted "nobody holds an organization grant", which is the one grant row A4.6 adds. I updated that assertion and nothing else (`integration-be-r4.log`). |
| `with-pg.sh … demo-roaming.test.ts` after that update | **0** | 69 passed (`integration-demo-roaming.log`) |
| `with-pg.sh …` on the 18 other API integration files that seed or reset the demo without `asOf` (now with the current month's generated periods): sensitive-reach ×5, environment ×7, form-export-illustrative, report-synthetic, table-totals-demo, index-feed, digest-restricted-z14, config-bundle-roundtrip | **0** | 18 files, 139 tests passed (`integration-demo-consumers.log`) |
| `pnpm -r typecheck` | **0** | `typecheck.log`. Re-checked with `tsc -p packages/db` after the last test edit: **0** (`typecheck-db-final.log`). |
| `pnpm lint` | **0** | `lint.log`. After the last test edit: **0** (`lint-final.log`). |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm test` | **0** | 205 + 130 + 3 files. 3022 + 2175 + 259 tests passed, 2 skipped (`pnpm-test.log`). |
| `node tools/release/migration-catalogue.mjs`, then `--check` | **0**, **0** | `PASS: migration catalogue up to date: 135 migrations (73 additive, 38 data_rewrite, 24 destructive)` |
| `with-pg.sh` + `node tools/release/dictionary-coverage.mjs --database-url <fresh migrated scratch db> --out docs/handover/data/coverage.json` | **0** | `PASS: 365 tables and 5776 columns documented`. The script is in the run's `$TMPDIR` (`dictionary-coverage.log`). |
| `git diff --exit-code apps/api/src/modules/access/rules.ts`, plus the checksum and `audit_event` greps | **0**, 1, 1 | `rules.ts` is unchanged. No test pins a literal checksum (A4.9 residual 5). There is no write to `audit_event` in the recheck code or in 0152 (`greps.log`; exit 1 means no match). |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | `All matched files use Prettier code style!` on all 23 batches, with no `[warn]` (`prettier.log`) |
| `with-pg.sh … apps/worker/test/integration/demo-reset-dev-binding.test.ts` | **0** | 2 passed (`integration-worker-demo-reset.log`) |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-end.log`) |

Ended 20:12:59 UTC (`date -u`), about 46 minutes after the start.

## 4. Known gaps, deviations and measurements

1. **T-R30 (A4.9 residual 4), measured.** I seeded with `--as-of 2027-03-15` (6 generated periods). The demo KDS submitted one actual per demo KPI in 2027-03 through the API, and each was accepted on submit (direct accept). The worker's `recalculate` then ran. `getKpiStatus` gave:
   - `attach_rate`: `valueStatus` `ok`, RAG `red` (`kpi.rag.red_threshold`);
   - `complaint_rate`: `ok`, `red`;
   - `cost_per_mb`: `ok`, `amber` (`kpi.rag.amber_band`).

   None was `not_computable`, so for these three KPIs in 2027-03 the residual did not occur. The values were the latest synthetic demo numerators and denominators re-entered, so the RAG colour reflects only that choice. These are measurements, not a gate.
2. **"A run of a trigger kind outside the map" (T-R25) cannot be stored.** `calculation_run_trigger_pair` admits only the four mapped kinds. The test therefore uses the nearest constructible case: a mapped kind (`threshold_changed`) whose idempotency key names an explained outbox row of another event. L1 refuses it on the map's event, and it stays unexplained. A restatement run (A4.9 residual 1) would need a schema change before it could exist.
3. **A4.7 count line for a failed run.** A4.7 prints `(expected 1)` for `values_recalculated`. My line prints the expected number, which is 1 for a completed run and 0 for a failed one, because A4.3 says a failed run has no lineage outbox row. For every completed run the text is exactly A4.7's.
4. **The A4.6 lines carry the existing `mth-db ` prefix.** The CLI prints `mth-db seed-demo: reporting periods relative to …` and `mth-db seed-demo: refused: --as-of must be a valid date not after today`, like every other `seed-demo` line (ADR-0050 §9 `mth-db <command>: refused:`). The A4.6 text is contained verbatim. See §5 Q1.
5. **`DemoRunSummary` gains three fields beyond `periodAnchor`:** `periodAsOf`, `periodTimezone` and `periodsGenerated`. They supply the A4.6 line. The worker's in-app reset returns only `runNo` and `checksumSha256`, so no API contract changes.
6. **T-R24's allowance lists `app_user` under `tables`, with the exact keys of the two actors who signed in** (the dev sign-in updates their rows). DO-D7's allowance must do the same for its signed-in actors, as A3.6 does for `transformation`. Measured on this fixture:
   - the audited tables touched were `kpi_actual`, `automation_execution`, `automation_action_result` and `corrective_case` (with 0 explaining events on `corrective_case`);
   - the children were `kpi_actual_value` and `kpi_actual_review`;
   - the counter was `record_code_counter`;
   - the chain had 1 execution at depth 1 (`kpi.actual_accepted`) and 3 at depth 2 (2 `kpi.deviation_evaluated`, 1 `kpi.values_recalculated`);
   - the run had 2 evaluations, 0 findings, 2 lineage outbox rows and 1 signal;
   - the acceptance was the KDS's direct accept on submit.
7. **T-R24's fixture.** It runs the real API in-process and the worker's real handlers, but not pg-boss. Outbox rows go to the handlers through the relay's own routing (`QUEUES_FOR_EVENT`, `jobsForEvent`, the envelope `relay.ts` builds), on attempt `{retryCount: 0, retryLimit: 2}`. Imported identities are held (ADR-0064 §8), so the two actors are first rebound to the dev issuer through `applyRebind`.
8. **New test-only imports.** The two new `packages/db` integration files import `apps/api/test/support/harness.ts` and `apps/worker/src/{handlers,queues,relay}`, which no `packages/db` test did before. The integration project and its global setup are shared, and typecheck and lint pass. Production code in `packages/db` imports nothing new.
9. **T-R25 owner-built rows.** The extra ordinal-2 starter result is inserted by a superuser session with `SET LOCAL session_replication_role = replica`, because the 0074 guard admits results only for a running attempt. Its audit event is appended in an ordinary transaction. `audit_event` triggers are never disabled, and nothing is updated, deleted or truncated.
10. **The A4.4 `request_id` rule is applied per result.** A result whose event is outside `R(x)` (or outside `E`) is unexplained on its own. The "every result row of `x`" rule covers the attempt and ordinal violations, as A4.4 lists them.
11. **The A4.3 counts are stricter than the minimum.** `values_recalculated` and `deviation_evaluated` are counted over every added outbox row on the run's (or its evaluations') aggregate with that event, and every counted row must also be a valid L3 row.
12. **Not run.** I did not run the full API and worker integration suites. I ran the 38 integration files listed in §3, which include every API and worker integration file that seeds or resets the demo.

## 5. Open questions

1. **Q1 (texts).** Should the A4.6 lines read exactly `seed-demo: …` (as A4.6 and A4.7 write them), or keep the `mth-db ` prefix that every existing `seed-demo` and `reset-demo` line carries? I kept the prefix (§4 item 4). DO-D7 should match on the unprefixed text.
2. **Q2 (A4.7, failed run).** Should a failed run's count line print `(expected 1)` literally, as written, or the expected 0 (§4 item 3)?

## 6. Merge instructions

- **Migration:** `0152_p7_transfer_recheck_lineage_basis.sql`, the next id above 0151. If another task took 0152, renumber it at merge, then:
  - update `seed.test.ts` (next free id 0153);
  - update the 0152 lines in `data-dictionary.md` and `erd.md`;
  - regenerate `migration-catalogue.json`, `upgrades.md` and `coverage.json` with their tools.
- **Order:** BE-R4, then DO-D7 (B.9). DO-D7 needs:
  - allowance `/4` with `lineage` (`/3` is now refused);
  - `app_user` keys for the signed-in actors (§4 item 6);
  - `--as-of`, if the drill pins its anchor.
- **Conflicts to expect:** `deploy/scripts/drill/allowance.mjs` and `deploy/scripts/tests/transfer-drill.test.mjs` still write and assert `mth-recheck-allowance/3`. They are DO-D7's files. `reconcile-migration` refuses `/3` with `unsupported schema version 'mth-recheck-allowance/3'` until DO-D7 moves them to `/4`.
- **Generated files:** `docs/handover/{migration-catalogue.json,upgrades.md,data/coverage.json}` are generated. Regenerate them after the merge. `coverage.json` pins the sha256 of `data-dictionary.md` and `erd.md`.
