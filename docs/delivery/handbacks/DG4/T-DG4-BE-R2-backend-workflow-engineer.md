# Handback T-DG4-BE-R2 (backend-workflow-engineer): approval resubmit/withdraw in the caller's transaction, revoked gate exception, weekly cadence, worker attempt count

- **Stage:** DG4 (BUILDING). Branch `dg4/be-r2`, worktree `/home/user/wt/dg4-be-r2`, base `HEAD` `8a641e1152cba35234cacd3a8852fd968cfb5d39`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-BE-R2-backend-workflow-engineer-20261009T232626Z-7bdd15c3` (session `7bdd15c3-b7da-4013-b214-90658a991649`). The assignment's sha256 `74add3e5…d98a5ed` was verified before I started.
- **Time:** start `2026-10-09T23:26:38Z`, end `2026-10-10T00:25:18Z` (`date -u`; see `evidence/start-time.txt` and `end-time.txt`). About 59 minutes, within the bound.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, exit 0. I ran it before any edit and again at the end (`evidence/validate-dg3-historical-{start,end}.txt`).
- **Two gate systems.** Every approval decided in these tests is a synthetic, in-product business approval of synthetic data, made by a test user. None is made by a requester, a job or an agent. Nothing here reads or writes DG0–DG7 records other than this handback and its evidence.

## 0. Read first: production wiring (D-107)

**No `server.ts` edit is needed.**
- Sustainment reaches workflows only through the port that `server.ts` wires with `wireTransitionDecisionApprovals({ requestApproval, registerSubject })`. I did not add fields to that port.
- Instead, the approval registry hands its in-transaction services to any provider that declares `bindServices` (`registerApprovalSubject` calls it once). The transition-decision provider receives `resubmit` and `withdraw` through the `registerSubject` call that the existing wiring line already makes.
- **Proof:** `test/integration/sustainment/transition-decisions-server-wiring.test.ts` now has a third case. It builds the real server through the harness, wires nothing by hand, and counts the wiring calls (still exactly 1). It then shows that a round-2 resubmit and a withdrawal both succeed. Without the binding, both paths fail closed with 500.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/approvals.ts` | **Item 1.** Adds `resubmitApprovalInTx` and `withdrawApprovalInTx` (ADR-0026 A2/A3), plus their input types, `ApprovalInTxServices`, the provider flags `resubmitThroughSubject` and `bindServices`, and the refusal `approval.resubmit_through_record`. The two routes now run their existing gates, then the service, then `emitOutcome`. |
| `apps/api/src/modules/workflows/index.ts` | Exports the two services and their types. |
| `apps/api/src/modules/workflows/workflows.test.ts` | The pinned export list gains `resubmitApprovalInTx` and `withdrawApprovalInTx`. |
| `apps/api/src/modules/governance/matrices.ts` | **Item 1, BE-C §4.1.** A draft matrix whose approval has changes requested is set `in_approval` (audited) on submit, then resubmitted on the new header version in the same transaction. The provider sets `resubmitThroughSubject`. |
| `apps/api/src/modules/sustainment/transition-decisions.ts` | **Item 1, BE-J.** Submit on a draft whose approval has changes requested resubmits that approval. Withdrawing a decision with an open approval calls `withdrawApprovalInTx` first, then moves the row `draft → withdrawn`. The services arrive through `bindServices`; the provider sets `resubmitThroughSubject`. |
| `apps/api/src/modules/workflows/change-requests.ts` | **Item 1, BE-L.** `submitInTx` resubmits a returned request's approval in its own transaction. `withdrawRequest` on a request in approval withdraws the approval first. `change_request.withdraw_via_approval` is removed (retired). The provider sets `resubmitThroughSubject`. |
| `apps/api/src/modules/workflows/gates.ts` | **Item 2.** `gate.exception_revoked` is checked before `gate.exception_expired` on the approve path. |
| `apps/api/src/modules/sustainment/handovers.ts` | **Item 3.** `["weekly", "weekly"]` is added to the cadence map. |
| `apps/worker/src/handlers/spec.ts` | **Item 4.** `JobAttempt` moves here; `JobHandler.handle` takes an optional fourth argument `attempt`. |
| `apps/worker/src/worker.ts` | **Item 4.** `boss.work(…, { includeMetadata: true })` and passes `{ retryCount, retryLimit }` to every domain handler. |
| `apps/worker/src/handlers/kpi.ts` | **Item 4.** `recalculateAttemptOf`, the `pgboss.job` read, is removed. `recalculate` uses only the attempt it is passed; a call without one is "not known to be last", as before. `JobAttempt` is re-exported from `spec.ts`. |
| `apps/api/test/integration/workflows/change-requests-in-tx.test.ts` (new) | A4 (a)–(d) for `change_request`, the round-1 stale 409, and the not-requester 403s. 6 tests. |
| `apps/api/test/integration/governance/matrix-resubmit.test.ts` (new) | A4 (a)–(d) for `governance_matrix_change`, the stale 409, and the not-requester 403. 5 tests. |
| `apps/api/test/integration/sustainment/transition-decisions-in-tx.test.ts` (new) | A4 (a)–(d) for `benefit_transition_decision`, the stale 409, the no-edit 422 and the not-requester 403s. 6 tests. |
| `apps/api/test/integration/sustainment/transition-decisions-server-wiring.test.ts` | +1 test: the real-server path for resubmit and withdraw (§0). |
| `apps/api/test/integration/sustainment/transition-decisions.test.ts` | Two BE-J tests that encoded the old behaviour now assert the corrected flow. Before: a 409 `approval.already_open` on resubmit, and a stale 409 after withdrawal. Now: resubmit through submit, and a withdrawn approval that answers 422 `approval.not_open`. |
| `apps/api/test/integration/workflows/change-requests.test.ts` | The `withdraw_via_approval` assertion is replaced by the in-transaction withdrawal (200; the approval is `withdrawn`). |
| `apps/api/test/integration/workflows/impact.test.ts` | The manual `POST …/resubmit` is removed (it is now 422 for this type). The test asserts the submit itself resubmitted: round 2, `subjectVersion` 5. |
| `apps/api/test/integration/workflows/gate-exceptions.test.ts` | **Item 2.** +2 tests, beside BE-K2's expired-exception test. |
| `apps/api/test/integration/sustainment/handovers.test.ts` | **Item 3.** +1 test. |
| `apps/worker/test/integration/worker-attempt.test.ts` (new) | **Item 4.** 1 test. |

There are no migrations, no contract changes and no seed changes.

## 2. Behaviour delivered

My section assigns no requirement IDs. Each item is mapped below to the row it repairs; the quoted acceptance texts come from `requirements.csv`.

### Item 1: in-transaction resubmit and withdraw (ADR-0026 amendment A2–A4)

**The services follow A2/A3 as written.**
- **Check order:** 404, then 403 `approval.not_requester`, then 409 version conflict (only when `expectedApprovalVersion` is given), then the status check, then the version and stale checks under the approvalSubject lock. Nothing is written on a refusal.
- **Effects:** exactly those of the previous route bodies, including the audit events `approval.resubmit` and `approval.withdraw`, work-item closing, and approver tasks.
- **No `onOutcome`.** Neither service calls it. The routes call `emitOutcome` themselves, so the route contract and responses are unchanged (`approvals.test.ts`, `p4-exercises-be-b.ts` and `reminders.test.ts` pass unchanged).
- **`resubmitThroughSubject`:** `POST …/resubmit` answers 422 `approval.resubmit_through_record`, "Resubmit this request by submitting its record again.", and writes nothing. The check runs after the 404, requester and permission gates and before `If-Match`.

**Rows served:**
- REQ-S10-017, "approving version 3 after the record moved to version 4 returns 409";
- REQ-S10-018, "'request changes' returns the item to the requester without closing it";
- REQ-S10-007, versioned approved matrix changes;
- REQ-S11-007;
- REQ-PB-065 and REQ-S04-014, the change-request approval path.

**Proofs, per subject (A4 (a)–(d)):**

| | governance matrix | transition decision | change request |
|---|---|---|---|
| (a) round 2 through the subject's submit: one open approval, round 2, at the new version; a decision on it succeeds | ✓ The header is `in_approval` again and the rows are frozen again (422 `governance_matrix.in_approval`). The header submit and the approval resubmit share one xmin. | ✓ | ✓ A second impact assessment is frozen. The CR submit and the approval resubmit share one xmin. The approver task is for round 2; the changes-requested item is `done`. |
| stale approval still 409 | ✓ A decision quoting the round-1 version → 409 `approval.stale_version`; nothing is decided. | ✓ | ✓ |
| (b) subject-side withdraw: approval `withdrawn` and subject withdrawn (or draft), both audited in one transaction | ✓ **Through the approval route.** A matrix has no withdraw action of its own; `onOutcome('withdrawn')` returns the header to `draft`. Tested in round 2; `approval.withdraw` and `governance_matrix.return_to_draft` share one xmin. A later submit creates a new round-1 approval. | ✓ For a pending approval and for one with changes requested. `approval.withdraw` and `transition_decision.withdraw` share one xmin. A later decision is 422 `approval.not_open`, so no approval is left that can never be decided. | ✓ For pending and for changes requested; same xmin. The approver task is `cancelled`. `withdraw_via_approval` is no longer produced. |
| (c) `POST …/resubmit` → 422 `approval.resubmit_through_record`, nothing written | ✓ | ✓ | ✓ |
| (d) requester revoked between request and commit → 403, nothing written | ✓ round-2 submit | ✓ submit and withdraw | ✓ submit and withdraw |
| also | Another TL submitting round 2 → 403 `approval.not_requester`; nothing is written. | No edit → 422 `approval.resubmit_needs_new_version`. Another BO → 403 `approval.not_requester` on submit and on withdraw. | Another TL → 403 `approval.not_requester` on submit and on withdraw. |

### Item 2: revoked gate exception (ADR-0035 amendment A1)

Approving a submission whose snapshot records an exception now in status `revoked` is refused with 422 `gate.exception_revoked`: "The exception for {label} was revoked on {date}; it no longer covers the missing evidence."
- {date} is `p4_business_date(revoked_at, transformation.timezone)`.
- The check runs before the expiry check, so an exception that is both revoked and expired reports the revoke.

**Tests:**
- An exception revoked before the decision → 422 with the exact text; no `gate_decision` is written, and the `gate_submission` row is byte-identical.
- Reject on the same submission → 201.
- An exception that is both revoked and expired → `gate.exception_revoked`.
- An unrevoked, unexpired exception → approve 201 `approved`.

Row served: REQ-S04-012, "with a valid exception it succeeds and the snapshot records the exception". A revoked exception is no longer valid.

### Item 3: weekly cadence (ADR-0034 amendment A1)

A weekly handover sets a linked benefit's `control_cadence` to `weekly` and its BAU owner, at version + 1. It is audited (`control_cadence: {from: null, to: "weekly"}`), and the API shows `controlCadence: "weekly"`.

Row served: REQ-PB-083, "accepting a handover creates recurring BAU review tasks for the BAU owner exactly once". That test is unchanged and still passes.

### Item 4: attempt count for worker handlers (KBE-R1 handback §5.2)

`worker.ts` passes `{ retryCount, retryLimit }` from the job's own pg-boss metadata. The kpi handler no longer reads `pgboss.job`.

**Tests:**
- New: a handler that fails once sees `{0, 1}`, then `{1, 1}`; `isFinalAttempt` gives `[false, true]`; pg-boss records `retry_count 1 / retry_limit 1`, completed.
- KBE-R1's final-retry tests in `kpi-recalculate.test.ts` pass 5/5, including the production-worker dead-letter case.

## 3. Checks actually run

Logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-R2-evidence/`. Environment: Node 24.21.0, offline. Harness ports were 24950–24999. Disk had 21 GB free before each full run (`df-before-*.txt`).

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | `PASS gate DG3 (historical)`, exit 0 |
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r build` | exit 0 |
| `pnpm lint` | exit 0 |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | "All matched files use Prettier code style!", exit 0 |
| `pnpm openapi:lint` | `PASS … OpenAPI 3.1.1, 647 operations`, exit 0 |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | exit 0. First Vitest invocation: 122 files, **2342 passed**. Second: 3 files, **259 passed, 2 skipped**. (`unit-locale-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | exit 0. Same counts: 2342; 259 passed, 2 skipped. (`unit-c-utf8.log`) |
| `QA_PG_PORT=24970 MTH_PORT_POOL=24971-24999 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0. 165 files, **1609 passed** (PostgreSQL 16.13 on port 24970, first attempt). This is D-109's 1587 + 22 new: 6 CR + 5 matrix + 6 transition decision + 1 server wiring + 2 gate exception + 1 handover + 1 worker. Duration 822 s. No retries and no flaky tests. |

The lint, format, typecheck, build and openapi checks were re-run after my last source edit (two comments); the table shows those final runs. The unit and integration runs above were made after that edit too.

**Two non-zero exits, both disclosed and kept as logs:**
1. **`unit-locale-unset-run1-FAILED.log`, exit 1.** This was my defect. `advisory-locks.test.ts` forbids lock-class literals outside the registry, and two of my comments wrote `730226`. I replaced them with "the approvalSubject lock" and the registry test passed (3/3). A later full run passed.
2. **`unit-locale-unset-run2-FAILED-stub-dir.log`, exit 1.** This came from the environment. `architecture.test.ts` found an empty sandbox stub directory `apps/api/src/modules/.claude` (left after I removed its `.cc-writes`, as the assignment asks). I removed the empty `.claude` stubs too and re-ran; that run passed (`unit-locale-unset.log`). Before every later run I removed both stub kinds.

Before the full runs I also ran each changed or new integration file on its own; all passed.

## 4. Pending operations, media-type pin, contract and schema

- **Operations routed:** none. No contract operation was added or removed, so my pending list has no delta. The changes are behaviour inside existing operations.
- **Media-type pin:** unchanged at `[304, 303, 1]` in `contract.test.ts`. I added no JSON request body.
- **Schema:** none needed. The `0031` trigger allows both services, as ADR-0026 A1 says. No migration number was used.
- **New codes, for the orchestrator:** `approval.resubmit_through_record` (422) and `gate.exception_revoked` (422), with exactly the ARCH-R1 English texts. `change_request.withdraw_via_approval` is retired; the code no longer appears in `apps/` or `packages/`.
- **FE:** EN/AR texts for the two new codes are not in `apps/web` i18n. That is FE's file scope.

## 5. Wording for the architect (item 5) and other notes

- **ADR-0025 §3**, the job-handler rules, does not say that the worker passes the attempt (`retryCount`/`retryLimit` from the job metadata) to `JobHandler.handle`. It doesn't contradict it either; it is a suggested addition.
- **ADR-0027 §8 step 4** still reads as the handler knowing its last attempt. True now, but the source of the attempt is the worker (per KBE-R1 §5.2, which ARCH-R1 left open).
- **ADR-0031:** I found no text that no longer matches what I built. Nothing in this task touches RAID.
- **ADR-0026 amendment A2–A4: as built, compared with the text.**
  1. On a resubmit where the subject no longer exists (current version null), the service answers 422 `approval.subject_unknown`, as the old route did. A2 lists only `approval.stale_version` for step 6.
  2. The 403 `approval.not_requester` from the services carries the authorization-denial audit, like the route's.
  3. Sustainment receives the services through the new `bindServices` provider hook, which A4 does not describe (see §0).
  4. **Withdraw reason.** A3 requires a reason, but the subject-side withdraws have no reason field: `withdrawChangeRequest` has no body, and the transition-decision PATCH has no `reason`. The server therefore writes `Change request CR-nn withdrawn.` / `Transition decision TD-nn withdrawn.` as the `approval.withdraw` reason. If the architect wants a user-entered reason, the contract needs a body.
  5. **Round-2 matrix submit.** It answers 201 with `Location` set to the existing approval, the only success status the contract declares, and the body's `title` is not applied on round 2 (the approval keeps its title).
  6. **A4 test (b) for matrices** goes through `POST /approvals/{id}/withdraw`, because a matrix has no withdraw action of its own.
  7. **Requester only.** A TL or another BO/FIN who may act on the subject, but is not the approval's requester, gets 403 `approval.not_requester` from round-2 submit or from withdraw. A2/A3 imply this, but the subject modules otherwise allow "requester or lead" (ADR-0036 §7).
- **ADR-0035 A1** is implemented as written. When several criteria have exceptions, the first revoked one in ordinal order is reported.

## 6. What remains

Nothing in the assigned scope remains. Items 1–4 are implemented and proven; item 5 is the list in §5. There are no merge instructions beyond integrating the uncommitted files.

**Conflicts to expect:**
- `transition-decisions.test.ts`, `change-requests.test.ts`, `impact.test.ts`, `gate-exceptions.test.ts` and `handovers.test.ts` are other tasks' test files. I edited them only where the old behaviour was asserted, or to add tests beside existing ones.
- `apps/worker/src/handlers/spec.ts` and `worker.ts` are shared with any concurrent worker change.
