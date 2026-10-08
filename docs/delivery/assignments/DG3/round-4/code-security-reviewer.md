# DG3 gate review: code-security-reviewer (round 4)

Task ID: `T-DG3-REV-SEC-R4`. You are the independent code and security reviewer re-reviewing the **repaired** DG3 candidate (P3 "Mobilization and portfolio"). You did not implement any DG3 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:8376d762920591f1348e321dc36aaa806793efe2238af113f903b76b016fc455`. Verify it with `node tools/gates/candidate.mjs --stage DG3` (757 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG3/8376d762920591f1.manifest.json`.
- **source_commit:** `171a0b57f9b8d2112891d1284adda6f0384da090`.
- **Round 3** reviewed candidate `sha256:f2b4c77a026c6825d323cdc89782d63410ec9ead05666e06d90a4d51988d1d1d` at source `ce988e20`. A container restart killed the first code-security and qa runs, and both were re-run from `round-3/*-rerun.md` (D-084).
  - **domain:** PASS. It verified F-DG3-170 (CLOSED_VERIFIED).
  - **qa (rerun):** PASS. It verified F-DG3-180 (CLOSED_VERIFIED).
  - **code-security (rerun):** FAIL. Its F-DG3-100 verification failed again. The engine's catch-all turned an exercised `EvalError` into an accepted `internal` problem, and `../value.ts` was outside every formula rule.
  - **Why this round is a full re-review.** A gate needs three PASS verdicts on one candidate, so this round is again a **full** re-review by all three reviewers.
- **The repair diff:** `git diff ce988e20..171a0b57f9b8d2112891d1284adda6f0384da090`, product code (`packages/shared/**`, `eslint.config.js`, `docs/architecture/**`).
  - The repair commit is `0fb892c` (T-DG3-KBE-F, merged in `35133fb`); there are no orchestrator edits (D-084).
  - The handback is `docs/delivery/handbacks/DG3/T-DG3-KBE-F-kpi-benefits-engineer.md`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. **Never run `git worktree add` on this repository.** A new worktree changes the configuration snapshot of every concurrent run (D-082).
- **Previous gates:** DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG2` and `--historical --stage DG1` must pass.
- **Design and delivery context:**
  - `docs/architecture/adr/ADR-0021`…`ADR-0024`;
  - `docs/architecture/p3-work-split.md`, including §9, the amendments;
  - `docs/delivery/decisions.md` D-078 to D-084;
  - your own round-1 and round-2 records under `docs/delivery/reviews/DG3/round-{1,2,3}/`, and their evidence.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 32 rows with `final_gate` = DG3). Test them literally.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7.

## Verify F-DG3-100 on THIS candidate, adversarially

**F-DG3-100 (Low, REQ-PB-056).** Your round-3 verification FAILED it, for two reasons:
- **(1) The engine swallowed the error.** Its catch-all turned an exercised `EvalError` into an `internal` `formula.syntax` problem, which the tests accepted (S1, S3).
- **(2) `../value.ts` was unguarded.** It is the engine's one allowlisted outside import, and no formula rule covered it (V1).

**The claimed fix** is T-DG3-KBE-F, `0fb892c` (merged in `35133fb`). Read its handback, §2–§4.
- **The rethrow.** Every catch in the engine's import closure rethrows `EvalError`: `validateFormula`, `evaluateFormula`, `evaluateAst` and `value.ts` `formatDecimal`.
- **The internal-failure rule.** Independently, every `fuzz.test.ts` outcome check and every `formula.test.ts` rejection row refuses `reason: 'internal'`.
- **Regression tests** in the no-codegen project.
- **`value.ts` is now guarded.** It gets the engine-source lint block, with a `decimal.js`-only allowlist, and it joins the scan.
- **The closure test.** `engineImportClosure()` pins the transitive closure to the guarded file set, with a lint-coverage test. That test runs in `unit-node` only, because ESLint cannot run under the flag.
- **ADR-0024 §6** is corrected.
- **Production behaviour** for unexpected errors other than `EvalError` is unchanged (422 `formula.syntax` 'internal').

To verify:

1. **Re-run your round-3 probes** in a disposable clone, never in the candidate tree:
   - `docs/delivery/test-evidence/DG3/code-security/round-3/probes/guard-layers-probe.mjs` (S1 S2 S3 V1 V2);
   - `probes/exercised-probe.mjs`;
   - the round-2 `guard-bypass-probe.mjs` (the 18 earlier forms).

   For each form, report which layer refuses it.
2. **Attack the new mechanisms.** For example:
   - Is there any other catch in the closure, such as a `.catch`, a `finally` that swallows, or a helper, that converts an `EvalError`?
   - Can an `EvalError` be wrapped, for example with `cause`, so the rethrow misses it?
   - Does the internal-failure rule cover every outcome check?
   - Does the closure test follow every import form?
   - Is any file reachable from the engine at run time but outside the closure?
   - Does the `EvalError` rethrow change any API or web behaviour? A 500 can only occur if code generation is refused, so check that the API callers handle it safely.
3. **Check the claims.** Is ADR-0024 §6 now exactly true, statement by statement, including the residual?
4. **Confirm the engine's formula results are unchanged.** Re-run your probe C fuzz.

Write `docs/delivery/reviews/DG3/round-4/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual that the ADR states honestly and that only an unexercised path could reach belongs in the note, with your reasoning.

## Full re-review: no regression, plus the full checks

This round is a **full** review of the candidate, because a gate needs three PASS verdicts on one candidate. Re-inspect:

- **The repair diff** (`git diff ce988e20..171a0b57f9b8d2112891d1284adda6f0384da090`): T-DG3-KBE-F only. Check it changed no formula result, no API status other than the documented `EvalError` path, and no other Vitest project.
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

Put your evidence under `docs/delivery/test-evidence/DG3/code-security/round-4/`.

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

Write `docs/delivery/reviews/DG3/round-4/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG3/round-4/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 4`, `stage_id: DG3`;
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

- **Your id range for any NEW finding:** **F-DG3-220 to F-DG3-229**, used in order. Never use another id. The other reviewers have their own ranges, and F-DG3-100, F-DG3-120, F-DG3-170 and F-DG3-180 are taken.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG3/round-4/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG3");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG3/round-4/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
