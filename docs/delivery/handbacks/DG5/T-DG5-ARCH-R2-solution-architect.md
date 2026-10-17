# Handback T-DG5-ARCH-R2 (solution-architect): the R1 amendments brought to the built state (D-167)

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-R2-solution-architect-20261017T170031Z-73d5e542","session_id":"73d5e542-5bc3-4c20-8f08-2d63902d0ffb"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-ARCH-R2.md`. I checked its sha256 before starting: `e3eeaaf5a4d427c029fca73c244a53b28c13b396e992ee8c8823d1527094329e`, which matches.
- **Base:** branch `dg5/arch-r2` at `f78afff972069b59b5df9ad0d200c967070d3e10` (D-167, W1–W21 merged). The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` was `Sat Oct 17 17:00:47 UTC 2026` at the start and `Sat Oct 17 17:09:41 UTC 2026` at the end of the checks.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0, at the start and at the end (§3).

No agent grants a real business, Finance or IT approval. Product gates G1–G6 are business approvals inside the product and stay separate from DG0–DG7. The playbook and the product are not called an official PMI standard anywhere.

## 1. Changed files

Every change is under `docs/architecture/**`, plus this handback and its evidence folder.

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0042-…-coverage.md` | A dated "brought to the built state" note. V2: the gap reference is pinned to `6f8ce12`, and `steps.ts:911` → `:994`. A new block, "Rule A as merged", covers the `0096` guard conditions, the API adoption and its audit action, the routing wait, the retry, and the tests. A new block, "Who reads and acts on an adopted step (D-167 clarification)", is marked decided by D-167, implemented by T-DG5-BE-T5 (W22). V3: the UI bullet now describes FE-D4's merged output-record choice. |
| `docs/architecture/adr/ADR-0044-…-notification-policy.md` | Header: Rule B is merged and verified (D-167), and the B0 line reference is pinned to `6f8ce12`. New **B3** "Rule B as merged" confirms that B1 and B2 match the code. New **B4**: `dependency.slipped` v1 reaches the relay, decided by D-167, implemented by T-DG5-BE-T5 (W22). |
| `docs/architecture/adr/ADR-0043-…-failure-queue.md` | S2: `dependency.slipped` has no sample at `f78afff` (with evidence). A dated sub-bullet says it will be registered and its `samplePayload` served, decided by D-167, implemented by T-DG5-BE-T5 (W22). |
| `docs/architecture/adr/ADR-0050-…-walkthrough.md` | D3 "In-app reset": now describes the built state (the worker keeps the dev binding), with evidence and tests. |
| `docs/architecture/adr/ADR-0039-…-publish-pipeline.md` | C2: one dated line says D-167 confirms the one-off framing. The text itself is kept unchanged. |
| `docs/architecture/data-dictionary.md` | The `procedure_step_instance.transformation_id` row, the section intro, the `0096` row of "Changes to earlier tables", the transition table (conditions as merged, with `0096:` lines), the routing paragraph (wait and retry), and a D-167 paragraph on who acts on an adopted step (W22). |
| `docs/architecture/erd.md` | §1r: the `0096` bullet now says "merged, D-167" and names the guard function. |
| `docs/delivery/handbacks/DG5/T-DG5-ARCH-R2-evidence/*.log` | Logs of the checks. |

## 2. Item → amendment → evidence (acceptance 3)

All `file:line` references are to `f78afff`. I printed each one with `sed -n` before writing it down.

| # | Item | Amendment (where) | Evidence (`file:line`) |
|---|---|---|---|
| 1a | Rule A: the `procedure_step_instance_row_guard()` conditions | ADR-0042 V2 "Rule A as merged" (database guard); data dictionary `0096` row and transition table; ERD §1r | `packages/db/migrations/0096_p5_intake_adopts_transformation.sql:27` (function), `:49–55` (identity immutable), `:59–63` (NULL → T, `pending` before and after, no other column except version/updated_at/updated_by), `:65–70` (instance: NULL transformation, `active`, `new_transformation_intake`, same organization), `:71–82` (output link, record type `transformation`, completed `capture_intake`, same organization), `:83–86` (refusal, `procedure_step_instance_identity_immutable`), `:89–92` (version step), `:99–100` (trigger re-created on this table only) |
| 1b | the audit action `procedure_step_instance.adopt_transformation` | ADR-0042 V2 (API); data dictionary (column row, `0096` row, transition table) | `apps/api/src/modules/procedures/steps.ts:722` `adoptIntakeTransformation`, `:745` the action; `:1203` (adopted record), `:1211–1218` (intake + `capture_intake` only, before `advance`) |
| 1c | the routing wait and its retry through the next instance action (`PATCH …/inputs`) | ADR-0042 V2 (routing wait, retry); data dictionary routing paragraph | `steps.ts:647` `ROUTING_WAIT_CODES`, `:650` `isAdopted`, `:694` (adopted step waits), `:994` `await_approval_unrouted`, `:703` `routeWaitingApprovals`, `:762`/`:765` `advance` retries first; `advance` callers `steps.ts:1219`, `:1236`, `:1330`; `apps/api/src/modules/procedures/instances.ts:436–438` (`updateProcedureInstanceInputs`, `PATCH /api/v1/procedure-instances/{instanceId}/inputs`); test `apps/api/test/integration/procedures/intake-adoption.test.ts:126`, `:241`, `:438` |
| 1d | D-167: an adopted step is read and acted on with T's authorization | ADR-0042 V2 "Who reads and acts on an adopted step"; data dictionary D-167 paragraph | Decided by D-167, implemented by T-DG5-BE-T5 (W22). Current (W21) state: `steps.ts:1142–1144` (`openStep` uses the instance's organization-scope read gate and write authorization). Not described as built. |
| 2 | Rule B as merged (`forwardFinishes`; the first allowed start is the forward finish date itself; external predecessors excluded) | ADR-0044 B3 (new). B1 and B2 are unchanged because the code matches them. | `apps/api/src/modules/portfolio/schedule.ts:179` `forwardFinishes`, `:218` `forwardFinish`, `:171–173` (start on the finish date itself), `:116` (`before_predecessor` only when `plannedStart < finish`), `:183` (external predecessor skipped), `:184` + `:82–84` (`isScheduled`), `:194`/`:196`/`:198–208` (own, shift), `:199`/`:202`/`:205–207`/`:192` (Unknown); `slip-events.ts:89–102` (initiative-to-initiative dependencies only), `:125–135` (before/after sets), `:155–156`, `:196–197` (`affected`); tests `schedule.test.ts:222–302` (incl. `:254` finish-date start), `tests/qa/integration/a13-dependency-slip-rule-b.test.ts` |
| 3 | ADR-0050 D3: the worker's in-app reset keeps the dev binding | ADR-0050 D3 "In-app reset" | `apps/worker/src/handlers/demo.ts:61–68` (`demoResetSettingsFromEnv` → `demoDevIssuerBindingAllowed`), `:17–20` (import from `@mth/db`), `:110` (passed to `resetDemo`), `:9–13` (header); `packages/db/src/index.ts:60`; `packages/db/src/demo/guard.ts:125–130`; tests `apps/worker/src/handlers/demo.test.ts:15–35`, `apps/worker/test/integration/demo-reset-dev-binding.test.ts:46`, `:63` |
| 4 | ADR-0042 V3: the output record is chosen in the UI | ADR-0042 V3 "UI" bullet | `apps/web/src/pages/procedures/InstancePage.tsx:368` (renders `CompleteWithOutput`), `:7`; `CompleteWithOutput.tsx:1–7`, `:94`, `:117`; `outputs.ts:55` `OUTPUT_SOURCES`, `:168` `scopeTransformationOf`, `:187` `eligibleRecords`, `:210–213` `completeBody`; test `instance-output.test.tsx:173`, `:263`, `:319`, `:374` |
| 5 | `dependency.slipped` v1 in `OUTBOX_EVENT_SCHEMAS`; the catalogue serves its `samplePayload` | ADR-0044 B4 (new); ADR-0043 S2 (dated sub-bullet) | Decided by D-167, implemented by T-DG5-BE-T5 (W22). Current state: `packages/shared/src/schemas/events.ts:42–49` (deliberately not registered), `:49–54` (`dependencySlippedV1`: `slipId`, `dependencyId`, `transformationId`, `slipDays`), `:175–214` (registry); `apps/api/src/modules/automation/samples.test.ts:49` (no sample today). Not described as built. |
| 6 | ADR-0039 C2: the `0094` trigger disable is a one-off exception | ADR-0039 C2: one "Confirmed 2026-10-17 by D-167" line; the text is kept | `packages/db/migrations/0094_p5_gate_approver_configured.sql:27–28` (disable), `:39–40` (re-enable) |

## 3. Checks actually run

Environment: worktree `/home/user/wt/dg5-arch-r2`, Node from the sandbox PATH, offline.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 17:00Z) | exit 0, `PASS gate DG4 (historical)` (`T-DG5-ARCH-R2-evidence/validate-dg4-historical-start.log`) |
| 2 | `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` (end) | exit 0, "All matched files use Prettier code style!" (`T-DG5-ARCH-R2-evidence/prettier-docs-architecture.log`) |
| 3 | `node tools/gates/validate.mjs --historical --stage DG4` (end, about 17:09Z) | exit 0, `PASS gate DG4 (historical)` (`T-DG5-ARCH-R2-evidence/validate-dg4-historical-end.log`) |
| 4 | Every cited `file:line` printed with `sed -n` against this tree | All match. Before writing, I corrected three references: `0096:50–54` → `:49–55`, `schedule.ts:115` → `:116`, and the slip-events ranges → `:125–135` and `:177–199`. |

Not run, because a docs-only change does not reach them: typecheck, build, lint, unit, integration and e2e. No code changed.

## 4. Known gaps and points for the orchestrator

1. **Items 1d and 5 are W22 work and are not described as built.** As the assignment asked, they read "decided by D-167, implemented by T-DG5-BE-T5 (W22)", and the texts state the current (`f78afff`) behaviour with evidence. After BE-T5 merges, a short follow-up could replace the "not in this tree" sentences with BE-T5's `file:line` references. The places are ADR-0042 V2's last block, ADR-0043 S2, ADR-0044 B4 and the data dictionary's D-167 paragraph.
2. **A naming difference that I recorded but did not resolve.** ADR-0044 §7 and B2 write the `dependency.slipped` payload as `{slipId, dependencyId, slipDays}`. The schema `dependencySlippedV1` also has `transformationId` (`events.ts:49–54`). B4 says so. I did not edit the §7 body, because the assignment allows a change only where the code shows it, and §7's text is a summary, not a schema. If you want the §7 sentence corrected in place, I can do it as a marked body correction.
3. **Something outside my items that I noticed and did not change.** ADR-0044 §7 gives the slip key as `<predecessor initiative id>:<schedule version>`. The merged code's comment spells it out as `<predecessor initiative id>:<milestone id>.<milestone version>` (`slip-events.ts:12–14`). This looks like a refinement of the same key, not a contradiction, but I did not verify it against `0075` in this task.
4. **The ADR-0039 C2 framing** is confirmed by D-167. The text is unchanged, with one dated confirmation line.
5. **No contract change.** No OpenAPI, schema or code file was touched. No gate reopen is needed.

## 5. Merge instructions

- Docs only: no migration, dependency or ordering constraint.
- Possible conflicts: none expected. BE-T5, FE-D5, AN-P5A and AN-P5B are assigned other paths.
- Do not integrate the untracked dotfiles at the worktree root (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json` and others). They were there at the start and are not part of this change.
