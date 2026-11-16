# Handback T-DG7-DO-D7 (devops-engineer): run T-B11 and the A18 harness to the end

- **Stage:** P7, gate DG7 (BUILDING). Scope: p7-work-split "B.9 DO-D7" (the repair task after BE-R4).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-D7-devops-engineer-20261113T201339Z-c08aca8f","session_id":"c08aca8f-2e80-40df-b12b-0300f2d4f68c"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D7.md`. I verified its sha256 as `a1b067541813e76335f3b51be26748822b5ac0dea530733dc4598b32afad741d`.
- **Base:** `e514c59a09fa75589c00a18d0d8232a11c3bb9b4` on `claude/mobily-transformation-platform-dg6-regate`.
  - The tree was clean apart from my run folder.
  - Nothing was committed.
- **Time (`date -u`, sandbox clock):** started 20:13:49Z. The last stamp before this file was 20:51:39Z.
- **Environment:**
  - Node v24.21.0, with `MTH_PNPM_OFFLINE=1`;
  - PostgreSQL 16.15 disposable clusters from `tests/qa/support/with-pg.sh`;
  - bubblewrap 0.9.0, uid 0;
  - no Docker daemon (D-243 Q1);
  - about 3566 MB free at the end (`df -Pm`). `$TMPDIR/b11` (archive, store copy, export) is deleted.
- **Two gate systems.**
  - Every IdP user, grant, secret, origin, KPI value, evidence note, deferral and gate decision here is SYNTHETIC.
  - Nothing grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes a DG0–DG7 record.
  - **A container-free local drill on one host is not evidence of high-availability production readiness.**

## Headline

**T-B11 PASS (D0–D11). The A18 harness PASSES (8 of 8, exit 0). T-B15, T-B17, T-B18 and T-B19 pass (43 of 43 drill tests).**

- **Preconditions (checked first):** both hold.
  - BE-R4 is merged:
    - `ALLOWANCE_SCHEMA_VERSION = "mth-recheck-allowance/4"` (`recheck.ts` l.94);
    - `RECHECK_LINEAGE_TABLES` exists (l.101);
    - `seed-demo` prints `mth-db seed-demo: reporting periods relative to 2026-11-13 (Asia/Riyadh): 2 generated, current period 2026-11 open`.
  - On a fresh `migrate` and `seed-demo`, the current period 2026-11 is open. Evidence: T-B17's journey submitted the actual in period 2026-11 with no grant.
  - The demo access administrator `01995000-1001-7000-8000-000000000003` holds organization-scope `ADM_ACCESS`. Evidence: `pick-actors.sql` picked that user as `accessAdmin`, and T-B19's grant succeeded.
- **The D8 lists were remeasured by T-B17 on the full A3.6 chain on shipped demo data,** with no fixture grant and no hand edit.
- **The T-B11 runs found two bugs.** Each is named in §1 with its failing log line, and both are fixed:
  - `exportq` sent no register parameter;
  - D9's own report export was never measured.
- **Seeded anchor:** `2026-11-13` (Asia/Riyadh), current period `2026-11` open. The demo export manifest digest depends on the month (A4.6), so it is **not pinned**. This run's value was `fe2a0298…a52cefb`.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/drill/allowance.mjs` | **Moved to `mth-recheck-allowance/4`.**<br>• It writes the eight keys in the parser's order, including `lineage` = `D8_TOUCHED_LINEAGE`, each entry with `mustInclude.added` = the journalled keys of that table.<br>• A lineage table's journal keys never go to `tables`.<br>• A journalled `changed` key of a lineage table is refused (lineage is append-only).<br>• A journalled lineage table missing from the list is refused.<br>• A lineage name outside `RECHECK_LINEAGE_TABLES` is refused.<br>• `RECHECK_LINEAGE_TABLES` is read from `recheck.ts` only.<br>• The reasons file is now `mth-recheck-allowance-reasons/4`, with a `lineage` list.<br>**Lists replaced by T-B17's measurement:**<br>• `D8_TOUCHED_LINEAGE` = `calculation_run`, `corrective_signal`, `data_quality_finding`, `kpi_evaluation`;<br>• `D8_TOUCHED_CHILDREN` gains `gate_submission_criterion`→`gate_submission`, `kpi_actual_value`→`kpi_actual`, `kpi_actual_review`→`kpi_actual`, `report_snapshot_source`→`report_snapshot` and `report_snapshot_version`→`report_snapshot`;<br>• `D8_TOUCHED_AUDITED` gains `report_snapshot` (the other 15 are as measured, unchanged);<br>• `D8_TOUCHED_COUNTERS` is unchanged (`record_code_counter`).<br>**New `A45_REQUIRED_AUDITED` = `{corrective_case}`.** buildAllowance adds it only because A4.5 refuses `corrective_signal` in `lineage` without `corrective_case` in `audited`. See §4 item 1. |
| `deploy/scripts/drill/journey.mjs` | **Bug fix (`exportq`).** The `createExport` request now sends `parameters: {register: "raid", filters: {}}`. Failing line (T-B11 run 1, D9): `FAIL  exportq (15 ms): createExport: HTTP 422 {…"code":"report.parameters_invalid"…}`. No earlier run had reached D9. |
| `deploy/scripts/tests/transfer-drill.test.mjs` | **T-B15 on `/4`:** eight keys; `parseAllowance` accepts the file; a lineage table appears only in `lineage`; a journalled `kpi_evaluation` key goes to `lineage[].mustInclude.added`; the refusals, including `/3`.<br>**T-B17:**<br>• every changed lineage table counts as residue;<br>• the expected set is audited ∪ children ∪ counters ∪ lineage;<br>• `corrective_case` (A4.5) must stay unchanged;<br>• mode 2 must give a depth-2 `automationChain` entry and a non-empty `lineageChain`;<br>• the journey adds D9's `exportq`/`exportwait` (**bug fix**; failing line in T-B11 run 2, D9: `report_snapshot: 1 added, 0 changed, 0 missing (unexplained)`);<br>• the exit-4 negative case now picks its "stranger" outside the allowance's whole `actors` list. Run 2 of the negative case gave exit 0 because the first user by id was a journalled actor on the full chain.<br>**T-B19 (new):** the installation setup moved into `fixtureSuite(kind, title, asOf)`, which T-B17 and T-B19 share. Most of the diff size is that re-indentation. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D7-evidence/*` | The logs (§3), the measurements, the driver, three T-B11 report folders and the A18 output |

- No migration, contract, product code, demo data, permission, gate rule or KPI configuration changed.
- `transfer-drill.sh` is unchanged: D9 already runs `allowance.mjs` from the tree, which now writes `/4`.
- `deploy/ci/**` is unchanged: no path changed.
- `apps/api/test/support/p7-pending*.ts` has no DO-D7 entry, so none was removed.
- No mutation endpoint was added. The drill only calls existing audited API routes.

## 2. Behaviour per requirement

| Requirement / clause | Test | Status |
| --- | --- | --- |
| B.9 allowance `/4`, `lineage` only for lineage tables, evaluation keys into `mustInclude.added` | T-B15 | **PASS** (8 of 8) |
| B.9 lists measured on the full A3.6 chain on shipped data | T-B17 | **PASS:** journey C0–C6 reaches `decideGate` 201 (`deferred`, SYNTHETIC); the residue equals the four lists; mode 2 exit 0, depths `{1: 6, 2: 9}`, `lineageChain` 3, signals 3; the negative case exit 4; T-B18 PASS |
| DO-D6's grant path on shipped data | T-B19 | **PASS:** with `--as-of 2026-10-01` there is no 2026-11 period. G `01995000-1001-7000-8000-000000000003` grants `TO` at organization scope `01995000-0000-7000-8000-000000000002` to `01995000-1001-7000-8000-000000000001` (201). The product audits it as `scoped_assignment.create`. The period is created and opened, and the grant appears in the journal's and the summary's `grants`. |
| REQ-S19-017 key workflows, evidence downloads, rebind, intact after restart | T-B11 D6, D8, D9 | **PASS** |
| REQ-S01-006 different base URL; offline | T-B11 D7, D10, probe | **PASS:** origin `http://127.0.0.1:25302`; probe `ENETUNREACH`/`EAI_AGAIN`; origin scan 0 failing hits |
| REQ-S01-001, REQ-S19-009, REQ-S19-010, REQ-S20-018 clean environment starts | T-B11 D0, D3, D7; A18 part 1 | **PASS** |
| REQ-S20-018 A18 harness | `tests/qa/integration/a18-transfer-drill.test.ts` | **PASS:** 8 of 8, exit 0 |

**T-B11, run 3, the PASS run** (`t-b11-run.log`, `transfer/`):
- **Archive:** `mth-transformation-hub-0.1.0-f0d63e71980c.tar.gz`, 14 426 493 bytes.
  - sha256 `fc1676178d3cf54b4555200db354c30e2e416387b6750b25b3275d24862c580b`;
  - candidate `sha256:f0d63e71980c9de933fd3f778844db07f16ce0546820898727261d6335d6c9ae`;
  - commit `e514c59a`;
  - built from HEAD with the demo export: 335 tables, 4782 rows; manifest `fe2a02985d5cf4142e6e276c8997a46b2b44512aa57a9208162680233a52cefb`.
- **Steps (s), all PASS with exit 0:**

  | D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 160.3 | 10.5 | 1.7 | 0.3 | 6.3 | 10.5 | 2.6 | 2.0 | 33.6 | 8.1 | 0.7 | 0 |

  The drill took 237.2 s.
- **D5:** 5006 rows in 335 tables and 2 attachments imported; `reconcile-d5.json` `matched`, with an `audit_already_present` delta (45 rows).
- **D6:** `reconcile-d6.json` `matched`.
- **D8:** all 8 steps PASS. The 30 s wait after C6 is recorded in the journey: "waited 30 s for the worker; KPI evaluations read: 3".
- **D9:**
  - job-check PASS (22 schedules equal);
  - the queued export succeeded after the restart;
  - 2 downloads, SHA-256 equal;
  - allowance: 6 actors, 12 tables, 17 audited, 7 children, 1 counter, 4 lineage, 6 operational;
  - `reconcile-d9.json` `matched after use`: 290 tables unchanged, 44 with allowed differences, 216 audit events added.
- **Report:** `result: PASS`, sha256 `435995cc…139c4`. Allowance sha256 `a3da92eb…6389`.
- **The archive's `source/` is HEAD.** As in DO-D2–D6, the drill scripts ran from the working tree, which holds this task's uncommitted changes.

**A18 harness:**
- **Inputs:**
  - `QA_A18_ARCHIVE` = the run-3 archive above;
  - `QA_A18_ARCHIVE_SHA256` = `fc1676…580b`;
  - `QA_A18_STORE` = the offline store copy;
  - `QA_A18_OUT` = `a18-out/`.
- **Result:** the harness ran its own drill: exit 0 in 242.6 s, 8 of 8 tests. Its report's sha256 is `414f7cdf…de9a`.

## 3. Checks run (real exit codes)

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6`, **first** | **0** | `PASS gate DG6 (historical)`: `validate-historical-DG6-before.log` |
| `MTH_DRILL_D8_MEASURE_OUT=… with-pg.sh node --test --test-name-pattern='T-B17' deploy/scripts/tests/transfer-drill.test.mjs` (run 1, lists not yet replaced) | 1 | The measurement: chain complete, residue listed (`t-b17-run1.log`, `t-b17-measurement.json` was overwritten by run 3) |
| the same, with `T-B1[789]` (run 2) | 1 | T-B17 lists and mode 2 PASS; the negative case gives exit 0 (stranger bug); T-B19 PASS (`t-b17-b19-run2.log`) |
| `with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs` (run 3) | **0** | 43 of 43 (`transfer-drill-test-run3.log`; measurement files `t-b17-measurement*.json` at the evidence root) |
| `node --test --test-name-pattern='T-B15' …` | **0** | 8 of 8 |
| T-B11 run 1: `with-pg.sh bash t-b11-driver.sh` | 1 | D0–D8 PASS; D9 `exportq` 422 (`t-b11-run1.log`, `transfer-run1/`) |
| T-B11 run 2 | 1 | D0–D8 PASS; D9 mode 2 `mismatch: 3 tables` (`report_snapshot`, `_source`, `_version`) (`t-b11-run2.log`, `transfer-run2/`) |
| T-B17 run 4 (adds the export to the journey) | 1 | Measures `report_snapshot` (audited) and its two children (`t-b17-run4/`) |
| T-B17 run 5 (lists updated) | **0** | 4 of 4, the final measurement (`t-b17-run5/`) |
| **T-B11 run 3** | **0** | **PASS** (`t-b11-run.log`, `transfer/`) |
| **A18:** `QA_A18_*=… with-pg.sh npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts` | **0** | 8 of 8, 260 s (`a18-run.log`, `a18-out/`) |
| `with-pg.sh node --test --test-reporter=spec deploy/scripts/tests/transfer-drill.test.mjs` (final) | **0** | 43 of 43, 120 s (`transfer-drill-test-final.log`) |
| `pnpm -r typecheck` | **0** | 261 s (`typecheck.log`) |
| `pnpm lint` | **0** | 34 s (`lint.log`) |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm test` | **0** | 302 s. 205 + 130 + 3 files; 3022 + 2175 + 259 tests passed, 2 skipped (`pnpm-test.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | 23 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier-repo.log`). Run before this row was edited; the file is re-checked below. |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6-after.log`, `final-exits.log`), 21:01:43Z |

- I did not run the vitest API integration suites or the contract test, because I changed no product code or contract.
- The drill tests and the A18 harness ran on disposable PostgreSQL clusters.

## 4. Known gaps

1. **`corrective_case` is in `audited` without being measured.** ADR-0064 A4.5 refuses a `/4` file with `corrective_signal` in `lineage` unless `corrective_case` is in `audited`. T-B17 measured 3 signals and **no** `corrective_case` change.
   - I did not put it in `D8_TOUCHED_AUDITED`. It is a separate constant, `A45_REQUIRED_AUDITED`, which `buildAllowance` adds only for that rule.
   - T-B17 asserts that `corrective_case` stays unchanged.
   - It explains only `corrective_case` rows that carry audit events by journalled actors. The orchestrator should confirm this reading.
2. **D9's export is measured inside T-B17.** The lists are still named `D8_TOUCHED_*`, but they now also cover D9's report export (`report_snapshot` and its two children). They come from measurement (run 4/5), not from a hand edit.
3. **D9's failure listing is misleading** (seen in T-B11 run 2). The `sed` in `transfer-drill.sh` d9 prints every indented `<table>: …` line of the mode 2 report as "changed outside the allowance". That includes the `N explaining events` lines, so 19 tables were named when only 3 were unexplained.
   - I did **not** change it after the PASS runs, so that the evidence matches the tree.
   - Suggested fix: match only lines ending in `(unexplained)`.
4. **A4.9 residuals 1 and 4 did not occur in these runs.** No scheduled automation row landed in the window, and the KPIs were computable.
5. **The first T-B11 archive differs from the run 3 archive,** although both were built from HEAD. Run 1's sha256 was `25b3b347…`. The demo export inside the archive carries fresh ids and timestamps. The run 3 archive is the one T-B11 PASS and A18 used.

## 5. Open questions and merge instructions

- **Q1:** Is item 1's `A45_REQUIRED_AUDITED` acceptable, or should A4.5 allow `corrective_signal` in `lineage` when every added signal's case is NULL?
- **Q2:** Should the D9 failure-listing fix in item 3 be its own small task?
- **Merge:**
  - no migration and no contract change;
  - `allowance.mjs` now writes `/4`, as BE-R4's `recheck.ts` requires;
  - the CI drill fragment is unchanged.
