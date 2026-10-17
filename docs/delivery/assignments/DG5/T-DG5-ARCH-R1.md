# Assignment T-DG5-ARCH-R1: ADR amendments for the DG5 repair waves (D-155 to D-166) (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/arch-r1`, at the integrated `HEAD` (W1–W20 merged, D-166).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** T-DG5-BE-T4 implements Rules A and B below in `apps/**` and `packages/db/**`. T-DG5-FE-D4 works on the procedure instance page. T-DG5-QA-E2 and T-DG5-QA-F2 write `tests/qa/**` and root `e2e/**`. You write only `docs/architecture/**`.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.

## Why

The repair waves after the slice architecture changed or added behaviour that the ADRs do not yet record. The DG5 reviewers read the ADRs as the design of record, so every such change must be in them before the freeze, as dated amendments (the T-DG4-ARCH-R1 precedent: `## Amendment (2026-10-17, T-DG5-ARCH-R1): …` at the end of the ADR).

## Task

Read each decision verbatim in `docs/delivery/decisions.md`. Read the handback it cites in `docs/delivery/handbacks/DG5/` and the merged code. Write one amendment per ADR, stating what is now true, with the decision ID, the migration, operation or file, and the requirement row. Correct the body of an ADR only where it is now false, and say so in the amendment.

1. **ADR-0039 §3 / ADR-0015 §2:**
   - every read that names a gate's approver reports the routed approver (`routedApproverOf`; T-DG5-BE-C3, D-163, D-164 a);
   - `gate_instance.approver_configured` (`0094`; T-DG5-BE-C4, D-164 b), its backfill from `gate_instance.configure` audit events, and the narrow trigger disable inside that migration.
2. **ADR-0041:** the `ETagOrZero` header of the custom-fields read of a record with no values (D-165, the D-153 precedent).
3. **ADR-0042:**
   - `procedures` v2 (`0095`; `record_baseline` → TL per REQ-PB-027; who gets it and why pins do not move; T-DG5-BE-T3);
   - **Rule A** below (`0096`; T-DG5-BE-T4), including the narrowed P2 identity guard;
   - the `ProcedureStepComplete` reading "verify and link only" (D-165).
4. **ADR-0043:**
   - the dry-run sample is the trigger's complete payload of schema version 1 (T-DG5-BE-C3);
   - `AutomationTrigger.samplePayload` with its placeholder `transformationId` (D-164 d; T-DG5-BE-C4, T-DG5-FE-D3).
5. **ADR-0044 §7:** **Rule B** below replaces the dependents' before/after computation. "No forecast is stored or overwritten" stays.
6. **ADR-0045:**
   - the optional `synthetic` member of the document (D-163; T-DG5-BE-N2), and `ReportEnvironmentPort` (D-164 e);
   - the declared table totals and the rule "only where the source screen shows one" as built (T-DG5-KBE-D3), with the tables that declare them;
   - the executive dashboard's KPI versions and sources (T-DG5-KBE-D4);
   - `WorkflowsReadPort.gateApprover` (T-DG5-KBE-D4);
   - the benefit totals taken by reference (`benefits/index.ts` `totalsOf`).
7. **ADR-0046:** B0004 on every XLSX sheet and as a CSV row, and the illustrative label in a demo snapshot's files (T-DG5-BE-N2); the KPI target as display text formatted per unit (T-DG5-KBE-D4).
8. **ADR-0049 §9 and §8:**
   - the shell renders only `GET /me/navigation` (D-163 a; the two DG1 journey pins changed and why);
   - the navigation background derived from `brand.primary` (D-163; T-DG5-FE-G2 `deriveNavigationBackground`; `nav.text-muted` = `nav.text`).
9. **ADR-0050 §2–§3 and §7:**
   - the demo access administrator `roaming.user.adm_access`;
   - the business-unit grants TL, TO and ADM_ACCESS, and why the other roles get none;
   - the dev-mode binding to the dev issuer (D-165; refused in production and in other auth modes);
   - the label implementation of §2 (d).
10. **`docs/architecture/data-dictionary.md`** (and `erd.md` where it lists columns): `gate_instance.approver_configured`; the adopted `procedure_step_instance.transformation_id` transition; `procedures` v2.

**Rule A, decided by D-166 (the intake adopts the transformation it produced; BE-T3 handback §3.3 option (a)).**
- When the `capture_intake` step of an organization-scope `new_transformation_intake` instance is completed with `outputRecordId` = T (a transformation), every step of the same instance that has not started gets `transformation_id = T` in the same transaction.
- This is the only change of `procedure_step_instance.transformation_id` ever allowed: from NULL to T, once; for a step that has not started; of an instance whose own `transformation_id` is NULL; and only to the transformation named by that instance's `capture_intake` output link. Repair migration `0096` narrows the P2 identity guard of `procedure_step_instance` to exactly this transition. Every other change stays refused.
- Each adopted step takes the P2 version step and one audit event.
- The instance keeps its launch scope (organization).
- Approvals of the adopted steps are requested on T and routed by T's role mappings (DG4 `resolveParty`, never a fallback). Until T has a mapped Sponsor, `confirm_sponsor` keeps today's truthful "awaiting routing" next action.

**Rule B, decided by D-166 (REQ-S12-012 "moves dependent forecasts per the logic"; M0232 "recompute forecast impacts using defined scheduling logic"; ADR-0044 §7).**
- `forwardFinish(S, set)` for an initiative S over a milestone set:
  - `own = predecessorFinish(S, set)` (ADR-0023 §5, unchanged);
  - if S has no scheduled finish-to-start predecessor, it is `own`;
  - otherwise `required` is the latest, over S's scheduled predecessors P, of the first date ADR-0023 §5 allows S to start after `forwardFinish(P, set)`;
  - `shift = max(0, required − S.planned_start)` in calendar days;
  - the result is `own + shift`.
- If S has a scheduled predecessor but no `planned_start`, or any input date is missing, the result is Unknown (`null`), never 0 or the unshifted date.
- Cycles cannot occur, because DG4 refuses dependency cycles.
- A slip's `affected` entries record `forecastFinishBefore = forwardFinish(S, before set)` and `forecastFinishAfter = forwardFinish(S, after set)`, for every initiative reachable from the slipped predecessor. The sets differ only in the slipped predecessor's milestone.
- Nothing is stored or overwritten except the slip's own `affected` evidence (ADR-0044 §7). A dependent with enough slack does not move; one with no slack moves by the slip.

## Rules

- Write only `docs/architecture/**`. Never edit `docs/source/**`, delivery records, reviews, gates, `tools/**`, `.claude/**`, `apps/**`, `packages/**`, `tests/**` or `e2e/**`.
- State only what the merged code and the decisions show. For Rules A and B, which T-DG5-BE-T4 implements during your run, write the decided rule and name `0096`. Mark them "implemented by T-DG5-BE-T4 (W21)".
- No product gate is an engineering gate: G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: amendment → decision → evidence (file:line, migration, operation), one row per item 1–10.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R1-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
