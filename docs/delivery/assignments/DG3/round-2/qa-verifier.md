# DG3 gate review: qa-verifier (round 2)

Task ID: `T-DG3-REV-QA-R2`. You are the independent QA verifier re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You may author tests under `tests/qa/**` and `e2e/**`, never product code.

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
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26699.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-081;
  - your own round-1 record, `docs/delivery/reviews/DG3/round-1/qa-verifier.json`, and its evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Your focus: full regression on the repaired candidate, from the acceptance criteria of all 32 DG3-final requirements

You raised no finding in round 1. The two Low findings belong to the other reviewers, and each is verified by the reviewer who raised it: code-security verifies F-DG3-100, and domain verifies F-DG3-120. **Write no verifications file.**

Your job:

1. **Re-test the repairs from the acceptance side.**
   - **T-DG3-ARCH-05**, `ea8e2de` (merged in `2f30603`): the `inheritedApproval` annotation on the gate list and the gate view.
     - Positive and negative checks through the API: `null` when there is none, `pending_verification`, `accepted`, `rejected`, `revoked`.
     - The gate `status` stays `draft`, and no gate decision is created.
     - An AUD user sees the annotation read-only.
     - The badge on the Gates screens in **chromium-en and chromium-ar**, axe-clean.
   - **T-DG3-KBE-D**, `4175262` (merged in `011654d`): the formula guard.
     - The formula engine's acceptance (REQ-PB-056/057, REQ-S08-007) is unchanged.
     - The new lint rules do not fail on the shipped code.
   - Any defect you find is a NEW finding in your id range.
2. **Re-run the full regression of round 1 on this candidate.**
   - Every `acceptance` text in `docs/delivery/requirements.csv` for the 32 DG3 rows, **literally**.
   - Re-use your round-1 QA specs and probes (`docs/delivery/test-evidence/DG3/qa/tests/round-1/`). Copy them into `docs/delivery/test-evidence/DG3/qa/tests/round-2/` and adapt them only if the repair requires it. If you do, say what changed and why.

You may author tests under `tests/qa/**` and `e2e/**`, never product code. Put your evidence under `docs/delivery/test-evidence/DG3/qa/round-2/`.

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
3. **Integration** on a disposable PostgreSQL, **twice**. It covers:
   - migrations `0001`→`0027`;
   - `contract.test.ts`: 270 operations live, and every `p3-pending-*.ts` empty;
   - the new `inheritedApproval` integration test.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) plus your own specs on the real stack (`e2e/support/qa-stack.sh`), `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings (`LANG`/`LC_ALL` unset, and `C.UTF-8`);
   - axe must show no serious or critical issues;
   - include an AUD read-only pass;
   - report the counts per spec, and compare them with round 1 (200/200 in each setting).
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

Write `docs/delivery/reviews/DG3/round-2/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-2/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 2`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/qa-verifier.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-180 to F-DG3-189**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100 and F-DG3-120 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-2/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG3/round-2/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
