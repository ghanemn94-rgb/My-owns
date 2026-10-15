# Handback T-DG5-KBE-C2 (kpi-benefits-engineer): the diagnostic, TOM, business-case, roadmap and gate-pack assemblers

## Continuation run (T-DG5-KBE-C2B)

- **This run:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-C2B-kpi-benefits-engineer-20261014T232612Z-6ee650c7","session_id":"6ee650c7-ce20-44ea-88bb-0bfc9ec5e019"}`.
  - **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-C2B.md`. I verified sha256 `84bd593f…cf648d` at the start.
  - **Time:** start `2026-10-14T23:26:26Z`, end `2026-10-15T00:26:49Z` (`date -u`, after the final Prettier check).
- **Interrupted run:** `DG5-T-DG5-KBE-C2-kpi-benefits-engineer-20261014T214748Z-ee1c75f3` (session `ee1c75f3-998a-4b2e-8ac6-290a7a713cbb`). A container restart stopped it (exit 143) while it was writing this handback. The orchestrator committed its tree as WIP `4459ddf` on `dg5/kbe-c2` (D-147, D-151).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited 0 at the start of this run (`PASS gate DG4 (historical)`, printed to the console). It exited 0 again at the end (`validate-dg4-historical-end-B.txt`).

**What I found (handback compared with the tree):**

1. Every file in §1 exists and ends cleanly; none is truncated. Each of the five assemblers ends with its `assemble` export, and both test files close their `describe`.
   - `assembler.ts` has the five registry lines and imports, under the `// KBE-C2` comment.
   - The test counts match the handback: 9 unit tests, 8 integration tests.
   - The reads named in §2 are present: `presentCases`, `activeLinesOf`, `toBusinessCaseLine`, `loadCaseTotals`, `toDiagnosticItem`/`toDiagnosticFinding`, `toTomGap`/`toCapability` and `loadGateDefinitions`. `ENGINE_VERSION` is imported read-only from `@mth/shared/calc`.
   - `assertBasesNeverMixed` is in the integration test.
   - The computed-member fix of §8 item 2 is in: `business-cases.ts` has no `sections[…]`.
2. The handback was incomplete. `__END__`, `__CHECKS__` and `__REMAINS__` were still placeholders. I have filled them in (§3, §9).
3. The interrupted run's check logs are not evidence for the final tree:
   - `business-cases.ts` changed at 22:31Z, after its `typecheck.txt`, `build.txt`, `lint.txt`, `openapi-lint.txt` and `prettier.txt` (22:14Z–22:19Z).
   - Its last unit log, `unit-locale-unset.txt` (started 23:21Z), was cut off by the restart. It shows exit status pending and 1 failed test plus 1 error: `apps/api/src/architecture.test.ts` timed out at 30 s under load.
   - Its run-2 log, `unit-locale-unset-run2-timeout-under-load.txt`, shows the same `architecture.test.ts` timeout. It also shows one `apps/web/src/pages/raid/raid.test.tsx` failure under load ("Unable to find role=\"link\" and name \"Synthetic call the vendor\"").
   - Neither file is in my scope, and both pass in the `-B` runs below.
   - Its `integration.txt` (230 files, 2232 tests, exit 0) ran on the tree after the 22:31Z change. I re-ran it anyway.
   - All of these logs are kept unchanged for provenance and superseded by the `-B` logs.
4. No part of §F.2 was left unimplemented. I made **no source change** in this run. The only changes are this handback and the `-B` logs.

**What I re-ran on the final tree:** every acceptance check, one after another so that the runs did not load each other. The results are in §3, all with exit 0.

## Original run (T-DG5-KBE-C2), corrected where no longer true

- **Stage:** P5 / DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §F.2.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-C2-kpi-benefits-engineer-20261014T214748Z-ee1c75f3","session_id":"ee1c75f3-998a-4b2e-8ac6-290a7a713cbb"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-C2.md`. I verified sha256 `cda563ee…d824f` at the start.
- **Base:** worktree `/home/user/wt/dg5-kbe-c2`, branch `dg5/kbe-c2`. The base is `b8c9769` (D-150, W7 merged).
  - The orchestrator committed the interrupted run's work as WIP `4459ddf` after the restart.
  - This continuation's changes (this handback and the `-B` logs) are left **uncommitted**.
- **Time:** start `2026-10-14T21:48:04Z` (`date -u`). That run had no end time: it was stopped at about 23:2xZ.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited 0 at the start (`PASS gate DG4 (historical)`; `T-DG5-KBE-C2-evidence/validate-dg4-historical-start.txt`). It exited 0 again at the end of the continuation (§3).
- **Two gate systems.** A gate pack records what the product gate's evaluators and its decision say; it approves nothing. Product gates G1–G6 are business approvals inside the product, and nothing here reads or writes DG0–DG7. The G1 submission and Sponsor decision in the tests are synthetic demo actions that approve nothing real. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/reports/assemblers/diagnostic.ts` (new) | The `diagnostic` assembler (B0030). Four sections: T01 items, findings, baselines and value pools, each exactly its DG2 list route's rows in that route's order. |
| `apps/api/src/modules/reporting/reports/assemblers/tom.ts` (new) | The `tom` assembler (B0055, B0057). The ten canvas boxes, plus the gaps, design decisions and dependencies of those dimensions (the canvas read model), plus the capability heatmap. |
| `apps/api/src/modules/reporting/reports/assemblers/business-cases.ts` (new) | The `business_cases` assembler (B0083). Cases, the ten B0085 sections, lines, and totals taken from the DG3 totals engine. Formula-version labels; `formula_version` and `calculation_engine` version rows. |
| `apps/api/src/modules/reporting/reports/assemblers/roadmap.ts` (new) | The `roadmap` assembler (B0078, B0080). Waves, initiatives, milestones and initiative dependencies, exactly as `GET …/roadmap` lists them. |
| `apps/api/src/modules/reporting/reports/assemblers/gate-pack.ts` (new) | The `gate_pack` assembler (B0023). The gate, every criterion with its state (the evaluator output recorded with the current submission), the latest criterion review, and the submission's evidence. |
| `apps/api/src/modules/reporting/reports/assembler.ts` | The five registry lines and their imports (§F.9: appended next to KBE-C's two; KBE-D appends its own line). |
| `apps/api/src/modules/reporting/reports/assemblers/kbe-c2.test.ts` (new) | Unit tests of the pure rules, with worked fixtures (9 tests). |
| `apps/api/test/integration/reporting/kbe-c2-assemblers.test.ts` (new) | Integration tests: the five outputs against their routes, the §F.2 literal tests and REQ-S13-008 (8 tests). |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-C2-*` | This handback and its evidence logs. |

- No operation, route, migration (`0083` stays unused), schema, OpenAPI or dependency change.
- No `p5-pending-*`/`p5-exercises-*` change: §F.2 routes no operation, and the five outputs are reached through KBE-C's 11 routes.
- Nothing under `apps/web`, `tools/**`, `.claude/**`, `docs/source/**` or the delivery records was edited.
- The formula engine `packages/shared/src/formula/**` is unchanged. Its `ENGINE_VERSION` is only read, through `@mth/shared/calc`.

## 2. Behaviour delivered, per requirement row

### REQ-S13-004 (my part: diagnostic, TOM, business cases, roadmap, gate pack)

Acceptance (verbatim): *"A15: each of the ten outputs (charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard, handover) generates from the demo transformation and contains that transformation's ID and records"*. §F.2 test: *"each of the five generates from a seeded transformation and contains its ID and records; the gate pack lists every criterion of the gate with its state and evidence (the content REQ-S13-005's PPTX test needs)"*.

With this task, seven of the ten outputs have an assembler (charter, registers + these five). `meeting_minutes`, `executive_dashboard` and `handover` follow in KBE-D2, so the row completes there and in FE-E.

**How each assembler reads (ADR-0045 §1: "reads only through the owning module's services or read models").**

- `business_cases` reads through the kpi module's public index: `presentCases`, `activeLinesOf`, `toBusinessCaseLine`, `loadCaseTotals`.
- `diagnostic` and `tom` use the transformations presenters `toDiagnosticItem`, `toDiagnosticFinding`, `toTomGap` and `toCapability`. `gate_pack` uses methodology's `loadGateDefinitions`.
- Where the reader is out of reach, the query is restated with the same tables, predicates and order, and a test compares the result with the route (the KBE-C registers precedent). This applies to:
  - `canvasViews`: `workflows` is not a `reporting` dependency (modules.ts);
  - `loadRoadmap`: private to `portfolio`;
  - the baselines and value-pools `listPage`: the presenters are private to `kpi`.

**Test proof** (`kbe-c2-assemblers.test.ts`; one transformation created through the API by `setupP2World` + `makeG1Ready`). Every snapshot passes the `reportSnapshot` API mirror and contains `content.transformation.id` equal to the transformation's ID, and:

- **diagnostic:** the rows of `items`, `findings`, `baselines` and `value_pools` equal, id by id and in order, `GET …/diagnostic-items`, `…/diagnostic-findings`, `…/baselines` and `…/value-pools` (≥ 6 seeded T01 rows). The authored root cause is shown as written. The evidence cited is the verified note linked to the T01 rows and the baseline.
- **tom:**
  - the 10 canvas rows equal `GET …/tom-canvas` cells, in dimension order;
  - gaps, design decisions and dependencies equal the canvas's per-dimension records;
  - capabilities equal `GET …/capability-heatmap`;
  - a created gap and a created capability appear.
- **business_cases:**
  - cases equal `GET /business-cases?transformationId=…`, and lines equal `GET …/lines`;
  - totals equal `GET …/totals`, figure by figure: gross 125000 = 100000 revenue uplift + 25000 cash saving (the engine's own figures, worked fixture); implementation cost with its unknown-line count; net value.
- **roadmap:** waves, initiatives, milestones and dependencies equal `GET …/roadmap`, id by id. A created initiative shows its code and name.
- **gate_pack:**
  - **Unsubmitted G2:** every criterion of the gate definition is listed in order. Each state is Unknown (`not_computable`, no value), never complete; there is no evidence; `approvalState` is `not_submitted`.
  - **Submitted G1:** the rows are exactly the `criteria` of `GET …/gates/G1/submissions/{no}`. Each shows its completeness, mandatory flag, missing count, and English and Arabic catalogue labels, and every catalogue criterion appears.
  - **G1 evidence:** the evidence section lists the submission snapshot's evidence (the verified note, "verified at submission"). `listReportSnapshotEvidence` cites it. The sources include `gate_instance`, `gate_submission` and `gate_submission_criterion`, and `approvalState` is `pending`.
  - **After the Sponsor's synthetic demo approval:** the live pack shows `approved` and the decision outcome, while the earlier generated snapshot still says `pending`.
  - **Refusals:** a missing subject, or a subject that is not a gate instance, gets 422 `report.subject_invalid`.

### REQ-S13-008 (my part: the labels in these five assemblers)

Acceptance (verbatim): *"A10;A15: a pending benefit value is labelled provisional in the PDF pack"*. The PDF is BE-N's. §F.2 test: *"a business case whose formula version is not validated has provisional values"*.

Rules applied (ADR-0045 §5, through `provisional.ts`), and the column each reads:

| Assembler / value | Source column | Rule → label |
|---|---|---|
| business_cases line amount (financial benefit) | `benefit_formula.current_version_no` → `benefit_formula_version.validation_status`. This is the DG3 G4 rule (`formulaValidationOf`): no formula, no current version, archived, unvalidated or rejected all count as not validated. | 2 → `validated` only when the current version is validated, else `provisional` |
| business_cases totals (gross, per value basis, net) | the lines in the engine's set for that currency (and basis) | 2 → `provisional` if any line is, `validated` if all are |
| business_cases investment line / implementation cost | none (plan figure) | 6 → `not_applicable` |
| business_cases strategic non-financial line | `value_basis = 'non_financial'` | never monetised → n/a, no number, never 0 |
| business_cases baseline section | `baselineValidation` (`validated` only while the hash matches; `stale`, `unvalidated` and `rejected` do not count) | 3 → `validated` / `provisional` |
| diagnostic baseline value | `baseline.validation_status` + `validated_record_version` = `version` (`baselineState`) | 3 → `validated` / `provisional` |
| diagnostic value-pool amounts | `value_pool.validation_status` + `validated_record_version`. This is the same ADR-0019 Finance validation, so I labelled it like rule 3; see §6 item 3. | 3 |
| any missing amount, value, date or level | the column is NULL | 5 → `unknown` (`missing`), no number |
| gate criterion state | `gate_submission_criterion.completeness` | 6 → `not_applicable` (an evaluator fact, never labelled validated) |
| unsubmitted gate's criteria | no evaluator output on record | 5 → `unknown` (`not_computable`) |
| all other cells | record fields | 6 |

Tests:

- **Integration:**
  - the revenue line whose formula version 1 is unvalidated is `{value: "100000.0000", currency: "SAR", valueBasis: "planned", validation: "provisional"}` with `formula_validation: unvalidated`;
  - the line whose version FIN validated is `validated`, and the capex line is `not_applicable`;
  - an opex line without an amount is Unknown (`missing`), never 0;
  - gross and net are `provisional` (one line in each is), the `cash_saving` basis is `validated`, and the case baseline section is `provisional`;
  - the unvalidated diagnostic baseline is `provisional` with `valueBasis: "baseline"`. After FIN validates it, the live report shows `validated`; after a later edit, `provisional` again;
  - the unquantified value pool's amount and an unassessed capability level are Unknown;
  - `provisionalValueCount` and `unknownValueCount` count them.
- **Unit (`kbe-c2.test.ts`):** every formula fact, the line label for each kind and basis, the total rule, and the worked fixtures. The B0087 Δ attach × customers × ARPU line, unvalidated, is provisional. The volume × Δ unit cost line, validated, is validated. A missing amount is Unknown and not n/a.

### §F.2: the snapshot records one `formula_version` row per formula used and the `calculation_engine` row

Test: `listReportSnapshotVersions` of the business-cases snapshot returns exactly two `formula_version` rows `[code, "v1"]` (the two formulas used) and one `{versionKind: "calculation_engine", referenceId: null, referenceKey: "formula_engine", versionLabel: "mth-formula/1.0.0"}`, which is `ENGINE_VERSION`, read and never changed. The sources include both `benefit_formula_version` rows, with their validation states. The engine row is written only when a formula is used.

### §F.2: value bases are never summed together (D-117, D-119, D-122)

- Every table of every one of the five outputs is checked by `assertBasesNeverMixed`: each decimal column holds one value basis and one unit kind, and no table has a report total.
- The report adds no number of its own.
- The business-case totals are the DG3 engine's figures, one row per measure, per currency and (for gross) per business-case value basis. This keeps revenue uplift apart from cash saving, gross apart from cost apart from net, and currencies apart.
- A baseline's unit is free text, so its value column has the single unit kind `other`, with the unit and currency in their own columns. A column of mixed unit kinds would fail the document schema.

## 3. Checks (real exit codes; logs in `T-DG5-KBE-C2-evidence/`)

Environment:
- Node 24.21.0, offline, worktree `/home/user/wt/dg5-kbe-c2` at `b8c9769` plus my uncommitted changes.
- Harness ports: PostgreSQL 16 on 23950, pool 23951–23999.
- Empty `.claude/.cc-writes` folders inside source folders were removed before the runs.
- Four W8 tasks ran concurrently.

**Final results (continuation run T-DG5-KBE-C2B).** All checks ran on the final tree, which is WIP `4459ddf` plus this handback. They ran one after another. The `-B` logs are the evidence:

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | every package `Done` | `typecheck-B.txt` |
| 1 | `pnpm -r build` | 0 | every package `Done` | `build-B.txt` |
| 1 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no output | `lint-B.txt` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" in every batch | `prettier-B.txt` |
| 1 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint-B.txt` |
| 2 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 106 files / 1894 tests passed; unit-web 72 / 1400 passed; unit-formula-nocodegen 3 / 259 passed, 2 skipped (261) | `unit-locale-unset-B.txt` |
| 2 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | the same counts: 106/1894, 72/1400, 3/259 + 2 skipped | `unit-locale-c-utf8-B.txt` |
| 3 | `QA_PG_PORT=23950 MTH_PORT_POOL=23951-23999 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 230 files / 2232 tests passed (PostgreSQL 16.13 on port 23950, first attempt; 1584.9 s), including `kbe-c2-assemblers.test.ts` (8 tests) | `integration-B.txt` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical-end-B.txt` |

- **Unit tests of this task:** `kbe-c2.test.ts`, 9/9, in both locales.
- **Pinned counts:** no change. There is no media-type or rate-limit delta in `contract.test.ts`, and no other pinned count changed.
- **Skips:** the 2 skipped tests in `unit-formula-nocodegen` are already skipped at the base. They are not mine.
- **Failures:** there was no failed, flaky or timed-out test in any `-B` run.
- **Earlier failures, disclosed in the continuation section:** the interrupted run's unit logs show load timeouts in `architecture.test.ts` and one `raid.test.tsx` failure under load. They did not recur.
- **Superseded logs:** the original run's logs without `-B` are kept for provenance only.

## 4. Operations routed (delta to my pending list)

None. §F.2 routes no operation, so there is no `p5-pending-kbe-c2.ts` or `p5-exercises-kbe-c2.ts`, and the contract-test pins are unchanged (no media-type or rate-limit delta). The five outputs are reached through KBE-C's `getLiveReport` and `generateReportSnapshot`. Before this task they answered 404; now they answer 200 and 201. No contract or exercise test asserted the 404 (checked: the KBE-C refusal tests use `executive_dashboard` and `meeting_minutes`, which keep their behaviour).

## 5. Contract, schema or dependency needs (for the orchestrator)

1. **Live evaluation for an unsubmitted gate pack (port request; not blocking).** `reporting` may not import `workflows`, and `WorkflowsReadPort` (reporting/ports.ts) carries only the readiness summary.
   - **What I did:** a pack of a gate that was never submitted lists every criterion with state Unknown (`not_computable`). That fails closed: it is never shown as complete or green. A submitted gate's pack shows the evaluator output recorded with its submission, which is what the approver decides on.
   - **Proposal:** add `gateCriteria(db, transformationId, gateCode): Promise<GateCriterionEvaluation[] | null>` to `WorkflowsReadPort`, built next to `gate-readiness-read.ts` over `evaluateGate` + `loadGateFacts`, plus its one wiring line in `server.ts`.
   - **Then:** the gate pack can show a live evaluation, labelled as live, for an unsubmitted gate. None of these files is mine (ports.ts, `workflows/**`, `server.ts`).
2. **Roadmap schedule flags (not blocking).** The roadmap screen shows schedule flags computed by `portfolio/schedule.ts`, which `portfolio`'s index does not export. The report lists the records without the flags, rather than recomputing a business value (ADR-0045 §1). If the flags are wanted in the report, the request is a `portfolio` index export of `loadRoadmap` (or of `computeScheduleFlags` + `loadScheduleFacts`); the assembler would then switch to it.
3. No new problem code, no migration, no dependency.

## 6. Decisions taken inside my scope (for the domain reviewer)

1. **Business-case approval state = `not_applicable`.** DG2–DG4 have no business approval of a business case (no approval subject; its Finance baseline validation is a validation, not an approval). So each source row has none, and ADR-0045 §3's "mixed / common / not_applicable" rule yields `not_applicable`. The baseline's validation is shown as its own labelled column.
2. **Gate-pack criterion state is labelled `not_applicable`** (rule 6), not `validated`/`provisional`. Completeness is an evaluator fact, and "Provisional" next to "incomplete" would mislead. Unsubmitted criteria are `unknown`.
3. **Value-pool amounts carry their ADR-0019 Finance validation** like baselines (rule 3), so an unvalidated pool is never shown as validated.
4. **Recorded gate criteria and gate decisions** are append-only rows without a `version` column; their sources record `recordVersion 1`.
5. **Labels.** Section, column and code labels are i18n keys under `report.diagnostic.*`, `report.tom.*`, `report.business_cases.*`, `report.roadmap.*`, `report.gate_pack.*`, and code prefixes such as `report.gate_criterion.<key>` and `report.formula_validation.<fact>`. FE-E (web) and BE-N (the export label table) add their en/ar texts, as §F.11 item 10 assigns. The gate criteria also carry the catalogue's English and Arabic labels as system text.

## 7. User-facing texts made untrue

None found.
- I searched the en/ar catalogues under `apps/web/src/i18n/**` for texts calling reports, diagnostic, TOM, business-case, roadmap or gate-pack outputs planned or later; there is none.
- The `report_definition` descriptions seeded by `0080` already describe what the five outputs now contain (for example "One product gate with its criteria, evidence and decision state.").
- The web has no report pages yet (FE-E).

## 8. Failures during development (disclosed, all fixed before the final runs)

1. First run of the new integration file: 4 failures.
   - **Three were test mistakes:** `limit=200` above the routes' maximum of 100.
   - **One was a real defect:** an investment line without an amount was labelled `not_applicable` instead of Unknown, because an explicit n/a state also applied when the value was missing. Fixed with `presentState`: a missing amount is always Unknown. A unit test covers it.
   - **Re-run:** 8/8.
2. First full `pnpm test` (locale unset), exit 1: 2 failures, `architecture.test.ts` and `reporting.test.ts`. The boundary scanner flagged `c.sections[field]` in `business-cases.ts`, a computed member with a non-literal key. I replaced it with accessor functions. Both files then pass (143/143), and the final runs are in §3. The failed log is kept as `unit-locale-unset-run1-failed.txt`.
4. Two later full unit runs of the interrupted run failed under load, in files I did not touch:
   - `unit-locale-unset-run2-timeout-under-load.txt`: an `architecture.test.ts` 30 s timeout and a `raid.test.tsx` failure.
   - `unit-locale-unset.txt`: the same timeout. The restart cut this log off.
   - Neither recurred in the continuation's `-B` runs, which ran one after another (§3).
3. My first attempt to start the integration run in the background exited at once without running any test: the job was started with `&` inside an already-backgrounded shell, and it ended with that shell. It was restarted properly; the result is in §3.

## 9. What remains

- §F.2 is complete in code and tests. There is no separable second half.
- **REQ-S13-004** completes with KBE-D2 (`meeting_minutes`, `executive_dashboard`, `handover`) and FE-E (generate screens).
- **REQ-S13-008** completes with BE-M/BE-N (labels in the files) and FE-E.
- **i18n keys:** the en/ar texts for the `report.diagnostic.*`, `report.tom.*`, `report.business_cases.*`, `report.roadmap.*`, `report.gate_pack.*`, `report.gate_criterion.*` and `report.formula_validation.*` keys belong to FE-E (web) and BE-N (export label table) (§6 item 5, §F.11 item 10).
- **Optional port requests for the orchestrator:** §5 items 1 and 2. Neither blocks this task.

## 10. Merge instructions

- No migration and no ordering constraint beyond §F.9.
- `assembler.ts`: KBE-D adds its `executive_pack` line, and KBE-D2 its four lines, to the same registry map. Append-only merges; my five lines sit under the `// KBE-C2` comment.
- New test files only; no shared test file was edited.

