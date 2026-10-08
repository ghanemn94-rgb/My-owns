# DG3 gate review: domain-reviewer (round 5)

Task ID: `T-DG3-REV-DOM-R5`. You are the independent domain reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:dfedd62f05412fd7888b7d13d2391c6ab5df7d56563ab946502e53c558689ed3`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (757 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/dfedd62f05412fd7.manifest.json`.
- **source_commit:** `21e2742e4b0f6800e379a4d935d5592a873b1c59`.
- **Round 4** reviewed candidate `sha256:8376d762920591f1348e321dc36aaa806793efe2238af113f903b76b016fc455` at source `171a0b57` (D-085).
  - **domain:** PASS.
  - **qa:** PASS.
  - **code-security:** FAIL. Its F-DG3-100 verification failed: ADR-0024 §6's 'every catch rethrows EvalError' was not enforced for a new handler (W1, W2, W4), and three statements were inaccurate.
  - **Why this round is a full re-review.** A gate needs three PASS verdicts on one candidate, so this round is again a **full** re-review by all three reviewers.
- **The repair diff:** `git diff 171a0b57..21e2742e4b0f6800e379a4d935d5592a873b1c59`, product code (`packages/shared/**`, `eslint.config.js`, `docs/architecture/**`).
  - The repair commit is `10472b4` (T-DG3-KBE-G, merged in `af27b01`); there are no orchestrator edits (D-085).
  - The handback is `docs/delivery/handbacks/DG3/T-DG3-KBE-G-kpi-benefits-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26400–26499.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-085;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2,3,4}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Your findings: confirm they still hold

Your F-DG3-120 (closed in round 2) and F-DG3-170 (closed in round 3) are CLOSED_VERIFIED. **Write no verifications file.**

Confirm on this candidate that both still hold:
- the `inheritedApproval` annotation states and `counts`;
- the gate stays `draft` with no gate decision;
- the badge wraps inside its card and row in EN and AR (re-run `dg3-ui-overflow.mjs`).

## Full re-review: no regression, plus the full domain checks

Re-inspect the repair diff (`git diff 171a0b57..21e2742e4b0f6800e379a4d935d5592a873b1c59`).
- It contains only **T-DG3-KBE-G**. That task enforces the engine's EvalError-rethrow rule in lint and the scan, gives `parse.ts` the same catch guard, and corrects ADR-0024 §6. Confirm it changed no formula semantics.
- Your seeded-example results must be unchanged:
  - the attach rate 0.10→0.12 × 100000 × ARPU 50 SAR = 100000 SAR exactly;
  - the cost example;
  - monthly × annual is refused.

Then confirm, in EN and AR through the real UI and API, that your round-1 to round-4 conclusions still hold on this candidate. Re-use your probes.
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
  - End-to-End launch after G2+G3;
  - a Modular inherited approval captured, never fabricated.
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

- Put your evidence under `docs/delivery/test-evidence/DG3/domain/round-5/`, with EN and AR screenshots for every UI claim.
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

Write `docs/delivery/reviews/DG3/round-5/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-5/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`, `round: 5`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/domain-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-260 to F-DG3-269**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170 and F-DG3-180 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-5/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-5/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
