# Assignment T-DG4-ARCH-R1: P4 architecture repairs — contract defects, open ADR decisions, repair migration `0060`, and the codes added outside the ADRs (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **Binding:** `docs/architecture/p4-plan.md` (D-089) and every DG4 decision `D-088` to `D-108` in `docs/delivery/decisions.md`. Read D-089, D-094, D-101, D-102, D-105, D-106, D-107 and D-108 verbatim.
- **You run alone on the shared contract files** (p4-plan §5.3). T-DG4-BE-R1, T-DG4-KBE-R1 and T-DG4-FE-C run in their own git worktrees; none touches your files. Every P4 slice is architected (ARCH-01 to ARCH-08) and every implementer task through W11 is integrated.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck, and write the handback listing exactly what remains.
- **Your harness ports are 23700–23749 only.**
- **Disk:** check `df -h .` before each full test run; under 3 GB free, stop and report it (D-104).

## Why this task exists

The DG4 implementers reported defects in the architecture deliverables and points the ADRs leave open. Each is listed below with the handback that reported it (all under `docs/delivery/handbacks/DG4/`). Read the cited handback section before deciding. Every claim you write must be **enumerated and exactly true, never absolute** (D-088 §2; F-DG3-100).

## Scope, in this order

### A. Contract defects (`docs/api/openapi.yaml`; `pnpm openapi:lint` must pass)

1. **ETag version 0.** BE-L's change-control policy GET and BE-L2's phase-step GET document `ETag: "0"` for a record that does not exist yet, but the shared ETag pattern and `currentVersion` start at 1 (BE-L and BE-L2 handbacks; KBE-G's RAG-policy GET reports the same). Decide one rule for "no row yet" reads (a pattern that admits `"0"`, or a 404/absent ETag), apply it to every affected operation, and tell the implementers (BE-R1 below) what to change. Remove the contract-check skips the implementers added for this once your rule makes them unnecessary, or list them for BE-R1.
2. **`createAdoptionMetricLink` `Location`** points to a single-link read the contract does not define (KBE-F handback). Either define the read or correct the header.
3. **Regex quoting.** BE-K2 and the orchestrator (D-108) fixed seven single-quoted `\\.` patterns. Search the whole contract for any remaining pattern that cannot match its intended values, and fix it.

### B. Schema type defect

4. `packages/db/src/schema.ts` types `benefit_overlap.dimensions` as `string`; the column is `text[]` (KBE-D2 handback). Correct the type and fix any compile fallout in `benefits/overlaps.ts` minimally (KBE-D2's workaround may then be removed).

### C. Repair migration `0060` (repair range `0058`–`0069`, D-094; `0058` and `0059` are taken)

5. Write **`0060`** only:
   - `job_schedule` rows for `governance.meeting_series_generate` (BE-F), the decision-SLA scan and the blocker scan (BE-G), with the cadences their ADRs state (ADR-0032; confirm the names against `apps/worker/src/queues/*.ts`);
   - the benefit `control_cadence` gains `weekly` (BE-I handback: a weekly BAU handover cadence cannot reach a linked benefit today). Do not rename `semiannual`; state in the ADR how the handover cadence maps to it.
   - Keep the P2 guard pattern and the seed/catalogue pins green; update `schema.ts` and the worker schedule test pins.
   - Probe it: apply `0001`→`0060` to an empty DB and over a P3-populated DB, and show each new row and the CHECK change.

### D. Decisions the ADRs leave open (write each into the owning ADR as a dated amendment, and list them in the handback for the orchestrator)

6. **Approvals of version-tied subjects while in approval.** BE-C (RACI matrix resubmission, §4.1), BE-J (transition decisions stay draft while in approval; a decision withdrawn while pending leaves an approval that can never be decided) and BE-L (`change_request.withdraw_via_approval`) all hit the same gap: the approval service has no in-transaction resubmit or withdraw. Specify the two services (`resubmitApprovalInTx`, `withdrawApprovalInTx`: inputs, effects, refusals, audit) in ADR-0026, and state each subject's corrected flow. BE-R1 implements them.
7. **Revoked gate exception** (BE-K2 handback): does a revoked exception block approval of a submission frozen with it? Decide and give the code and text.
8. **Assessment-form version** (BE-H2 handback): a new form is returned at record version 2 because the `0047` triggers force a second update, against the shared rule "creates are version 1". Decide: amend the rule for this entity with a reason, or specify a trigger change (it would need `0061`, which you may then write).
9. **Transformation-scoped reporting periods** (FE-B handback): a Lead or KPI owner cannot list reporting periods (`organization.read` only). Decide whether a transformation-scoped read is required by the REQ-S12-005 / S07 acceptance texts; if so, add the operation to the contract and a pending list for KBE-R1.
10. **RAID Dependency entries** (BE-D handback §5.1–5.3): no "In progress" status, closure fields null for a closed Dependency, and a Dependency created without a "To" initiative cannot be edited on the T08 path. Record the behaviour in ADR-0031 as decided (the orchestrator's preference: the RAID form requires a "To" initiative for a Dependency, FE-D; no DG3 reopen).

### E. Codes and messages added outside the ADRs

11. The implementers added refusal codes, validation codes and message keys that their ADRs do not list (each handback names them: BE-F, BE-G, BE-H, BE-H2, BE-I, BE-I2, BE-J, BE-K2, BE-L, BE-L2, BE-M, KBE-F, KBE-G, KBE-D2, KBE-E). For each, either accept it into the owning ADR's error table with its exact English text, or name the existing code it must use instead (and list the change for BE-R1/KBE-R1). Produce one consolidated table in the handback: code → ADR → accepted/replaced → English text. This table is what FE-C to FE-G translate.

## Outputs

- ADR amendments (dated) to ADR-0026, ADR-0031, ADR-0032, ADR-0033, ADR-0034, ADR-0035, ADR-0036, ADR-0037, ADR-0038 as needed; `0060` (and `0061` only if item 8 requires it); `schema.ts`; `openapi.yaml`; pending lists for any new operation; ERD and data dictionary for any schema change.
- **Keep every P1–P3 path and every existing P4 operation byte-stable** except the corrections above; list every changed contract line in the handback with its reason.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. `pnpm test` passes with the locale unset and with `C.UTF-8`; report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes; report the counts and any pin change.
4. The `0060` probe output.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R1-evidence/`. Include the decisions (D items 6–10), the consolidated code table (item 11), every contract line changed, and what BE-R1, KBE-R1 and the FE tasks must change as a result. Leave your changes **uncommitted** for the orchestrator to integrate.
