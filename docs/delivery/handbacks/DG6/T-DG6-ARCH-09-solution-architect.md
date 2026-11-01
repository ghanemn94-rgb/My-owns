# T-DG6-ARCH-09 handback: ADR records of D-203 and D-204 (solution-architect)

- **Stage:** P6, gate DG6 (BUILDING). **Branch:** `claude/mobily-transformation-platform-dg5-regate2`, main checkout, `HEAD` `c86e70ee21e024ac4bd76eb5ddff55629647b6ff`. The tree was clean except for the two run directories.
- **Invocation:** run `DG6-T-DG6-ARCH-09-solution-architect-20261101T033813Z-3472fe44`, session `3472fe44-3086-4af6-9a72-da23e50ebb18`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-09.md`, sha256 `f8bde0d8…004329`, checked against the file.
- **Time:** start `Sun Nov 1 03:38:24 UTC 2026`, end `Sun Nov 1 03:47:21 UTC 2026` (the format check was re-run after this handback was written: exit 0).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0, both at the start and at the end.
- **Changes are left uncommitted** for the orchestrator. Only documents were edited.
- **Approvals:** nothing here grants or records a business, Finance or IT approval. Nothing touches product gates G1–G6, and nothing reads or writes DG0–DG7.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0043-p5-automation-engine-rules-executions-failure-queue.md` | New amendment "2026-11-01, T-DG6-ARCH-09; D-203, D-204", sections E1–E6. |
| `docs/architecture/adr/ADR-0058-p6-performance-load-dataset-workload-p95-index-plan-async-export.md` | New amendment "2026-11-01, T-DG6-ARCH-09; D-203 O-1", section T1: the two worker variables and the measured throughput. |
| `docs/architecture/data-dictionary.md` | New section "P6 pre-freeze repair migration 0122 (DG6)": the `automation_rule_enablement` table, its trigger on `automation_rule`, its function and its backfill. |
| `docs/architecture/erd.md` | New §1aa (diagram, plus entity register §1aa.1) for `automation_rule_enablement`. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-09-evidence/format-check.log`, `openapi-lint.log` | Check output. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-09-solution-architect.md` | This handback. |

## 2. Items: applied or declined

| Item | Status | Where |
| --- | --- | --- |
| D-203 O-2: the enablement-time rule (BE-X9 §6 item 1) | **Applied** | ADR-0043 amendment E1 |
| D-203 O-1: batched, bounded-concurrency execution (BE-X9 §6 item 5) | **Applied** | ADR-0043 amendment E5; operations side in ADR-0058 amendment T1 |
| D-204: version in force at occurrence (BE-X9 §6 item 2, decided by D-204) | **Applied** as the decided behaviour plus implementation constraints | ADR-0043 amendment E2 |
| BE-X9 §6 item 3: unknown occurrence time | **Applied** | ADR-0043 amendment E3 |
| BE-X9 §6 item 4: ticks are out of scope | **Applied** | ADR-0043 amendment E4 |
| BE-X9 §6 item 6: batch expiry and settlement-failure edge cases | **Applied** (recorded as documented and untested, with no P6 repair) | ADR-0043 amendment E6 |
| Assignment 2: `automation_rule_enablement` (0122) in the data dictionary and ERD | **Applied** from the shipped `0122` file | data-dictionary "P6 pre-freeze repair migration 0122 (DG6)"; erd.md §1aa |
| Assignment 2: "with the column BE-X10 adds if any" | **Partly applied.** BE-X10's handback had not landed. Its unmerged work in progress (`0123`) adds no column, so no column was added to the docs. The work in progress is described as *not delivered* in ADR-0043 E2 and noted in the data dictionary and ERD. | ADR-0043 E2; data dictionary 0122 intro; erd.md §1aa |
| Assignment 3: `WORKER_JOB_BATCH_SIZE`, `WORKER_JOB_CONCURRENCY` and measured throughput | **Applied** to ADR-0058 (the throughput relates to REQ-S20-029). ADR-0053 is not edited; T1 points to its §6 for `WORKER_HEARTBEAT_SECONDS`. | ADR-0058 amendment T1 |
| BE-X9 §6 item 7: the `docs/operations/monitoring.md` entry | **Declined.** The file is devops-owned and outside my permitted files. T1 passes the suggestion to its owner. | — |

The facts in these amendments were checked against the code, not taken from BE-X9's summary:
- `engine.ts` `candidates` (SQL comparison, `origin = 'admin'`), `OCCURRENCE_UNKNOWN`, `tickSlot`;
- `worker.ts` `JOB_THROUGHPUT_DEFAULTS` 8/4, `notifyWorker`, and the purge and `job_schedule.updated` queues with `batchSize: 1`;
- `main.ts`: pool `max(5, concurrency + 2)`;
- `packages/config`: ranges 1–50 and 1–16, and the concurrency-above-batch refusal;
- the `0074` guard, which accepts a `superseded` version for an execution;
- the 0122 catalogue test;
- the throughput log lines: before 1406 → 1.5 jobs/s, after 1037 → 120.1 jobs/s.

## 3. Open points for the orchestrator

1. **D-204 is silent on one case** (ADR-0043 E2, last bullet): a late event that occurred while the rule was enabled, but is evaluated after the rule was **disabled**.
   - The pre-X10 engine filters `r.enabled = true` at evaluation, so it would not act.
   - The "version in force at occurrence" reading would act.
   - BE-X10's work in progress does not visibly settle this, so please decide it and record it in `decisions.md`.
2. **BE-X10 follow-up.** When its handback lands, check it against ADR-0043 E2's constraints. Then amend the data dictionary 0122 section for 0123, which adds:
   - the `source` CHECK values `disable` and `backfill_disable`;
   - the index `automation_rule_enablement_rule_time_idx`;
   - the replaced trigger function and the disable backfill.

   A short follow-up architect task (or this agent re-invoked) is needed for that. On a disable row, `enabled_from` means "stopped at", so the column name no longer fits that row. That is acceptable, but it should be noted in the data dictionary.

## 4. Checks actually run

Environment: Node 24.21.0, offline, main checkout.

| Command | Exit | Result |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | 0 | `PASS gate DG5 (historical)` |
| `pnpm format:check` (after the last edit) | 0 | "All matched files use Prettier code style!" (`T-DG6-ARCH-09-evidence/format-check.log`) |
| `pnpm openapi:lint` (after the last edit) | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` (`T-DG6-ARCH-09-evidence/openapi-lint.log`) |

No code was changed, so I ran no typecheck, unit or integration tests.

## 5. Known gaps

- The BE-X10 column and migration are not recorded as delivered, because they were not merged when I finished (§3 item 2).
- The decision on the disabled-at-evaluation case is open (§3 item 1).

## 6. Merge instructions

- Documents only: no migration, no contract change, no dependency.
- The four architecture files are appended or inserted in new sections. No existing text was changed, except that prettier reformatted only the new blocks.
- A conflict is unlikely unless BE-X10 edits `docs/architecture/**`, which its assignment does not permit.
