# DG3 gate review: domain-reviewer (round 1)

Task ID: `T-DG3-REV-DOM-R1`. You are the independent domain reviewer of the frozen **DG3** candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (753 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/873115d9bc84f763.manifest.json`.
- **source_commit:** `928b7654`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26400–26499.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078;
  - the P3 implementer handbacks in `docs/delivery/handbacks/DG3/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Your focus: source fidelity and operating logic

Check the P3 implementation against the playbook (`docs/source/playbook.md`) and the master prompt (`docs/source/master-prompt-v2.0.md`). Cite blocks as B00xx.

Work in **EN and AR**, through the real UI and API: build the stack from a complete clone and use the synthetic dev users. Confirm each item below.

### The source templates

- **T05 Initiative Card** (B0072). All 14 fields persist, and fewer than 3 or more than 7 key deliverables gives a *warning*.
- **T06 Prioritization Scorecard** (B0076, B0077):
  - the default weights are 25/25/20/15/15 on a 1–5 scale;
  - a scorecard of 5,4,3,2,1 gives **3.30**;
  - a missing score shows 'incomplete';
  - a risk/compliance criterion can replace part of the weighting;
  - the 0–100 view is labelled, and 3.30 gives **57.5**.
- **T07 Wave Roadmap** (B0079). The four waves appear **verbatim**, and overlapping horizons are accepted.
- **T08 Dependency Map** (B0081). All seven columns are present, and the From field can be External.
- **T09 Benefit Formula** (B0087). All six columns are present.

### Business case and benefit logic

- **The business case** (B0083–B0085). All ten sections are present, and there is a transformation-level case with lighter initiative cases underneath it.
- **Classes.** Investment and benefit classes match B0085.
- **No double counting** (B0088). A line has one class and the roll-up counts it once. Revenue uplift is kept separate from margin, and avoided cost from cash savings.
- **Finance validation before G4** (B0084, B0139). The author cannot validate their own baseline or formula.
- **The seeded examples** (B0087). The attach rate is stored as a fraction, so 10%→12% is 0.02 (2 pp). The revenue example gives exactly 100000 SAR, and monthly × annual figures are refused.

### Sequencing and traceability

- **Sequencing** (B0009, B0011, B0012, B0032):
  - no initiative can leave Draft or be submitted before G1;
  - G1 approval needs the three leadership agreements;
  - 'Outcome before activity' applies;
  - End-to-End launch waits for G2+G3;
  - a Modular inherited approval is captured, never fabricated.
- **The outcome hierarchy** (B0047, B0048). It has five levels, and an initiative contribution needs an outcome.
- **TOM vs portfolio** (B0059). An initiative is refused as G3 TOM evidence, and links to one or more gaps.

### Portfolio, mobilization and G4

- **Ranking, selection and funding are three separate things** (M0177). An initiative can show 'Selected - unfunded', and a selected-but-unfunded initiative cannot launch. Ranking changes are explained ('weight version 2'), and an override needs a reason.
- **Owners and capacity** (B0021, B0023, B0079). Role-based capacity is recorded, and a conflict indicator appears.
- **G4 Mobilization** (B0023, M0121, M0125). Its required evidence is complete, and the refusal names the gaps: 'Owners', 'Finance validation' and the initiative names.

### Product hygiene

- **Never a certification claim.** The product is never called an official PMI standard or a certified product.
- **Brand.** `#0078FF` stays provisional, with a provisional wordmark.
- **Arabic.** The provisional Arabic translations are labelled as such where the ADRs say so.

### What to put where

- Put your evidence under `docs/delivery/test-evidence/DG3/domain/round-1/`. Include EN and AR screenshots for every UI claim.
- **Run these and record them:**
  - `node tools/gates/validate.mjs --register DG3`;
  - `node tools/gates/validate.mjs --historical --stage DG2`;
  - `node tools/gates/validate.mjs --historical --stage DG1`.

## Requirements to check (record EXACTLY these)

`REQ-PB-004`, `REQ-PB-006`, `REQ-PB-007`, `REQ-PB-019`, `REQ-PB-022`, `REQ-PB-032`, `REQ-PB-040`, `REQ-PB-045`, `REQ-PB-046`, `REQ-PB-047`, `REQ-PB-048`, `REQ-PB-049`, `REQ-PB-050`, `REQ-PB-051`, `REQ-PB-052`, `REQ-PB-053`, `REQ-PB-054`, `REQ-PB-055`, `REQ-PB-056`, `REQ-PB-057`, `REQ-PB-059`, `REQ-S04-006`, `REQ-S05-005`, `REQ-S09-001`, `REQ-S09-003`, `REQ-S09-004`, `REQ-S09-005`, `REQ-S09-006`.

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

Write `docs/delivery/reviews/DG3/round-1/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-1/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`, `round: 1`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG2/round-17/domain-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-120 to F-DG3-139**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-1/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-1/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
