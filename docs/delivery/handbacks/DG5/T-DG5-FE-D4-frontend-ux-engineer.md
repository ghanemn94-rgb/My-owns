# Handback — T-DG5-FE-D4 (frontend-ux-engineer), stage DG5

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-FE-D4-frontend-ux-engineer-20261017T140341Z-b73f2368","session_id":"b73f2368-9e40-4c32-9612-8079ecc86d7f"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-D4.md`, sha256 `100602c0…ec612` (verified at start).
- **Base:** branch `dg5/fe-d4`, `HEAD` = `6f8ce12` (D-166). The changes are **uncommitted**, as assigned.
- **Time:** start `2026-10-17T14:03:58Z`; end `2026-10-17T14:51:59Z` (about 48 minutes; within the bound).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → exit 0, `PASS gate DG4 (historical)`. It was run at the start (`validate-dg4-historical-start.log`) and at the end (`validate-dg4-historical.log`).
- No business, Finance or IT approval was granted. All e2e data is SYNTHETIC. Nothing touches DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/procedures/outputs.ts` (new) | Covers the closed set of output record types of ADR-0042 §3, except `approval`, which the engine links itself. For each type it holds:<br>- the record type's **own list operation**;<br>- its native screen;<br>- a label;<br>- a pre-filter that mirrors the adapter's state rules in `procedures/outputs/**`.<br>Pure helpers:<br>- `chosenOutputOf`: the step's output is chosen only for `create`/`link`, never for `advance`, `approval` or no output;<br>- `scopeTransformationOf`: the instance's transformation, or the transformation an earlier step produced (kit.inScope, Rule A);<br>- `gateCodeOf`;<br>- `eligibleRecords`;<br>- `completeBody`. |
| `apps/web/src/pages/procedures/CompleteWithOutput.tsx` (new) | The completion form of a `create`/`link` step:<br>- a selector of the eligible records, read through the type's own list operation;<br>- the link to the native screen (text for "produce it" or "open it");<br>- "Reload the list";<br>- loading, empty, error and not-listable states, each with a text cue (the error shows its translated reason, never an empty choice);<br>- an optional note;<br>- sends `outputRecordId` with `If-Match`. |
| `apps/web/src/pages/procedures/InstancePage.tsx` | `StepActions` receives the pinned definition:<br>- a `create`/`link` step renders `CompleteWithOutput`;<br>- an `advance` step, or a step with no output, keeps the note-only form;<br>- the evidence and assignee selectors use `scopeTransformationOf` (an organization-scope instance acts in its produced transformation);<br>- header comment updated. |
| `apps/web/src/pages/procedures/instance-output.test.tsx` (new) | Unit tests per output kind, in en and ar (13 tests; §3). |
| `apps/web/e2e/p5-procedure-outputs.spec.ts` (new) | The e2e of Added scope 1, in chromium-en and chromium-ar. |
| `apps/web/e2e/p5-procedures-automation.spec.ts` | Added scope 2: the step shows TL; the main refusal is now `procedure_step.output_required`. Every other assertion is kept. |
| `apps/web/src/i18n/en/workflowsP5.json`, `apps/web/src/i18n/ar/workflowsP5.json` | One new appended block, `procedureOutput` (14 keys, en and ar). No existing key was changed. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-D4-evidence/**` | Logs, exit codes, and the screenshots of my own spec only (D-162). |

The untracked dotfiles at the root (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, …) and `CLAUDE.local.md` were there before this run. They are not mine and must not be integrated.

## 2. Behaviour delivered, per requirement row

### REQ-S06-002

> "A02: a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance"

**Before:** the instance page completed every step with a note only, so `record_baseline` (a `create` output of `baseline`) could never be completed from the screen.

**Now:**
- The step's form reads the step's output from the pinned definition.
- It lists the instance transformation's baselines through `GET /transformations/{id}/baselines` (`listBaselines`). Only baselines that are active, produced since the launch, and not already this instance's output are offered.
- When none exists, it says "No eligible record (KPI baseline) exists yet." and links `/transformations/{id}/diagnose#baselines`, where the baseline is recorded natively (DG2 `createBaseline`, with its own rules and audit event).
- After the person chooses the baseline, `outputRecordId` is sent.
- **Shown live, in en and ar:**
  - the step completes;
  - the baseline appears under "Output records";
  - `validate_baseline` becomes active, assigned to **FIN**.
- The FIN step is an `advance` and keeps the note-only form. The validation itself stays a human action by FIN in the DG2/DG3 baseline validation. The "validated baseline" part of the acceptance belongs to BE-G's adapter (advance = validated) and its integration test. I did not perform a Finance validation.

### REQ-S06-003

> "A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario"

Every `create`/`link` step of the ten seeded procedures can now be completed from the screen. The list operation and native screen used for each record type:

| Record type | List operation | Native screen |
|---|---|---|
| `transformation` | `listTransformations` | `/transformations/new` |
| `charter` | `getCharter` (one charter per transformation; no list operation exists) | — |
| `kpi_actual` | `listKpiActualReviewQueue` | `/kpis` |
| `tom_canvas_cell` | `getTomCanvas` (only cells whose status is `ready`) | — |
| `ranking_snapshot` | `listRankingSnapshots` | — |
| `gate_submission` | `listGateSubmissions` for the `gateCode` input | — |
| `change_request` | `listChangeRequests` | — |
| `finance_validation` | `listFinanceValidationQueue` | — |
| `decision` | `listExecutiveDecisions` | — |
| `bau_handover` | `listBauHandovers` | — |
| `evidence` | `listEvidence` | — |

`approval` outputs are not chosen here. They are linked by the engine when the business approver decides. Only the `baseline` path is proven live in the browser; the other types are covered by unit tests (`tom_canvas_cell`, `charter`) and the pure table tests. QA-E2 owns the full A02 browser run.

### REQ-S18-004

> "A02: an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records"

- The screen gap D-166 names, steps that produce records, is closed.
- An organization-scope intake reads `draft_charter`'s charter in the transformation that `capture_intake` produced, consistent with Rule A. This is covered by a unit test.
- The twelve-step browser run with the demo role users is QA-E2's (W21) and was not run here.

**Server refusals:**
- Every refusal is shown by its code in en and ar, in the page's single form-level alert (`useRunner`/`FormAlert`).
- All the codes these forms can receive already have en and ar texts in `problems.json`: `procedure_step__output_required`, `__output_record_invalid`, `__inputs_missing`, `__evidence_required`, `__not_assignee`, `__not_active`, `__decided_through_approval`, `procedure__not_active`.
- No key was added there, so there is nothing new to check for duplicates.

### Added scope 2: the refusal chosen

I chose **completing without an output → 422 `procedure_step.output_required`**, for three reasons:
- It is the refusal that the new form deliberately leaves to the server. There is no client-side block on a missing record, because the server is the authority, so it tests D-166's own behaviour.
- The TL reaches it naturally once the inputs and evidence are in place. The server checks inputs, then evidence, then output.
- The `dev.office` alternative depends on TO's `procedure.act` grant and scope. With the wrong grant it would answer a different 403 than `not_assignee`, which makes it a weaker test.

The test now:
1. asserts `TL` on `record_baseline`;
2. keeps every earlier assertion, screenshot and axe check;
3. provides the five inputs and links a synthetic evidence note;
4. clicks Complete with no record chosen;
5. asserts `data-problem="procedure_step.output_required"`, the en/ar text, and that the step is still active.

## 3. Checks actually run

All commands ran from `/home/user/wt/dg5-fe-d4` with Node 24.21.0, offline, one at a time (D-164). Exit codes are in `T-DG5-FE-D4-evidence/exit-codes.txt`.

| Check | Command | Exit | Result / log |
|---|---|---|---|
| DG4 historical (start) | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)`; `validate-dg4-historical-start.log` |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | `lint.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`; re-run after the last edit, still 0: `prettier-final.log` |
| OpenAPI lint | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`; `openapi-lint.log` |
| unit-web, locale unset, run 1 | `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --project unit-web` | **1** | **1 failed** / 1648 passed (87 files). The failure was mine: `glossary.test.ts` "spells the Transformation term consistently". My new Arabic string `noTransformation` wrote «التحول» without the shadda. I fixed it to «التحوّل». Log kept: `unit-web-locale-unset-run1-glossary-fail.log` |
| unit-web, locale unset, run 2 (after the fix) | same | 0 | **87 files, 1649 tests passed**; `unit-web-locale-unset.log` |
| unit-web, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | 0 | **87 files, 1649 tests passed**; `unit-web-c-utf8.log` |
| e2e, the two affected tests (first run) | `with-stack.sh npx playwright test apps/web/e2e/p5-procedure-outputs.spec.ts apps/web/e2e/p5-procedures-automation.spec.ts -g "My procedures\|Procedure outputs" --workers=1` (ports 23751/23752, pool 23753–23799) | 0 | 4 passed (chromium-en, chromium-ar); `e2e-own-specs.log` |
| e2e, both spec files in full, final tree (web rebuilt after the glossary fix) | `with-stack.sh npx playwright test apps/web/e2e/p5-procedure-outputs.spec.ts apps/web/e2e/p5-procedures-automation.spec.ts --workers=1` (ports 23761/23762, pool 23763–23799) | 0 | **14 passed** (2.4 min): every test of both files in both projects, axe clean (no serious or critical violation), no foreign request; `e2e-final.log` |
| DG4 historical (end) | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)`; `validate-dg4-historical.log` |

**Not run (D-164):** `pnpm test`, `pnpm test:integration` and the full e2e suite. They are for the orchestrator's merged-tree verification. Not run ≠ passed.

**A unit-test fix during development** (not a flaky test; disclosed for completeness):
- My first version showed a loading state, instead of the note form, while the definition loads.
- That broke 2 tests in `pages/automation/fed.test.tsx`. That file is not mine: it clicks "Complete step" before its stubbed definition 404 settles.
- I reverted to the earlier behaviour, where the note-only form shows until the definition is read. My tests wait for the definition-driven form.
- Effect: for the moment before the definition arrives, a `create`/`link` step shows the note-only form. A click in that window is refused by the server, by code, with `output_required`. Nothing is written.
- **For the owner of `fed.test.tsx`:** if a loading state is wanted there, that test should `await` the form.

**Interaction checks in the e2e:**
- keyboard-reachable controls driven by their labels (`getByLabel` with the en/ar labels);
- selecting a record;
- following the native link and back;
- the Diagnose dialog;
- the server refusal shown in the alert with its code;
- the step status transitions;
- the `outputRecordId` in the request body;
- axe at three states of the new spec (empty, chosen, done) and at the instance page of the updated spec.

**Screenshots (my own spec plus the updated instance page; D-162):** `docs/delivery/handbacks/DG5/T-DG5-FE-D4-evidence/screenshots/{en,ar}/`
- `p5-procedure-instance.png`
- `p5-procedure-output-empty.png`
- `p5-procedure-output-chosen.png`
- `p5-procedure-output-done.png`

## 4. Operations routed (delta to the pending list)

None. This is a frontend task: no API route was added, no `p5-pending-*.ts` changed, and `contract.test.ts` counts are unchanged. The screens call existing operations only: `completeProcedureStep`, plus the DG2–DG4 list and read operations listed in §2.

## 5. Contract, schema or dependency needs

- **No new dependency. No contract or schema change.**
- **Observation for the orchestrator (no action required for D-166):**
  - `kpi_actual` is listed through `listKpiActualReviewQueue`, the transformation-wide KPI actual list. That queue may list only actuals awaiting review. An already accepted or rejected actual that a `create` step could also accept would then not be offered.
  - The seeded `kpi_submission.submit_actual` names the actual right after it is submitted, so the main path is covered.
  - If wider coverage is wanted, a transformation-wide `listKpiActuals` with a status filter would be the contract need.
- `ProcedureStepInstance` in the read model carries no output kind. The page reads it from the pinned definition (`getProcedureDefinition` with `versionId`), which is correct but costs one extra read.

## 6. User-facing texts made untrue (F-DG4-160)

None found. I searched the en/ar catalogues for "planned", "not available yet" and "later" near procedures and outputs. No string called step outputs, or completing create/link steps, planned. The existing strings `workflowsP5.procedures.complete` and `approvalStepNote` stay true.

## 7. What remains

- Nothing from the Added scope is open.
- Outside my ownership:
  - the twelve-step demo-user browser run of REQ-S18-004 and the intake under Rule A are QA-E2's;
  - Rule A itself, the `transformation_id` adoption, is BE-T4's `0096`. Until it merges, an organization-scope intake's later steps read in the produced transformation through the output link, which is what the UI uses.

## 8. Merge instructions

- No migration and no ordering constraint.
- **Conflicts to expect:** the en/ar `workflowsP5.json` files end with my appended `procedureOutput` block. If another W21 task also appends a block at the end of these files, keep both blocks.
- The other W21 owners (BE-T4, ARCH-R1, QA-E2, QA-F2) do not edit `apps/web/src/pages/procedures/**` or the two spec files.
