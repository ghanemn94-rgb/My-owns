# DG3 gate review: code-security-reviewer (round 7)

Task ID: `T-DG3-REV-SEC-R7`. You are the independent code and security reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

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
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-087;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2,3,4,5,6}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify your round-6 finding on THIS candidate

**F-DG3-280 (Low, REQ-PB-056).** ADR-0024 §6 'Pinned by tests' overstated the `ESLint.lintText` test, which linted only 48 of the 99 probe-table rows. Partial selector removals, for example `ForOfStatement[await=true]` or the `PrivateIdentifier[…]` part, would have failed no test.

**The claimed fix** is T-DG3-KBE-I, `1cd89e6` (merged in `e210987`). Read its handback.
- The test lints every probe-table row except two named non-module rows. Each of those two must be a fatal parse error, and a separate test pins the exclusion list.
- Each linted row must be refused by a **formula guard rule**, not by any rule.
- Private-name rows are added.
- **Mutation runs:**
  - M1, removing `ForOfStatement[await=true]`, now fails a test;
  - M2, removing the `PrivateIdentifier` selector, now fails a test.
- The §6 sentence states exactly what is linted.
- `eslint.config.js` is unchanged, because no lint gap was found.

To verify:
1. Re-run your round-6 checks of that test.
2. Reproduce M1 and M2 in a disposable clone.
3. Confirm that the §6 sentence is exactly true.
4. **Confirm that F-DG3-100 still holds.** Your round-6 closure must not regress: re-run your probes (G1 G2 A1 A2, W1–W6, S1–S3 V1 V2, the 18 forms).

Write `docs/delivery/reviews/DG3/round-7/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }` for **F-DG3-280**:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Full re-review: no regression, plus the full checks

This round is a **full** review of the candidate, because a gate needs three PASS verdicts on one candidate. Re-inspect:

- **The repair diff** (`git diff c40232b0..d3e6fe62d9a4a3a0e8d08fcf273aef74857b3e81`): T-DG3-KBE-I only (a test and an ADR sentence). Check it changed no formula result, no API status other than the documented `EvalError` path, and no other Vitest project.
- **Then the whole P3 surface, as in round 1.** Re-use your round-1 and round-2 probes:
  - every P3 mutation: authorization re-checked at commit time, validation, `If-Match`, audit, no I/O inside a transaction;
  - the AUD-403 sweep;
  - separation of duties and no on-behalf decision in every P3 business approval;
  - the G1 agreements guard;
  - the dependency-graph cycle refusal and its concurrency;
  - the advisory-lock registry (730219–730223, distinct);
  - decimals end to end;
  - the formula engine's limits, fuzz and injection;
  - migrations `0020`–`0027`;
  - the contract (270 operations live, every `p3-pending-*.ts` empty);
  - the `inheritedApproval` annotation: read-only, read under the transformation read gate, acyclic modules, an additive contract change.

### Run these, with real output

A missing tool or database is BLOCKED.

- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24. Both Vitest invocations must run; report both counts.
- The integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` and migrations `0001`→`0027`.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1`.

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-7/`.

## Requirements to check (record EXACTLY these)

`REQ-S16-016`, `REQ-S09-008`, `REQ-DLV-035`, `REQ-S08-007`, `REQ-PB-004`, `REQ-PB-007`, `REQ-PB-022`, `REQ-S04-006`, `REQ-PB-048`, `REQ-PB-049`, `REQ-PB-051`, `REQ-PB-052`, `REQ-PB-055`, `REQ-PB-056`, `REQ-S09-003`, `REQ-S09-006`.

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

Write `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-7/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 7`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - F-DG3-280 verifies CLOSED;
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-310 to F-DG3-319**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170, F-DG3-180 and F-DG3-280 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-7/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-7/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
