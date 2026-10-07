# DG2 gate review — qa-verifier (round 12)

Task ID: `T-DG2-REV-QA-R12`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (552 files).
- **manifest:** `docs/delivery/candidates/DG2/5dfecce44b9d7d4d.manifest.json`.
- **source_commit:** `8488e7a4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-11 finding on THIS candidate
**F-DG2-430 (Low).** Claimed fix (FE9 `644198a`): `RecordForm` reports value changes outside the state updater. A web unit-test guard fails any test that prints a React "Cannot update a component" or act() warning. Any other side-effecting updater found in the sweep was fixed the same way.

To verify:
1. Run `pnpm test` on Node 22 and Node 24 in both locale settings. Grep every log for `Cannot update a component`; it must find nothing.
2. Check the Team assign dialog's role-accountability preview in EN and AR.
3. Check that the guard catches a reintroduced violation.

Write `docs/delivery/reviews/DG2/round-12/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Also new since round 11 (D-072): regression focus
BE17 (`eb455d3`) changed the evidence upload into three phases:
1. checks;
2. the body received while holding no database connection;
3. a short write transaction that re-checks If-Match.

It also bounded the database pool: checkout waits at most 10 s, and an idle-in-transaction session is ended after 30 s. And it made an incomplete request body the declared 400 on every route.

Run a **full regression** in **both locale settings**. Add your own negative checks:
- an upload whose item is edited during the body gets 409, with nothing stored;
- a slow or stalled upload does not block other users' requests or `/readyz`;
- an aborted JSON body gets no 500 and no error-level log;
- a normal binary upload is stored byte-exact and its sha256 matches;
- Arabic/emoji text still round-trips verbatim;
- the R8-05 form-error spec still shows each message once.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

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
   - `invalid-utf8.test.ts`;
   - `media-types.test.ts`;
   - the evidence tests.
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
Write `docs/delivery/reviews/DG2/round-12/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-12/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 12`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`. **Every check that counts toward the verdict must be PASS. If a run fails, investigate and report it as a finding; do not leave a failed check in a PASS record.**
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if F-DG2-430 verifies CLOSED, every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-460 to F-DG2-469**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412 and 430 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-12/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-12/qa-verifier.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
