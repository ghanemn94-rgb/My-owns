# Assignment T-DG4-ARCH-R2: P4 architecture repairs, round 2 — the Modular G3 waiver, contract gaps, ADR text that no longer matches the build, and the codes added since ARCH-R1 (solution-architect)

## Stage and base

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING), on branch `claude/mobily-transformation-platform-regate`, at the current `HEAD`.
- **Preceding gate:** DG3 is APPROVED. Before anything else, run `node tools/gates/validate.mjs --historical --stage DG3` and report the result. It must exit 0.
- **Binding:** `docs/architecture/p4-plan.md` (D-089) and every DG4 decision `D-088` to `D-110` in `docs/delivery/decisions.md`. Read D-089, D-106, D-109 and **D-110** verbatim.
- **You run alone on the shared contract files** (p4-plan §5.3). T-DG4-BE-M3, T-DG4-KBE-G2 and T-DG4-FE-D run in their own git worktrees and none touches your files.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck, and write the handback listing exactly what remains.
- **Your harness ports are 23700–23749 only.**
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **The G6 test** asserts that nothing under `docs/delivery/` changes while it runs. Keep your test logs in `$TMPDIR` until the suite finishes, then copy them to your evidence folder (the ARCH-R1 lesson).

## Scope, in this order

Each item cites the handback that reported it; all are under `docs/delivery/handbacks/DG4/`. Every claim you write must be **enumerated and exactly true, never absolute** (D-088 §2; F-DG3-100).

1. **The Modular G3 waiver (D-110, option a; BE-M2 handback §0.2).**
   - **The decided rule:** a narrow reopen of the DG3 dispensation route. A `waiver` dispensation for **G3** is allowed on a **Modular** transformation, and it waives **only** the Modular-links precondition (`gate.modular_links_missing`), never a G3 criterion.
   - **Unchanged:** every other DG3 dispensation response, and every End-to-End response, stays byte-identical. That includes `dispensation.waiver_requires_end_to_end` for every other Modular case.
   - **Write it as a dated amendment** to ADR-0021 (dispensations) and ADR-0038 §7.4. Include:
     - the exact condition;
     - what the waiver covers;
     - its expiry semantics (BE-K2's business-date clock);
     - the audit trail;
     - the refusal codes and texts.
   - **Contract change:** if one is needed, make it, and list the implementer change in your handback for the later backend task.
2. **ADR-0038 §7.4 corrections (BE-M2 §0.3–0.4, §5.4).** As built:
   - the precondition runs **after** the criteria check, because the DG2-approved test `dg2-repairs.test.ts:461` must keep `gate_criteria_incomplete`;
   - the scope is **G3 only**, per D-106 (e);
   - the pure rule lives in `packages/shared/src/schemas/missing-links.ts`.

   Amend the text to match.
3. **`getInheritedRecord` (BE-M2 §5.2).** `createInheritedRecord` sends a `Location` with no read operation behind it. Define the read, following the `getAdoptionMetricLink` precedent, and add it to a pending list for the later backend task.
4. **Plan-value version (FE-C decision 1; KBE-R2 item 3).** `BenefitValueLine` has no `version` (and has `additionalProperties: false`), and no operation reads a plan value, so no client can send a correct `If-Match` to edit one. Decide between `version` on the line and a plan-value read, then specify it.
5. **Formula lineage (KBE-R1, KBE-R2 item 4).** ADR-0027/0028 define no field for the accepted actuals that fed each formula input; `inputs` is untyped. Specify the stored shape, or state with a reason that lineage stays at the input-value level.
6. **Governance → RAID dependency (BE-F2 handback).** `governance/meeting-actions.ts` copies BE-D's `createLinkedAction`, because governance may not depend on `raid`. Decide whether to add `raid` to governance's `dependsOn`, keeping the module graph acyclic and proving it, or to keep the copy with a parity test. Record the decision.
7. **ADR text that no longer matches the build.** Amend each so it is exactly true:
   - **ADR-0025 §3/§4 (BE-R1, BE-R2):** the reschedule and reassign services, the `#n` task-key suffix, the `work_item.reschedule` audit action, and the worker passing the attempt count.
   - **ADR-0026 (BE-R2):** the approval-type `bindServices` hook; the server-written withdraw reason; resubmit and withdraw are requester-only (`approval.not_requester`); the matrix round-2 `Location` and the ignored `title`; and `approval.subject_unknown` on resubmit.
   - **ADR-0027 §8 (KBE-R1):** the attempt count and `kpi.recalculate_failed`.
   - **ADR-0031 §11 (BE-R1):** the duplicate-corrective-case database check now maps to 500, while the client still sees 409 from the service path.
   - **The `work_item.system_managed` text (BE-R1):** a corrective follow-up closes with its case, not an approval. Make the wording neutral.
8. **Codes added since ARCH-R1.** Extend the consolidated code table, giving each code its ADR, its acceptance and its English text:
   - BE-F2's 8 refusal codes and 2 work-item message keys (its handback §6);
   - BE-M2's `inherited_record.record_not_found` and its `gate.modular_links_missing` item messages (§0.5);
   - KBE-R1's `kpi.recalculate_failed`;
   - any new code from items 1–6.

## Outputs

- **Amendments:** dated ADR amendments to ADR-0021, -0025, -0026, -0027, -0028, -0031, -0032 and -0038, as needed.
- **Contract:** `openapi.yaml`, and pending lists for any new operation.
- **Migrations:** `0061` only if an item cannot be met without a schema change; say why in the handback.
- **Unchanged responses:** keep every P1–P3 path and every existing P4 operation byte-stable, except the corrections above. List every changed contract line in the handback with its reason.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
4. If you write `0061`, include its probe output.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-solution-architect.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-ARCH-R2-evidence/`. It must contain:
- each decision;
- the extended code table;
- every contract line changed;
- the exact implementer changes for the later backend task (BE-R3) and the frontend tasks.

Leave your changes **uncommitted** for the orchestrator to integrate.
