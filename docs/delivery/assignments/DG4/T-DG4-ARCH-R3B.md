# Assignment T-DG4-ARCH-R3B: salvage and completion of T-DG4-ARCH-R3 (solution-architect)

## Salvage of the interrupted run (D-103; the D-059/D-070 precedent)

- **What happened:** the first T-DG4-ARCH-R3 run started at about 08:43Z. A container restart killed it at 09:37Z, after about 55 minutes, before it finished its checks.
- **What it left:**
  - The orchestrator committed its working tree, unverified, as WIP commit `d74d75c` on branch `dg4/arch-r3`. That commit is your starting point.
  - The killed run's transcript is kept at `docs/delivery/test-evidence/DG4/arch-r3-orphaned/` **for provenance only**. Do not cite it.
  - Do not trust any partial log or claim the WIP contains. A log or handback text from before this run is stale: delete or rewrite it, and produce fresh evidence.
- **Your job:** this assignment is the complete scope. The original assignment, `docs/delivery/assignments/DG4/T-DG4-ARCH-R3.md`, is reproduced below unchanged.
  1. Review the WIP critically against the scope, the ADRs and the shared rules, as if someone else wrote it. Fix whatever is wrong or missing.
  2. Complete the remaining items.
  3. Run every acceptance check from scratch on your final tree.
- **About this WIP:** The WIP already holds every ADR amendment, the contract changes, the pending list and a near-complete handback; its §3 "Checks actually run" is an unfilled placeholder (`@@CHECKS@@`) and no evidence folder exists. So: review the WIP critically (the contract diff against `983fdfa`, every amendment, the code table), fix what is wrong, run every acceptance check from scratch, write the evidence logs, and fill §3 with the real exit codes. **Orchestrator answer to your §7 question:** the DG1-approved `Problem` schema has no `additionalProperties: false`, so it already admits extension members; declaring the optional `params` member changes no P1 response or validation and needs no DG1 reopen (D-114). State this in ADR-0038 Q1 as the reason.
- **Handback:** write it as `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-solution-architect.md` (the original task's name), with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/`. Add a section "Salvage" that lists:
  - what you kept from the WIP;
  - what you changed, and why;
  - what you added.
- **Time:** the 2-hour limit counts from your own start.
- **Concurrency:** the other three W17 tasks restart from their own WIP at the same time, in their own worktrees.

---

## Original assignment: T-DG4-ARCH-R3: P4 architecture repairs, round 3: contract gaps found by the screens, lineage wording, and open interpretations (solution-architect)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg4/arch-r3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Never run `git worktree add`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **Binding:** `docs/architecture/p4-plan.md` (D-089) and every DG4 decision `D-088` to `D-113` in `docs/delivery/decisions.md`. Read D-109 to D-113 verbatim.
- **You are the only writer of the shared contract files** (p4-plan §5.3). T-DG4-FE-F2, T-DG4-FE-G2 and T-DG4-QA-B run in their own worktrees and touch none of your files.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck, and write the handback listing exactly what remains.
- **Your harness ports are 23700–23749 only.**
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).

## Scope, in this order

Each item cites the handback that reported it; all are under `docs/delivery/handbacks/DG4/`. Every claim you write must be **enumerated and exactly true, never absolute** (D-088 §2; F-DG3-100).

1. **`getInitiativeSchedule`** (FE-D2 handback, "Contract gap"):
   - **The gap:** `/api/v1/initiatives/{initiativeId}/schedule` has `createInitiativeSchedule` (POST) and `updateInitiativeSchedule` (PATCH) but no read. `ScheduleNode` carries no version, so the UI cannot take an `If-Match` from a read; today it sends version 1 or the version learned from a 409.
   - **Do:** define the read, following the `getAdoptionMetricLink`, `getInheritedRecord` and `getBenefitPlanValue` precedents. State what a missing row answers.
   - **Implementers:** add it to a pending list; BE-R4 routes it and FE-R3 adopts it.
2. **A structured date on the Modular waiver refusals** (FE-F handback):
   - **The gap:** `gate.modular_waiver_revoked` and `gate.modular_waiver_expired` carry their date only inside the English text, so the UI cannot translate it.
   - **Do:** specify a structured member, for example an extension member or an `errors[]` item parameter. Follow the shape the contract already uses for parameters, and say which.
3. **Business units for the G5 scale scope** (FE-F handback):
   - **The gap:** the G5 approver (a Sponsor by default) cannot read the organization's business units, so the scale-scope editor offers only the transformation's own unit.
   - **Do:** decide how an approver chooses units for the scale scope: a scoped read, a permission default, or a stated limitation. Then specify it.
4. **Finance dashboard drill-down per value class** (KBE-G2 handback §5 item 5):
   - **The gap:** a per-class Finance line drills down only when it is the whole state's figure, because `getDashboardDrilldown` has no `valueClass` parameter and no metrics for measured, rejected or sustained.
   - **Do:** decide whether to add them (ADR-0037 §5 drill-down invariant) or to record the limitation with its reason.
5. **Older assessment-form versions** (FE-E handback):
   - **The gap:** a response recorded against an older form version shows answer keys, because the API returns only the current version's questions.
   - **Do:** decide on a version read, or the questions embedded in the record, or a stated limitation.
6. **Localized names in work-item message parameters** (FE-R1 handback):
   - **The gap:** `governance.task.minutes_to_approve` passes the forum's English name, so an Arabic reader sees it inside the Arabic sentence.
   - **Do:** decide the rule for record names in message parameters (both names, a code, or a record reference resolved at render time) and list every key it affects.
7. **Formula lineage wording** (KBE-R3 handback, "Two spec questions"):
   - PostgreSQL `jsonb` reorders keys, so "in `kpi_formula_input` order" cannot hold once stored. Amend ADR-0027 C1 so consumers look up `sources` by variable name.
   - State what a cumulative roll-up records for a scope that counts through earlier periods but has no accepted actual for the current period.
8. **Codes added since ARCH-R2.**
   - Re-run your mechanical code scan and diff it against ARCH-R2's output.
   - Extend the consolidated table from row 186 with each new code's ADR, acceptance and English text, including any code from items 1–7.
   - If nothing new is found, say so with the scan output.

## Outputs

- **ADR amendments:** dated amendments to the owning ADRs (ADR-0025 to ADR-0038 as needed).
- **Contract:** `openapi.yaml`, plus a new `apps/api/test/support/p4-pending-arch-r3.ts` for every new operation, imported by the aggregate exactly as ARCH-R2 did. Add the operation ids to the P4 set, and update the operation-count pin with its comment.
- **Migrations:** `0061` only if an item cannot be met without a schema change; say why.
- **Byte-stability:** keep every P1–P3 path and every existing P4 operation byte-stable, except the corrections above. List every changed contract line in the handback with its reason.
- **Implementer changes:** list the exact changes for the later backend task (BE-R4), any KPI/benefits task, and the frontend task (FE-R3).

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts. BE-R3 narrowed the G6 test to the gate records, so concurrent agent transcripts no longer trip it.
4. If you write `0061`, include its probe output.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R3-evidence/`. It must contain:
- each decision;
- the extended code table;
- every contract line changed;
- the exact implementer changes.

Leave your changes **uncommitted** for the orchestrator to integrate.
