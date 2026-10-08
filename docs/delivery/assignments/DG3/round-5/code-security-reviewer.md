# DG3 gate review: code-security-reviewer (round 5)

Task ID: `T-DG3-REV-SEC-R5`. You are the independent code and security reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

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
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-085;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2,3,4}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify F-DG3-100 on THIS candidate, adversarially

**F-DG3-100 (Low, REQ-PB-056).** Your round-4 verification FAILED it. Nothing enforced the EvalError-rethrow rule for a new handler (W1 `catch { }`, W2 `finally { return; }`, W4 `Promise….catch`), and ADR-0024 §6 had three inaccurate statements. You named closure criterion (a): enforce the rule statically in the closure, in lint and mirrored in the scan.

**The claimed fix** is T-DG3-KBE-G, `10472b4` (merged in `af27b01`). Read its handback.
- **The catch rule.** Every `CatchClause` in the engine's import closure must bind `e` and have `if (e instanceof EvalError) throw e;` first. A lint selector enforces it, and the scan mirrors it.
- **`finally`.** `no-unsafe-finally` is on.
- **Asynchrony.** `Promise`, `async`, `await` and `.then`, `.catch`, `.finally` are refused.
- **`parse.ts`** gets the same first statement.
- **The closure parser** follows string-named specifiers (X1).
- **ADR-0024 §6** is corrected.

To verify:

1. **Re-run your round-4 `swallow-probe.mjs`** (W1–W6), your round-3 `guard-layers-probe.mjs` (S1 S2 S3 V1 V2) and the round-2 `guard-bypass-probe.mjs` (18 forms) in a disposable clone. Report which layer refuses each form.
2. **Attack the new static rule.** For example:
   - Is there a catch shape that satisfies the selector but still swallows, such as a rethrow of a different variable, a shadowed `e`, `EvalError` rebound, or code before the guard?
   - Is there any other way to handle a refusal without a catch, such as an event, a callback, `process.on` (refused globals) or an iterator `return()`?
   - Does the scan mirror the lint rule?
3. **Check the claims.** Is ADR-0024 §6 now exactly true, statement by statement, including its stated residuals?
4. **Confirm the engine's formula results are unchanged.** Re-run your probe C.

Write `docs/delivery/reviews/DG3/round-5/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if your closure criterion is met: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual that §6 states honestly and that only an unexercised path could reach belongs in the note, with your reasoning.

## Full re-review: no regression, plus the full checks

This round is a **full** review of the candidate, because a gate needs three PASS verdicts on one candidate. Re-inspect:

- **The repair diff** (`git diff 171a0b57..21e2742e4b0f6800e379a4d935d5592a873b1c59`): T-DG3-KBE-G only. Check it changed no formula result, no API status other than the documented `EvalError` path, and no other Vitest project.
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

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-5/`.

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

Write `docs/delivery/reviews/DG3/round-5/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-5/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 5`, `stage_id: DG3`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all of these hold:
  - F-DG3-100 verifies CLOSED;
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of your round-1 record, `docs/delivery/reviews/DG3/round-1/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG3-250 to F-DG3-259**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170 and F-DG3-180 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-5/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-5/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
