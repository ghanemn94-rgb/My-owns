# Handback T-DG4-ARCH-07 — P4 architecture, slice H (phases, G5/G6, gate reviews and exceptions, scale, change control)

- **Role:** solution-architect. **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-07-solution-architect-20261009T085547Z-2ed12507","session_id":"2ed12507-c95d-4d8a-a7b3-a3d9db507934"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-07.md` (sha256 `a01506fb0ea37b8b5f0794e9e7b61df6b9ed4d51624bd14ba1ab448257c3a2f8`, verified with `sha256sum` before starting).
- **Base:** branch `claude/mobily-transformation-platform-regate`, `HEAD` = `76e128e02683807c8700b714326c2350593ac4ff`. Untracked environment files (`.bashrc`, `.idea`, `CLAUDE.local.md`, …) and other runs' `docs/delivery/runs/**` were not touched.
- **Time:** start `Fri Oct  9 08:56:26 UTC 2026` (`T-DG4-ARCH-07-evidence/start-time.txt`); end `Fri Oct  9 09:56:33 UTC 2026` (`end-time.txt`).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 or `docs/delivery/` records (other than this handback and its evidence). G5 and G6 remain closed for submission (`submission_enabled = false`); no migration, seed, trigger or job approves a gate, an exception, a risk disposition, a scale scope or a change request — each CHECK in `0051`/`0052` refuses an outcome without a person's decision. Product G6 never implies DG7. All probe data is synthetic.

## 1. `validate --historical --stage DG3`

`node tools/gates/validate.mjs --historical --stage DG3` (Node 24.21.0), run first at 08:56Z before any write: **`PASS gate DG3 (historical)`, exit 0** (`validate-historical-DG3.log`). Re-run at the end: `PASS gate DG3 (historical)`, exit 0 (`validate-dg3-historical-end.log`).

## 2. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0035-p4-phases-g5-g6-exceptions-routing.md` (new) | Phases and guided steps, G5/G6 criteria and evaluators, per-criterion review and Under Review, gate exceptions and the D-089 Q2 CHECK change, G5 scale scope/conditions/transitions, risk dispositions, gate outbox events and routing tasks; authorization, refusal codes and English texts, Unknown semantics, verification |
| `docs/architecture/adr/ADR-0036-p4-change-control-impact-assessment.md` (new) | Change requests (state machine, kinds, apply-on-approval, preserved originals), materiality (no seeded threshold), T11 routing through the canonical approval, impact preview/assessment, automatic and refused material changes, authorization, refusal codes |
| `docs/architecture/adr/ADR-0015-decision-and-product-gate-model.md` | Dated correction note for the outbox-event sentences (D-089 R1); wording only |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 lock registry rows 730246–730248 |
| `packages/db/migrations/0051_p4_phases_gates_g5_g6_exceptions.sql` (new) | 10 tables (`phase_definition`, `phase_step_definition` seeds; `phase_step`, `phase_step_evidence`, `gate_criterion_review`, `gate_exception`, `gate_decision_scale_scope`, `gate_decision_condition`, `scale_transition`, `risk_disposition`), 8 G5/G6 criteria rows, the `gate_submission_criterion` column/CHECK change (D-089 Q2) and trigger |
| `packages/db/migrations/0052_p4_change_control.sql` (new) | `change_control_policy`, `change_request`, `impact_assessment`, `impact_assessment_item`; prefix `CR` |
| `packages/db/migrations/0053_p4_gates_change_permissions.sql` (new) | 10 permission codes, 31 role grants, 7 work-item kinds, approval types `change_request` and `risk_disposition` |
| `packages/db/migrations/0054_p4_gate_exception_expiry_schedule.sql` (new) | The daily `gate.exception_expiry_scan` schedule, audited `system` |
| `packages/db/src/schema.ts` | Kysely interfaces, `Database` lines, row types and `SCHEMA_COLUMNS` for the 14 tables (generated from the DDL by `gen-schema.py`); `gate_submission_criterion.gate_exception_id` |
| `packages/db/src/seed.test.ts` | `0053` = `P4_GATES_CHANGE_*` pins (3 new tests); the union of all blocks includes the new block |
| `packages/db/test/integration/catalogue.test.ts` | Slice H trigger pin (new test), versioned-table list, `mth_app` grants (generated from a migrated DB by `gen-catalogue.ts`) |
| `packages/shared/src/permissions.ts` | `P4_GATES_CHANGE_PERMISSIONS`, `P4_GATES_CHANGE_ROLE_PERMISSIONS`, role spreads (SP, TL, BO, WL, FIN, TO, KDS); header names `0053` |
| `apps/api/src/modules/platform/advisory-locks.ts`, `advisory-locks.test.ts` | Classes 730246, 730247 (730248 reserved); the test pins 23 classes |
| `docs/api/openapi.yaml` | 37 operations, 5 tags, 14 parameters, the slice H schemas, the `GateDecisionCreate.scaleScope` member (D-089 seam 2), 10 `PermissionCode` values, info note; `info.version` stays `1.3.0-p4` |
| `apps/api/test/support/p4-pending-arch-07.ts` (new, frozen aggregate), `p4-pending-be-k.ts` (6), `p4-pending-be-k2.ts` (9), `p4-pending-be-l.ts` (12), `p4-pending-be-l2.ts` (10) (new); `p4-pending.ts` (one import); `p4-operations.ts` (the 37 ids) | Contract seams (S-10) |
| `apps/api/test/integration/contract/contract.test.ts` | Operation-count pin 570 → 607 and its comment (the only pin the pending pattern requires) |
| `apps/api/test/integration/identity.test.ts` | TO's effective-permission pin gains the 6 slice H codes TO holds (the ARCH-01…06 precedent) |
| `apps/worker/test/integration/schedules.test.ts` | The `0054` row is reported `unhandled` (no handler yet): pin gains `GATE_EXCEPTION_SCAN` (the ARCH-06 precedent) |
| `docs/architecture/erd.md` | §1j (physical model, slice H; entity register); the slice E register's ChangeRequest row and the §2.8 table now point to `change_request` |
| `docs/architecture/data-dictionary.md` | "P4 tables, slice H" (generated from the migrated catalogue by `gen-dictionary.ts`), changes to existing tables, seeds, functions, validation summary |
| `docs/analysis/permissions-matrix.md` | §16 catalogue and per-entity rights (AUD read-only everywhere) |
| `docs/architecture/p4-work-split.md` | §H (BE-K, BE-K2, BE-L, BE-L2: ownership, contracts, proofs, migrations, consumers, integration order, requirement → owner, implementer rules); header line names §H |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/*` | Probe, generators, logs (§4, §8) |

## 3. Behaviour delivered per requirement (architecture layer; the API halves are the implementers', p4-work-split §H.8)

| Requirement | Delivered here | Remaining (owner) |
|---|---|---|
| REQ-PB-014 | Six phases seeded verbatim (B0021 names, purposes, key outputs; titles; objectives), probe S01 | `GET /phases`, workspace (BE-L2) |
| REQ-PB-015 | G5/G6 criteria (S03); criterion review table (GR*) | G5/G6 engine and enabling (BE-K); reviews (BE-K2) |
| REQ-PB-020 | G5 criteria incl. "Risk closure"; risk dispositions with canonical approval (RD01–RD04); approver SP/BO since `0011` | evaluators, the label-form 422 (BE-K) |
| REQ-PB-021 | G6 criteria incl. "Ownership transfer" | evaluators (BE-K) |
| REQ-S03-004 | Scale transition only with an approved G5 and inside its scope (SC02, SC06–SC08) | route and 422 naming G5 (BE-K) |
| REQ-S04-001 | Step catalogue (25 steps, S02), step state machine, met completion check, separate reviewer, frozen evidence (PS01–PS16) | routes, rule evaluation, review queue (BE-L2) |
| REQ-S04-002 | Snapshot freeze unchanged (DG2 trigger); an approved decision and snapshot read back unchanged after a change is approved (CR20) | G5/G6 snapshot members (BE-K); steps never move a gate (BE-L2) |
| REQ-S04-007 | Scope (initiative × business unit), conditions with owner and deadline, transitions (SC01–SC10) | `scaleScope` decision rules, routes (BE-K) |
| REQ-S04-008 | G6 criteria; `next_phase` NULL; G6 writes no DG record (ADR-0035 §2) | evaluators and proof (BE-K) |
| REQ-S04-009 | `gate_criterion_review` with the six review fields; nine per row (GR05: 9 of 9) | routes (BE-K2) |
| REQ-S04-010 | `submitted → under_review` edge specified; DG2 transitions unchanged | first-review transition (BE-K2) |
| REQ-S04-012 | `gate_exception`; the D-089 Q2 CHECK (GC01–GC06; G06 on an upgraded P3 DB) | submission lines, snapshot record (BE-K2) |
| REQ-S04-013 | Five NOT NULL fields (GE01, GE02), state machine, SoD, expiry by date, scan schedule (`0054`) | routes, scan handler (BE-K2) |
| REQ-S04-014 | `change_request` + assessments; outcomes need a person's decision (CR13); originals preserved (CR20) | service, apply, hook (BE-L) |
| REQ-S07-015 | KPI change kinds with `proposed_record = kpi_version`; impact items (ADR-0036 §5) | preview, apply via activation (BE-L) |
| REQ-S09-010 | `schedule_rebaseline`, materiality policy with decimal ratio (CR18, CR19) | materiality, the threshold refusal (BE-L) |
| REQ-S12-009 | `gate_decision_due` kind; `gate.submitted` payload and dedupe keys (ADR-0035 §7) | events and consumer (BE-K) |
| REQ-S12-010 | `phase_step_enabled`, `scale_scope_enabled`, `gate_condition_due` kinds; `gate.decided` payload | consumer (BE-K) |

None of the 18 rows is complete at this task's end: each needs its implementer half (as for every ARCH task).

## 4. Checks actually run

| Check | Command / environment | Result |
|---|---|---|
| Historical validator (start, end) | `node tools/gates/validate.mjs --historical --stage DG3` | exit 0, `PASS gate DG3 (historical)` both times |
| Migration apply + guard probe (final) | `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23729 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/probe.ts` (PostgreSQL 16.13, UTF8, C locale) | exit 0; **91 PASS, 0 FAIL** (`probe-output.txt`): `0001`→`0054`(+`0058`) on a fresh DB (G01) and `0028`→ over a DB populated by `0001`–`0027` with a G1 submission (G02–G04, G06); missing audit fails at COMMIT (PS02, GR03, GE04, CR03, SC10); a non-stepping version fails (PS08, GE13, CR17); UPDATE/DELETE on append-only tables fails (GR07, GR08, SC09, RD04, CR10); every ADR invariant probed (ADR-0035/0036 Verification) |
| Earlier probe runs (disclosed) | same command, ports 23700, 23702, 23704 | **Run 1** (`probe-run1-output.txt`): probe-setup error — the P3 database (before `0051`) has no `gate_exception_id` column, so the probe's insert failed; the open client kept the process alive past the 600 s tool timeout, so the tool moved the command to the background; the probe's own exit status was not captured (the reported exit 0 is that of the trailing `echo`), and the output ends with the stack trace. Fixed in the probe (omit the column when NULL; `process.exit` in `finally`). **Run 2: exit 1, 87/4** (`probe-run2-output.txt`): four probe-setup errors, no migration defect — G06 inserted a duplicate G2 instance (the P3 database already had one), S03 compared labels in the wrong order, SC10 used an initiative already scaled, RD03 inserted a RAID entry as `closed` (refused by `raid_entry_starts_open`). **Run 3: exit 0, 91/0**. The final run above is on the final migrations |
| Kysely generation, catalogue pins, dictionary | `gen-schema.py`; `gen-catalogue.ts` (port 23706) and `gen-dictionary.ts` (port 23710) on disposable clusters | exit 0 each |
| OpenAPI lint | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` (`openapi-lint.log`) |
| Contract stability | `diff` before/after (`openapi-diff-check.txt`) | 0 lines removed, 1525 added; the one line inside a pre-existing schema is `GateDecisionCreate.scaleScope` (D-089 seam 2); `info.version` 1.3.0-p4 |
| Typecheck | `pnpm -r typecheck` | exit 0 (`typecheck.log`, after the last source edit; an earlier run `typecheck-run1.log` also exit 0) |
| Build | `pnpm -r build` | exit 0 (`build.log`) |
| Lint | `pnpm lint` | exit 0 (`lint.log`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, "All matched files use Prettier code style!" (`format.log`); before it, `prettier --write` reformatted `seed.test.ts` and `schedules.test.ts` (my edits) |
| Unit, locale unset, run 1 (disclosed) | `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_MESSAGES pnpm test` | **exit 1: 1 failed / 2104 passed** (`unit-locale-unset-run1.log`): `architecture.test.ts` "has only mapped module directories" found a directory `apps/api/src/modules/.claude`. Cause: empty sandbox write-tracking directories (`.claude/.cc-writes`, created 09:00 by the run harness, untracked) in ten source directories I wrote to; not a product defect. I removed the empty ones under `apps/` and `packages/` with `rmdir` (the D-093 ARCH-04 precedent); the ones under `docs/` were left (no test reads them) |
| Unit, locale unset | same | **exit 0**: 107 files, **2105 passed**; worker 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`). Pinned-count change: +3, the three new `0053` seed tests (2104 + 1 in run 1; D-100 reported 2102 at `bfbca26`; I did not re-run the base `HEAD` separately) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: 2105 passed; worker 259 passed, 2 skipped (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0: 99 files, 1133/1133 passed** (`integration.log`). Count change: +1 (the new slice H catalogue trigger test; D-100 reported 1132 at `bfbca26`) |

## 5. DG1–DG3 artifacts changed, and why (D-089)

1. **`gate_submission_criterion` (DG2 `0017`) — the D-089 Q2 reopen, accepted by the orchestrator.** The CHECK `gate_submission_criterion_mandatory_complete` becomes "complete, or covered by an accepted exception recorded on the row"; new column `gate_exception_id`, CHECK `…_exception_only_incomplete`, trigger `…_exception_valid`. A row without an exception is held to the DG2 rule exactly (probes GC01 and G06 on an upgraded P3 database); existing rows keep their values (G04).
2. **`gate_criterion_definition` (DG2 seed table):** 8 new G5/G6 rows; G1–G4 rows untouched (G05). G5/G6 stay closed until BE-K's enabling migration.
3. **`record_code_counter` (DG2):** the prefix CHECK dropped and re-added with `CR` (the `0020`/`0037`/`0041`/`0048` precedent; every prefix stays).
4. **`docs/api/openapi.yaml`:** additive; the one change inside a DG2 schema is the D-089-accepted `GateDecisionCreate.scaleScope` member (seam 2). The `PermissionCode` enum gains 10 values (the ARCH-01…06 precedent). Seam 20.
5. **ADR-0015 (DG2):** a dated correction note (D-089 R1); no decision text changed. **ADR-0016 §6 (DG2):** registry rows 730246–730248.
6. **`gate_dispensation` (DG3) is not changed.** p4-plan §3 seam 3 proposed widening its G1–G3 CHECK; ADR-0035 §4 meets REQ-S04-012/013 with the per-criterion `gate_exception` instead (a dispensation has no scope, expiry or compensating action). This is a narrower change than the plan proposed, not a new reopen.
7. **Pins** (`seed.test.ts`, `catalogue.test.ts`, `contract.test.ts`, `advisory-locks.test.ts`, `identity.test.ts`, `apps/worker/test/integration/schedules.test.ts`): extended as the established pattern requires; no assertion weakened.

**One new reopen-adjacent item for the orchestrator (ADR-0036 §3, §6):** the DG3 `POST /milestones/{id}/approve-date` gains a 422 `milestone.rebaseline_requires_change_request` **only** when a transformation has configured a date threshold in the new P4 `change_control_policy`. No existing transformation has a policy row, so DG3 behaviour on existing data is unchanged (the D-091 (2) pattern). The same applies to BE-E's P4 budget-line update. And the P4 KPI-version activation gains 422 `kpi_version.change_request_required` for a second activation (a P4 operation that already declares 422). Please confirm these three readings.

## 6. What the implementers of slice H must know (summary; binding text in p4-work-split §H.9 and the two ADRs)

1. **Split proposal for the orchestrator:** BE-K (6 operations + evaluators, facts, enabling, events, consumers) → BE-K2 (9; reviews, exceptions, expiry scan; new task); BE-L (12; change control and hooks) → BE-L2 (10; phases; new task). The BE-H2/BE-I2/KBE-D2 precedent. If a split task is not scheduled, its parent carries the section.
2. **No migration number is left** in `0051`–`0054`. `0054` (the schedule) is written here so ARCH-08's `0055` can merge (S-12). **BE-K's G5/G6 enabling migration needs a repair-range number from the orchestrator** (`0059` or later; D-094).
3. **G1–G4 are byte-stable;** the label form of the 422 detail is for G5/G6 only.
4. **No job approves anything;** exceptions, dispositions, scale scopes and change requests need a person; change requests are decided through `POST /approvals/{id}/decision` (no separate decide path), and apply runs in the subject provider's `onOutcome`.
5. **Exceptions are per criterion** and cover by date comparison in the transformation's timezone; the scan only notifies.
6. **Interpretations to confirm** (p4-work-split §H.9 item 8): "High-impact" = `impact = 'high'`; "required approvers" = configured user, else every active holder of the approver role with `gate.decide`; phase-step evidence/roles/rules are an architect interpretation; "reports" = T10 areas until a report entity exists; the three refusals of §5.
7. **The OpenAPI estimate** in p4-plan §4 named "change-requests (+ submit, decide)": there is no separate decide operation (D-089 Q10: the canonical approval decides). 37 operations instead of ≈ 24, because the phase workspace, step evidence, criterion reviews, scale and risk dispositions each need their own paths.

## 7. Known gaps, continuation and merge instructions

- **Not done by this task (by design, assigned in p4-work-split §H):** every route, service, evaluator, consumer, the scan handler, the enabling migration, the hook lines, the screens (FE-F) and the EN/AR keys. No ARCH deliverable is left for a continuation task: deliverables 1–6 are complete.
- **Not verified here:** the API refusal codes and English texts (no route exists yet), the consumers end to end, and REQ-S12-009/010 behaviour.
- **Merge:** apply `0051`–`0054` with `mth-db migrate` after `0050` (contiguous; probe G00). Expect conflicts only in the p4-plan §5.3 shared files if another ARCH task ran concurrently (none did; FE-A, BE-D2 and BE-E run in their own worktrees and touch none of my files, per the assignment). `requirements.csv`, `stages.json`, `findings.json`, reviews and gate records were not touched.

## 8. Final results

All on the final tree; logs in `T-DG4-ARCH-07-evidence/`.

| Check | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | exit 0, `PASS gate DG3 (historical)` |
| Guard probe (`0001`→`0054` + `0058`, fresh and over P3) | exit 0, **91 PASS, 0 FAIL** (`probe-output.txt`); migration checksums in `migration-sha256.txt` |
| `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| `pnpm -r build` | exit 0 (`build.log`) |
| `pnpm lint` | exit 0 (`lint.log`) |
| prettier check over `git ls-files -co --exclude-standard` | exit 0 (`format.log`); the two docs edited afterwards (ADR-0035 §1/§11 wording and codes, this handback) re-checked with `prettier --check`: exit 0 |
| `pnpm openapi:lint` | exit 0, 607 operations (`openapi-lint.log`) |
| `pnpm test`, locale unset | exit 0: **2105 passed** (107 files); worker **259 passed, 2 skipped** (`unit-locale-unset.log`); run 1 (exit 1, the stray `.claude` directory) disclosed in §4 |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | exit 0: **2105 passed**; worker **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: **99 files, 1133/1133 passed** (`integration.log`) |

**Pinned-count changes:** unit +3 (three `0053` seed tests); integration +1 (the slice H catalogue trigger test); contract operations 570 → 607; advisory-lock classes 21 → 23; TO's effective permissions +6; the worker schedule test's `unhandled` list +1. The media-type triple pin of `contract.test.ts` is unchanged: it counts routed operations, and none of the 37 is routed.

**Disclosed:** during the integration run I edited only documentation (ADR-0035 §1 probe references and two §11 rows; this handback); no test reads those files. The empty sandbox directories `.claude/.cc-writes` under `docs/` (four, incl. one in the ARCH-06 evidence directory that I did not create) were left in place; git does not track empty directories.

**End:** `Fri Oct  9 09:56:33 UTC 2026`.
