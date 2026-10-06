# DG2 gate review — qa-verifier (round 9)

Task ID: `T-DG2-REV-QA-R9`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:45ebccc04d8efc0c4fdc6a842eb3c9ec330bab2ec517b1c592af60b05a066294`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (544 files).
- **manifest:** `docs/delivery/candidates/DG2/45ebccc04d8efc0c.manifest.json`.
- **source_commit:** `7854770e`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Verify your round-8 finding on THIS candidate
**F-DG2-340 (Low, REQ-PB-029).** Claimed fix (FE8 `e3cadfa`, `apps/web/src/components/RecordForm.tsx` and the forms swept in its handback):
- A form-level validation problem shows its localized message **once**, in one live region, in EN-LTR and AR-RTL.
- A genuinely different second message is still shown.
- Field-pointer errors stay attached to their fields.

To verify:
1. Re-run your round-8 spec R8-05 (`docs/delivery/test-evidence/DG2/qa/tests/round-8/e2e/dg2-qa-r8.spec.ts`) against this candidate in chromium-en and chromium-ar.
2. Check the other forms and dialogs FE8 swept (charter, GateDetailPage, JourneysSection, RowActions, ReasonDialog, the P1 admin forms) for the same double rendering.

Write `docs/delivery/reviews/DG2/round-9/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"` with the reason.

## Also new since round 8 (D-069): regression focus
- Every operation now accepts only its declared request media types. Anything else is a declared 400 `validation.content_type` before the body is read. Examples:
  - `uploadEvidenceContent` sent `text/plain` or JSON;
  - a JSON operation sent `text/plain` or `application/octet-stream`.
  - A valid octet-stream upload still stores the exact bytes.
- Form-level error messages are deduplicated (FE8).

Run a **full regression** in **both locale settings**. Add your own negative checks:
- an evidence upload in an undeclared media type (nothing stored, no audit row);
- a valid binary upload whose downloaded bytes and sha256 match;
- Arabic/emoji text that still round-trips verbatim.

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
Write `docs/delivery/reviews/DG2/round-9/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-9/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 9`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`. **Every check that counts toward the verdict must be PASS. If a run fails, investigate and report it as a finding; do not leave a failed check in a PASS record.**
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if F-DG2-340 verifies CLOSED, every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-370 to F-DG2-379**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320 and 340 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-9/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-9/qa-verifier.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
