# Handback T-DG7-ARCH-R5 (solution-architect): ADR-0064 Amendment 4

- **Stage:** P7, gate DG7 (BUILDING). This is a repair task under p7-plan §5.3 (D-263).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-ARCH-R5-solution-architect-20261113T190640Z-e92f9a74","session_id":"e92f9a74-dd8d-4743-9386-1a164d72f4a1"}`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R5.md`. Its sha256 was verified as `64bb256214acee1e65b9cb7a3fc899d062859f1291783bd5e7cd840ca288e4c2`.
- **Base:** `d398b007a2c61ee0f2f35758ae7240b8ed7da2b9` on `claude/mobily-transformation-platform-dg6-regate`. The tree was clean apart from my run folder. Nothing was committed.
- **Time (`date -u`):** start 19:06:49Z, end 19:25:13Z.
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval, and nothing reads or writes a DG0–DG7 record. All demo and drill data named here is SYNTHETIC.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | **Amendment 4** (A4.1–A4.10), added at the end. Additions only (`git diff`: 311 insertions, 0 deletions). |
| `docs/architecture/p7-work-split.md` | New `### C.15 BE-R4 …`, inserted after C.14 (before §D), and new `### B.9 DO-D7 …`, inserted after B.8 DO-D4 (before §F). Additions only (139 insertions, 0 deletions). No existing section was edited. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R5-evidence/*.log` | Check logs (§3) |
| this file | Handback |

## 2. What was decided

**DO-D6 Q2: diagnosis from the code.** The 9 unexplained executions are the second hop of the KPI chain:

- An accepted actual produces an outbox row, then an execution of `starter.kpi_actual_accepted`, whose job writes a `calculation_run` and its `kpi_evaluation` rows. These are unaudited system lineage, by design (0035; ADR-0027 §7).
- The same job writes `kpi.values_recalculated` and `kpi.deviation_evaluated` outbox rows.
- Those rows trigger 3 starters × 3 actuals = 9 executions.
- A3.2 step 2 needs an audit event on the outbox row's aggregate. Runs and evaluations have none, so the chain broke.
- The 9 action results fall with their executions.
- `kpi_evaluation`'s 3 "unexpected" rows are the `cumulative`-basis evaluations. They appeared because the table was put in `tables` (exact ids from the API).

**Amendment 4:**

- **A4.2 lineage link.** A code-defined map, `RECHECK_LINEAGE_TABLES` / `RECHECK_LINEAGE_OUTBOX`, sets out the links:
  - `calculation_run.idempotency_key` plus the trigger record and slot link to an explained outbox row (L1);
  - `kpi_evaluation` and `data_quality_finding` link to their run through `kpi_evaluation_run_fkey` and `data_quality_finding_run_fkey` (L2, L4);
  - lineage outbox rows link through an exact key prefix, the aggregate and the run's `completed_at` (L3);
  - `corrective_signal.source_event_key` links to an explained outbox row that a chain-explained execution consumed (L5).

  These links join the A3.2 fixed point. The recheck checks the named links against the catalogue at run time.
- **A4.3 `kpi_evaluation`.** Its basis is the run of the journalled acceptance. The exact count is: evaluations = `evaluation_count`, findings = `finding_count`, exactly 1 `values_recalculated` row, and as many `deviation_evaluated` rows as there are period-basis evaluations.
- **A4.4 depth and counts.**
  - Depth +1 per execution hop or run hop. `RECHECK_CHAIN_MAX_DEPTH = 5`; the deepest measured chain is depth 2.
  - Each action result must be explained by an event of its own execution's job (`request_id ∈ R(x)`).
  - Ordinals must be contiguous, and a starter execution has exactly one action result per attempt.
- **A4.5.** Format `mth-recheck-allowance/4` (`lineage` key), migration 0152 (basis value `lineage`) and an additive contract value.
- **A4.6 demo data (D-263).**
  - **Anchor:** the run month in the organization's timezone, with `--as-of` to override it.
  - **Fixed periods:** the four fixed periods stay unchanged.
  - **Generated periods:** one `open` period for each month from 2026-10 up to the anchor, with fixed ids.
  - **Determinism:** counts and checksum are identical for the same anchor.
  - **Access administrator:** the permission model already allows an organization-scope `ADM_ACCESS` (`grantApplies`; `seed-dev` precedent). So one grant at organization scope is added for the existing demo access administrator. No rule change.
- **A4.8 guarantees.**
  - The DG1 guarantees hold: the recheck only reads (SELECT), and 0152 does not touch `audit_event`.
  - "Never ignore a table" holds: there are no operational additions, and every link is key-by-key with exact counts.
  - D-263's escalation condition (a table-wide allowance) is **not met**.

## 3. Checks actually run

Environment: Node v24.21.0, offline, the base above plus my documentation edits.

| Command | Exit | Log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (first) | **0** (`PASS gate DG6 (historical)`) | `T-DG7-ARCH-R5-evidence/validate-historical-DG6-before.log` |
| `npx prettier --check` on the two changed docs | **0** | `prettier-own.log` |
| `pnpm -r typecheck` | **0** | `typecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations`) | `openapi-lint.log` |
| `npx prettier --check .` (repository-wide) | **0** | `prettier-repo.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (end) | **0** (`PASS gate DG6 (historical)`) | `validate-historical-DG6-after.log` |

The background shell that chained typecheck, lint, openapi:lint and prettier reported exit 1. That came from my trailing `tail -2 <several files>` ("option used in invalid context"). Each check's own exit code, recorded in its log, is 0.

I ran no database test and no measurement: this task changes no code. The diagnosis in A4.1 comes from reading the code and DO-D6's saved evidence. The mode 2 JSON report of DO-D6's diagnostic run (with `automationChain`) was not saved, so the trigger codes of the 9 executions are **inferred** from the starter catalogue (0075). The inference matches 3 × 3 = 9. BE-R4's T-R24 must confirm it.

## 4. Known gaps / questions

1. **ADR-0050 has no text of its own for A4.6.** A4.6 amends ADR-0050 §4 (determinism per anchor) and D2 (the business-unit-only grants) by reference from ADR-0064. I did not edit ADR-0050, because the assignment did not list it. The orchestrator may want a pointer amendment there.
2. **A4.9 residual 4.** Demo trajectories end 2026-12-31. From 2027-01, a fresh actual may be `not_computable`, and then D8 stops at G5. T-R30 measures it. Extending trajectories is a further demo data change for the orchestrator to decide.
3. **A4.6 adds the organization-scope `ADM_ACCESS` unconditionally.** D-263's condition holds (the model allows it). The grant widens the demo access administrator's reach beyond ADR-0050 D2's least-privilege set. It holds no approval permission.
4. **Numbering:** "B.9 DO-D7" clashes with the existing "B.9 What the implementers must know", as B.6–B.8 did. The section says so.
5. **C.15 asks BE-R4 to stop and report** if any A4.1 fact (the same transaction timestamp, the idempotency key equality, one action result per starter attempt) does not hold when measured.

## 5. Merge instructions

- Documentation only: no migration, contract or code change in this task.
- Order: this task, then BE-R4 (C.15: migration 0152, `/4`, demo seed), then DO-D7 (B.9).
- Conflicts are unlikely: both documents only gained sections at the ends named above.
