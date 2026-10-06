# DG2 gate review — qa-verifier (round 5)

Task ID: `T-DG2-REV-QA-R5`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:2f81c60ab1347986b3a2c31f8cd7642e0f8e4c0b6de59f1636f05268f3558c46`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (526 files).
- **manifest:** `docs/delivery/candidates/DG2/2f81c60ab1347986.manifest.json`.
- **source_commit:** `96a3c293`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-4 finding on THIS candidate (you raised it)
**F-DG2-220 (Low, REQ-DLV-034): the required unit check was flaky.**

Claimed fix (FE7 `6946a1e`):
- `apps/web/test/setup.ts` sets `configure({ asyncUtilTimeout: 5000 })`.
- The unit-web `testTimeout` is 20 s, with a guard test `apps/web/src/test/harness-config.test.ts`.
- `p2-blank-forms.test.tsx` page loads are cheaper.

Re-run your round-4 procedure and add repetition:
- `pnpm test` at least **8 times on Node 24** and **4 times on Node 22**;
- plus **2 runs under moderate concurrent CPU load**.

Every run must be green. Report each tally.

Write `docs/delivery/reviews/DG2/round-5/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Also new since round 4 (D-065): regression focus
- The product now **refuses a non-UTF8 database**: `mth-db` migrate/status/bootstrap/seed-dev exit 1, and `/readyz` reports `database: fail`.
- Every disposable test cluster and database is explicitly UTF8 (`initdb --encoding=UTF8 --locale=C`; `CREATE DATABASE … ENCODING 'UTF8' TEMPLATE template0`). This includes your `tests/qa/support/with-pg.sh` and `e2e/support/qa-stack.sh`.
- Run the integration and e2e suites **in both locale settings**: `LANG`/`LC_ALL` unset, and `LANG=C.UTF-8`.
- Include a negative check of your own: a database created with `ENCODING 'SQL_ASCII'` is refused by `mth-db migrate`, and nothing is created.
- The visible-content rule now also excludes Cc, Cs and Default_Ignorable code points (F-DG2-180). Re-run your blank-text negative checks in EN and AR. Add one invisible-only case, such as a variation selector alone, in a charter field.

## Execute (real output; a missing tool or database is BLOCKED)
1. Build and static checks:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint` (161 ops)
   - `pnpm check:no-cdn`
   - `pnpm format:check`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. Unit tests: the repeated `pnpm test` runs above.
3. Integration on a disposable PostgreSQL (unique port), **once per locale setting**:
   - migrations 0001→0019;
   - DB guards;
   - `contract.test.ts` (161 ops routed);
   - `blank-text.test.ts`;
   - `encoding.test.ts`.
4. e2e (pre-installed Chromium, `--workers=1`, unique port), **once per locale setting**:
   - the P1 and P2 journeys plus `apps/web/e2e/p2-blank-text.spec.ts`, in **chromium-en and chromium-ar**, including Define→G2 and Design→G3;
   - axe with no serious or critical violations, error states included;
   - your acceptance journey (`e2e/support/qa-stack.sh`), with the `server_encoding` line in the log.
5. Register and pipeline: `node tools/gates/validate.mjs --register DG2`, `--pipeline` and `--reconcile`.

## Requirements to check (record EXACTLY these — all 32)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, and note the residual. None is ever a BLOCKED gate check:
- live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-5/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-5/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 5`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`. **Every check that counts toward the verdict must be PASS. If a run fails, investigate and report it as a finding; do not leave a failed check in a PASS record.**
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if F-DG2-220 verifies CLOSED, every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-250 to F-DG2-259**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181 and 201-220 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-5/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-4/qa-verifier.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-5/qa-verifier.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
