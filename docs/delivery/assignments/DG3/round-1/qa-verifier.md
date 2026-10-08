# DG3 gate review: qa-verifier (round 1)

Task ID: `T-DG3-REV-QA-R1`. You are the independent QA verifier of the frozen **DG3** candidate (P3 "Mobilization and portfolio"). You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate

- **candidate_id:** `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (753 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/873115d9bc84f763.manifest.json`.
- **source_commit:** `928b7654`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26699.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078;
  - the P3 implementer handbacks in `docs/delivery/handbacks/DG3/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Your focus: derive checks from the acceptance criteria of all 32 DG3-final requirements

Run positive, negative, regression, bilingual and reliability checks. Test every `acceptance` text in `docs/delivery/requirements.csv` **literally**. You may author tests under `tests/qa/**` and `e2e/**`, never product code. Put your evidence under `docs/delivery/test-evidence/DG3/qa/round-1/`, and your test copies under `docs/delivery/test-evidence/DG3/qa/tests/round-1/`.

Cover at least the following.

### The entity group and the templates

- **REQ-S16-016.** Create and read each entity through the API with authorization: Initiative, Deliverable, Milestone, RoadmapWave, Dependency, ResourceDemand, Capacity, FundingDecision.
- **T05** (REQ-PB-045/046). All 14 fields persist, and fewer than 3 or more than 7 deliverables gives a warning. A G4 submission naming an initiative with no gap link is refused, naming it.
- **T06** (REQ-PB-047/048/049, REQ-S09-001/005):
  - 5,4,3,2,1 → 3.30, and the 0–100 view shows 57.5 with its label;
  - a score of 6 is refused, and a missing score shows 'incomplete';
  - weights totalling 95% or 105% are refused, with nothing written;
  - weight-set v2 (risk/compliance 10, strategic fit 15) is accepted;
  - v1 results keep their v1 reference;
  - the ranking history shows 'weight version 2';
  - an override without a reason is refused.
- **T07 and the roadmap** (REQ-PB-050, REQ-S09-006). The four waves are verbatim. Moving a milestone updates the timeline, the table and the board, and conflicting edits show a conflict.
- **T08** (REQ-PB-051/052, REQ-S09-008, REQ-S09-004):
  - all seven columns persist, and From can be External;
  - the four system types cannot be deleted, and an unknown type is refused;
  - A→B→C→A is refused naming the cycle;
  - a needed-by conflict and sequencing before a predecessor are both flagged.

### Business case, formulas and finance

- **The business case** (REQ-PB-053/054/055, REQ-S05-005):
  - all ten sections persist;
  - a line with two classes is refused;
  - the total equals the distinct lines counted once;
  - editing an initiative case changes the roll-up without duplication;
  - G4 with an unvalidated formula is refused, listing 'Finance validation'.
- **T09** (REQ-PB-056/057, REQ-S08-007):
  - all six columns persist;
  - a confidence outside H/M/L is refused;
  - an undefined variable is refused;
  - 0.10→0.12 × 100000 × ARPU 50 SAR = 100000 SAR exactly;
  - the cost example is exact;
  - monthly ARPU × an annual population is refused.

### Mobilization and G4

- **Capacity** (REQ-PB-059, REQ-S09-004). Demand above availability shows the conflict indicator, and G4 lists initiatives without owners.
- **Ranking, selection and funding** (REQ-S09-003). An initiative selected without funding shows 'Selected - unfunded' and cannot launch.
- **Sequencing** (REQ-PB-004/006/007/022):
  - End-to-End launch gives 422 with the exact reason until G2 and G3 are approved, then succeeds;
  - 'Outcome before activity' applies;
  - before G1, leaving Draft gives 422, and readiness lists the missing areas;
  - G1 approval without the three agreements is refused.
- **The outcome hierarchy and TOM** (REQ-PB-032/040). All five levels are present, and a contribution without an outcome is refused. An initiative is refused as G3 TOM evidence.
- **G4** (REQ-PB-019, REQ-S04-006, REQ-DLV-035):
  - a submission is refused when an initiative has no owner ('Owners'), no funding or no capacity commitment, and the refusal names the initiative;
  - a decision by a non-approver or by the submitter is 403, and one on a superseded version is 409;
  - **the G4 approval flow runs end to end in EN and AR, with distinct synthetic TL, FIN and SP users.**
- **The register** (REQ-DLV-035). The 32 DG3 rows are IMPLEMENTED with existing evidence (`node tools/gates/validate.mjs --register DG3`).

### Execute, with real output

A missing tool or database is BLOCKED.

1. **Static:**
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `pnpm check:no-cdn`
   - `pnpm format:check`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. **Unit:** `pnpm test` on Node 22 and Node 24, and in both locale settings.
3. **Integration** on a disposable PostgreSQL, **twice**. It covers migrations `0001`→`0027` and `contract.test.ts` (270 operations live, every `p3-pending-*.ts` empty).
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) plus your own specs on the real stack (`e2e/support/qa-stack.sh`), `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings;
   - axe must show no serious or critical issues;
   - include an AUD read-only pass.
5. **Register and pipeline:**
   - `node tools/gates/validate.mjs --register DG3`;
   - `node tools/gates/validate.mjs --pipeline`;
   - `node tools/gates/validate.mjs --historical --stage DG2`;
   - `node tools/gates/validate.mjs --historical --stage DG1`.

## Requirements to check (record EXACTLY these, all 32)

`REQ-PB-004`, `REQ-PB-006`, `REQ-PB-007`, `REQ-PB-019`, `REQ-PB-022`, `REQ-PB-032`, `REQ-PB-040`, `REQ-PB-045`, `REQ-PB-046`, `REQ-PB-047`, `REQ-PB-048`, `REQ-PB-049`, `REQ-PB-050`, `REQ-PB-051`, `REQ-PB-052`, `REQ-PB-053`, `REQ-PB-054`, `REQ-PB-055`, `REQ-PB-056`, `REQ-PB-057`, `REQ-PB-059`, `REQ-DLV-035`, `REQ-S04-006`, `REQ-S05-005`, `REQ-S08-007`, `REQ-S09-001`, `REQ-S09-003`, `REQ-S09-004`, `REQ-S09-005`, `REQ-S09-006`, `REQ-S09-008`, `REQ-S16-016`.

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

Write `docs/delivery/reviews/DG3/round-1/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-1/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 1`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG2/round-17/qa-verifier.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-140 to F-DG3-159**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-1/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG3/round-1/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
