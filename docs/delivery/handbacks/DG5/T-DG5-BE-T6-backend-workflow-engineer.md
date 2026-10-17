# Handback T-DG5-BE-T6 (backend-workflow-engineer): the roaming chains read exactly as B0147 writes them

- **Stage:** DG5 (P5), repair task under D-168 (REQ-PB-090; B0146–B0147, M0347).
- **Invocation:** `DG5-T-DG5-BE-T6-backend-workflow-engineer-20261017T175756Z-034ff1df`, session `034ff1df-073d-40d4-ba4f-44a377c719e0`.
- **Base:** branch `dg5/be-t6`, `HEAD` `4372448b7cccd721a2068c3bcd953d287d0b9e11`. The assignment file's sha256 matched (`9ed92a53…7a`).
- **Time:** started `2026-10-17T17:58:11Z`, ended `2026-10-17T18:28:43Z`.
- **Changes are uncommitted**, as the assignment asks.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, both at the start and at the end (`T-DG5-BE-T6-evidence/validate-dg4-historical.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/src/demo/data/kpis.ts` | The three chain KPIs are named as B0147 writes them: "Attach rate / activation", "Complaint rate", "Cost/MB, margin". The descriptions keep the roaming wording (for example "Roaming attach rate: share of …"), so no context is lost. |
| `packages/db/src/demo/data/benefits.ts` | The three chain benefits are titled as B0147 writes them: "Revenue uplift", "CX + care cost", "Margin improvement". B02's description now explains "CX + care cost", and still says the value counted is avoided care cost, not a cash saving. |
| `packages/db/src/demo/data/business-cases.ts` | Every text that cited the old names now uses the new ones: the three formulas' `benefitName`, the three KPI variable `source` texts, and the three benefit case-line titles. The titles are now "Revenue uplift (annual run-rate at target)", "CX + care cost: avoided care cost (annual run-rate at target)" and "Margin improvement (annual run-rate at target)". No number changed. |
| `packages/db/src/demo/data/roaming-chains.ts` | Each contribution names its outcome KPI (`outcome_kpi_id = rtId(RT_BLOCK.outcomeKpi, n)`), so the `initiative_kpi` edge ends at the KPI and each line has exactly five nodes. The seed also fails loudly if a chain KPI's name or a chain benefit's title is not B0147's column. The header comment is updated. |
| `packages/db/test/integration/demo-numbers.test.ts` | The KPI names in the stale-KPI and chain-benefit assertions are updated (no other edits). |
| `packages/db/test/integration/demo-roaming.test.ts` | Only my `REQ-PB-090` describe block and one header comment line changed. It now checks a five-step walk over `traceability_edge`, the literal line of each chain, that no `initiative_kpi` edge ends at an outcome, and that no row still carries a pre-D-168 name. |
| `apps/api/test/integration/environment/demo-traceability-chains.test.ts` (**new**) | The integration test of the assignment. It seeds the real demo dataset into a scratch database, starts the real API (`MTH_ENV=demo`), signs in the demo TL, and reads `getTraceability`, the operation the web traceability screen calls (`useTraceGraph`). It reads the whole graph and, for each chain, the graph downstream from its diagnosed issue, then asserts the literal B0147 line. Negative cases: the demo access administrator gets 403/404 and the response holds no chain text; an anonymous request gets 401. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T6-evidence/*` | Logs of every check below. |

There is no migration, no API endpoint, no contract or schema change and no dependency.

## 2. Behaviour delivered

**REQ-PB-090.** Acceptance (D-168): "A01: the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift'".

- On a seeded demo database, `GET /api/v1/transformations/{t}/traceability` now returns, for each chain, exactly one edge per step: `issue_gap`, `gap_initiative`, `initiative_kpi` (to the `outcome_kpi`), then `kpi_benefit_measure`. The node labels read:
  - `Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift`
  - `High complaints -> Journey + service assurance -> Proactive comms + QoS monitoring -> Complaint rate -> CX + care cost`
  - `Partner cost pressure -> Partner model + analytics -> Partner optimization -> Cost/MB, margin -> Margin improvement`
- This holds both downstream from the issue (`rootType=diagnostic_finding&direction=downstream`) and in the whole-transformation graph. The test spells the expected lines out from the B0147 table; it does not derive them from the dataset.
- **Control.** With `outcome_kpi_id` put back to `null`, the new test fails all three chain cases with `expected 'outcome' to be 'outcome_kpi'` (exit 1, `control-outcome-kpi-null.log`). The file was then restored.
- **Synthetic and deterministic.** Every value is synthetic and no number changed. The determinism test in `demo-roaming.test.ts` passed: "a second seed into a fresh database gives identical record counts and checksum". `demo.test.ts` (the reset tests) passed too.

## 3. Checks run (one at a time, D-164)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | `build.log` |
| 3 | `pnpm lint` | 0 | `lint.log`. It ran before the prettier reformat of three files, so `npx eslint --max-warnings=0` was run again on those three files: exit 0 (`lint-after-format.log`). |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. The first two attempts exited 123 on my own files; I fixed them with `prettier --write` and reran. |
| 5 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations" |
| 6 | `npx vitest run --configLoader runner --project unit-node packages/db`, locale unset | 0 | 4 files, **72/72** passed (`unit-node-db-locale-unset.log`) |
| 7 | the same with `LC_ALL=C.UTF-8` | 0 | 4 files, **72/72** passed (`unit-node-db-c-utf8.log`) |
| 8 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration packages/db/test/integration apps/api/test/integration/environment/demo-traceability-chains.test.ts tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts`, locale unset | **1** | 15 of 16 files passed; **250/251** tests passed, **1 failed** (`integration.log`). See below. |
| 9 | the same harness with only my new test and `demo-roaming.test.ts` | 0 | 2 files, **74/74** passed (`first-try.log`) |
| 10 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS |

**The one failure is pre-existing and not caused by this change.**

- **The failing test:** `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`, "REQ-S06-003 … drives every instance through its steps …". It fails on `new_transformation_intake: "draft_charter (TL): 404 not_found"`. This is the procedure-intake path of D-166, which has nothing to do with chain names.
- **It is deterministic:** it fails the same way with my change applied (`a02-rerun-with-change.log`).
- **Control without my change:** I wrote the `HEAD` content of all six modified files back with `git show HEAD:<file> > <file>`, then ran `a02` alone: exit 1, the same failure (`control-a02-head-without-change.log`). After that I restored my files and checked that `git diff` is byte-identical to the patch I saved before.
- **Disclosure:** my first attempt at this control used `git checkout`. The sandbox refused it (`index.lock: Read-only file system`), so that run executed **with** my change. Its log is named for what it really is (`a02-rerun-with-change.log`).
- **Owner:** whoever owns the intake procedure or `a02`. It is probably the T-DG5-BE-T5B line (procedures and approvals in `apps/api`), but the orchestrator should confirm.

The other files of check 8 passed: `packages/db/test/integration` (all 12 files), the new test (6/6), `a15-demo-transformation-outputs` (7/7) and `a22-operational-readiness` (8/8).

**Not run, D-164:** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. The web Vitest project was not run either: no web file, fixture or string names the changed KPIs or benefits (I checked with grep).

## 4. Operations routed

None. This task adds no route, so it has no `p5-pending-*` delta and no change to the `contract.test.ts` pinned counts. The new test reads the existing `getTraceability`.

## 5. Contract, schema or dependency needs

None.

## 6. User-facing texts

- The KPI names and benefit titles are seeded record content. Like every other dataset text, they are stored in English only and are not i18n keys; this is unchanged from before. No en/ar string in `apps/web/src/i18n` names the old KPIs or benefits, or calls the chains planned, so no string became untrue.
- Only historical handbacks (T-DG5-BE-T, T-DG5-KBE-H, T-DG5-AN-P5A) still cite the old names. They are records of their time and I did not edit them.

## 7. What remains, and notes for the orchestrator

1. **The `a02` REQ-S06-003 failure** (§3) is pre-existing at `4372448` and outside my ownership. It needs an owner.
2. **Two notes on `roaming.ts`**, which is outside my named files, so I did not edit it:
   - Each chain's outcome statement (`roaming.ts` ~line 667, `statement: c.kpi`) is still the B0147 KPI text. So in the whole graph, an outcome and its outcome KPI now share the same label (for example "Attach rate / activation"). The outcome is **not** on the line (the line goes initiative → outcome KPI), so the acceptance is met.
   - The comment above it, "the chain's KPI step in the traceability view", is no longer accurate.
   - A one-line follow-up for the owner of `roaming.ts`: take the outcome statements from the B0145 outcome items instead (for example "Higher attach/activation", "Fewer complaints", "Improved partner economics"), and correct the comment.
3. **D-168 is not in `docs/delivery/decisions.md`.** It is cited only in the DG5 W22 assignments. I followed its text as quoted in this assignment. The orchestrator should record it in the register.
4. **Environment:** the worktree shows untracked sandbox mount points at the top level (`.bashrc`, `.mcp.json`, `.gitmodules`, … are `/dev/null` character devices) and `CLAUDE.local.md`. They are not mine; don't integrate them. I removed one empty `.claude/.cc-writes` directory that appeared under `packages/db/src/demo/data/` during my edits.

## 8. Merge instructions

- No migrations and no ordering constraints.
- Expect no conflicts with T-DG5-BE-T5B (`roaming-ids.ts`, `roaming-states.ts`, `apps/api` source) or T-DG5-FE-D5B (`apps/web/**`). My only `apps/api` file is the new test. In `demo-roaming.test.ts`, my edits are confined to the `REQ-PB-090` describe block and one header comment line.
