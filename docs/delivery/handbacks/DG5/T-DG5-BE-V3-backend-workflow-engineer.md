# Handback T-DG5-BE-V3 (backend-workflow-engineer): DG5 round-1 repair of F-DG5-120

- **Stage / gate:** P5, DG5, FIXING after round 1 (candidate `sha256:8e7d23a3…`, D-170).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-V3-backend-workflow-engineer-20261018T051603Z-b9bed4ed","session_id":"b9bed4ed-60c0-4ee6-95b3-12206bf74b45"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-V3.md` (sha256 `c55486a7…1220d5`, verified at start).
- **Working tree:** `/home/user/wt/dg5-be-v3`, branch `dg5/be-v3`, base `HEAD` `e0cfdaf`. All changes are **uncommitted**, as the assignment asks.
- **Time:** started `Sun Oct 18 05:16:19 UTC 2026`, finished at about `06:20 UTC` (`date -u` output: section 4).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, at the start and at the end.

**Nothing here grants a real approval.** Every seeded G-decision and exception is a synthetic demonstration decision by a demo role user, on demo data, in a demo-initialized database. Each one is labelled "Synthetic demonstration - approves nothing real". Seeding is refused in production, as all demo seeding is (`demo/guard.ts`, unchanged). Product gates G1–G6 are business approvals inside the product. G6 is not seeded, and nothing here touches DG0–DG7.

## 1. Files changed

| File | Change |
|---|---|
| `packages/db/src/demo/data/roaming-gates.ts` | **New** module `roaming.gates` (order 550). It seeds the G1–G4 gate history as the product records it: (1) the evidence each gate's criteria read; (2) two accepted G4 gate exceptions; (3) per gate, the submission, its frozen criteria, the decision, the agreements and the phase advance. |
| `packages/db/src/demo/data/roaming.ts` | The transformation is created in `diagnose` (was `transform`). The charter carries the B0037 thesis (`thesis_change/outcomes/benefits/because`). The three outcomes carry the B0051 good-outcome inputs (`specific_confirmed`, `strategically_relevant_confirmed`, `causal_chain`). |
| `packages/db/src/demo/data/roaming-states.ts` | Each phase step names the approved gate decision that enabled its phase (`enabled_by_gate_decision_id`), as the `gates.decided` consumer does, and is dated at that decision. Diagnose and Realize steps name none. |
| `packages/db/src/demo/data/roaming-ids.ts` | New id blocks `0x060`–`0x069` for the new rows. |
| `packages/db/src/demo/data/index.ts` | Registers `ROAMING_GATES_MODULE` (between the chains and the states). |
| `apps/api/test/integration/environment/demo-gate-history.test.ts` | **New** regression test: the reviewer's reproduction, run through the product's own operations. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-V3-evidence/**` | Logs, screenshots and the rendered-page probe (section 4). |

There is no migration, no schema change, no contract change, no new dependency and no `apps/web` change.

## 2. F-DG5-120 (Medium, REQ-S18-002, M0348): the cause, the fix and the regression test

**The cause.** `roaming.ts` inserted the transformation directly with `current_phase: "transform"`. The starter structure inserted the six `gate_instance` rows as `draft` with no submission or decision (old `roaming.ts:229` and `:361–374`). No module ever recorded a gate history, so the demo showed Transform-phase progress and validated value with G1–G6 never submitted.

**The fix (D-170).** The approved-gate history is now seeded through the product's own tables, database guards and audit action names (`apps/api/src/modules/workflows/gates.ts` `submitGate` / `decideGate`; `transformations/phase.ts`).

**Phase.** The transformation is created in Diagnose (`roaming.ts:230`). Each approved gate advances it by exactly one phase (`transformation.phase_advance`, `roaming-gates.ts:709`), so it ends in Transform at version 5 (four phase advances). The seed refuses to run (throws) if a gate is not an unconfigured draft routed to SP, or if the transformation is not in that gate's phase (`roaming-gates.ts:489`ff).

**Evidence, so each approved page reads complete** (`seedGateEvidence`, `roaming-gates.ts:231`ff, all dated before the gate):
- **G1:**
  - a measured baseline (attach rate 0.18, source and date);
  - one **verified** evidence note, created by TL and reviewed by KDS (never its author; 0019 guard). It is linked to the six T01 rows and to the baseline;
  - the six T01 rows completed (current state, root cause, impact, confidence, baseline);
  - a confirmed `root_cause` finding;
  - a quantified, material value pool.
- **G2:**
  - the B0037 thesis (`roaming.ts:648`) and the good-outcome inputs (`roaming.ts:682`);
  - the three T02 trajectories, approved by SP (not their creator TL) for their current version;
  - one active strategic guardrail.
- **G3:** a capability gap (level 2 → 4, linked to TOM gap 1) and an active future-state journey.
- **G4:** the business case's baseline section, validated by the demo Finance user (`validate_baseline`, `roaming-gates.ts:428`). The sha256 is computed as `business-cases.ts` `baselineSha256` does, so it reads `validated`, not `stale`.

**Two G4 exceptions, exactly as the product allows one** (`DEMO_GATE_EXCEPTIONS` `:136`, `seedGateExceptions` `:442`; ADR-0035 §4). They cover `g4.initiative_cards` (portfolio empty) and `g4.prioritization` (no ranking snapshot). Each:
- is requested by TL, created `pending`, then accepted by SP (the gate's approver, never the requester; DB CHECK);
- carries a reason, a scope, a compensating action owned by TL, and an expiry of synthetic clock + 730 days (2028-08-31);
- carries the synthetic label in the reason and the decision note.

The submission rows link each exception (`gate_exception_id`; 0051 trigger `…_exception_covers` checked on the submission date).

**Submit and decide, per gate** (`seedGateApproval`, `:489`ff):
- **The submission:** `gate_submission` (pending, `submitted_by` = roaming.user.tl, routed to role SP with no named user). Its snapshot follows the product's `mth.gate-submission/1` shape: transformation version and phase, charter, North Star, approver, criteria (with the exception member on covered criteria), evidence, and the `g4` member for G4 (`g4SnapshotOf`, `:716`). The sha256 is computed over canonical JSON.
- **The criteria:** `gate_submission_criterion` rows. Then `gate_instance.submit` (`:634`).
- **The decision:** the canonical `decision` row (kind gate, `GD-01`…`GD-04`), then `gate_decision` (approved, decided by roaming.user.sp, basis `default_role`, role SP). The `gate_decision_guard` refuses it if the decider is the submitter.
- **G1's agreements:** the three B0032 agreements, confirmed by the decider (0024/0025 guards).
- **Then:** `gate_submission.decide`, `gate_instance.decide` (approved, `approved_at`), and the phase advance.
- **Rationale:** each rationale is dated and synthetic, and starts with "Synthetic demonstration - approves nothing real / عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي."

**Dates.** The synthetic clock is `2026-09-01T06:00Z`; the gates run in phase order (`DEMO_GATE_HISTORY`, `:67`):

| Gate | Submitted | Decided |
|---|---|---|
| G1 | 21 May | 22 May |
| G2 | 29 May (after the KPI trajectories, 28 May) | 30 May |
| G3 | 1 Jun | 2 Jun |
| G4 | 8 Jun (after the Finance validations, 5 Jun) | 10 Jun |

G4 is decided before the Transform-phase records that depend on it: benefits enabled 15 Jun, the launch plan and initiative starts 3 Jul.

**G5 and G6** stay draft and not submitted. The workspace's "Gate readiness: G5" is computed by the product (G5 reads "1 of 4 mandatory outputs complete").

**Kept:**
- REQ-S18-002 coverage: the coverage check is unchanged, every condition is met, and the pending approval is still in `roaming.user.bo`'s inbox (`demo-pending-approval.test.ts` passes);
- the REQ-S18-001 deterministic reset (`demo.test.ts` CLI seed → reset → reset; `demo-roaming` / `demo-numbers` second-seed checks pass);
- the three B0147 chains (`demo-traceability-chains.test.ts` passes);
- the walkthrough on a NEW transformation (`walkthrough.test.ts`, and the e2e `a02-guided-walkthrough` and `a02-demo-users-walkthrough` pass).

**The regression test.** `apps/api/test/integration/environment/demo-gate-history.test.ts` uses the real `seedDemo` in a scratch database and the real API with `MTH_ENV=demo`. It signs in as roaming.user.tl and roaming.user.sp and checks, through `GET /transformations/{id}`, `GET /transformations/{id}/gates`, `GET …/gates/{code}/submissions/1` and `GET …/gate-exceptions?gateCode=`:
- the transformation is `end_to_end` in `transform`;
- G1–G4 are approved (`latestSubmissionNo` 1, `canSubmit` false). Each submission was decided, submitted by TL and routed to SP. Each decision is approved by SP (`default_role`, never the submitter) and its rationale contains the label in en and ar. G1 has its three agreements;
- every mandatory G1–G4 criterion is complete, or covered today by an accepted exception decided by SP and labelled;
- only `g4.initiative_cards` and `g4.prioritization` are incomplete or excepted;
- the frozen criteria agree with the live ones;
- the gates are in phase order, and G4 is decided before the launch plan and initiative start dates;
- G5 and G6 are draft, 0 submissions, no current submission;
- four `transformation.phase_advance` audit events: diagnose → define → design → mobilize → transform.

**The reviewer's final assertion**, kept and reversed by the fix, is at `:163–164`: `expect(gates.map(v => v.gate.status)).toEqual(["approved","approved","approved","approved","draft","draft"])`.

**Failing before the fix** (`T-DG5-BE-V3-evidence/regression-before.log`, run on the unchanged seed, exit 1). Tail:
```
- Expected  + Received
    "G1",
-   "approved",
-   1,
+   "draft",
+   0,
 ❯ …/demo-gate-history.test.ts:71:70
 FAIL … the phase history: four phase advances … AssertionError: expected [] to deeply equal [ …(4) ]
 Test Files  1 failed (1)
      Tests  2 failed (2)
```
**Passing after the fix** (`regression-after.log`, exit 0):
```
 ✓ |integration| apps/api/test/integration/environment/demo-gate-history.test.ts (2 tests)
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
The test was later tightened (exact excepted set), and the tightened version also passed (it is part of the integration run in section 4).

**Rendered evidence** (`T-DG5-BE-V3-evidence/probe/{en,ar}/`). These are screenshots and visible text of the workspace and of G1, G4 and G5, rendered on a demo stack as roaming.user.sp:
- **G1:** "Approved", "6 of 6 mandatory outputs complete" / "6 من 6 مخرجات إلزامية مكتملة", the synthetic label, and submission #1 decided.
- **G4:** "Approved", and the two accepted exceptions with reason, scope, compensating action, owner, expiry and the approver's labelled decision.

The probe spec is kept as `probe/gate-pages.probe.spec.ts.txt`. It ran through a temporary Playwright config in `$TMPDIR` and was renamed afterwards, so it is not part of lint or the test tree.

## 3. Pinned demo counts and checksums

**No pin had to change.** No owned or listed test pins the record counts or the checksum: they compare two seeds or resets with each other. `tests/qa/integration/{a02-a21-complete-lifecycle,a15-demo-transformation-outputs,a22-operational-readiness}.test.ts` pass unchanged.

The dataset itself does change: new rows in `baseline`, `evidence`, `evidence_link`, `diagnostic_finding` (+1), `value_pool`, `strategic_guardrail`, `capability`, `journey`, `gate_exception` (2), `gate_submission` (4), `gate_submission_criterion` (24), `decision` (+4: GD-01…04), `gate_decision` (4) and `gate_decision_agreement` (3). Several rows change too: the transformation is now version 5, the six T01 rows, the three T02 rows, the business case, and the phase steps' `enabled_by_gate_decision_id` and dates. The counts and the checksum therefore differ from round 1's, and stay identical across seed, reset and reset.

## 4. Checks run (real exit codes)

All ran in this worktree, with Node 24.21.0 and ports 23100–23149, one heavy run at a time (D-164). The logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-V3-evidence/`.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start and end) | 0 / 0 | `PASS gate DG4 (historical)` |
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log`. The first run exited 2: TS2358 (`instanceof` on a date column typed as a string) in the new test. Fixed, then re-run after Prettier: 0 |
| 1 | `pnpm -r build` | 0 | `build.log` (re-run after Prettier: 0) |
| 1 | `pnpm lint` | 0 | `lint.log`. The first run exited 1: an unused-value `PHASES` const in `roaming-gates.ts`, replaced by a type. Re-run after Prettier: 0 |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. Re-run after this handback was written: 0 |
| 1 | `pnpm openapi:lint` | 0 | `openapi-lint.log`: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` |
| 2 | `npx vitest run --configLoader runner --project unit-node packages/db/src`, locale unset | 0 | **4 files, 72 tests passed** (`unit-db-locale-unset.log`) |
| 2 | the same, with `LANG=LC_ALL=C.UTF-8` | 0 | **4 files, 72 tests passed** (`unit-db-c-utf8.log`) |
| 3 | `QA_PG_PORT=23101 MTH_PORT_POOL=23102-23149 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration packages/db/test/integration apps/api/test/integration/environment tests/qa/integration/a02-a21-complete-lifecycle.test.ts tests/qa/integration/a15-demo-transformation-outputs.test.ts tests/qa/integration/a22-operational-readiness.test.ts` | 0 | **21 files, 294 tests passed**, 363 s (`integration.log`; includes the new test) |
| 3 | the new test alone, before the fix / after the fix | 1 / 0 | `regression-before.log` (2 failed) / `regression-after.log` (2 passed) |
| 4 | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_PG_PORT=23110 E2E_API_PORT=23111 MTH_PORT_POOL=23112-23149 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1 --reporter=list` | 0 | **12 passed** (6 specs × en/ar), 3.7 min (`e2e-demo.log`) |
| — | the rendered-page probe on a second demo stack (same ports) | 0 | 2 passed (`probe/probe.log`) |

**Notes on these runs:**
- **The screenshot directory.** `E2E_SCREENSHOT_DIR` was set, but these specs write to `QA_EVIDENCE_DIR`, which defaults to `test-results/…`. So the gate-label screenshots were copied from there to `shots/{en,ar}-labels-gate-approval.png`, and `test-results/` was then removed.
- **No failures.** There was no flaky test, no timeout and no warning in the logs. The two "error" matches in `integration.log` are test names.
- **Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They are for the orchestrator's merged-tree verification and are not claimed as passed.
- **Earlier development runs** (same commands, all exit 0): `packages/db/test/integration` + `environment`, 18 files / 266 tests; the three QA files, 3 files / 28 tests.

## 5. Contract, schema, dependency or web needs (for the orchestrator)

- **Contract, schema, dependency:** none. No operation or response shape changed, and no migration was added.
- **Web (FE-owned; this is a need, not a defect of this task).** On an approved gate whose mandatory criteria are partly covered by accepted exceptions, the live readiness banner counts only complete outputs. The G4 page therefore reads "6 of 8 mandatory outputs complete" (Arabic: "6 من 8 …") next to "Approved", with the two accepted exceptions listed right below it. The gate-exceptions panel and the frozen submission view (`GateP4.tsx` `coveredByException`) do show the coverage.
  - **Why it matters:** D-170 asks that no approved gate page show a bare "N of M complete".
  - **Option 1 (no contract change):** make the banner say the rest is covered. The server already returns `covering` on each exception, and the string `gates.submit.coveredNote` ("… The other {{covered}} are covered by accepted exceptions …") exists for the submit dialog. A gate-page variant of it would do.
  - **Option 2:** replace the two exceptions with a full G4 portfolio dataset (section 7).
- The synthetic label itself needs no web change. `SyntheticApprovalLabel` already shows it on every gate page in a demo database, in en and ar (`a02-demo-labels` passes). The seeded decisions also carry it in their rationale.

## 6. ADR and data-dictionary statements this fix makes untrue or incomplete (for T-DG5-ARCH-R4)

**ADR-0050** (`docs/architecture/adr/ADR-0050-p5-demo-environment-roaming-dataset-reset-walkthrough.md`):
- **§4 "The dataset":** it describes one end-to-end transformation with the B0145 elements and the B0147 chains, and says nothing about its phase or gate history. It should add:
  - the transformation is created in Diagnose and advanced to Transform by the synthetic G1–G4 approvals (module `roaming.gates`, order 550);
  - G1–G3 are complete on seeded evidence, and G4 is complete except two accepted exceptions (`g4.initiative_cards`, `g4.prioritization`, expiry 2028-08-31);
  - G5 and G6 are not submitted;
  - updates are written with their own audit events (`<table>.<verb>` or the product's action names, source `cli`), in addition to "one audit event each" per inserted row.
- **§5 "G1–G6: a gate instance each":** still true. A note could add that G1–G4 carry approved decisions.
- **Line references made stale by the new lines in `roaming.ts` and `roaming-states.ts`:**

  | Reference | Now |
  |---|---|
  | `roaming.ts:669` (`statement: c.kpi`) | `:676` |
  | `roaming.ts:665` (the comment) | `:672` |
  | `roaming-states.ts:280–345` (`seedPendingApproval`) | `:285–350` |
  | `roaming-states.ts:348` | `:353` |
  | `roaming-states.ts:355` | `:360` |

  `roaming.ts:110/118/132` are unchanged.
- **The phase steps:** they now carry `enabled_by_gate_decision_id` for Define…Transform. The Realize steps still exist without an approved G5. The coverage condition "phase 6" needs them, and they predate this task.

**Data dictionary:** I found no statement about the demo dataset's gate states. If the architect documents the dataset there, the same facts as for §4 apply.

## 7. User-facing text made untrue, and what was done

- **Before the fix,** the demo showed "Phase 5 Transform (current phase)" with every gate "Not submitted" (the finding). That is now true to the data: G1–G4 read "Approved" with their decisions.
- **The G4 banner** "6 of 8 mandatory outputs complete" next to "Approved" is true, because two criteria are covered by exceptions. But it is the kind of reading D-170 wants avoided. Reported in section 5; not changed (FE ownership).
- **No string in a catalogue was changed.** The new seeded texts are in English with the label also in Arabic: rationales, submission notes and exception reasons are user data, as for every other seeded record. They are marked synthetic.

## 8. What remains (stated plainly)

1. **G4 is approved with two accepted exceptions instead of a complete portfolio.** The illustrative initiatives INI-01…03 stay `draft`, so the G4 "approved portfolio" is empty and no ranking snapshot exists.
   - **Why:** a complete G4 needs, for each initiative: portfolio submission, ranking and selection; a funding decision; an approved milestone; committed demand with capacity for every month; and an initiative-level business case with its Finance validation. That cascades into the KBE-H numbers, the walkthrough and the B0147 tests, and could not be done safely in this task.
   - **Allowed by D-170** ("or covered by an exception exactly as the product allows one").
   - **Time-bounded:** after **2028-08-31** (the exceptions' expiry, a real-date comparison), the live G4 page shows the two criteria as missing again, as the product does for any expired exception.
2. **The "6 of 8" banner** on the G4 page (section 5).
3. **Not written to the outbox:** `gate.submitted` and `gate.decided`. Their consumers would create approver tasks and phase-step rows from the real clock. Their effect on phase steps is seeded directly instead.
4. **Not recorded:** the `REQUEST_STARTERS.gateEvidenceMissing` request execution (automation bookkeeping) of `submitGate`.
5. **Audit attribution.** The seeded rows' audit events carry the seed's actor (system, source `cli`), as every demo-seeded row does. The acting demo user is on the rows themselves (`submitted_by`, `decided_by`, `requested_by`).
6. **Not run, D-164:** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite.

## 9. Merge instructions

- Apply the uncommitted changes listed in section 1. There is no migration and no ordering constraint.
- **Possible conflicts with other repair tasks:**
  - T-DG5-BE-V1 edits `packages/db/src/schema.ts` and adds migration `0097`. This task touches neither.
  - No file overlaps with BE-V2 (`procedures/**`) or FE-V1 (`apps/web/**`).
- After merging, a demo database must be re-seeded (`mth-db reset-demo` or `seed-demo`) to show the gate history.
- The top-level untracked dotfiles in this worktree (`.bashrc`, `.vscode`, `CLAUDE.local.md`, …) were there before this task and are not part of it.
