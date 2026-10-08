# DG3 gate review: domain-reviewer (round 2)

Task ID: `T-DG3-REV-DOM-R2`. You are the independent domain reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:58ef3f4777967f7f5791565d6075c3ec28b45c3a42a58903057b81b522540f31`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (754 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/58ef3f4777967f7f.manifest.json`.
- **source_commit:** `f49ca1604857f8a79dce28c306cff895e6158d8e`.
- **Round 1** reviewed candidate `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33` at source `928b7654`. All three reviewers gave PASS. Two Low findings were raised and repaired since: F-DG3-100 and F-DG3-120 (D-080).
- **The repair diff:** `git diff 928b7654..f49ca1604857f8a79dce28c306cff895e6158d8e`, product code (`apps/**`, `packages/**`, `eslint.config.js`, `docs/api/**`, `docs/architecture/**`).
  - The repair commits are `4175262` (T-DG3-KBE-D, merged in `011654d`) and `ea8e2de` (T-DG3-ARCH-05, merged in `2f30603`); D-081 records one orchestrator edit, renumbering the two new §9 items of `p3-work-split.md` as 23 and 24.
  - The handbacks are `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-solution-architect.md` and `T-DG3-KBE-D-kpi-benefits-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26400–26499.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-081;
  - your own round-1 record, `docs/delivery/reviews/DG3/round-1/domain-reviewer.json`, and its evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify your round-1 finding on THIS candidate, adversarially

**F-DG3-120 (Low, REQ-PB-004).** The gate list had no `inheritedApproval` annotation, although ADR-0021 §5 says it shows one.

**The claimed fix** is T-DG3-ARCH-05, `ea8e2de` (merged in `2f30603`).
- `GateInstance` (the gate list item and the gate view) gains a nullable `inheritedApproval` object, built from the gate's `inherited_approval` dispensations, with these fields:
  - `dispensationId`;
  - `status`: `pending_verification` | `accepted` | `rejected` | `revoked`;
  - `counts`: the sequencing rule of ADR-0021 §5;
  - `approvingBody`;
  - `approvedOn`.
- The gate's own `status` stays `draft`.
- The Gates list and the gate detail screen show a translated badge that never presents the gate as approved.
- ADR-0021 §5 states the field.

To verify, in **EN and AR**, through the real API and UI, on a stack built from a complete clone:

1. **Re-run your round-1 probe step 'modular'** (`docs/delivery/test-evidence/DG3/domain/round-1/dg3-api-extra.mjs`) on this candidate:
   - a Modular transformation (entry phase mobilize);
   - an `inherited_approval` dispensation for G1 with VERIFIED evidence → the annotation shows `pending_verification`, `counts: false`;
   - the synthetic Sponsor accepts it → `accepted`, `counts: true`;
   - G1's `status` stays `draft`, `latestSubmissionNo` stays 0, and no gate decision exists;
   - revoke it → `revoked`, `counts: false`.
2. **Check the screens.** The Gates list and the gate detail show the badge in EN and AR. Take a screenshot of each state. Confirm that:
   - the wording never says or implies the gate is approved, and never uses the approved colour;
   - the Arabic reads naturally, RTL.
3. **Check source fidelity.** Is "a Modular inherited approval is captured, never fabricated" (B0009, B0011, B0012, B0032; ADR-0021 §5) now true on every surface? That covers the gate list, the gate view, readiness, the Dispensations page and sequencing (`canSubmitInitiatives`).

Write `docs/delivery/reviews/DG3/round-2/domain-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason and the reproduction.

## Re-review: no regression, plus the full domain checks

Re-inspect the repair diff (`git diff 928b7654..f49ca1604857f8a79dce28c306cff895e6158d8e`).
- It also includes **T-DG3-KBE-D**, which only hardens the ESLint override and the source scan for the formula engine. Confirm it changed no formula semantics.
- Your round-1 seeded-example results must be unchanged:
  - the attach rate 0.10→0.12 × 100000 × ARPU 50 SAR = 100000 SAR exactly;
  - the cost example;
  - monthly × annual refused.

Then confirm, in EN and AR through the real UI and API, that your round-1 conclusions still hold on this candidate. Re-use your round-1 probes.
- **The templates:**
  - T05: the 14 fields and the 3–7 warning;
  - T06: 3.30 and 57.5, with the label;
  - T07: the four verbatim waves, and overlap accepted;
  - T08: the seven columns, and From can be External;
  - T09: the six columns.
- **The business case:**
  - the ten sections;
  - the classes;
  - no double counting;
  - Finance validation before G4, and SoD.
- **Sequencing:**
  - before G1;
  - the three agreements;
  - 'Outcome before activity';
  - End-to-End launch after G2+G3.
- **Structure:**
  - the five-level outcome hierarchy;
  - an initiative refused as TOM evidence.
- **Selection and G4:**
  - ranking, selection and funding are separate, with 'Selected - unfunded';
  - capacity and the conflict indicator;
  - G4's refusal naming 'Owners', 'Finance validation' and the initiatives.
- **Product hygiene:**
  - no certification claim;
  - the provisional brand and wordmark;
  - the provisional-Arabic labels.

### What to put where

- Put your evidence under `docs/delivery/test-evidence/DG3/domain/round-2/`, with EN and AR screenshots for every UI claim.
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

Write `docs/delivery/reviews/DG3/round-2/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-2/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`, `round: 2`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - F-DG3-120 verifies CLOSED;
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/domain-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-170 to F-DG3-179**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100 and F-DG3-120 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-2/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-2/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
