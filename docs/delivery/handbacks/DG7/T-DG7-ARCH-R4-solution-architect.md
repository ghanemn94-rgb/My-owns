# Handback T-DG7-ARCH-R4 (solution-architect): ADR-0064 Amendment 3 (mode 2 for automation and counter rows; D8 gate chain)

- **Stage:** P7, gate DG7 (BUILDING). This is the repair task of p7-plan §5.3 (D-260, repair round 3).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-R4-solution-architect-20261113T160935Z-f4b6b692","session_id":"f4b6b692-d126-43f9-a18f-6fe558b5efc8"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R4.md`. I verified its sha256 as `56c3ce27aa315d1a6d93219bafbee116ae18d5213026ea4fb9439c693e2dff6d`.
- **Base:** `cbf26ddb40a402f2ea1873eb665b5d8d32f7ec42` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from this run's own directory. Nothing was committed.
- **Time (`date -u`):** start 16:09:44Z. The end time is in §3a.
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval. Nothing reads or writes a DG0–DG7 record. The G5 submission and decision that D8 makes under A3.6 are SYNTHETIC drill data on a disposable target, with outcome `deferred`.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | Appends the dated section **Amendment 3** (A3.1–A3.10). No earlier text was changed; `git diff --numstat` shows only added lines (§3). |
| `docs/architecture/p7-work-split.md` | Inserts `### C.14 BE-R3` at the end of §C (after C.13, before §D) and `### B.8 DO-D4` at the end of §B (after B.7 DO-D3, before §F). No existing section was edited; `git diff --numstat` shows only added lines (§3). |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R4-solution-architect.md` | this handback |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R4-evidence/*.log` | the check logs (§3) |

## 2. Decisions (behaviour delivered as design; nothing is implemented by this task)

### 2.1 Automation rows (DO-D3 Q2a; A3.1, A3.2)

**A fact that changes D-260's wording.** The measured `automation_execution` row comes from the **seeded starter** `starter.transformation_created`, which has `run_as = 'service'`. The starter wrapper writes `initiating_user_id: null` (`apps/worker/src/automation/starters.ts` l.212), and CHECK `automation_execution_identity` requires that. So a rule over `initiating_user_id` alone explains **none** of the measured rows. The same holds for the `gate.submitted` and `gate.decided` starters that the full D8 chain adds, whose `initiating_user_field` is NULL.

**Decision: (e) the chained explanation through recorded links. D-260's rule is kept as a cross-check.**
- An outbox row is explained when an explained event sits on its aggregate with the same transaction timestamp (`occurred_at = created_at`; both default to `now()`).
- An execution is explained when its immutable `trigger_key`/`trigger_code` names that outbox row (the relay copies `idempotency_key`), and when its recorded user, if any, is a journalled actor. The recorded user is `initiating_user_id`, or the payload member named by the catalogue's `initiating_user_field`.
- The worker's service events of that execution's job (`request_id = job:<id>`) then join the explaining set `E*`. This repeats to a fixed point.
- No schema change and no new allowance key are needed for this. The rows count as `audit_explained`, and the report gains `automationChain`.

**Rejected:**
- an `on_behalf_of_user_id` on worker events, which re-attributes the trail;
- `operational`;
- "any worker event".

### 2.2 Counters (DO-D3 Q2b; A3.3)

**Decision:** a `counter` basis.
- The counter row `(transformation_id, prefix)` may move only from `old` to `new` such that the numbers of the new coded rows explained in its scope equal exactly `{old+1…new}`.
- New coded rows without a counter step are also reported.
- The prefix → (table, code column) map is a code constant (`RECHECK_COUNTER_TABLES`). An unmapped prefix is always unexplained, and a test pins the 24 prefixes of the 0055 CHECK.

This needs migration `0151` (the `basis` CHECK with `counter`) and one additive enum value. It also needs allowance format `/3` (key `counters`); `/2` and `/1` are refused.

### 2.3 D8 gate chain (DO-D3 Q3; A3.6)

D8 reads `getGate`. It completes each missing mandatory item through a closed remedy table, by OpenAPI operation id:

- KPI actuals: `submitKpiActual`/`addKpiActualValue`, then `acceptKpiActual` by a different reviewer;
- pilot evidence: `createEvidence`, then `reviewEvidence` by a non-author, then `linkPhaseStepEvidence`;
- adoption: through the KPI remedy, or `createTrainingRecord`;
- decision log: `createExecutiveDecision`, or `recordExecutiveDecisionOutcome` `deferred` with a new date;
- risk: `closeRaidEntry`.

It then polls `getGate` until `canSubmit` is true. Next, `submitGate` runs as `S`; `getGate` is polled as `P` until `canDecide` is true; and `decideGate` runs as `P` (≠ `S`, `deferred`). An unknown code stops D8 with an exact line. Shipped demo data is unchanged. Gate exceptions and a new transformation were rejected.

### 2.4 BE-R2 Q1 and the shared-baseline count (A3.7)

- `audit_event` has 17 columns, and E5 compares 15 (all except `seq` and `occurred_at`). Following the assignment, A3.7 corrects the readings of A2.1, A2.2 L1, A2.10 residual 2 and the two C.13 places as an amendment table, without rewriting them. BE-R2's code already does this.
- **Recorded:** `|P| = 45` measured by BE-R2 (`T-DG7-BE-R2-evidence/integration-be-r2.log`), against A2.10 residual 1. The ADR's reading of the migrations gave 44.

### 2.5 DG1 and D-260's escalation condition (A3.8)

- Every new explanation is a SELECT over recorded links that ends at an audited mutation by a journalled actor. Nothing writes `audit_event`, and no attribution changes.
- **The escalation condition is not met.** The one case that would meet it, scheduled automation that lands in the drill window, is kept **unexplained** (A3.9 residual 1). DO-D4 reports it if it happens and must not pause the scheduler to avoid it.

### 2.6 Work split (deliverable 2)

- **C.14 BE-R3:**
  - the A3.2–A3.5 code, migration 0151 and the contract value;
  - **DO-D3 Q1:** `mth-db` sets `process.exitCode` instead of calling `process.exit`, with the `DemoRefused` branch returning;
  - tests T-R19–T-R23, where T-R23 pipes a `table-digest --rows` output larger than 256 KiB and compares its bytes and SHA-256 with the file output.
- **B.8 DO-D4:**
  - the A3.6 chain in `journey.mjs` and `pick-actors.sql`;
  - allowance `/3`;
  - the lists remeasured on the full chain;
  - T-B15, T-B17, the new T-B18, and T-B11 to the end.

  Its preconditions are that BE-R3 and AN-R1 are merged.

## 3. Checks actually run

The environment was Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, offline.

| Command | Exit | Log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (**first**, before any edit) | 0 | Output `PASS gate DG6 (historical)`. My command line piped through `tail` and printed `EXIT=$?` of the pipe, so that line shows tail's status. The background task's exit was also 0. The end-of-run validator in §3a is captured without a pipe. |
| `npx prettier --check` on the ADR and the work split | 0 | `T-DG7-ARCH-R4-evidence/prettier-own.log` |
| `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` | see §3a | `final-exits.log` |
| repository-wide prettier check, closing validator | see §3a | `final-exits.log` |

Not run: `pnpm test` and any integration test, because this task changes documents only.

## 4. Known gaps / not done

1. **The assignment's wording "`initiating_user_id` (or equivalent recorded link)" was taken as allowing the recorded-link chain.** The literal rule explains no measured row (§2.1). The orchestrator should confirm that A3.2 is within D-260's direction. My reading is that it is (A3.8).
2. **Scheduled automation in the drill window stays unexplained** (A3.9 residual 1). If T-B11 hits it, T-B11 FAILs and the orchestrator decides. I did not pre-authorize any loosening.
3. **The G5 remedy table is closed and written for G5 only.** It was written from the code (`apps/api/src/modules/workflows/g5.ts`) and the 422 measured by DO-D3, not from a run. Which adoption item the demo misses, and whether the demo KPIs evaluate to `ok` after a fresh accepted actual, are **not measured**. Either can stop D8 with an exact line (A3.9 residuals 5–6).
4. **The counter prefix map is not filled in by me beyond the verified examples** (`R`/`A`/`I` → `raid_entry`, `D`/`GD`/`DEC` → `decision`, `DEP` → `dependency`). BE-R3 completes and pins it from the call sites.
5. **BE-R2's Q2 (the grouped single-statement load and `SET CONSTRAINTS ALL IMMEDIATE` before L8) was not in this assignment** and is not decided here. C.14 notes that it stays with the orchestrator.
6. **The numbering clash is repeated.** "B.8 DO-D4" clashes with the existing "B.8 Requirement → clause → test → owner", as B.6 and B.7 did. The assignment named the heading, so I used it as given.

## 5. Merge instructions

- These are documents only. There is no migration, contract or code change in this task.
- BE-R3 adds migration `0151` (the next free id above `0150`). Renumber it at merge if the id is taken.
- Order: AN-R1 and BE-R3 (in either order), then DO-D4.

## 3a. Final check results

`docs/delivery/handbacks/DG7/T-DG7-ARCH-R4-evidence/final-exits.log` is authoritative. The values below are copied from it after the runs finished.

| Command | Exit | Log |
| --- | --- | --- |
| `pnpm -r typecheck` | **0** | 193 s, `typecheck.log` |
| `pnpm lint` | **0** | 42 s, `lint.log` |
| `pnpm openapi:lint` | **0** | `openapi-lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | in `final-exits.log` | `prettier.log`. It runs after this file was written, so it covers this file. |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | in `final-exits.log` | `validate-historical-DG6-end.log` |

**Result.** `final-exits.log` records exit 0 for all five commands: typecheck, lint, openapi lint, the repository-wide prettier check and the closing validator (`PASS gate DG6 (historical)`). `git diff --numstat` shows the ADR at 264 added and 0 deleted, and the work split at 121 added and 0 deleted. End time: 16:28:43Z (`date -u`). Free disk was 3.6 GB; no temporary tree was made.
