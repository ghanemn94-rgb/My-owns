# Handback T-DG5-KBE-D4 (kpi-benefits-engineer)

This is a repair task, D-164 and D-165, under p5-work-split §F.2 and §F.4. The Added scope 1–4 of the assignment is binding.

- **Stage:** DG5 (BUILDING), P5 "Configuration automation and outputs".
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-D4-kpi-benefits-engineer-20261017T093145Z-32244d25","session_id":"32244d25-b453-4095-b908-0f69eb87a603"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-D4.md`, sha256 `7742eb2c…ea2c0a`, verified on read.
- **Base:** `HEAD` `457e0ca9352e77dc6a45a1131f9fe3e0a8c01592` on branch `dg5/kbe-d4`, in its own worktree.
- **Commits:** none. The changes are left uncommitted for the orchestrator.
- **Started:** `Sat Oct 17 09:31:59 UTC 2026`. The end time is in the closing line.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits **0** (`PASS gate DG4 (historical)`). It ran at the start and again at the end; see §3.

Product gates G1–G6 are business approvals inside the product. Nothing here grants one, and nothing here touches the engineering gates DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/ports.ts` | `WorkflowsReadPort.gateApprover(db, transformationId, gateCode)`, which returns `{roleCode, userId}` or null. The unwired port answers null. |
| `apps/api/src/modules/reporting/reports/assemblers/gate-pack.ts` | The approver shown is the submission's approver first, then the port's effective approver, then the stored `gate_instance.approver_role_code`. The header comment is updated. |
| `apps/api/src/modules/workflows/index.ts` | One export line: `effectiveGateApprover` from `./gates.ts`. |
| `apps/api/src/modules/workflows/workflows.test.ts` | Barrel pin: adds `"effectiveGateApprover"`. |
| `apps/api/src/server.ts` | Wiring beside the existing `setWorkflowsReadPort`, which now also passes `gateApprover` (it calls `effectiveGateApprover` and maps the result to `{roleCode, userId}`). The name is added to the existing `workflows/index.ts` import. See §5 for the line count. |
| `apps/api/src/modules/benefits/index.ts` | Export only: `computeTotals`, `totalsOf` and the types `TotalsBenefit`, `TotalsResult`, `TotalsValueLine` from `./totals.ts`. |
| `apps/api/src/modules/reporting/reports/assemblers/registers.ts` | (a) `kpiTargetText`: the KPI target goes through `formatDecimal`. (b) `benefitTotalSections` takes its figures from the benefits engine by reference (`computeTotals` per row, `totalsOf` for the declared totals) instead of restating the rules. |
| `apps/api/src/modules/reporting/reports/assemblers/executive-dashboard.ts` | `kpiStatusesByItem`, `uniqueVersions` and `kpiLineage`. The snapshot records the `kpi_version` and calculation versions of every KPI value shown, and cites `kpi_definition` and `kpi_actual` as sources. |
| `apps/api/src/modules/reporting/reports/assemblers/kbe-d4.test.ts` (new) | Unit tests with worked fixtures for `kpiTargetText`, `kpiStatusesByItem` and `uniqueVersions`. |
| `apps/api/test/integration/reporting/gate-pack-approver.test.ts` (new) | Added scope 1 integration tests (4). |
| `apps/api/test/integration/reporting/kpi-target-text.test.ts` (new) | Added scope 2 integration tests (2), including the real CSV renderer in en and ar. |
| `apps/api/test/integration/reporting/workspace-header.test.ts` | One line. Its "port answers null" stub now spreads the wired port (`{ ...wired, gateReadiness: async () => null }`), because the port interface gained a required member. Behaviour is unchanged. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-D4-*` | This handback and its evidence logs. |

No test under `tests/qa/**` or root `e2e/**` was edited. No migration, OpenAPI, zod or dependency change was made. Migration `0083` stays unused.

## 2. Behaviour delivered

### Added scope 1 (D-164 c; BE-C3 handback §5.1): the gate pack names the effective approver

- **Before:** with no submission, the gate pack printed the stored `gate_instance.approver_role_code`. A new transformation pinned to a methodology whose G3 default is BO therefore printed SP.
- **Now:** the pack shows the submission's recorded approver first. With no submission, it shows `workflowsReadPort().gateApprover(...)`, which is workflows' `effectiveGateApprover`, the rule `submitGate` routes by. It shows the stored value only when the port is unwired or answers null.
- **Boundary:** reporting still never imports workflows. The composition root wires the port.
- **Tests:** `gate-pack-approver.test.ts`, 4 tests, all passing:
  - A new transformation pinned to the BO version prints `BO` (label `report.role.BO`) for its G3 pack with no submission. The stored row is still `SP`, and the pack agrees with `GET …/gates/G3`.
  - A v1-pinned transformation's G3 pack prints `SP`, unchanged.
  - With a submission (a synthetic G1 demo submission), the pack prints the submission's recorded approver even when the port answers BO for every gate. A gate without a submission takes the port's answer.
  - An unwired port (null) falls back to the stored approver.

### Added scope 2 (D-164 g; QA-C O3): the KPI target in the registers output

- **Formatting:** `kpiTargetText(value, unitKind, currency)` formats the target with the shared display formatter `formatDecimal` (ADR-0046 §9): half-up display rounding, trailing zeros dropped, Latin digits. It uses the KPI's own unit kind, as the KPI screen does (`apps/web` `formatKpiValue`):
  - money: 2 fraction digits with the ISO 4217 code;
  - percentage: the stored fraction × 100, 2 digits, then ` %`;
  - any other unit: up to 4 digits.
- **No target:** stays null, so the cell shows n/a, never 0.
- **Stored value:** never rounded. The test reads `kpi_version.target_value` = `100.000000` / `0.250000` back unchanged.
- **Column:** stays a `text` column, so a `decimal` column never mixes unit kinds (ADR-0045).
- **Language:** the document is language-neutral. With Latin digits and the same separators, `formatDecimal` prints the same digits in en and ar (unit-tested). So one text serves both languages, and the English order is used for a currency code (`SAR 1,500,000`).
- **Tests:**
  - Unit (`kbe-d4.test.ts`): `100.000000` → `100`; `0.250000` → `25 %`; `0.123456` → `12.35 %`; money half-up `10.125000` → `SAR 10.13`; null → null; en/ar parity.
  - Integration (`kpi-target-text.test.ts`, 2 tests): the live register shows `100` and `25 %`. The generated snapshot does too, and still records the KPI's `kpi_version`. Its CSV export through the real renderer, in **en and ar**, prints `100` and `25 %` on the KPI rows and never `100.000000` or `0.250000`.
- **Note:** a currency KPI's target text in an Arabic export reads `SAR 1,500,000`, the English order. The content model has no per-language text cell. A per-language form would need a new value type (a schema change), which is not mine to make. I list it in §5.

### Added scope 3 (D-164 h; KBE-D3 handback §6): the benefit totals by reference

- **Barrel:** `benefits/index.ts` exports `computeTotals` and `totalsOf` with their input and result types.
- **Totals block:** `benefitTotalSections` in `registers.ts` no longer restates the counting rules:
  - **Rows:** each row's cells are `computeTotals` of that one benefit. The engine decides whether it is counted and monetised (unmonetised → in no table, never 0). A missing amount makes the cell Unknown. A state with no line is a known 0 with label n/a, as before. An open overlap still shows n/a with no number for the validated and sustained cells (engine rule 4).
  - **Declared totals:** each is `totalsOf(db, [t], null)`'s line for that currency × class × state, which is the figure `GET /benefit-totals` returns. It is passed to `columnTotals` as the screen value, at the report's canonical scale. An Unknown cell still makes the total Unknown.
- **Figures unchanged:** `registers-report.test.ts` (5/5) and `table-totals-demo.test.ts` (2/2) pass unchanged.
- **Barrel pins:** none exists for `benefits/index.ts`. `reporting` already imported `benefits` (`dashboards/engine.ts`), so the module boundary is unchanged. `architecture.test.ts` and `reporting.test.ts` pass.

### Added scope 4 (D-165; QA-B P-1, Medium): the executive dashboard snapshot records its KPI versions

Requirement rows: REQ-S13-007 "source record revisions … calculation versions" and REQ-S07-016 "offer report reissue".

- **Before:** `executive-dashboard.ts` returned `versions: []`.
- **Now:** for every dashboard item that shows a KPI (an outcome KPI or an adoption indicator), `kpiLineage` reads the KPI status's `kpi_evaluation`.
  - **Versions recorded:**
    - `kpi_version`: reference id is the evaluation's `kpi_version_id`; key `kpi_definition:<id>`; label `v<n>`. This matches what the KPI register records (`registers.ts`).
    - `calculation_engine` rows from the evaluation's `calculation_run`: `kpi_rules` (`kpi_rules_version`) and `formula_engine` (`formula_engine_version`).
  - **Sources cited:**
    - each KPI definition shown;
    - the period's `kpi_actual` for the evaluation's scope, labelled `validated` once accepted, else `provisional`.
  - **Uniqueness:** sources are deduplicated against the item sources (`report_snapshot_source_record_key`). Version rows have unique keys (`uniqueVersions`, `report_snapshot_version_key`).
- **Result:** the worker's restatement run (`apps/worker/src/handlers/kpi.ts`, which matches on `report_snapshot_version` `kpi_version` or a `kpi_definition` source) now offers the Q1 dashboard for reissue.
- **Tests:** both named tests in `tests/qa/integration/a07-historical-integrity.test.ts` pass **unchanged**:
  - ✓ "REQ-S13-007: the issued Q1 dashboard retains the calculation version and source revision of the KPI value it shows";
  - ✓ "…the Q1 report issued earlier (the Q1 dashboard showing the KPI) is offered for reissue after the approved restatement".
  - Unit tests cover `kpiStatusesByItem` and `uniqueVersions`.

### Requirement rows

The repair serves rows already assigned to §F.2 and §F.4:

| Row | How this repair serves it |
|---|---|
| REQ-S13-004 | The gate pack shows the correct approver. The registers output shows its KPI targets in their units. |
| REQ-S13-007 | Snapshot lineage: the dashboard records its calculation versions and source revisions. |
| REQ-S07-016 | The reissue offer now includes the dashboard. |
| REQ-S13-006 / D-163 | The totals come from the engine by reference, so they cannot drift. |
| REQ-S13-008 | Unknown is never 0 and n/a is never 0. Both are unchanged and re-asserted. |

Each row's acceptance text is unchanged by this repair. The behaviours above are what it adds to them.

## 3. Checks actually run

- **Node:** 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`).
- **Shell locale:** unset unless stated.
- **Logs:** in `docs/delivery/handbacks/DG5/T-DG5-KBE-D4-evidence/`.
- **Order:** checks ran one at a time (D-164 load rule).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | 0 | `PASS gate DG4 (historical)` | inline; end-of-run output in `validate-dg4-end.log` |
| 1 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (re-run after this handback was written; see the closing line) | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 6 | Vitest `unit-node`, locale **unset**: `npx vitest run --configLoader runner --project unit-node apps/api/src/modules/reporting apps/api/src/modules/workflows/workflows.test.ts apps/api/src/modules/benefits apps/api/src/architecture.test.ts apps/api/src/server.test.ts` | 0 | **18 files, 387/387 passed** | `unit-node-locale-unset.log` |
| 7 | The same with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **18 files, 387/387 passed** | `unit-node-c-utf8.log` |
| 8 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/reporting/gate-pack-approver.test.ts apps/api/test/integration/reporting/kpi-target-text.test.ts` | 0 | 2 files, 6/6 | `int-new-files.log` |
| 9 | The same harness with `tests/qa/integration/a07-historical-integrity.test.ts` | **1** | 11 passed, **1 failed**; see below | `int-qa-a07.log` |
| 10 | The same harness with `apps/api/test/integration/reporting` (whole directory) | 0 | **31 files, 199/199** (includes `registers-report`, `table-totals-demo`, `kbe-c2-assemblers`, `kbe-d2-assemblers`, `report-snapshots`, `export-labels`, `workspace-header`) | `int-reporting-dir.log` |
| 11 | The same harness with the four `tests/qa/integration/a15-*.test.ts`, `apps/api/test/integration/kpi-restatements`, `apps/api/test/integration/methodology/effective-approver.test.ts` and `apps/api/test/integration/contract/contract.test.ts` | 0 | **8 files, 138/138** | `int-qa-a15-kpi-restatements-contract.log` |

**The non-zero exit in run 9 is not mine.** The one failure is `contract (found while authoring A07): reading the extension values of a record that has none > GET …/form-records/T13/{id}/custom-fields returns version 0 with an ETag the contract allows`. This is QA-B **P-3**, which D-165 allocates to **BE-C4** (the `ETagOrZero` precedent) and keeps failing on purpose until then. This task touches no forms code.

The two tests this task had to fix pass in that same run (see §2, scope 4), and so do the other nine A07 tests.

**Not run, by D-164:** `pnpm test`, `pnpm test:integration` and the full e2e suite. The orchestrator runs them once on the merged tree. Integration runs used the shell's locale (unset).

**Pinned counts:** no change.
- No operation was added, so the media-type triple and the rate-limit floor are untouched. `contract.test.ts` passes in run 11.
- The only pin changed is the `workflows/index.ts` barrel pin in `workflows.test.ts` (+1 name).

## 4. Operations routed (delta to the pending list)

None. This repair adds no operation, so my `p5-pending-*.ts` and `p5-exercises-*.ts` files are unchanged. The four outputs are reached through KBE-C's existing routes.

## 5. Contract, schema or dependency needs (for the orchestrator)

- **No new dependency, migration, OpenAPI change or zod change.**
- **`server.ts` footprint:** the assignment allows "one wiring line". The wiring is one `setWorkflowsReadPort({...})` call, the existing one extended in place. Prettier lays it out over 7 lines, with a 1-line comment and one added name in the existing `workflows/index.ts` import list. Nothing else in `server.ts` changed.
- **Workspace-header test:** `apps/api/test/integration/reporting/workspace-header.test.ts` had a one-line change (spread of the wired port). It is outside `src/modules/reporting/**`, but it is the reporting port's own test. It would not typecheck otherwise, because `gateApprover` is a required member of the port (fail-closed, like `gateReadiness`).
- **Possible later schema change (not needed now):** a per-language text cell would print a currency KPI target as `1,500,000 SAR` in Arabic exports. Today the language-neutral text uses the English order `SAR 1,500,000`. Digits and separators are identical in both languages. Percentage and plain targets are identical in both languages.

## 6. User-facing texts made untrue

None found.
- I searched the en/ar report labels (`packages/shared/src/reports/content-labels.ts`, `apps/web/src/i18n/*/reportsP5.json`) for strings that call the approver, the KPI target, dashboard versions, reissue offers or totals planned or later. The only "planned" matches are value-basis labels ("Planned value …"), which are not release claims.
- No new label key was needed:
  - the approver uses `report.role.*`;
  - the target is system text;
  - the lineage rows are snapshot metadata.

## 7. What remains

- None of Added scope 1–4 is left unimplemented.
- **Verification only:** the repository-wide `pnpm test`, `pnpm test:integration` and the e2e suite on the merged tree (orchestrator, D-164).
- **Merge notes:**
  - **Conflicts:** possible only in the `workflows/index.ts` export list and `workflows.test.ts` barrel pin if BE-C4 also adds an export (merge by union, alphabetical in the pin), and in `server.ts` around the `setWorkflowsReadPort` call.
  - **Ordering:** none needed.
  - **Migrations:** none to run.

---

At the end, `node tools/gates/validate.mjs --historical --stage DG4` exited 0 (`validate-dg4-end.log`). The prettier check was re-run after this handback was written and exited 0 (`prettier.log`).

Handback finished at Sat Oct 17 10:14:58 UTC 2026, about 43 minutes after the start.
