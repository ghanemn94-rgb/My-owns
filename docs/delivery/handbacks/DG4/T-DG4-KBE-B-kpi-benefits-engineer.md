# Handback T-DG4-KBE-B (kpi-benefits-engineer): P4 slice A, p4-work-split §A.2

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Engineering work only: no product gate G1–G6 and no engineering gate DG0–DG7 is decided here; no business, Finance or IT approval was granted. All test and seed data is synthetic.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-B-kpi-benefits-engineer-20261009T042803Z-4bbdcad7","session_id":"4bbdcad7-ddee-4de3-8158-0874a4f3614b"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-B.md` (sha256 `8e635f95…6a6f`, verified).
- **Working tree:** `/home/user/wt/dg4-kbe-b`, branch `dg4/kbe-b`, base `HEAD` `ab51be8d114861ee0c22e44118a7e384e80eaa18`. Changes are **uncommitted** for the orchestrator.
- **Time:** started `2026-10-09T04:28:17Z`; ended `2026-10-09T05:21:09Z` (`date -u`; about 53 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0, at the start and again at the end (`T-DG4-KBE-B-evidence/validate-historical-DG3.log`).

## 1. Result in one paragraph

18 of the 19 operations of `p4-pending-kbe-b.ts` are routed, exercised through the validating contract client and covered by five integration files (36 tests) against a real PostgreSQL 16.13. The 19th, `requestKpiVersionApproval` (and the `kpi_version_activation` subject provider), needs BE-B's approval service (`workflows/approvals.ts`, ADR-0026 §4), which is a stub in this tree. S-14 forbids writing `approval` directly, so it stays pending (§7). All acceptance checks exit 0 (§5).

## 2. Changed files

**Owned (p4-work-split §A.2):**

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/kpi-versions.ts` | `listKpiDictionary`, `getKpiDictionaryEntry`, `listKpiVersions`, `createKpiVersion`, `getKpiVersion`, `updateKpiVersion`, `activateKpiVersion`, `withdrawKpiVersion`. The content rules and the activation order of ADR-0027 §2, the supersede-then-activate transaction and the `kpi.version_activated` event. Also registers the threshold routes. |
| `apps/api/src/modules/kpi/kpi-formulas.ts` | Formula validation through KBE-A's `validateKpiFormula` (engine unchanged, S-9). The breadth-first cycle walk under the `kpiFormulaGraph` lock (730228) names the path by KPI names. Formula-input insert and read. No routes of its own. |
| `apps/api/src/modules/kpi/rag-thresholds.ts` (new) | `listKpiRagThresholds` and `createKpiRagThreshold`: a new version supersedes the old one, with the `kpi.threshold_changed` event. |
| `apps/api/src/modules/kpi/trajectories.ts` | `listTargetTrajectories`, `createTargetTrajectory` (incl. `sourceOutcomeKpiId` import), `getTargetTrajectory`, `approveTargetTrajectory`, `withdrawTargetTrajectory`, with the `kpi.trajectory_approved` event. |
| `apps/api/src/modules/kpi/data-quality.ts` | `listDataQualityFindings`, `getDataQualityFinding`, `resolveDataQualityFinding`. |
| `apps/api/src/modules/platform/db-errors.ts` | The slice A (KBE-B part) block `mapP4KpiGuardError`, called right after BE-A's `mapP4GuardError`: the ADR-0027 §13 database last-line mappings for my tables, plus the `*_scope_valid` constraints of slice A. |
| `packages/shared/src/schemas/kpi-versions.ts` (new) + its `schemas/index.ts` line | Zod mirrors of every request and response body of the 18 operations. Also the three outbox payload schemas `kpiThresholdChangedV1`, `kpiTrajectoryApprovedV1` and `kpiVersionActivatedV1`. |
| `apps/api/test/support/p4-pending-kbe-b.ts` | 19 → 1 (`requestKpiVersionApproval`). |
| `apps/api/test/integration/contract/p4-exercises-kbe-b.ts` | Exercises all 18 operations through `ctx.mirrored`, with the `P4_MIRRORS_KBE_B` map. |
| `apps/api/test/integration/kpi-p4/{versions,formulas,thresholds,trajectories,data-quality}.test.ts` (new) | 10 + 8 + 5 + 8 + 5 = 36 tests. Each file has its AUD-403, ADM-only-403 and commit-time authorization cases. |

**Outside the listed ownership (each is needed by the owned behaviour; for the orchestrator to accept or relocate):**

| File | Change | Why |
|---|---|---|
| `packages/shared/src/schemas/events.ts` | +1 import, +3 entries in `OUTBOX_EVENT_SCHEMAS` (`kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.version_activated`, v1) | §A.2 makes KBE-B write these three events. The relay (`apps/worker/src/relay.ts`) and the writer refuse an event type that has no registered schema. No file owns the registry. The payloads stay in my mirror file. |
| `apps/api/src/modules/kpi/kpi-outbox.ts` (new, kpi module) | A module-local outbox writer, `enqueueKpiEvent`, the same code as `jobs/outbox.ts` | `modules.ts` (BE-A) does not list `jobs` in kpi's `dependsOn`, so `architecture.test.ts` refuses `kpi → jobs` imports. The local writer validates through the same shared registry. **Orchestrator choice:** keep it (KBE-C can reuse it for `kpi.actual_accepted`), or add `jobs` to kpi's `dependsOn` (`modules.ts` and the pin in `kpi.test.ts`) and switch to `enqueueOutboxEvent` (same input shape). |
| `apps/api/src/modules/kpi/kpi.test.ts` | The P2 kpi suite pins the module's exact route set (48) and write-permission set: + `KPI_P4_KBE_B_OPERATIONS` (18) and the five new write permissions | Every kpi route task must update it. P3 KBE-B and KBE-C did the same. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[155, 154, 1]` → `[163, 162, 1]`, with a comment naming the 8 JSON-body operations | The per-task pinned-count precedent (BE-A, the P3 tasks). This is the **pinned-count change** asked for in acceptance item 3. |
| `apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts` (new) | The shared helpers of my five test files and the exercises. `insertFinding` writes a synthetic reporting period (with its audit event), a run and an open finding, because findings have no create operation. | It is a test helper. A new file, so it overlaps nobody. |

## 3. Behaviour delivered, per requirement row

### REQ-S07-001

> **Acceptance (A05):** "a KPI definition persists all listed fields; one without polarity, unit or aggregation rule is rejected"

- **Polarity and unit:** the DG2 `createKpiDefinition` without either is still 400 (unchanged; D-089 Q1, D-091 (1)).
- **Aggregation rule:** a version without one is stored as a draft (D-089 Q1: not required on create). `activateKpiVersion` refuses it with 422 `kpi_version.aggregation_rule_required`, "A KPI version needs an aggregation rule before it can be activated.", so it is refused before any P4 use. `getKpiDictionaryEntry` then reports `missingForUse: ["active_version","aggregation_rule","approved_trajectory"]`.
- **All listed fields persisted:** `getKpiDictionaryEntry` returns the DG2 definition together with the active version. The test asserts name, description, business purpose, owner, steward, unit, frequency, polarity, numerator/denominator, calculation, baseline and baseline date, target and target date, aggregation rule, data-quality rule, reporting period (frequency and YTD start month), approval policy (submission route, reviewer party, definition approval), source and leading/lagging. The phased trajectory is reported through `missingForUse` until one is approved (`trajectories.test.ts` shows it disappear).
- **Versioned:** versions are numbered 1, 2, 3; a version after the first needs a `changeReason`; at most one draft per KPI (409 `kpi_version.draft_exists`).
- **Content rules:** measure type vs polarity, band, aggregation vs value nature, custom formula, reviewer route, ratio labels and milestone due date. Each has the exact ADR-0027 §13 code and text (`versions.test.ts`).
- **Activation order (ADR-0027 §2):**
  1. the definition is active (`kpi_version.definition_not_active`);
  2. the version is complete;
  3. under `business_approval`, an approved `kpi_version_activation` approval (`kpi_version.approval_required`; nothing grants one);
  4. no formula cycle, and the units are re-checked.
  The previous active version is superseded, then the new one activated, in one transaction, with one audit event each and one `kpi.version_activated` outbox event (key `kpi.version_activated:<id>:<versionNo>`).
- **Measure lock:** on a KPI that has a version, `updateKpiDefinition` of unit, currency, polarity or frequency is 422 `kpi_definition.measure_locked` (through the db-errors mapping of trigger `kpi_definition_measure_lock`). A KPI without a version can still change them (D-091 (2)).

### REQ-S07-007, threshold and trajectory half

> **Acceptance (A04; A05):** "with all tasks complete and actual below the red threshold the KPI is Red; changing the threshold version recomputes RAG"

- **Threshold versions:** `createKpiRagThreshold` inserts the new version as active and supersedes the previous one in the same transaction. It writes one audit event each and exactly one `kpi.threshold_changed` event per version (key `kpi.threshold_changed:<id>:<versionNo>`), which KBE-C's `kpi.recalculate` consumer turns into one calculation run. A red threshold below the amber one is 422 `kpi_threshold.order`, "The red threshold cannot be below the amber threshold.".
- **Trajectories:** points are fixed at creation. Approval is an in-product business approval by `kpi_target.approve` (SP, BO), never by the creator (403 `target_trajectory.approver_is_author`). It supersedes the previously approved trajectory of the KPI and scope and writes one `kpi.trajectory_approved` event.
- **What `thresholds.test.ts` shows:** the stored threshold versions and the approved trajectory, read back through the API and fed to KBE-A's `expectedToDate` and `evaluateRag`, give **Red** (d = 0.15 > 0.10) for actual 85 against expected 100 under version 1 (0.05/0.10), and **Amber** under version 2 (0.10/0.20). `evaluateRag` has no task-completion input.
- **Owned by KBE-C:** the literal end-to-end proof (an accepted actual, then a run, then the stored evaluation) belongs to the run (§A.7: "KBE-C (run)").

### REQ-S07-011, graph half (with KBE-A's unit half)

> **Acceptance (A05):** "KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected"

- **The literal example:** A = `b + 1` is created and activated. B = `a * 2` is then 422 `kpi_formula.circular`, "The formula would create a circular reference: KPI B → KPI A → KPI B.", and nothing is written.
- **Other cycles:** a self-reference ("KPI X → KPI X") and a three-KPI cycle ("KPI R → KPI P → KPI Q → KPI R") are refused. With two drafts that reference each other, the first activation succeeds and the second is refused.
- **Last line:** the database trigger `kpi_formula_no_cycle` maps to 422 `kpi_formula.circular`.
- **SAR plus a count:** 422 `formula.kind_mismatch`, with the engine's own text "Kind mismatch: r (currency) + c (count) is not allowed".
- **Other unit refusals:** a result in another unit is 422 `kpi_formula.unit_mismatch` ("The formula gives count (lines), but the KPI is measured in SAR."). An input that is not a KPI of the transformation is 422 `kpi_formula.input_unknown_kpi`.
- **"On save and publish":** the cycle and the units are checked at version creation and again at activation. A source KPI without a version may have changed its unit in between; that case is tested and refused at activation.

## 4. Operations routed (delta to `p4-pending-kbe-b.ts`)

Removed (18): `listKpiDictionary`, `getKpiDictionaryEntry`, `listKpiVersions`, `createKpiVersion`, `getKpiVersion`, `updateKpiVersion`, `activateKpiVersion`, `withdrawKpiVersion`, `listKpiRagThresholds`, `createKpiRagThreshold`, `listTargetTrajectories`, `createTargetTrajectory`, `getTargetTrajectory`, `approveTargetTrajectory`, `withdrawTargetTrajectory`, `listDataQualityFindings`, `getDataQualityFinding`, `resolveDataQualityFinding`.
Still pending (1): `requestKpiVersionApproval`.

S-3: every JSON-body route declares `consumes: ["application/json"]`; the bodiless `activateKpiVersion` declares none. The contract test's `consumesDrift` is empty, and the live media-type sweep passes.

## 5. Checks actually run (environment: Node 24.21.0, offline; PostgreSQL 16.13 disposable clusters on ports 23200 and 23210, pool 23201–23249)

All logs are under `docs/delivery/handbacks/DG4/T-DG4-KBE-B-evidence/`. Every row below is from the **final** tree (the last source change was made before these runs). Empty `.claude/.cc-writes` directories in source folders were removed before the tests, as the assignment requires.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages clean | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages built | `build.log` |
| 3 | `pnpm lint` | 0 | no findings | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 436 operations` (unchanged) | `openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | 1st Vitest invocation: **101 files, 2001 passed**; 2nd (`unit-formula-nocodegen`): **3 files, 259 passed, 2 skipped** | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2001 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=23200 MTH_PORT_POOL=23201-23249 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **66 files, 883 passed** (PostgreSQL 16.13, UTF8 / C) | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3.log` |

**Counts against the base** (base commit `ab51be8` message: "merged tree verified: unit 1999+259/2, integration 847"):

- **Unit:** 1999 → 2001 (+2). The kpi suite's per-file "never a float" check now also covers the two new kpi source files, `rag-thresholds.ts` and `kpi-outbox.ts`.
- **Integration:** 847 → 883 (+36): `versions` 10, `formulas` 8, `trajectories` 8, `thresholds` 5, `data-quality` 5. The contract test stays at 44 tests; the "P4 KBE-B operations" case now exercises 18 operations.

**Pinned-count change:** `contract.test.ts`, request media types `[155, 154, 1]` → `[163, 162, 1]` (+8 JSON-body operations; §2).

**Non-zero exits during development (disclosed; all fixed before the final runs above):**

1. **Contract exercise, first run** (exit 1): my fixture inserted `calculation_run.started_at` from the client clock, which was later than the database `now()` (`calculation_run_times`). Fixed: it now uses `now()`.
2. **`versions.test.ts`, first run** (exit 1): the test used `limit=200`, above the platform's maximum limit. Fixed in the test (100).
3. **`formulas.test.ts`, first run** (exit 1): my zod mirror defaulted `inputBasis`, but the contract makes it required, and the harness rejected the request. Fixed: the mirror requires it and the tests send it.
4. **`thresholds.test.ts`, first run** (exit 1): I expected 404 for an out-of-scope **write**. The platform's commit-time authorization answers 403 (§9). The assertion was corrected; the read stays 404.
5. **Unit, first full run** (exit 1, 7 failures in both locales): static source checks.
   - `kpi → jobs` import is outside the module boundary. Fixed with `kpi-outbox.ts`.
   - Computed non-literal member access in `kpi-versions.ts`. Rewritten with `Map`s and explicit objects.
   - `Number(` in cursor parsing. Now `Number.parseInt`.
   - A lock-class number in a comment.
   - The kpi suite's route and permission pins. Updated (§2).
6. **Integration, first full run** (exit 1; kept as `integration-run1-stale.log`): 881 passed, 2 failed.
   - The media-type pin, updated afterwards.
   - My new "units re-checked on publish" test. The suite had loaded the API module before I added that re-check, and picked up the new test file mid-run. The same test passes in the final run.
7. **No flaky test and no timeout** in the final runs.

## 6. Shared rules (S-1 … S-14), as implemented

| Rule | How it is met |
|---|---|
| S-1 | Every free-text member goes through `freeText`: blank text is 400 `validation.blank`, invalid characters `validation.invalid_character`. |
| S-2 | No route-local parser. |
| S-3 | See §4. |
| S-4 | Every mutation runs `openWrite(…, { atCommit: true })`, so authorization is re-checked inside the transaction: a grant revoked meanwhile is 403 and an ended session 401 (one test per file). It also has zod validation then business rules (422), and `If-Match` (428/409; creates are version 1). Each changed row gets one audit event in the same transaction, and a refusal writes nothing. There is no remote I/O. |
| S-5 | Every value is a decimal string, written through `measureDecimal` (no rounding: over-scale is 400) and read back with `canonicalDecimal`. JSON numbers are 400. The kpi suite's "never a float" source check covers the new files. |
| S-6 | API problem `code`s are i18n keys. The Arabic and English rendering belongs to FE-B and FE-A. |
| S-9 | Nothing under `packages/shared/src/formula/**` changed. |
| S-10 | See §4. |
| S-11 | Every ADR-0027 §13 code and text is used verbatim. |
| S-12 | No migration. |
| S-14 | No module write to `approval*`. Activation only reads `approval` for the `business_approval` check. |

## 7. What remains (separable; not done)

1. **`requestKpiVersionApproval`** and the **`kpi_version_activation` subject provider** (`registerApprovalSubject('kpi_version_activation', { currentVersion, onOutcome })`, whose `onOutcome('approved')` must not activate). Both need BE-B's `workflows/approvals.ts`. In this tree it is the T-DG4-BE-A stub, and S-14 forbids writing `approval` directly.
   - **Plan once BE-B merges:** a route in `kpi-versions.ts` that locks the draft (If-Match on the version), requests the approval through the service (assignee party `BO` by default; SoD: the requester is excluded), stores `approval_id` on the draft with version + 1 and one audit event, and returns 201 `Approval`.
   - **Also then:** register the provider in the kpi module, add the exercise and the activation-after-approval test, and empty `p4-pending-kbe-b.ts`.
   - **Activation is already ready:** it accepts a version whose `approval_id` names an approved `kpi_version_activation` approval of the version (and the trigger `kpi_version_approval_required` checks the same).
2. **Nothing else of §A.2 is open.**

## 8. Contract or schema needs for the orchestrator

- **Schema:** none. No migration and no repair-range number needed.
- **Contract:** none. `openapi.yaml` is unchanged, and `pnpm openapi:lint` gives PASS with 436 operations.
- **Decisions requested:**
  - (a) accept the 3 registry lines in `events.ts`, or move them;
  - (b) keep `kpi/kpi-outbox.ts`, or add `jobs` to kpi's `dependsOn`;
  - (c) accept the `kpi.test.ts` and `contract.test.ts` pin updates.

## 9. Observations and disclosures

- **Codes not in ADR-0027 §13.** Where the ADR names no code, a refusal uses an existing generic one:
  - `validation.constraint` (422) for:
    - a binary milestone without the milestone value nature (or the reverse);
    - a milestone due date on another measure;
    - ratio labels on a non-ratio KPI;
    - a baseline given both as a record and as a value;
    - data-quality minimum above maximum;
    - formula expression vs calculation method;
    - formula inputs on an entered KPI;
    - a variable listed twice;
    - a negative threshold;
    - an unrepresentable imported point.
  - `validation.reference` (422) for an unknown reviewer party, a baseline of another transformation, and an outcome-KPI row that is not of this KPI.
  - `kpi_definition.archived` (422) for a version, threshold or trajectory on an archived KPI.
  - An imported outcome-KPI row without points uses `target_trajectory.points_required`.
  - The reviewers and FE-B may want explicit ADR codes for these.
- **Database last-line limits.** The database cannot say which field failed. `kpi_version_complete_when_active` maps to `kpi_version.aggregation_rule_required` in every case; the service checks the ratio labels and the milestone due date first, with their own codes. `kpi_version_aggregation_fits_nature` maps to a text without the `{aggregationRule}`/`{valueNature}` placeholders; the service sends the exact parameterized text first.
- **Commit-time authorization on writes.** Following the platform rule (F-DG2-440, `openWrite` with `atCommit`), a write by a caller without the read right answers **403**, not 404. Reads outside the scope stay 404. The P3 routes behave the same way.
- **Formula check order.** The cycle walk runs before the unit check, so a circular reference is reported as circular whatever its units.
- **KBE-A library.** No defect found. One observation: the DG3 engine refuses `b + 1` for a **monthly** KPI as `formula.period_mismatch` ("b is per month but 1 has no period"), because KBE-A maps monthly to the period `month`. The literal A05 example is therefore demonstrated with ad-hoc KPIs (period `none`). This is the engine's documented rule (seam 5), not a library defect.
- **Untracked files at the top level** (`.bashrc`, `.gitconfig`, `.zshrc`, `CLAUDE.local.md`, `.mcp.json` and others): runner and home artefacts that are not mine. I did not touch them, and they are not part of this change.

## 10. Merge instructions

- **Ordering:** no migration. Merge after BE-A (merged) and before KBE-C (§A.6).
- **Expected conflicts:**
  - `platform/db-errors.ts`: KBE-C appends after my `mapP4KpiGuardError` block.
  - `contract.test.ts`: other tasks also change the media-type pin. Add the counts: +8 JSON for this task.
  - `schemas/index.ts` and `events.ts`: one appended line or block each.
  - `kpi.test.ts`: KBE-C adds its own operation list.
- **`kpi/routes.ts`:** unchanged. Its existing KBE-B lines call my files; the thresholds are registered from `registerKpiVersionRoutes`.
