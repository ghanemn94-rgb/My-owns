# DG2 gate review — qa-verifier (round 8)

Task ID: `T-DG2-REV-QA-R8`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:9331e9d13e0ffa55f35ebc25ecdf9b60e159876dc2470fe56e9241a40fea124f`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (539 files).
- **manifest:** `docs/delivery/candidates/DG2/9331e9d13e0ffa55.manifest.json`.
- **source_commit:** `cf3446e4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-7 finding on THIS candidate
**F-DG2-310 (Low, REQ-DLV-034).** Claimed fix (DEVOPS3 `4e3c446`):
- A shared port policy in `tests/qa/support/pg-port.sh`. Every disposable-cluster harness (`with-pg.sh`, `with-stack.sh`, `qa-stack.sh`, `a18-clean-start.sh`, `clean-start-local.sh`) defaults to a port below 32768 (24331/24340/24351/24361/24371).
- A bounded, logged retry on EADDRINUSE for PostgreSQL and the API. `*_STRICT_PORT=1` disables it.
- Exported URLs follow the port that was actually used.
- `tests/qa/support/port-collision-check.sh` reproduces the TIME_WAIT collision.

To verify:
1. Re-run your round-7 collision repro (`11-port-collision-repro.py`) against the new harnesses.
2. Run `port-collision-check.sh`.
3. Run the integration suite **at least 3 times per locale setting**, keeping every full log. Every run must start.

Write `docs/delivery/reviews/DG2/round-8/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"` with the reason.

## Also new since round 7 (D-068): regression focus
- Request bodies that are not valid UTF-8, sent with Content-Length or chunked, now get the declared 400 `validation.json`. Query strings with undecodable percent sequences now get 400 `validation.format`.
- The contract now declares 429 on every operation. A rule test enforces the platform statuses.

Run a **full regression** in **both locale settings**. Add your own negative checks: an invalid-UTF-8 body, a `?q=%FF` query, and Arabic/emoji text that still round-trips verbatim.

## Execute (real output; a missing tool or database is BLOCKED)
1. Build and static checks:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint` (161 ops)
   - `pnpm check:no-cdn`
   - `pnpm format:check`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. Unit tests: `pnpm test` on Node 22 and Node 24, at least 3 times each, plus once under moderate CPU load.
3. Integration on a disposable PostgreSQL (unique port), **at least 3 times per locale setting** (see above):
   - migrations 0001→0019;
   - DB guards;
   - `contract.test.ts` (161 ops routed);
   - `blank-text.test.ts`;
   - `encoding.test.ts`;
   - `invalid-character.test.ts`;
   - `framework-errors.test.ts`;
   - `invalid-utf8.test.ts`.
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
Write `docs/delivery/reviews/DG2/round-8/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-8/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 8`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`. **Every check that counts toward the verdict must be PASS. If a run fails, investigate and report it as a finding; do not leave a failed check in a PASS record.**
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if F-DG2-310 verifies CLOSED, every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-340 to F-DG2-349**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181, 201-220, 230-231, 260, 290 and 310 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-8/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-8/qa-verifier.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
