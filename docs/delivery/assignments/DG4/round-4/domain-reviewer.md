# DG4 gate review: domain-reviewer (round 4)

Task ID: `T-DG4-REV-DOM-R4`. You are the independent domain reviewer of the frozen **DG4** candidate (P4 "Execution value and sustainment"). You did not implement any DG4 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:5ff36f6e74af1853096e057ba6deee19df8ae44f9f06a7f3d2e184d1160e0f98`. Verify it with `node tools/gates/candidate.mjs --stage DG4` (1469 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG4/5ff36f6e74af1853.manifest.json`.
- **source_commit:** `ccc37c9`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26400–26499.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG3` must pass, and so must `--historical --stage DG2` and `--historical --stage DG1`.
- **Design and delivery context:**
  - `docs/architecture/p4-plan.md`;
  - `docs/architecture/p4-work-split.md`;
  - `docs/architecture/adr/ADR-0025` … `ADR-0038`, with their dated amendments, which win where they differ from the original text;
  - `docs/delivery/decisions.md` D-088 to D-126;
  - the P4 implementer handbacks in `docs/delivery/handbacks/DG4/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-{A,B,C,D}-authoring/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 137 rows with `final_gate` = DG4). Test them literally. The DG4 rows are IMPLEMENTED with evidence (`validate.mjs --register DG4` PASS). Their `notes` disclose every clause that is covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner` (QA-A's finding). Use it, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load; D-111, D-112 and D-115 record this. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## Verify your round-3 findings on THIS candidate, adversarially

- **F-DG4-125 (High, mandatory):** a percentage KPI stored as 0.12 rendered as '0.12 %' on the dashboards.
  - **Claimed fix:** FE-R6 renders `percentage` and `%` as a fraction × 100. FE-R7 then formats every KPI-derived value by `DashboardValue.kpiUnit.kind` (ADR-0037 N5), as the KPI pages' `formatKpiValue` does.
  - **To verify:** re-run R3-7 and `dom-pct.mjs` on the real stack in EN and AR, and read the T10 Outcomes and People & adoption areas, the Executive Overview, the adoption dashboard and every drill-down. Expect '12 %'. Also try a `percentage` KPI labelled '% of users' (expect '12 % of users') and a `ratio` KPI of 1.5 (expect '1.5', not '150 %'), and confirm the value gap still reads '100 %'.
- **F-DG4-126 (Medium):** the Value RAG ignored the top-line and non-cash gaps (a false Green).
  - **Claimed fix:** ADR-0037/ADR-0030 N4: a gap ratio per basis and currency, never summed, with the Value RAG the worst of them; `ruleParams.lines` lists every basis and currency. The rule you proposed was adopted (D-122).
  - **To verify:** re-run R3-6 (both variants: expect Red) on T10, the workstream dashboard, the Overview area and row, and the Finance rows. Also judge D-123 item 1: a revenue-only transformation now carries its top-line gap status instead of `not_applicable` (your round-3 R3-2 pins the old n/a, so expect it to fail by design).
- **F-DG4-127 (Medium):** the Portfolio initiative value was a five-class SAR sum (435).
  - **Claimed fix:** the initiative value and ranking use the profit-and-cash basis, labelled by `DashboardItem.valueBasis`. An initiative with only top-line or non-cash allocations is `not_applicable` and ranks last. A missing planned amount makes the value Unknown (D-123 item 3).
  - **To verify:** re-run R3-8 (expect 90), a ranking world, and an initiative with a missing amount. Also judge D-123 item 4: the item labels its basis and does not list the other bases.
- **Also verify D-124 item 1:** the T10 Outcomes area, the Executive Overview and the outcomes drill-downs now show an outcome created **through the API** (still `draft`), and not an archived one. The header's outcome health and the Outcomes RAG now include draft outcomes, as every other reader already treats non-archived outcomes (charter, gate criteria, portfolio hierarchy). Judge this against the source.

**Verifications file.** Write `docs/delivery/reviews/DG4/round-4/domain-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- If the fix is genuine: `result: "PASS"` and `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual you judge not worth a finding goes in the note, with your reasoning. **Your verdict can be PASS only if each of your round-3 findings verifies CLOSED.**

**The repair diff** is `git diff 925f0bc..ccc37c9` (round-3 source `925f0bc` to this candidate's source). The repairs are:
- T-DG4-ARCH-R6: ADR-0037 and ADR-0030 amendment N4 (a gap and status per basis, the Portfolio value basis, currency-exact value drill-downs), `DashboardItem.valueBasis`, `DashboardDrilldown.currency`, the `currency` query parameter and the 422 `dashboard.currency_not_applicable`;
- T-DG4-KBE-R7: F-DG4-126, F-DG4-127 (including a missing planned amount now Unknown, D-123 item 3), F-DG4-105, and the ARCH-R6 closing step;
- T-DG4-FE-R6: F-DG4-125, the per-basis RAG lines and the Portfolio value basis on screen;
- T-DG4-ARCH-R7: ADR-0037 amendment N5, `DashboardValue.kpiUnit = {kind, label}`;
- T-DG4-KBE-R8: the dashboards read non-archived outcomes (D-124 item 1), `kpiUnit` on every KPI emitter, and the ARCH-R7 closing step;
- T-DG4-FE-R7: dashboards format KPI values by `kpiUnit.kind`, as the KPI pages do.

Their handbacks are in `docs/delivery/handbacks/DG4/`. D-122 decided the round-3 repairs. D-123 to D-126 record the integration, including three defects FE-R6 found outside its scope and the orchestrator confirmed before this freeze (D-124: the T10 Outcomes area empty for any outcome created through the product; a `ratio` KPI shown × 100; a labelled percentage KPI shown unscaled). No orchestrator edit was made at these merges.
- **Re-inspect the whole repair diff for regressions.** A repair must not weaken any other behaviour.
- **Then run your full review, as below.** This round is a complete review of the new candidate, not only a check of the repairs.

## Your focus: source fidelity and operating logic

Check the P4 implementation against the playbook (`docs/source/playbook.md`) and the master prompt (`docs/source/master-prompt-v2.0.md`). Cite blocks as B0xxx and M0xxx.

Work in **EN and AR**, through the real UI and API: build the stack from a complete clone and use the synthetic dev users. Confirm, at least, each of the following.

### Source templates and seeded content

- **The T10 Monthly Health Check.** Its six areas are seeded verbatim, each area has its own RAG rule, and Unknown is never green.
- **The T11 decision rights and the T12 RACI.** Each deliverable has one accountable person.
- **T13 adoption.** It has seven columns and closed value lists; 'Hostile' is refused.
- **T14 benefits register.** It has ten columns, and pending value is excluded from the validated total.
- **T15 RAID.** It has nine columns, and Probability is n/a except for a Risk.
- **T16 executive decisions.** It has nine columns; an ask has seven elements, including 'why now'.
- **The five forum layers.** Their cadence text is seeded verbatim.
- **The seven adoption indicators.** Each is available by name.

### KPI and benefit semantics

- **Calculations.** Polarity and bands; % vs pp; zero denominator; Unknown and Stale never 0 or green; weighted ratio roll-ups; no currency mixing.
- **Benefits.** A shared benefit counts once; allocations total at most 100 %; forecast, upside and pending value never count as validated.
- **Finance validation.** It is a Finance-only business approval, and an amendment or reversal keeps both records visible.
- **Benefit types.** Revenue is kept apart from margin and avoided cost from cash. A non-financial benefit is n/a, never 0.

### Governance, execution and escalation

- **SLAs.** They count working days against the configured calendar.
- **Escalation.** It happens once, to the next authority.
- **Blocker rule.** A blocker that stays Red for N cycles creates one T16 ask.
- **Meetings.** Quorum is enforced; published minutes are immutable; meeting actions appear in My Work.
- **Corrective actions.** There is one case per source, with no duplicates; a persistence rule applies.

### Adoption, sustainment and closure

- **Status separation.** Delivery, adoption, validated value and closure are separate. 'Delivered — value validation pending' is never labelled successful, and closure is refused while value is pending unless a transition decision exists.
- **BAU handover.** Only the receiving owner accepts it, and acceptance creates the recurring reviews exactly once.
- **After closure.** Areas, KPI actuals and the CI backlog continue. Reopening preserves the original acceptance and closure date.

### Gates G5 and G6, change control, Modular entry

- **G5.** It requires risk closure and records the scale scope; scaling outside that scope is refused.
- **G6.** It requires ownership transfer.
- **Exceptions and waivers.** Each has an expiry and a compensating action.
- **The Modular G3 waiver.** D-110 and ADR-0021 W1–W7 apply. It covers only the missing links, never a criterion, and approval is refused when the waiver is revoked or expired.
- **Change requests.** They preserve the original approvals and snapshots.
- **Two QA observations to judge:**
  - QA-C O-2: a transformation stays `draft` through G1–G6 until it is activated. Does this match the source?
  - QA-B: approving a Draft gate answers 409, where another rule suggests 422.

### Dashboards and traceability

- **Dashboards.** There are six; Executive Overview and the workspace header are included. Filters cover organization, transformation, owner, period, phase and status. A drill-down reaches the contributing records. Zero, Unknown, Stale and n/a are rendered distinctly.
- **Traceability.** It has one source of truth and no copies; there is an orphan report; an allocation over 110 % is refused.

### Product hygiene

- **No certification claim.** The product is never called an official PMI standard or a certified product.
- **Provisional brand.** `#0078FF` stays provisional, with a provisional wordmark.
- **Provisional Arabic.** Provisional Arabic text is labelled where the ADRs say so.

### What to put where

- **Evidence:** put it under `docs/delivery/test-evidence/DG4/domain/round-4/`, with EN and AR screenshots for every UI claim.
- **Run and record:**
  - `node tools/gates/validate.mjs --register DG4`;
  - `node tools/gates/validate.mjs --historical --stage DG3`.

## Requirements to check (record EXACTLY these, 137)

`REQ-PB-005`, `REQ-PB-008`, `REQ-PB-009`, `REQ-PB-010`, `REQ-PB-013`, `REQ-PB-014`, `REQ-PB-015`, `REQ-PB-020`, `REQ-PB-021`, `REQ-PB-044`, `REQ-PB-058`, `REQ-PB-060`, `REQ-PB-061`, `REQ-PB-062`, `REQ-PB-063`, `REQ-PB-064`, `REQ-PB-065`, `REQ-PB-066`, `REQ-PB-067`, `REQ-PB-068`, `REQ-PB-069`, `REQ-PB-070`, `REQ-PB-071`, `REQ-PB-072`, `REQ-PB-073`, `REQ-PB-074`, `REQ-PB-075`, `REQ-PB-076`, `REQ-PB-078`, `REQ-PB-079`, `REQ-PB-080`, `REQ-PB-081`, `REQ-PB-082`, `REQ-PB-083`, `REQ-PB-084`, `REQ-PB-085`, `REQ-DLV-036`, `REQ-S03-001`, `REQ-S03-002`, `REQ-S03-003`, `REQ-S03-004`, `REQ-S03-005`, `REQ-S03-006`, `REQ-S03-008`, `REQ-S03-009`, `REQ-S03-011`, `REQ-S04-001`, `REQ-S04-002`, `REQ-S04-007`, `REQ-S04-008`, `REQ-S04-009`, `REQ-S04-010`, `REQ-S04-012`, `REQ-S04-013`, `REQ-S04-014`, `REQ-S07-001`, `REQ-S07-002`, `REQ-S07-003`, `REQ-S07-004`, `REQ-S07-005`, `REQ-S07-006`, `REQ-S07-007`, `REQ-S07-008`, `REQ-S07-009`, `REQ-S07-010`, `REQ-S07-011`, `REQ-S07-012`, `REQ-S07-013`, `REQ-S07-014`, `REQ-S07-015`, `REQ-S07-017`, `REQ-S08-001`, `REQ-S08-002`, `REQ-S08-003`, `REQ-S08-004`, `REQ-S08-006`, `REQ-S08-008`, `REQ-S08-009`, `REQ-S08-010`, `REQ-S08-011`, `REQ-S08-013`, `REQ-S08-014`, `REQ-S08-015`, `REQ-S08-016`, `REQ-S08-017`, `REQ-S08-018`, `REQ-S09-007`, `REQ-S09-009`, `REQ-S09-010`, `REQ-S10-003`, `REQ-S10-005`, `REQ-S10-006`, `REQ-S10-007`, `REQ-S10-008`, `REQ-S10-009`, `REQ-S10-010`, `REQ-S10-011`, `REQ-S10-012`, `REQ-S10-014`, `REQ-S10-016`, `REQ-S10-017`, `REQ-S10-018`, `REQ-S10-019`, `REQ-S11-001`, `REQ-S11-002`, `REQ-S11-004`, `REQ-S11-005`, `REQ-S11-006`, `REQ-S11-007`, `REQ-S11-008`, `REQ-S11-009`, `REQ-S12-005`, `REQ-S12-006`, `REQ-S12-009`, `REQ-S12-010`, `REQ-S12-011`, `REQ-S12-014`, `REQ-S12-016`, `REQ-S13-001`, `REQ-S13-002`, `REQ-S13-003`, `REQ-S15-008`, `REQ-S16-005`, `REQ-S16-011`, `REQ-S16-014`, `REQ-S16-017`, `REQ-S16-018`, `REQ-S16-019`, `REQ-S16-020`, `REQ-S16-025`, `REQ-S20-003`, `REQ-S20-004`, `REQ-S20-005`, `REQ-S20-008`, `REQ-S20-009`, `REQ-S20-010`, `REQ-S20-011`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG4/round-4/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG4/round-4/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`, `round: 4`, `stage_id: DG4`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG3/round-7/domain-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG4-128 to F-DG4-139**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG4/round-4/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG4");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG4/round-4/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
