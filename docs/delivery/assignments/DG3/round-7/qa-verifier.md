# DG3 gate review: qa-verifier (round 7)

Task ID: `T-DG3-REV-QA-R7`. You are the independent QA verifier re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate

- **candidate_id:** `sha256:f55095dbec364594d25a624261512239854f233d3ee0b5c8ecc210d1602bf6e0`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (757 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/f55095dbec364594.manifest.json`.
- **source_commit:** `d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81`.
- **Round 6** reviewed candidate `sha256:7049d793cd20ed7718e84ff4aa3bf940f99b5e2507e964660ef3b3545c1f3c96` at source `c40232b0` (D-087).
  - **All three verdicts were PASS.** code-security verified F-DG3-100 CLOSED.
  - **code-security also raised F-DG3-280** (Low, documentation drift, not blocking): ADR-0024 §6 'Pinned by tests' overstated the lintText test, which linted 48 of 99 probe rows.
  - **Why another round.** Every finding must be resolved before the gate, so F-DG3-280 was repaired, and this round re-reviews the new candidate in full.
- **The repair diff:** `git diff c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81`, product code (`packages/shared/**`, `eslint.config.js`, `docs/architecture/**`).
  - The repair commit is `1cd89e6` (T-DG3-KBE-I, merged in `e210987`); there are no orchestrator edits (D-087).
  - The handback is `docs/delivery/handbacks/DG3/T-DG3-KBE-I-kpi-benefits-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26699.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-087;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2,3,4,5,6}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Full regression on the repaired candidate

Your F-DG3-180 was verified CLOSED in round 3. Confirm it still holds: re-run your F180 and F180b layout probes in chromium-en and chromium-ar. **Write no verifications file.** F-DG3-100 belongs to code-security.

**Then the full regression,** from the acceptance criteria of all 32 DG3-final requirements. This round is a **full** review, because a gate needs three PASS verdicts on one candidate.

- **Re-test the round-7 repair from the acceptance side.** **T-DG3-KBE-I**, `1cd89e6` (merged in `e210987`): a test change in `fuzz.test.ts` and one ADR-0024 §6 sentence. No engine source changed.
  - The formula acceptance (REQ-PB-056/057, REQ-S08-007) is unchanged.
  - The API keeps its 422 behaviour for invalid formulas.
  - `formatDecimal` still shows Unknown for an invalid stored value.
  - `pnpm test` runs both Vitest invocations.
  - Any defect you find is a NEW finding in your id range.
- **Re-run the full regression of rounds 1 to 6 on this candidate.**
  - Every `acceptance` text in `docs/delivery/requirements.csv` for the 32 DG3 rows, **literally**.
  - Re-use your QA specs and probes (`docs/delivery/test-evidence/DG3/qa/tests/round-3/`). Copy them into `docs/delivery/test-evidence/DG3/qa/tests/round-3/`, and adapt them only if a repair requires it. If you do, say what changed and why.

You may author tests under `tests/qa/**` and `e2e/**`, never product code. Put your evidence under `docs/delivery/test-evidence/DG3/qa/round-7/`.

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
2. **Unit:** `pnpm test` on Node 22 and Node 24, and in both locale settings. Report both Vitest invocations' counts.
3. **Integration** on a disposable PostgreSQL, **twice**. It covers:
   - migrations `0001`→`0027`;
   - `contract.test.ts`: 270 operations live, and every `p3-pending-*.ts` empty.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`, now including `p3-inherited-approval.spec.ts`) plus your own specs on the real stack (`e2e/support/qa-stack.sh`), `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings (`LANG`/`LC_ALL` unset, and `C.UTF-8`);
   - axe must show no serious or critical issues;
   - include an AUD read-only pass;
   - report the counts per spec, and compare them with round 6.
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

Write `docs/delivery/reviews/DG3/round-7/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-7/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 7`, `stage_id: DG3`;
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

- **Your id range for any NEW finding:** **F-DG3-330 to F-DG3-339**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170, F-DG3-180 and F-DG3-280 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-7/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG3/round-7/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
