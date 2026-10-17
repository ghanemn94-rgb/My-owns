# Handback T-DG5-QA-E2: executable acceptance suites A02, follow-up (qa-verifier, authoring)

- **Run:** `DG5-T-DG5-QA-E2-qa-verifier-20261017T140401Z-abaf3ac9` (session `abaf3ac9-c96b-49e4-8e3c-380d3dfc615e`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-QA-E2.md`; its SHA-256 `8c38f1ce…2cca97` matches.
- **Tree:** worktree `dg5/qa-e2` at `6f8ce12a34038946d0b01dd5685a4cc2a7fb12d7`, the integrated `HEAD` with D-166.
  - W21's BE-T4 (Rule A, `0096`) and FE-D4 are **not** in this tree.
- **Time:** start `2026-10-17T14:04:19Z`, end `2026-10-17T15:35:29Z` (`date -u`), about 91 minutes.
- **Kind:** authoring task, not the DG5 gate review. No review record was written.
- **Product source:** unchanged. My changes are:
  - one edited QA file (the A02 integration suite, as the assignment directs);
  - three new root `e2e/` files;
  - this folder.
  - Everything is left **uncommitted**.
- **Synthetic data:** everything is synthetic. Every G1–G6 decision, Finance validation, executive decision and handover acceptance in the suites is a synthetic in-product decision on demo data that approves nothing real. Nothing in product text names DG0–DG7.

## 1. Files written

| File | What |
|---|---|
| `tests/qa/integration/a02-a21-complete-lifecycle.test.ts` (edited, QA-E's own A02 file) | Two changes, described below the table. |
| `e2e/support/a02-demo.ts` (new) | Support for the demo-stack specs. See below the table. |
| `e2e/a02-demo-users-walkthrough.spec.ts` (new) | **REQ-S18-004, literally.** The twelve ADR-0050 §7 steps are done in the UI by the demo role users, on a new transformation in the demo business unit. Each step's records are verified through the API. Runs in chromium-en and chromium-ar. See §3. |
| `e2e/a02-demo-labels.spec.ts` (new) | **REQ-S18-001 and REQ-S21-001, rendered**, in en and ar. Three tests, described below the table. |
| `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-E2-authoring/**` | Logs, mutation evidence, screenshots (`screenshots/en`, `screenshots/ar`: one per walkthrough step, plus the label screens) and this handback. |

**Changes to `a02-a21-complete-lifecycle.test.ts`:**
- `:867` → the baseline step's assignee is **TL** (`procedures` v2, `0095`). The Lead links the evidence and completes the step. A new negative check: the BO completing it gets **403 `procedure_step.not_assignee`**, and the step does not advance.
- In "drives every instance…", for the intake under **Rule A**:
  - the `capture_intake` producer staffs the produced transformation T natively. The access administrator assigns a Sponsor on T (`POST /role-assignments`), and T's Lead maps that Sponsor (`POST …/role-mappings`).
  - The adopted steps are acted on by T's actors: T's Lead is its creator, and its Sponsor is the mapped one.
  - For the intake's approval, the test asserts `approval.transformationId = T` and that the instance's `transformationId` stays `null` (organization launch scope).
  - Then the mapped Sponsor decides.

**`e2e/support/a02-demo.ts` provides:**
- a catalogue lookup, so one spec drives the en and the ar UI: an English string → its rendering in the language, with an alternation when keys disagree;
- `field()` for labels with the "(required)" marker;
- `demoPage` / `demoApi`: a demo role user signed in through the **dev sign-in form** (D-165) or `POST /auth/dev-login`;
- `expectBanner`: the banner's exact catalogue text.

**The three tests of `e2e/a02-demo-labels.spec.ts`:**
- (1) the banner on 11 visited screens; the record badge in record headers; the approval label on all six G-gate pages of the seeded transformation and on the Finance queue;
- (2) the badge in **form** headers. It fails: product defect D-QA-E2-1;
- (3) a DOCX export produced by the **real worker process** (`apps/worker/dist/main.js`) and downloaded through the API. It carries the illustrative label of its language and not the other language's.

## 2. Checks (real exit codes)

Ports used: 23600–23649 only. Disk (`df -h .`) was 7.9 GB free throughout. There were no empty `.claude/.cc-writes` directories before the runs.

| # | Command | Exit | Result |
|---|---|---|---|
| 6a | `node tools/gates/validate.mjs --historical --stage DG4` (start, 14:04Z) | 0 | `PASS gate DG4 (historical)` (`validate-dg4-start.log`) |
| 1 | `QA_PG_PORT=23600 MTH_PORT_POOL=23601-23609 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` | **1** | 28 files: **311 passed, 1 failed** (`integration-tests-qa-full.log`). The 1 is the intake under Rule A (§5.1), which waits on BE-T4, as the assignment foresees. |
| 2a | Demo stack: `E2E_PG_PORT=23610 E2E_API_PORT=23611 MTH_PORT_POOL=23612-23619 e2e/support/with-demo-stack.sh npx playwright test e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts --workers=1` | **1** | **10 passed, 2 failed** (`e2e-demo-stack.log`). The 2 are the form-header badge test in en and ar: product defect D-QA-E2-1, kept failing on purpose. See the breakdown below the table. No timeouts. |
| 2b | Binding root stack (item 3): `E2E_SCREENSHOT_DIR=$TMPDIR/root-shots E2E_PG_PORT=23620 E2E_API_PORT=23621 MTH_PORT_POOL=23622-23629 apps/web/e2e/support/with-stack.sh bash -c "npx playwright test <10 specs> --project chromium-en --workers=1; npx playwright test <10 specs> --project chromium-ar --workers=1"`. The specs are a03, a04, a06, a07, a08-a09, a13, a15, a16, a20 and a22, by explicit paths, in file order, en then ar, in **one** stack. | **1** | en: **14 passed, 1 failed**. ar: **14 passed, 1 failed**. Total 28 passed, 2 failed (`e2e-root-stack.log`). The 2 failures are **A13** in both projects: "timed out after 60000 ms waiting for the failed execution". This is the D-165/D-166 shared-stack timing, owned by **QA-F2**, and left to it. A06 and A07 pass in both projects. |
| 2b′ | The same command without `E2E_SCREENSHOT_DIR` (the first attempt) | 1 | en 12 passed, 2 failed, 1 did not run; ar the same (`e2e-root-stack-run1-screenshot-dir-readonly.log`). See the disclosure below the table. |
| 3a | `pnpm lint` | 0 | `lint.log` |
| 3b | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| 5 | Mutation runs M1–M6 (§4) | 1 each | Every mutation is detected. |
| 6b | `node tools/gates/validate.mjs --historical --stage DG4` (end, 15:31Z) | 0 | `PASS gate DG4 (historical)` (`validate-dg4-end.log`) |

**Run 2a, the 10 passes:**
- REQ-S18-004's twelve steps: en 54 s, ar 59 s;
- labels test (1): en and ar;
- the export label: en and ar;
- QA-E's `a02-guided-walkthrough` and `a21-no-ai-operation`, both projects.

**Run 2a, axe:** 0 serious or critical issues, through the shared `expectAccessible`, on:
- the walkthrough page after the twelve steps;
- the record screen;
- the Finance queue screen.

**Run 2b′, the first root-stack attempt:**
- A06 and A07 failed in both projects with `ENOENT: mkdir 'apps/web/e2e/screenshots/en'`. Their shared `shot()` helper writes into `apps/web/**`, which is read-only in this agent sandbox.
- A06 en stopped mid-test, so A06 ar then failed `toHaveURL` on the state it left.
- So the run was repeated, with the helper's supported `E2E_SCREENSHOT_DIR` pointed at a writable scratch path (2b). This is an environment matter, not a product or spec defect.

**Per-file counts of run 1** (`tests/qa`):

| File | Passed | Failed |
|---|---|---|
| a02-a21-complete-lifecycle | 12 | **1** |
| a06 | 27 | 0 |
| a08 | 31 | 0 |
| a09 | 17 | 0 |
| a05 | 17 | 0 |
| a11-bau-sustain | 17 | 0 |
| a10 | 16 | 0 |
| a15-snapshots-and-packs | 15 | 0 |
| a12 | 14 | 0 |
| a16-health-check | 13 | 0 |
| a07 | 12 | 0 |
| a03 | 12 | 0 |
| a11-adoption | 12 | 0 |
| a13-durable-automation | 12 | 0 |
| a11-value-closure | 11 | 0 |
| a16-launch-plan | 11 | 0 |
| a04-kpi-propagation | 8 | 0 |
| a22-operational-readiness | 8 | 0 |
| a15-outputs-every-definition | 5 | 0 |
| a13-job-idempotency | 5 | 0 |
| a14 | 5 | 0 |
| a15-demo-transformation-outputs | 7 | 0 |
| a15-selected-records | 7 | 0 |
| a16-s16-021 | 6 | 0 |
| a13-starter-jobs | 4 | 0 |
| a04-a05-a10-partials | 4 | 0 |
| a01 | 2 | 0 |
| a02-a08 | 1 | 0 |

**Disclosure of intermediate runs.** The files `dev-iter1..7.log` and `dev-labels1..8.log` are the authoring iterations of the two new specs, with failures from locator and contract-field corrections:
- `dev-iter1` timed out at 300 s on a wrong locator;
- `dev-iter6` failed in ar on an ambiguous catalogue lookup;
- `dev-labels*` record dataset findings: the gate list shape; no pending approval for any demo user (O-1).

They are kept for honesty, and none of them is cited as a pass. `integration-a02-file-run1.log` is the single-file run after my edits: 12 passed, 1 failed, the same intake failure.

## 3. REQ-S18-004 in the browser: what the spec does

**Set-up.** Everything below is on `e2e/support/with-demo-stack.sh`, with every user signed in through the dev sign-in form as `roaming.user.<role>`. Each role has its own browser context. The demo access administrator `roaming.user.adm_access` assigns SP, BO, FIN, KDS and WL on the new transformation (`POST /role-assignments`). The TL maps SP and BO. These are access set-up actions, not walkthrough steps.

**After each step:** `GET /demo/walkthrough` reads the step's flag from the persisted records. It is false before the step and true after it. The step's records are then read back through the API. Every screen visited during a step checks `html[lang]`, `html[dir]` and the banner's exact text.

| # | Step (M0349) | Performed in the UI by | Records verified through the API |
|---|---|---|---|
| 1 | create transformation | **TL**: New transformation form, demo BU | `businessUnitId` = demo BU, name, `end_to_end`. The record badge is in the record header. |
| 2 | diagnose and agree baseline | **TL**: Diagnose > Add baseline. **FIN**: Validate > "Validated by Finance" > Record decision. | `value` 1250000.00 (decimal string), SAR, `revenue`, `validationStatus` `validated`, `baselineDate` 2026-01-31 |
| 3 | define outcomes/KPIs | **TL**: Add outcome; Add KPI, owned by KDS; Add T02 row with target date 2027-12-31 | an active outcome-KPI link with that `targetDate` |
| 4 | design TOM | **TL**: canvas box Technology > Edit > Target design; Add gap | `targetDesign` text of the technology cell |
| 5 | prioritize and approve mobilization | **TL**: scorecard, strategic fit = 4, Save scores; Gates G4 > Submit. **SP**: Gates G4 > Record decision > Approve. | `initiative …/scores` holds strategic_fit = 4; G4 `status` `approved`. The SP's gate page shows "Synthetic demonstration - approves nothing real" (ar: its Arabic). |
| 6 | update delivery/adoption | **TL**: Owner updates > write > submit. **BO**: Training > update > completed. | a `submitted` update with the exact achievements text |
| 7 | submit KPI actual | **KDS**: KPI > Update KPI, the four-step form | the actual's status (`submitted` or `accepted`), its period, the value 120.5 |
| 8 | validate benefit | **FIN**: Finance queue item > Decide, six items accepted > approved 240000.00. The queue item is created by the real worker. | `status` `approved`; `approvedAmount` 240000.00 (decimal string); `decidedBy` = FIN. The approval label is on the item. |
| 9 | resolve executive decision | **TL**: Raise an executive ask. **BO**, the decision owner: Record outcome (business decision) > decided, option A. | `status` `decided`, `chosenOptionLabel` A, `ownerUserId` = `decidedBy` = BO |
| 10 | generate report | **TL**: Reports > Output: charter > Generate snapshot | a `generated` charter snapshot created by the TL; its `content` records `"synthetic":true` (ADR-0050 §2 d) |
| 11 | accept BAU handover | **BO**: new performance area and control. **TL**: prepare handover (all fields), add evidence, submit. **BO**, the receiving owner: Accept. | `status` `accepted`; `receivingOwnerUserId` = BO; `acceptedAt` |
| 12 | continue performance monitoring | **KDS**: Update KPI on a second KPI after the acceptance | the actual's `submittedAt` is later than the handover's `acceptedAt` |

**End of the spec:**
- `completedCount`/`total` = 12/12;
- axe has 0 serious or critical issues on the walkthrough;
- no request leaves the origin.

**Prerequisites done through the API by the same demo users** (native endpoints; they are not walkthrough completion records):
- step 5: the initiative, its outcome contribution and its submission; G1–G3 passed (missing criteria covered by exceptions the SP accepted; TL submits; SP approves); G4's exceptions;
- step 6: the stakeholder group and the training record;
- steps 7 and 12: the KPI definition's activation and its measurement version;
- step 8: the T09 formula and its Finance check, the T14 benefit moved to Measure with its enabler, the baseline validation, and the BO's submitted measurement;
- step 11: the SOP evidence note.

**FE-D4 is not exercised.** The walkthrough's completion rules read native records, not procedure instances. So the FE-D4 gap (`InstancePage` never sends `outputRecordId`) does not block these twelve steps, and this spec does not test it.

## 4. Mutation checks

All runs used a disposable `git clone` of `HEAD` in `$TMPDIR`:
- the tree's built `dist/` was copied in, and `node_modules` was symlinked;
- for M6, the copy's `apps/worker/node_modules/@mth` points to the copy's packages;
- each mutation changed one line in the copy only and was restored from a pristine copy afterwards;
- the copy was deleted at the end.

The runner is `mutations/mutate.sh`, with the diffs (`M*.log.diff`), logs (`M*.log`) and `summary.txt`. M4 and M5 change a 1.3 MB one-line bundle, so their `.diff` files state the exact substitution instead of a full diff.

| ID | Row | Mutation (copy only) | Killed by | Result |
|---|---|---|---|---|
| M1 | REQ-S06-002 | `0095`: `record_baseline` → `'BO'` instead of `'TL'` | "a baseline-validation instance…": `expected ['active','BO'] to deeply equal ['active','TL']` | **killed** |
| M2 | REQ-S06-002 | `steps.ts` `requireStepActor`: the `not_assignee` refusal disabled | same test: the BO's completion returns 200 instead of 403 `procedure_step.not_assignee` | **killed** |
| M3 | REQ-S18-004 | API dist `walkthrough.js`: `kpi_actual_submitted` always false | e2e twelve steps: "walkthrough submit_kpi_actual" (step 7) | **killed** |
| M4 | REQ-S18-001 | web bundle: banner text → "Example data." | labels test (1): `expectBanner` `toHaveText` fails | **killed** |
| M5 | REQ-S21-001 | web bundle: `approvalLabel` → "" | labels test (1): `Expected "Synthetic demonstration - approves nothing real"`, `Received ""` | **killed** |
| M6 | REQ-S18-001 (export) | `packages/reporting/dist/labels.js`: `export.illustrative` (en) → "" | export test: "docx carries the en illustrative label" | **killed** |

**M6's first run did not count.** It exited 0 because the worker loaded the tree's `@mth/reporting` through the symlinked `node_modules`, so the mutated file was never loaded. It is kept as `M6-run1-not-applied.log` and is not counted. After re-pointing, M6 was killed. In every run, the 2 intended product-defect failures stay as they are.

## 5. Product defects and open items (tests kept failing; not worked around)

### 5.1 Intake under Rule A: pending T-DG5-BE-T4

- **Not a new defect.** It is the D-166 decision, which this tree does not yet implement (no `0096`).
- **Test:** `a02-a21-complete-lifecycle.test.ts` › "drives every instance…", per the assignment.
- **Result on `6f8ce12`:** `"new_transformation_intake": "draft_charter (TL): 404 not_found"`. After `capture_intake`, the step still has `transformation_id = NULL`, so T's Lead cannot act on it.
- The other 9 procedures complete.

**What the test expects under Rule A:**
- `draft_charter` is acted on by T's Lead;
- `confirm_sponsor`'s approval is requested on T (`approval.transformationId = T`);
- the instance's `transformationId` stays `null`;
- the Sponsor that the access administrator assigned and T's Lead mapped decides;
- every instance ends `completed`.

**If BE-T4 authorizes adopted steps differently:** for example, if the organization-scope Lead keeps acting on `draft_charter`, the failure will say so at that step. This needs a one-line change in `actorOf`.

### 5.2 D-QA-E2-1: no record badge in form headers (REQ-S18-001; ADR-0050 §2 b)

- **Proposed severity:** Medium. A mandatory label is missing on part of the demo screens.
- **Requirement:** ADR-0050 §2 (b): "every record view **and form header** shows the badge 'Illustrative example — synthetic' / 'مثال توضيحي — اصطناعي'". REQ-S18-001: "every demo screen, record and export shows the synthetic label in en and ar".
- **Screens:** on the demo stack, signed in as `roaming.user.tl`, en and ar:
  - (a) `/transformations/{id}/edit`, header "Edit transformation" / its Arabic;
  - (b) `/transformations/{id}/diagnose` > "Add baseline", the dialog header.
- **Actual:** neither header contains `[data-state='demo-record']`. Screenshots: `screenshots/{en,ar}/labels-edit-form-header.png` and `labels-create-dialog-header.png`. The banner is present.
- **Cause (read-only):** `DemoRecordBadge` is rendered only by `components/Workspace.tsx:244` and `pages/transformations/TransformationDetailPage.tsx`. No form or dialog header renders it.
- **No API request is involved:** this is rendering only.
- **Test:** `e2e/a02-demo-labels.spec.ts` › "the record badge in FORM headers". It fails in chromium-en and chromium-ar with `missing = ["edit form page header", "create dialog header"]`.

### 5.3 Observations (not failing tests)

**O-1: the seeded "pending approval" is in no demo role user's inbox.**
- For each of `roaming.user.{sp,bo,fin,tl,kds,to,wl,cm}`, `GET /api/v1/approvals?role=assignee&status=pending&limit=10` returned `items: []` (`dev-labels6.log`: "a demo role user with a seeded pending approval" → null).
- REQ-S18-002's coverage counter for "pending approval" is ≥ 1 (QA-E's coverage test passes), so the record exists, but no demo user can open it from the inbox.
- This also left the "approval opened from an inbox" label check NOT COVERED (§6).
- Proposed classification for the review: Low, demo usability.

**O-2: the root A06 and A07 specs need a writable `apps/web/e2e/screenshots`.**
- Through the shared `shot()`; see run 2b′.
- In a confined runner, set `E2E_SCREENSHOT_DIR`. This is for the orchestrator's merged-tree verification, if it runs sandboxed.

## 6. Requirement → test

In the table, "integ" is `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`, "walk" is `e2e/a02-demo-users-walkthrough.spec.ts`, and "labels" is `e2e/a02-demo-labels.spec.ts`.

| Row | Binding acceptance | Proven by | Status on `6f8ce12` |
|---|---|---|---|
| REQ-S18-004 | an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records | **walk** (en and ar): all twelve in the UI by `roaming.user.*`, each step's records verified (§3); integ › the API-level lifecycle and the demo users' sign-in and step 1 | **PASS** |
| REQ-S20-002 | Authorized users complete the guided end-to-end scenario using only native application workflows | walk (native screens, each by the role holding the right) + integ lifecycle + QA-E's `a02-guided-walkthrough` | **PASS** |
| REQ-S06-002 | a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance | integ › "a baseline-validation instance…": current step `record_baseline`, assignee **TL** (`0095`); BO refused 403 `procedure_step.not_assignee`; evidence and output 422s; output link; FIN 422 before validation; `completed`; baseline row `validated`, 12.50 | **PASS** (M1, M2) |
| REQ-S06-003 | the ten procedures exist after initialization and each can be launched and completed in the A02 scenario | integ › "exist" (PASS); "launched" 10/10 (PASS); "drives every instance…" 9/10 completed | **FAIL until BE-T4** (§5.1) |
| REQ-S01-003 | … the guided scenario passes through input, validation, approval, output, monitoring, correction and sustainment on persisted records | integ › "REQ-S01-003: the chain…" (QA-E, unchanged) | **PASS** for the scenario clause. The A01 coverage-view clause: NOT COVERED (A01, DG6). |
| REQ-S01-004 | the A02 scenario completes with exports, email and AI channels disabled; no workflow step's completion condition references an uploaded spreadsheet, deck or email | integ › the two A21 tests (QA-E, unchanged); e2e `a21-no-ai-operation` (en and ar) | **PASS**, with QA-E O-3 |
| REQ-S09-011 | the executive pack's workstream section contains the submitted update text and current metrics without manual editing | integ › "the generated pack contains…" (QA-E, unchanged) | **PASS** |
| REQ-S18-002 | a seed-coverage test finds at least one record for each of … pending approval | integ › "the dataset run's coverage…" (QA-E, unchanged) | **PASS**, with O-1 |
| REQ-S18-001 (rendered part) | every demo screen, record and export shows the synthetic label in en and ar | labels (1): banner on 11 screens, plus walk on every screen of the twelve steps; badge in record headers. Labels (3): DOCX by the real worker, label in the language. Labels (2): **form headers FAIL**. | **FAIL** (D-QA-E2-1). Record, screen and export parts PASS (M4, M6). The reset-twice clause belongs to A22/QA-F, not here. |
| REQ-S21-001 (rendered part) | demo G-approvals display 'Synthetic demonstration - approves nothing real' | labels (1): all six G-gate pages of the seeded transformation and the Finance queue, en and ar, exact catalogue text; walk step 5 (G4 decision page, SP) and step 8 (Finance item, FIN) | **PASS** (M5). The text-scan clause is QA-F's A22U. The approval opened from an inbox is NOT COVERED (O-1). |

## 7. What remains

1. **T-DG5-BE-T4 (Rule A).** After it merges, re-run `a02-a21-complete-lifecycle.test.ts`. Expected: 13/13. If its authorization of adopted steps differs, see §5.1.
2. **D-QA-E2-1:** the record badge in form and dialog headers (frontend). The labels test (2) then passes.
3. **A13 in the shared root stack:** QA-F2. In run 2b it failed in both projects, while it passed in run 2b′, where A06 and A07 stopped early (less backlog). This is consistent with D-165.
4. **O-1:** decide whether a seeded pending approval should be routed to a demo role user. Then the inbox label check can be added.
5. **Global configuration (D-163):** my specs publish none. Each test creates its own transformation. The labels test reads the seeded roaming transformation and writes nothing to it. Two specs start the real worker for one step and stop it with SIGTERM.
6. **Load:** heavy commands ran one at a time. Ports 23600–23649 only.
