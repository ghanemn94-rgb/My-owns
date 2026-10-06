# DG2 gate review — qa-verifier (round 3)

Task ID: `T-DG2-REV-QA-R3`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:b98c44db7ef91295eec25a21cbd394a91890b01caeeb6bfd269eb1ee6d132be5`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (519 files).
- **manifest:** `docs/delivery/candidates/DG2/b98c44db7ef91295.manifest.json`.
- **source_commit:** `9e13947e`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, and 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED. `validate --historical --stage DG1` must pass.

## Context
All six of your earlier findings, F-DG2-201 to 206, were CLOSED_VERIFIED in round 2. You have none to verify this round. Since round 2, these repairs changed the product:
- F-DG2-150: the B0041 exclusions pre-check fails on an empty or blank Out of scope.
- D-063: blank (whitespace-only) free text is rejected with 400 `validation.blank` on every P2 input, and G1-G3 readiness uses trimmed presence.
- F-DG2-151: gate titles show the B0023 name once.
- F-DG2-152 and its sweep: register `screen_api` corrections on 16 DG2 rows.
- F-DG2-143: unit-test timeout headroom.

Re-verify the whole stage against these changes, with **regression** as the focus. **Write no `.verifications.json` this round**, since you have no finding to verify.

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
3. Integration, run **twice** on a disposable PostgreSQL with a unique port:
   - migrations 0001→0019;
   - the DB guards fire;
   - `contract.test.ts` is green (161 ops routed);
   - `blank-text.test.ts` is green.
4. e2e (pre-installed Chromium, `--workers=1`, unique port): the P1 and P2 journeys are green in **chromium-en and chromium-ar**, including Define→G2 and Design→G3. axe reports no serious or critical violations. Run your acceptance journey too (`e2e/support/qa-stack.sh`). Add negative checks of your own, in EN and AR:
   - a whitespace-only value in a charter field and in a T01 field shows the localized blank-validation message and saves nothing;
   - an empty Out of scope shows the failing exclusions chip.
5. Register and pipeline:
   - `node tools/gates/validate.mjs --register DG2`
   - `node tools/gates/validate.mjs --pipeline`
   - `node tools/gates/validate.mjs --reconcile`

## Requirements to check (record EXACTLY these — all 32)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, and note the residual. None of them is ever a BLOCKED gate check:
- the live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-3/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-3/qa-verifier.md` (bare path).
- `candidate_id` as above.
- `reviewer_role: qa-verifier`, `round: 3`, `stage_id: DG2`.
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`.
- `requirements_checked[]`: exactly the 32 ids.
- `findings[]`: only the ids of NEW findings.
- `verdict`: PASS only if every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-210 to F-DG2-219**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152 and 201-206 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-2/code-security-reviewer.findings.json` field for field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-3/qa-verifier.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
