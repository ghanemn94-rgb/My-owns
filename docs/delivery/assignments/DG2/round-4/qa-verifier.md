# DG2 gate review — qa-verifier (round 4)

Task ID: `T-DG2-REV-QA-R4`. You are the independent QA verifier re-verifying the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (521 files).
- **manifest:** `docs/delivery/candidates/DG2/29ced0ed896ab9bf.manifest.json`.
- **source_commit:** `e37f6ea4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-3 findings on THIS candidate (you raised them)
Re-run your round-3 specs. They are in `docs/delivery/test-evidence/DG2/qa/tests/round-3/e2e/`: `dg2-qa-blank-r3.spec.ts` and `dg2-qa-blank-probe-r3.spec.ts`. Copy them into your round-4 test area and adapt them if the UI wording changed, but do not weaken them.

- **F-DG2-210 (Medium, REQ-PB-029).**
  - **Claim:** FE5 `bfa1807` and FE6 `97863da` fixed every P2 web form: RecordForm/T01, the charter, the gate submission note, the decision rationale and comments, journey steps, the row-action note, decisions/define inputs and ReasonDialog.
  - **Expected behaviour:** whitespace-only or invisible-only text shows the inline localized `validation__blank` message ("Enter some text; spaces alone are not a value." / "أدخِل نصاً؛ المسافات وحدها ليست قيمة."). The field gets aria-invalid and focus. **Nothing is sent and nothing is written:** no charter is created, no charter version is written, and an existing value is not cleared. Visible text is sent verbatim. A change summary alone counts as "no changes".
  - **How:** confirm in EN and AR on the real stack, in each of those forms.
- **F-DG2-211 (Medium, REQ-S15-012).**
  - **Claim:** the RecordForm error banner is now `<div role="alert">` wrapping a semantic `<ul>`.
  - **How:** confirm with axe on the banner state in EN and AR: no serious or critical violation. Also scan any other error or alert state you can reach.

Write `docs/delivery/reviews/DG2/round-4/qa-verifier.verifications.json` as `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason.

## Execute (real output; a missing tool or DB is BLOCKED)
1. Build and static checks:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint` (161 ops)
   - `pnpm check:no-cdn`
   - `pnpm format:check`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. Unit tests: `pnpm test` on Node 22 and on Node 24.
3. Integration, **twice**, on a disposable PostgreSQL with a unique port:
   - migrations 0001→0019;
   - the DB guards fire;
   - `contract.test.ts` green (161 ops routed);
   - `blank-text.test.ts` green.
4. e2e with the pre-installed Chromium, `--workers=1` and a unique port:
   - The P1 and P2 journeys, plus `apps/web/e2e/p2-blank-text.spec.ts`, pass in **chromium-en and chromium-ar**, including Define→G2 and Design→G3.
   - axe reports no serious or critical violations, including in the error states.
   - Run your acceptance journey (`e2e/support/qa-stack.sh`) and your blank-text negative checks.
5. Register and pipeline: `node tools/gates/validate.mjs --register DG2`, `--pipeline` and `--reconcile`.

## Requirements to check (record EXACTLY these — all 32)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

## Environmental residuals — NOT BLOCKED gate checks
Record these as PASS on the offline/config surface and note the residual: live registry (D-057), live CI (D-058) and Keycloak (D-049). Never record them as BLOCKED gate checks.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-4/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-4/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`;
- `round: 4`;
- `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if both your findings verify CLOSED, every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-220 to F-DG2-229**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160 and 201-211 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-4/qa-verifier.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` field for field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-4/qa-verifier.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
