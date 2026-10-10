# Handback T-DG4-QA-B (qa-verifier, authoring): executable acceptance suites A08 and A09

Completed by the salvage run **T-DG4-QA-BB** (invocation `DG4-T-DG4-QA-BB-qa-verifier-20261010T094037Z-0ac43f67`, session `0ac43f67-7f93-4d14-b1e0-ca4d7723e1fb`). Assignment `docs/delivery/assignments/DG4/T-DG4-QA-BB.md`, sha256 `f2682951…4ce411a` (verified).

- **Stage:** DG4 (BUILDING). This is an **authoring** task. It is not the DG4 gate review, and it grants no verdict on DG4.
- **Tree:** worktree `/home/user/wt/dg4-qa-b`, branch `dg4/qa-b`, HEAD `ea92e25` (the WIP commit of the interrupted run). My changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started 09:40:49Z, last check 09:58:12Z (about 18 minutes of the 2-hour limit used).
- **Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL came from `with-pg.sh` and `with-stack.sh`. Chromium came from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was not run.
- **Ports:** 25750–25799 only.
- **Disk:** checked before each full run. 7.9 G was free each time.
- **Data:** all synthetic. Every gate decision, exception decision and approval in these suites is a synthetic in-product business action by a test person on test data. Nothing here grants a real business, Finance or IT approval. Product G1–G6 never imply DG0–DG7.

## Salvage

### Kept from the WIP

I reviewed every WIP file as someone else's work, against the requirement rows, `docs/api/openapi.yaml` and the shared rules. I kept these files after review:

- `tests/qa/support/gates-native.ts`: the native world builder. It creates the transformation through the API, grants roles through the access API, maps parties, and passes G1–G4 by exception, Lead submission and Sponsor approval. It is used unchanged.
- `tests/qa/integration/a08-gate-controls.test.ts`: kept, with the corrections listed below.
- `tests/qa/integration/a09-decision-escalation.test.ts`: kept, with the corrections and additions listed below.
- `tests/qa/integration/a04-a05-a10-partials.test.ts`: kept unchanged. Its four cases match the four QA-A partial rows and pass.
- `e2e/a08-a09-gates-decisions.spec.ts`: kept unchanged. I re-read it against REQ-S04-012, REQ-PB-015, REQ-PB-081 and REQ-S10-012, and ran it fresh.

### Changed, and why

- **Stale evidence deleted.** I deleted the WIP screenshots (`screenshots/{en,ar}/*.png`) before any run, then regenerated them from my final e2e run. I rewrote `logs/mutate.py` (see "Added"). No WIP log or claim is cited here.
- **a08, REQ-S04-010, direct Draft → Approved.** The WIP accepted `[409, 422]` with no problem type.
  - The refusal now has to be a problem+json with the matching type: 409 `version-conflict` or 422 `invalid-transition`. The contract leaves "no submission exists" between the two. The observed result is 409 `gate.submission_superseded`, "There is no pending submission to decide."
  - Added a second vector: the gate's only write route, `PATCH …/gates/G1`, carrying `status: "approved"`, must give 400. The gate must stay Draft, both in the API view and in the database.
- **a08, REQ-S04-009 and REQ-S10-014, blank gate rationale.** The WIP accepted `[400, 422]`. It is now pinned to the uniform 400 `urn:mth:problem:validation` with pointer `/rationale`, as observed. A missing rationale must also name `rationale` in `errors`.
- **a08, REQ-S04-008, G6 fingerprint.**
  - **Directories excluded.** The fingerprint skips `docs/delivery/test-evidence/` and `docs/delivery/runs/`. Delivery tooling, such as a log tee or the agent runner, can write there while the suite runs, so including them would make the check flaky when the orchestrator re-runs it. Neither directory holds a DG decision.
  - **Non-vacuity check.** The test now asserts that the fingerprint contains `stages.json`, `findings.json`, `requirements.csv` and at least one `gates/DGn.json`.
  - **Response check.** The test asserts that the G6 decision response names no `DG0`–`DG7`.
  - **Fixture text.** The G6 rationale used to contain the text "DG7". I reworded it so the new check is meaningful.
- **a09, REQ-S15-008.** The WIP covered this row only through the timestamps of an escalation event. The row text is about a **KPI actual**, plus "changing the default currency affects only new records". QA-A's handback says that second half was left to A09. I relabelled the escalation-timestamp test as REQ-S12-011 / REQ-S15-008 (escalation event) and added the two tests listed under "Added".
- **a09, REQ-S16-018/019.** The WIP replaced the assigned check with a schema probe. I checked that the BE-D2 and BE-F2 entity-group tests exist, cover every listed entity, and pass (results below). The probe is kept only for the one row clause those tests do not check: "the ERD and migrations contain every entity with primary keys, owner and status where applicable". The describe block is renamed and commented to say so.

### Added

- **a09, `REQ-S15-008: a KPI actual for period 2026-10 …`:**
  - A KPI actual is submitted through the API for period 2026-10. It keeps label, start and end 2026-10.
  - `enteredAt` is a UTC timestamp.
  - `businessDate` equals the Asia/Riyadh date of `enteredAt`. The oracle is an independent `Intl` one, not the product's code.
  - The row's example is checked at the boundary through the oracle and the database's `p4_business_date`: 20:30Z on 2026-11-02 gives 2026-11-02, and 21:30Z gives 2026-11-03. The API cannot be given a past entry instant.
- **a09, `REQ-S15-008: changing the organization's default currency affects only new records`:**
  - The organization's `defaultCurrency` is changed from SAR to USD through `PATCH /organizations/{id}`.
  - A new transformation gets USD.
  - The existing transformation keeps SAR, and its `version` is unchanged.
  - A `finally` block restores SAR.
- **Mutation runner and fresh mutation evidence:** the rewritten `logs/mutate.py` and `logs/mutations.log`. See "Mutation checks".

## Suites authored and what each asserts

| File | Tests | Asserts |
|---|---|---|
| `tests/qa/integration/a08-gate-controls.test.ts` | 31 | G1 missing evidence (422 `gate_criteria_incomplete` with one `/criteria/<key>` pointer per missing item, and no submission row); exactly one missing item listed; waiver field refusals; a valid exception lets the submission through and the snapshot records it; stale If-Match 409; one task per approver referencing the snapshot SHA, idempotent on redelivery; non-approver 403 `gate.not_approver` (BO, WL, TL, AUD) and outsider 404; the nine criterion-review fields persisted (API and DB); no-rationale 400; all seven statuses reached through the API, each transition with an audit event at the new version; Draft → Approved refused; superseded submission 409 `gate.submission_superseded`; submitter-approver 403; phase tasks never move the gate; the snapshot is unchanged by later edits; an expired waiver gives the item back as missing; a native G1–G4 path to G5; scale before G5 gives 422 `invalid-transition` `gate.g5_not_approved` naming G5; G5 refused listing 'Risk closure'; G5 approver BO, so an SP approval is 403 and a BO approval succeeds and records the scale scope; scaling outside the scope gives 422 `scale.outside_approved_scope` and inside it 201; G6 refused listing 'Ownership transfer'; a G6 approval leaves the DG records under `docs/delivery/` unchanged; approvals: rationale, request version, SoD 403 `approval.sod_requester`, stale 409 `approval.stale_version` (3 vs 4), request changes, defer. |
| `tests/qa/integration/a09-decision-escalation.test.ts` | 17 | Working days come from the calendar API and are checked against an independent oracle (Thursday; the day before a holiday; no holiday until one is configured); a real Business scope change approval's due date crosses a configured holiday; SLA expiry escalates once to SP with the delay-impact text and is linked to the ask, with no duplicates under re-runs and concurrent scans; no escalation on a non-working day; the approval timer escalates exactly once and the approval stays undecided; a blocker red for N = 2 gives exactly one open T16 ask, idempotent across the consumer and the scan; T16 9 columns; Decisions area Red and listed, then cleared once decided; agenda item without Impact of delay refused 422 `agenda_item.executive_ask_incomplete`; ask without why-now 400; quorum 422 `meeting.quorum_not_met` then decided; immutable minutes 422 `meeting_minutes.published`; actions in the owner's My Work only; REQ-S15-008 KPI actual and currency; the ERD/migration clause of REQ-S16-018/019. |
| `tests/qa/integration/a04-a05-a10-partials.test.ts` | 4 | The QA-A partial rows REQ-S07-007, REQ-S13-003, REQ-S08-015 and REQ-PB-075 (see the table). |
| `e2e/a08-a09-gates-decisions.spec.ts` | 2 × 2 projects | The G1 gate page lists every missing mandatory item (`data-completeness="incomplete"`, label in the page language), submission is blocked, and the API 422 lists the same keys; the T16 log shows the nine columns in the page language and the ask's why-now and impact; `<html lang dir>` checked; axe 0 serious or critical. |

**Disclosed test seams.** None of these is a product edit.

- **Exception clock (a08 waiver-expiry case):** `setGateExceptionClock`, the product's own seam, because the server clock cannot be injected through the API.
- **Worker job functions called directly with the relay's outbox envelope, never by sleeping:** `handleGateSubmitted`, `handleGateDecided`, `handleDecisionSlaScan`, `scanOverdueApprovals`, `handleBlockerEscalation` and `handleBlockerEscalationScan`.
- **Due dates moved into the past with an audit event:** the backend fixtures `moveAskDates` and `makeOverdue`, because the API refuses past dates.

## Requirement → test table

`a08` = `tests/qa/integration/a08-gate-controls.test.ts`, `a09` = `…/a09-decision-escalation.test.ts`, `p` = `…/a04-a05-a10-partials.test.ts`, `e2e` = `e2e/a08-a09-gates-decisions.spec.ts`.

| Requirement | Test(s) | Status |
|---|---|---|
| REQ-PB-015, REQ-S20-008 | a08 "REQ-PB-015, REQ-S20-008: a submission with missing mandatory evidence is 422 …"; "… approval by a non-approver is 403 …"; "REQ-PB-015: a submission with a stale gate version (If-Match) is refused with 409"; "REQ-PB-015, REQ-S10-014: approving a stale (superseded) submission number is 409 …"; e2e A08 | Covered |
| REQ-PB-020 | a08 "REQ-PB-020, REQ-S04-007: G5 with an open High-impact risk … listing 'Risk closure'"; "REQ-PB-020, REQ-PB-015: with G5 configured to BO an SP approval is 403 …; a BO approval succeeds and records the scale scope" | Covered |
| REQ-S04-007 | a08 the same G5 tests, plus "REQ-S04-007: an approved disposition resolves the risk …" and "REQ-S04-007, REQ-S03-004: after approval scaling inside the scope succeeds; scaling outside it is blocked" | Covered |
| REQ-PB-021 | a08 "REQ-PB-021, REQ-S04-008: G6 without an accepted BAU handover is refused, listing 'Ownership transfer'" | Covered |
| REQ-S04-008 | a08 the G6 refusal test, plus "REQ-S04-008: a product G6 approval (API and its worker consumer) changes nothing under docs/delivery/" (excludes the live `test-evidence/` and `runs/` directories; see Salvage) | Covered |
| REQ-S03-004 | a08 "REQ-S03-004: a scale transition before G5 approval is 422 invalid-transition naming G5", plus the scale-after-approval test. The row's "Design-phase draft before G2" clause was not in this assignment. | Covered (assigned clauses) |
| REQ-S04-002 | a08 "completing every Diagnose phase task leaves G1 Draft with no submission"; "editing a record after submission does not change the snapshot shown to approvers" | Covered |
| REQ-S04-009 | a08 "REQ-S04-009: a criterion review persists all nine fields …"; "REQ-S04-009, REQ-S10-014: a gate decision without rationale is refused …" | Covered |
| REQ-S10-014 | a08 "REQ-S10-014: a decision without rationale is refused …; the stored record includes the request version" | Covered |
| REQ-S04-010 | a08 "the seven statuses exist …; a direct Draft -> Approved is refused"; "submit moves Draft -> Submitted with an audit event"; "Under Review -> Changes Requested -> … -> Approved, each with an audit event" | Covered |
| REQ-S04-012 | a08 "the gate page lists the missing mandatory items; canSubmit is false"; "with exactly one missing mandatory item the 422 lists exactly that item"; "with a valid (accepted, unexpired) exception the submission succeeds and its snapshot records the exception"; e2e A08 (the rendered page in en and ar) | Covered |
| REQ-S04-013 | a08 "a waiver without an expiry or without a compensating action is refused"; "after expiry the covered evidence item is reported missing again and blocks submission" | Covered |
| REQ-S10-016 | a08 "the requester approving their own scope change is 403 under the default policy" | Covered |
| REQ-S10-017 | a08 "approving version 3 after the record moved to version 4 is 409" | Covered |
| REQ-S10-018 | a08 "'request changes' returns the item to the requester without closing it"; "'defer' requires a new date" | Covered |
| REQ-S12-009 | a08 "REQ-S12-009: each required approver receives exactly one task referencing the snapshot; a redelivery adds none" | Covered |
| REQ-PB-066 | a09 "5 working days from a Thursday skip the configured weekend days"; "a Business scope change approval gets a due date 5 working days after it is raised …". A real approval cannot be *raised* on a Thursday without injecting the server clock, so the Thursday case runs through the calendar API on the same calendar engine, and the real approval checks the weekend and holiday skip on today's date. | Covered (disclosed) |
| REQ-S10-006 | a09 "the default calendar is Asia/Riyadh …, and no holiday exists until configured"; "5 working days from the day before a configured holiday skip the holiday and the weekend days" | Covered |
| REQ-S12-011, REQ-S20-009 | a09 "an ask whose SLA expired on a working day is escalated once to SP, linked to the ask, with the delay-impact text; re-running creates nothing"; "nothing is escalated on a non-working day; the first working-day scan escalates once"; "(escalation event) … SLA date, business date, UTC" | Covered |
| REQ-S10-019 | a09 "after the due date plus retries the approval is escalated exactly once and remains undecided" | Covered |
| REQ-PB-082 | a09 "N = 2: two consecutive red cycles produce exactly one open T16 ask …; re-running creates none" | Covered |
| REQ-PB-064 | a09 "an open T16 decision due yesterday (Asia/Riyadh) makes the Decisions area Red and is listed; once its Outcome is recorded … no longer counts" (the dashboard and the overview) | Covered |
| REQ-PB-068 | a09 "publishing an executive-ask agenda item missing 'Impact of delay' is rejected by the API …" | Covered |
| REQ-S10-012 | a09 "an ask without 'why now' is rejected by the API …"; e2e A09 | Covered |
| REQ-PB-081 | a09 "T16 persists all 9 columns …"; the Decisions-area test (outcome recorded: closed, leaves the overdue list); e2e A09 (the nine columns rendered in en and ar) | Covered |
| REQ-S10-011 | a09 "no decision below quorum; published minutes are immutable; actions appear in the owners' My Work" | Covered |
| REQ-S15-008 | a09 "a KPI actual for period 2026-10 keeps observation period 2026-10, the Asia/Riyadh business date …, UTC event timestamp"; "changing the organization's default currency affects only new records". The 23:30 example is checked at the boundary through the oracle and `p4_business_date`, because the API cannot be given a past entry instant. QA-A's a05 test covers the same point for A05. | Covered (disclosed) |
| REQ-S16-018 | Backend `apps/api/test/integration/raid/entity-group.test.ts` (BE-D2; 7 tests, Risk, Assumption, Issue, Action, Decision, Approval and ChangeRequest each created and read through the API, AUD 403, outside 404) exists and **passes** (`logs/entity-groups.log`); a09 "every listed entity is in the ERD and has a table with a primary key, and owner and status columns where applicable" | Covered |
| REQ-S16-019 | Backend `apps/api/test/integration/governance/entity-group.test.ts` (BE-F2; Forum, Meeting, AgendaItem, Attendance, Minutes and MeetingActionLink created and read, AUD 403, outside 404) exists and **passes**; the same a09 ERD/migration test | Covered |
| REQ-S07-007 (QA-A partial) | p "with every Diagnose phase task and every action complete, an actual below the red threshold is Red" | Covered |
| REQ-S13-003 (QA-A partial) | p "the Value area's validated headline drills to exactly the validated benefit records, whose decimal sum equals the headline" (BigInt decimal sum; the pending benefit excluded) | Covered |
| REQ-S08-015 (QA-A partial) | p "a Finance decision without the measurement-period item is 422 finance_validation.content_incomplete; with the item not accepted it is 422 finance_validation.items_not_accepted" | Covered (pinned) |
| REQ-PB-075 (QA-A partial) | p "the T14 register row carries ID, Benefit, Type, Baseline, Target, Value (SAR), Realized, Owner, Evidence and Status" (API and DB) | Covered |

No assigned row is NOT COVERED.

## Checks run (real exit codes)

Every command ran in `/home/user/wt/dg4-qa-b` with `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0a | `node tools/gates/validate.mjs --historical --stage DG3` (start, 09:41Z) | 0 | `PASS gate DG3 (historical)` | (console; repeated at the end) |
| 0b | WIP baseline: `QA_PG_PORT=25750 MTH_PORT_POOL=25751-25769 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration <a08> <a09> <partials>` on the unmodified WIP | 0 | 3 files, 50/50 | `logs/wip-baseline-integration.log` |
| 0c | Probe run of a08 and a09 with temporary `console.log` lines, to observe the blank-rationale and Draft → Approved responses (the probe lines were then removed) | 0 | 48/48 | `logs/probe-run-a08-a09.log` |
| **1** | `QA_PG_PORT=25750 MTH_PORT_POOL=25751-25769 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` (final tree) | **0** | **9 files, 117/117** | `logs/final-integration.log` |
| **2** | `E2E_PG_PORT=25770 E2E_API_PORT=25771 MTH_PORT_POOL=25772-25799 QA_EVIDENCE_DIR=docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/screenshots PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test e2e/a08-a09-gates-decisions.spec.ts --workers=1 --reporter=list --output=$TMPDIR/pw-out` | **0** | **4 passed** (2 in chromium-en, 2 in chromium-ar); axe 0 serious or critical on both screens in both languages (asserted in the spec) | `logs/e2e-final.log`; first run `logs/e2e-run1.log` (exit 0, 4 passed); `screenshots/{en,ar}/*.png` from the final run |
| **3a** | `pnpm lint` | **0** | `eslint . --max-warnings=0`, clean | `logs/lint.log` |
| **3b** | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" | `logs/prettier.log` |
| 4 | REQ-S16-018/019 backend tests: `… with-pg.sh pnpm vitest run --configLoader runner --project integration apps/api/test/integration/raid/entity-group.test.ts apps/api/test/integration/governance/entity-group.test.ts` | 0 | 2 files, 8/8 | `logs/entity-groups.log` |
| 5 | Mutation checks (next section) | see below | 7 killed, 2 survived (both explained) | `logs/mutations.log`, `logs/mutate.py` |
| **6** | `node tools/gates/validate.mjs --historical --stage DG3` (end, 09:58Z) | **0** | `PASS gate DG3 (historical)` | (console) |

Per-file counts for check 1:

| File | Tests |
|---|---|
| a08-gate-controls | 31 |
| a09-decision-escalation | 17 |
| a04-a05-a10-partials | 4 |
| a10-benefit-integrity | 16 |
| a05-calculation-correctness | 17 |
| a04-kpi-propagation | 8 |
| a12-cross-scope | 14 |
| a13-job-idempotency | 5 |
| a14-concurrency | 5 |
| **Total** | **117**, all passed |

**Sandbox note (QA-A precedent):** Vitest runs with `--configLoader runner`, because `node_modules` is read-only in the confined sandbox and the default config loader fails before any test runs. The orchestrator can re-run the same command without the flag where `node_modules` is writable.

**Every test passed; nothing was flaky, failed or timed out.** All non-zero exits came from mutation runs, where a non-zero exit is the expected result, and from the first A08 mutation baseline, explained below.

## Mutation checks

Every mutation ran in a disposable copy at `$TMPDIR/mut`, made with `tar` and excluding `.git`, `trading_agent` and `test-results`. I deleted the copy afterwards.

- `logs/mutate.py` applies one textual edit, runs the targeted test or tests, and restores the file byte for byte.
- After each batch, `diff -r` confirmed that the copy's `apps` and `packages` sources were identical to the worktree again.
- No product file in the worktree was edited.

| ID | Scenario | Mutation (product source, in the copy) | Target test | Result |
|---|---|---|---|---|
| M0b | baseline | none (describe-level filters) | the A08 describes plus REQ-S10-017 | 16/16 passed |
| M1 | A08 | `gates.ts`: `if (incomplete.length > 0)` → `if (false as boolean)` (missing-evidence refusal removed) | "REQ-PB-015, REQ-S20-008: a submission with missing mandatory evidence is 422 …" and "… exactly one missing item …" | **KILLED**. A database trigger still returned 422, but with pointer `''` instead of `/criteria/<key>` (`expected [ '' ] to include '/criteria/g1.diagnostic'`). |
| M2 | A08 | `gates.ts`: approver check `if (!(await isApprover(…)))` → `if (false && …)` | "… approval by a non-approver is 403 …" | **KILLED** |
| M3 | A08 | `approvals.ts`: `if (current === null \|\| current !== a.subject_version)` → `if (current === null)` | "REQ-S10-017: approving version 3 after the record moved to version 4 is 409" | **KILLED** |
| M4 | A09 | `escalations.ts`: `if (cal === null \|\| !isWorkingDay(today, cal.calendar))` → `if (cal === null)` | "nothing is escalated on a non-working day …" | **KILLED** |
| M5 | A09 | `escalations.ts`: `const n = stored?.red_cycles ?? defaults.redCycles` → `const n = 1` | "N = 2: two consecutive red cycles produce exactly one open T16 ask …" | **KILLED** |
| M6 | A09 | `packages/shared/src/time/working-days.ts`: the holiday lookup always misses | "5 working days from the day before a configured holiday …" | **KILLED** |
| M7 | A09 | `escalations.ts`: the "already escalated" NOT EXISTS filter disabled | "… escalated once to SP …; re-running creates nothing" | **SURVIVED**. This is an equivalent mutant: the behaviour was not broken, because two more guards still enforce "once". |
| M7b | A09 | M7, plus the `decision_escalation_once UNIQUE` constraint removed from migration 0045 | the same | **SURVIVED**. The third guard, the `runOnce` key `decision.escalate:<id>:<slaDate>`, still deduplicates. |
| M7c | A09 | M7b, plus a per-job `runOnce` key (all three guards removed) | the same | **KILLED**: `expected [ … ] to have a length of 1 but got 4` |

The first mutation batch also had a baseline, M0, using per-test `-t` filters. It failed 2 tests: those `it`s depend on earlier `it`s in their describe, for example the `missing` list or the submitted state, so the filter cut off their prerequisites. The first M1 and M2 "kills" from that batch are therefore **not valid**, and I do not count them. I re-ran M1 and M2 with whole-describe filters against the passing baseline M0b. That is what the table reports, and all runs are in `logs/mutations.log`.

## Product defects found

None. Every assigned acceptance clause behaves as the row text and the contract say.

Observations (not defects, no finding proposed):

- **Draft → Approved status code.** For a decision on a Draft gate with no submission, the product answers 409 `version-conflict` with code `gate.submission_superseded` and the detail "There is no pending submission to decide." Another row (ADR-0007) says an illegal transition is "422 invalid-transition". The `decideGate` contract only defines 409 for a non-current submission, so both readings fit. The test accepts either type, but pins that it must be a refusal with the matching problem type. A domain reviewer may want to settle which code is intended.
- **T16 Owner column.** In the T16 log, the Owner column shows the owner as a role reference ("Team member (Executive Sponsor), ref e14d…") rather than a display name, for a Lead viewing it. This looks like directory-visibility policy. It is not in this task's scope.

## BLOCKED

Nothing.

## Merge notes

- **Files to integrate (uncommitted):**
  - `tests/qa/integration/a08-gate-controls.test.ts` (modified)
  - `tests/qa/integration/a09-decision-escalation.test.ts` (modified)
  - the WIP files already in `ea92e25` (`tests/qa/support/gates-native.ts`, `tests/qa/integration/a04-a05-a10-partials.test.ts`, `e2e/a08-a09-gates-decisions.spec.ts`)
  - the evidence under `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/`
- No migrations. No product or support-file edits. QA-A's files are unchanged.
- **Running the A09 suite:** it changes the organization's default currency and restores it, but only for the suite's own `seedWorld` organization. It does not interfere with other files.
- **Running the e2e spec:** it needs the built tree (`apps/api/dist`, `apps/web/dist`) and `with-stack.sh`, like QA-A's spec.
