# Handback T-DG4-QA-C (qa-verifier, authoring): acceptance suites A11 and A03, REQ-DLV-036 evidence run

- **Stage / task:** DG4 (P4), T-DG4-QA-C, p4-plan §5.1 QA-C slice L. This is an **authoring** task, not the independent DG4 QA gate review.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-QA-C-qa-verifier-20261010T124206Z-7c10a589","session_id":"7c10a589-a0ee-4430-b79e-04aeec5f514c"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-QA-C.md`. Its SHA-256 `bbb30809…3252d7` was verified before starting.
- **Tree:** worktree `/home/user/wt/dg4-qa-c`, branch `dg4/qa-c`, HEAD `48eba105a78c21096a34163ffaf619f3cf6e0132` (start and end). No product source was modified. The test files are left **uncommitted**.
- **Time:** started 2026-10-10T12:42:22Z and finished 13:22:01Z (about 40 minutes, inside the 2-hour limit).
- **Environment:**
  - Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL 16.13 came from `tests/qa/support/with-pg.sh` and `apps/web/e2e/support/with-stack.sh`.
  - Chromium came from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was not run.
  - Ports were all inside 25800–25849.
  - Disk was checked before each full run: 7.9 GB free on the worktree's tmpfs.
- **Sandbox note (QA-A precedent):** every Vitest command uses `--configLoader runner`, because `node_modules` is read-only in this sandbox. The orchestrator can re-run the same commands without the flag.
- **Synthetic data:** all data is synthetic. Every gate decision, exception, waiver, handover acceptance, transition approval, Finance validation and deliverable acceptance in these suites is a synthetic in-product business action on test data. None of it approves anything real, and none of it touches DG0–DG7.

## 1. Files authored (all new, uncommitted)

| File | Purpose |
|---|---|
| `tests/qa/support/a11.ts` | Setup-only re-exports: the backend's world fixtures (benefit, sustainment, closure and modular worlds; launched initiatives), the worker's exported job functions, `envelopesOf` (the relay envelope of real outbox rows; it fails if none exist) and `businessToday`. |
| `tests/qa/integration/a11-adoption.test.ts` | A11 part 1, poor adoption triggers intervention (12 tests). |
| `tests/qa/integration/a11-value-closure.test.ts` | A11 part 2, delivery completion does not close value realization (11 tests). |
| `tests/qa/integration/a11-bau-sustain.test.ts` | A11 part 3, an accepted handover creates recurring BAU tasks, and BAU outlives closure. One transformation goes natively from creation through G1–G6 to closure and reopen (17 tests). |
| `tests/qa/integration/a03-modular-entry.test.ts` | A03, Modular entry (12 tests). |
| `e2e/a03-modular-entry.spec.ts` | A03 on screen in chromium-en and chromium-ar: the missing links, G2 inherited, the G3 refusal; `lang`/`dir` and axe. |
| `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-C-authoring/**` | This handback, the logs in `logs/` and `logs/mutations/`, and the screenshots in `screenshots/{en,ar}/`. |

The existing support files (`api.ts`, `p4.ts`, `gates-native.ts`, `with-pg.sh`) were reused unchanged.

## 2. What each suite asserts

Assertions come from the row acceptance texts in `requirements.csv` and from `docs/api/openapi.yaml`, not from the backend's own tests:
- Status codes, problem `type`/`code`, decimal strings (via `canon`, never floats), and the database state or API read-backs.
- Worker behaviour runs through the **exported production job functions** (`handleIndicatorEvaluated`, `handleKpiDeviation`, `handleBenefitVariance`, `handleControlCheckFailed`, `runReviewScan`, `runControlCheckScan`, `runMonitoringScan`). Each one is given the relay envelope of a **real** outbox row, produced by a real API call and the real recalculation. No synthetic events are used.

**a11-adoption**
- **Indicator templates:** the seven indicator names equal the playbook's B0109–B0115 names verbatim and in order, each with Arabic text; an unauthenticated call gets 401.
- **Below-trajectory intervention:**
  - Setup: an initiative-scoped adoption KPI with an approved trajectory of 0.8 and an actual of 0.4, accepted and recalculated.
  - The evaluation is red/adverse, and the worker creates exactly one intervention with an owner and a due date (or an Unknown reason).
  - A redelivery and a second evaluation of the same period add none; a green actual creates none.
  - The initiative with delivery Complete shows adoption `at_risk` and closure `open`.
  - The owner sees the intervention in My Work.
- **Training and proficiency:** training records go through the API (2 of 2 completed).
  - Observed proficiency is `unknown` with value `null` (never 0) and not green.
  - An observation submitted through a published proficiency form links to the group and counts 1/1.
  - Training completion is unchanged by it.
- **Stakeholder groups:** a group keeps influence and impact apart (L/H, then H/H after a PATCH).
- **My Work:** an intervention with owner and due date `2041-03-19` appears in the owner's My Work only.
- **Champion constraints:** a champion's constraint on a T04 decision is listed by `?decisionId=` with the decision code, and not on another decision. A non-champion raising one gets 403.
- **REQ-S16-020 entities:** StakeholderGroup, AdoptionIntervention, TrainingRecord, AssessmentRecord (feedback form with an invitation) and AdoptionMetricLink are each created and read through the API. An outsider gets 404 and an auditor's writes get 403.

**a11-value-closure**
- **Delivery Complete (REQ-S03-003):** adoption, adoptionSource, value, closure and closureRecordId are all unchanged.
  - The label is exactly `Delivered — value validation pending`, with no `success` anywhere.
  - Closing gets 422 `urn:mth:problem:invalid-transition` and no closure record is written.
  - A drafted transition decision still gets 422; after the Sponsor approves it, the close is 201 and the value becomes `validated_with_transition`.
- **All initiatives complete, value pending (REQ-S11-006):** the transformation label is `Delivery complete - value validation pending`, the states are separate, and closing gets 422.
- **Enabling deliverable (REQ-S08-002):** the deliverable is accepted through the deliverable API by the executive owner.
  - The benefit moves from `not_enabled` to `enabled_not_yet_measured`.
  - The measured, submitted, validated and sustained states are 0, and the value series is byte-identical.
- **Lifecycle (REQ-PB-074):**
  - Plan→Measure gets 422, and Plan→Enable without outputs gets 422 `benefit.plan_outputs_missing`.
  - Measure→Sustain without a BAU owner and cadence gets 422 `benefit.sustain_outputs_missing`, still 422 with the owner only, and 200 with both.
- **Transition decision (REQ-S11-007):** the forecast plan value is unchanged and still `forecast`, and nothing is validated or sustained. The monitoring task is the residual owner's only.
- **Corrective actions (REQ-PB-085):**
  - Benefit half: two below-plan, Finance-validated values and a redelivery leave exactly one open case for the benefit (signal count rising).
  - KPI half: under a two-cycle red rule, real red actuals in three periods give no case, then one case (`consecutiveOffTrack` 2), then the same case updated (3, version up).

**a11-bau-sustain** (native)
- **G1–G5:** passed natively. G5 is approved with a scale scope. The transformation is in Realize.
- **Area setup:** a performance area, a linked KPI and an ownerless control, all through the API.
- **Handover completeness (REQ-S11-005):** missing data access is refused with 422, naming data access at `/dataAccess`; the handover stays draft at the same version.
- **G6 before acceptance (REQ-PB-021):** refused with 422 `gate_criteria_incomplete`, naming "Ownership transfer".
- **Who may accept (REQ-S11-005):** BO2, SP, TL, WL, TO and AUD all get 403. The second BO gets the contract's `bau_handover.not_receiving_owner`.
- **Acceptance (REQ-PB-083):** the receiving owner accepts; exactly one review and one My Work task go to the BAU owner. A repeated accept gets 422, the scans add nothing, and the next scan advances the schedule.
- **Backlog and G6 approval:**
  - The CI item completes the G6 backlog criterion; ownership transfer, controls and benefits evidence (an approved transition decision) are all native.
  - The G6 snapshot lists the CI item and the handover. G6 is approved, and the response names no DG record.
- **Closure:** the transformation is closed by the governed closure.
- **After closure:**
  - CI item: still listed.
  - Next review: not created 8 days early; created on the day its 7-day window opens, for the BAU owner, with its My Work task.
  - KPI actual: still `accepted`.
  - Failed control check (control transferred to the BAU owner): exactly one owned recovery action with a follow-up date and a My Work task, even after a redelivery.
  - Lesson: searchable by a user granted only on another transformation.
- **Reopen (REQ-S11-009):** the handover's acceptance (status, `acceptedAt`, `acceptedBy`, version) and the closure records are unchanged, and cycle 2 links the prior acceptance and closure date.

**a03-modular-entry**
- **Inherited G2 (REQ-S03-005):** Modular at Design. G2 is labelled `inherited` (status not approved) and no gate decision exists.
  - The prior approval is listed as an inherited record.
  - A fabricated `prior_approval` gets 422 `inherited_record.prior_approval_use_dispensation`.
  - Inherited evidence is labelled `inherited` with its provenance.
- **Missing links (REQ-PB-005):**
  - Both links are flagged blocking.
  - G3 gets 422 `gate.modular_links_missing` listing both, with nothing written.
  - With the baseline only it lists the outcome link alone; with both links, 201.
- **Waivers (D-110, W1–W7):**
  - A pending waiver does not count, and the recorder cannot authorize their own waiver (403).
  - An accepted waiver gets 201 while the links stay flagged.
  - Revoked after submission: approval gets 422 `gate.modular_waiver_revoked`, with nothing written.
  - Expired by approval time: 422 `gate.modular_waiver_expired`; in force, 201.
  - Expired at submission: 422 `gate.modular_links_missing`.
- **End-to-End G3:** with G1 and G2 approved natively, and no baseline or outcome link, the submission is 201.
- **Disclosed seam:** the expired cases use the API's injectable exception clock `setGateExceptionClock`, a test seam of the gate-exception module. No row is edited, and it is reset after each test.

**e2e/a03-modular-entry.spec.ts** (real stack, `--workers=1`)
- **Screen 1, Modular entry:** both links show as blocking, G2 is labelled Inherited, no gate is labelled Approved, and the API agrees.
- **Screen 2, G3 page:** every criterion is covered and the submit control is enabled. Submitting shows the alert `data-problem="gate.modular_links_missing"` with exactly two items, translated in the page's language. G3 stays `draft` with no submission.
- **Each screen:** `<html lang dir>` (en/ltr, ar/rtl) and axe with 0 serious or critical violations.
- **Screenshots:** `screenshots/{en,ar}/a03-0{1,2}-*.png`.

## 3. Requirement → test

| Requirement | Test(s) |
|---|---|
| REQ-PB-069 | a11-adoption › "REQ-PB-069: … creates exactly one owned intervention", "'exactly one': a redelivered event …", "the initiative with delivery Complete … shows adoption at risk", "the intervention's owner sees it in My Work" |
| REQ-PB-071 | a11-adoption › "GET /adoption-indicator-templates lists exactly the seven playbook indicators by name", "an on-trajectory actual creates no intervention" (with the PB-069 creation test for "an actual below trajectory creates a corrective intervention") |
| REQ-S20-011 | All three a11-* files: 40/40 pass on this tree (integration). **The A11 e2e half is NOT COVERED** (see §6). |
| REQ-PB-072 | a11-adoption › "100% training completion with no proficiency observation: proficiency Unknown (not 0), not adopted" |
| REQ-S11-002 | a11-adoption › "an observation submitted through the published form links to the group and counts …" |
| REQ-PB-073 | a11-adoption › "a champion's constraint links to a T04 decision and is visible on that decision" |
| REQ-S11-001 | a11-adoption › "a group records influence and impact separately", "an intervention with owner and due date appears in the owner's My Work" |
| REQ-PB-009 | a11-value-closure › "the label is exactly 'Delivered — value validation pending'", "closing while validated value is pending is 422 invalid-transition" |
| REQ-S03-003 | a11-value-closure › "delivery Complete leaves adoption, value and closure exactly as they were", the 422 closure test, "with an approved transition decision … the closure is accepted" |
| REQ-S11-006 | a11-value-closure › "the transformation shows delivery complete and value pending as separate states, never successful" |
| REQ-S08-002 | a11-value-closure › "realization state enabled_not_yet_measured; validated value stays zero" |
| REQ-PB-074 | a11-value-closure › "without the Plan outputs a benefit cannot move towards Measure", "Sustain without a BAU owner and control cadence is 422 …" |
| REQ-PB-083 | a11-bau-sustain › "the receiving owner's acceptance creates the BAU review task … exactly once", "'recurring': the scan … schedules the following review, once" |
| REQ-S11-005 | a11-bau-sustain › "a handover missing data access is refused", "acceptance by anyone other than the receiving owner is 403" |
| REQ-S03-002 | a11-bau-sustain › "after closure the next scheduled review task is created on time", "after closure the area's KPI still accepts an actual" |
| REQ-S11-004 | a11-bau-sustain › "after closure the next scheduled review task is created on time for the BAU owner" |
| REQ-PB-084 | a11-bau-sustain › "G6 lists the continuous-improvement backlog", "the G6 submission snapshot lists the backlog item", "after closure the CI backlog item is still listed" |
| REQ-S11-007 | a11-value-closure › "forecast unchanged and not sustained/validated; the residual owner gets the monitoring task" |
| REQ-S11-008 | a11-bau-sustain › "a failed control check creates exactly one owned recovery action …", "a lesson published here is searchable by a user of another transformation" |
| REQ-S12-016 | a11-bau-sustain › "a failed control check creates exactly one owned recovery action with a follow-up date" |
| REQ-S11-009 | a11-bau-sustain › "after reopening, the original handover acceptance and the closure date are unchanged" |
| REQ-PB-085 | a11-value-closure › "two below-plan validated values and a redelivery leave exactly one open case", "red in cycle 1 -> no case; red in cycle 2 -> one case; red in cycle 3 -> the same case updated" |
| REQ-PB-020 | a11-bau-sustain › "G1-G5 were passed natively" covers G5 reached and approved natively. **The G5 refusal texts ('Risk closure', SP 403 / BO approves) are NOT COVERED by QA-C**: they are QA-B's `a08-gate-controls.test.ts` (A08 G5/G6 describe), which passes in the same run. I did not duplicate them. |
| REQ-PB-021 | a11-bau-sustain › "G6 without an accepted BAU handover is refused, listing 'Ownership transfer'" (also QA-B A08) |
| REQ-S04-008 | a11-bau-sustain › the G6 refusal test and "… G6 is approved; no DG record is named". The `docs/delivery` fingerprint check is QA-B's A08 test. |
| REQ-S16-020 | The backend entity-group tests exist and pass: `apps/api/test/integration/adoption/entity-group.test.ts` (4) and `entity-group-metric-link.test.ts` (1), 2 files 5/5. Also a11-adoption › "every entity of the people and adoption group is created and read through the API with authorization". The ERD/migration half was not reviewed (not assigned). |
| REQ-PB-005 | a03-modular-entry › "both are flagged as blocking", "G3 submission is 422 gate.modular_links_missing …", "only the baseline …", "once both links are supplied …"; the waiver describe; e2e tests 1 and 2 |
| REQ-S03-005 | a03-modular-entry › "G2 is labelled 'inherited', never Approved", "… a prior approval cannot be fabricated"; e2e test 1 |
| REQ-S20-003 | a03-modular-entry (12/12) and e2e/a03-modular-entry.spec.ts (4/4, chromium-en and chromium-ar) |
| REQ-DLV-036 | The evidence run in §4, check 5 |

## 4. Checks run (real exit codes)

| # | Command (cwd `/home/user/wt/dg4-qa-c`) | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `logs/validate-dg3-start.log` (transcribed from the console) |
| 2 | Baseline before authoring: `QA_PG_PORT=25800 MTH_PORT_POOL=25801-25819 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | 0 | 9 files, 117/117 | `logs/baseline-integration.log` |
| 3 | **Acceptance 1:** `QA_PG_PORT=25800 MTH_PORT_POOL=25801-25809 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` (final tree) | **0** | **13 files, 169/169** | `logs/final-integration.log` |
| 4 | **Acceptance 2:** `E2E_PG_PORT=25830 E2E_API_PORT=25831 MTH_PORT_POOL=25832-25849 QA_EVIDENCE_DIR=… apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03-modular-entry.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (final spec) | **0** | **4/4**; axe 0 serious/critical on 4 screens | `logs/e2e-a03.log` |
| 5 | **REQ-DLV-036:** `QA_PG_PORT=25810 MTH_PORT_POOL=25811-25819 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration` on the six A04, A10, A09 and A11 files | **0** | **6 files, 81/81** | `logs/dlv-036-a04-a09-a10-a11.log` |
| 6 | REQ-S16-020: `… with-pg.sh pnpm vitest run --configLoader runner --project integration apps/api/test/integration/adoption/entity-group.test.ts apps/api/test/integration/adoption/entity-group-metric-link.test.ts` | 0 | 2 files, 5/5 | `logs/s16-020-entity-group.log` |
| 7 | **Acceptance 3:** `pnpm lint` | **0** | — | `logs/lint.log` |
| 8 | **Acceptance 3:** `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | All matched files use Prettier code style | `logs/prettier.log` |
| 9 | **Acceptance 6:** `node tools/gates/validate.mjs --historical --stage DG3` (end) | **0** | `PASS gate DG3 (historical)` | `logs/validate-dg3-end.log` |

Per-file counts of run 3:

| File | Tests |
|---|---|
| a08-gate-controls | 31 |
| a09-decision-escalation | 17 |
| a10-benefit-integrity | 16 |
| a05-calculation-correctness | 17 |
| **a11-bau-sustain** | **17** |
| **a11-adoption** | **12** |
| **a11-value-closure** | **11** |
| a04-kpi-propagation | 8 |
| **a03-modular-entry** | **12** |
| a04-a05-a10-partials | 4 |
| a12-cross-scope | 14 |
| a13-job-idempotency | 5 |
| a14-concurrency | 5 |

**REQ-DLV-036 per suite (run 5):**

| Suite | Owner | Tests |
|---|---|---|
| A04 `a04-kpi-propagation` | QA-A | 8/8 |
| A10 `a10-benefit-integrity` | QA-A | 16/16 |
| A09 `a09-decision-escalation` | QA-B | 17/17 |
| A11 `a11-adoption` | QA-C | 12/12 |
| A11 `a11-value-closure` | QA-C | 11/11 |
| A11 `a11-bau-sustain` | QA-C | 17/17 |

No failures. The A04/A05/A10 partials file (4/4) passed in run 3.

**Disclosed non-zero exits during authoring.** Each was caused by my own test setup, fixed in the test, never by a product change:
- `dev-a11-adoption.log` (first run, exit 1): I used the template field `templateKey` instead of the contract's `key`/`indicatorAr`; an initiative-scoped actual needs `entryScopeKind: "initiative"` on the KPI version; a feedback response needs an invitation.
- `dev-a11-value.log` (exit 1): the deliverable acceptance body is `{result}`, not `{decision}`.
- `dev-a11-value-s08.log` (two exit 1 runs): first the `{result}` body above, then 403 `deliverable.not_owner` until the initiative had an executive owner.
- `dev-a11-bau.log`, first run (exit 1): G5 approval needs `scaleScope`.
- `dev-a11-bau.log`, second run (exit 1): closure was 422 `closure.transformation_not_open`, because a natively created transformation stays `draft` until the Lead sets `status: active` through `PATCH /transformations/{id}`, which the contract offers; and the follow-up date was null (Unknown) because the organization had no default calendar. The fix was a native PATCH and `ensureDefaultCalendar` in setup. The Unknown follow-up without a calendar is the specified "Unknown, never guessed" behaviour, not a defect.
- e2e run 1 (`logs/e2e-a03-run1-before-prettier.log`): exit 0, 4/4. Prettier then reformatted the spec, so it was re-run (check 4).

No timeouts and no flaky tests were observed.

## 5. Mutation checks (acceptance 5)

**Method.**
- A disposable copy of the tree was made under `$TMPDIR` (tar of the worktree with `node_modules`, plus `docs/api`); it was deleted at the end.
- Each mutation was applied with `perl` to one product file **in the copy**. The relevant suite was run with `QA_PG_PORT=25840`, and the file was then restored.
- The unmutated control in the copy passed: 4 files, 52/52 (`logs/mutations/M0-control-unmutated-copy.log`).
- Each log contains the exact diff, the command and the output.

| ID | Scenario | Mutation (in the copy only) | Result | Failing tests |
|---|---|---|---|---|
| M1 | A11 PB-069 | `apps/worker/src/handlers/adoption.ts`: below-trajectory test → `if (true)` (never creates) | **killed**, exit 1, 5 failed | creation, exactly-one, on-trajectory, at-risk, My Work |
| M2 | A11 PB-009 | `status-model.ts`: label always "Delivered — value validated" | **killed**, exit 1, 1 failed | label test |
| M3 | A11 PB-009/S03-003 | `closure.ts`: initiative value-pending refusal removed | **killed**, exit 1, 2 failed | 422 closure, transition-decision closure |
| M4 | A11 S11-005 | `handovers.ts`: receiving-owner check removed (API only) | **survived**, exit 0, 17/17 (twice; the second run asserts the contract code) | — |
| M4b | A11 S11-005 | M4 **plus** the `bau_handover_accepted_complete` CHECK clause removed from migration 0048 in the copy | **killed**, exit 1, 4 failed | not-receiving-owner 403, plus three dependent steps |
| M5 | A11 PB-085 | `apps/worker/src/handlers/raid.ts`: persistence `count < rule.persistenceCycles` → `count < 1` | **killed**, exit 1, 1 failed | two-cycle rule test |
| M6 | A03 | `gates.ts`: `assertModularLinks` always returns null (precondition off) | **killed**, exit 1, 6 failed | refusals and waiver tests |
| M7 | A03 | `gates.ts`: revoked-waiver check at approval removed | **killed**, exit 1, 1 failed | revoked-waiver test |

M4 is not a test weakness. The receiving-owner rule is enforced twice: by the API and by the database CHECK `accepted_by = receiving_owner_user_id`. The DB error mapper returns the same 403 `bau_handover.not_receiving_owner`, so breaking one layer does not change the behaviour; breaking both (M4b) is caught. Logs are in `logs/mutations/`.

## 6. Product defects found

**None.** Every requirement assertion passed on the candidate tree. A11 and A03 found no behaviour that contradicts a row acceptance text or the contract.

Observations, not filed as defects:
- **O-1 (UX, Low):** on the A03 G3 screen, the submit dialog shows the warning "Only 1 of 5 mandatory outputs are complete. The submission will be refused…" even when every missing criterion is covered by an accepted exception and the server accepts the submission (`canSubmit: true`). See `screenshots/{en,ar}/a03-02-*.png`. The text overstates the refusal in that case. It is for the frontend reviewer to judge.
- **O-2 (information):** a transformation created through the API stays `draft` through G1–G6 approvals until someone sets `status: active`. Governed closure then refuses it with `closure.transformation_not_open`. This matches the contract, but whether gate approvals should activate a transformation is a domain question. It is not covered by any row text I was given.

## 7. BLOCKED / not covered / remaining

- **A11 e2e (REQ-S20-011's "e2e" half) is NOT COVERED by QA-C.** The assignment asked for a root e2e spec only for A03, so I authored none for A11. The frontend's own `apps/web/e2e/p4-adoption-bau.spec.ts` exists, but it is not mine and I did not run it.
- **REQ-PB-020's refusal texts** are left to QA-B's A08 suite (see the table). This suite only proves that G5 is reached and decided natively.
- **REQ-S16-020:** the ERD and migration inspection ("every entity … with primary keys, owner and status") was not performed. Only the "integration test exists and passes" half and an API create/read/authorization check were done.
- Nothing was BLOCKED. Every tool and service needed was available offline.

## 8. Merge instructions

- Add the five test files and `tests/qa/support/a11.ts` as-is. They are new files, so no conflicts are expected with QA-A/QA-B files (none were edited).
- No migrations and no product changes.
- `e2e/a03-modular-entry.spec.ts` imports `apps/web/e2e/support/{ui.ts,p3-journey-setup.ts}` read-only. It writes screenshots only to `QA_EVIDENCE_DIR` (default `test-results/qa-c`).
- Re-run without `--configLoader runner` where `node_modules` is writable:
  - `QA_PG_PORT=25800 MTH_PORT_POOL=25801-25849 tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa`
  - `E2E_PG_PORT=25830 E2E_API_PORT=25831 MTH_PORT_POOL=25832-25849 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a03-modular-entry.spec.ts --workers=1`
