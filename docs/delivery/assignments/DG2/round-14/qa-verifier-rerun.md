# DG2 gate review — qa-verifier (round 14)

> **Re-run.** Your first round-14 run (`DG2-T-DG2-REV-QA-R14-qa-verifier-20261007T100759Z-a3e1cd3d`) was killed by a container restart before it wrote a record. Its transcript and partial evidence were moved to `docs/delivery/test-evidence/DG2/qa-r14-orphaned/` for provenance only. Do not cite them; produce all evidence afresh under `docs/delivery/test-evidence/DG2/qa/round-14/`. Everything else in this assignment is unchanged.

Task ID: `T-DG2-REV-QA-R14`. You are the independent QA verifier. Re-verify the **repaired** DG2 candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:9f3ca298d029f691330de1eddab806df57d5876307926b50df0312f8882b684e`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (560 files).
- **manifest:** `docs/delivery/candidates/DG2/9f3ca298d029f691.manifest.json`.
- **source_commit:** `ea9051b2`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- DG1 is APPROVED; `validate --historical --stage DG1` must pass.

## Context
Your round-12 finding F-DG2-460 is CLOSED_VERIFIED, and you have **no open finding to verify**, so do not write a `.verifications.json`.

## New since round 13 (D-074): regression focus
FE10 (`8cb3bb8`, web only) repairs the domain finding F-DG2-480. When a session ended while the app was open, the client looped between sign-in and the page:
- the page was blank;
- it sent about 130 `/me` requests per second;
- with the default limits, the per-IP bucket ran out.

Now a 401 clears the cached identity and lands the user once on sign-in, with the localized message and a bounded number of `/me` requests.

Run a **full regression** in **both locale settings**. Add your own negative checks:
- sign-out in another tab, then an in-app navigation: one landing on sign-in with the message, EN and AR;
- an upload refused with 401 after revocation: the dialog shows its message, then sign-in;
- the same with the product's default rate limits: no 429, and a second context from the same IP can sign in;
- a 403 is never treated as a session end;
- a refused language-preference save (FE11 `59d38ad`): the notice matches the language shown, EN→AR and AR→EN, with `dir`/`lang` correct;
- a language switch while a notice or error is visible (FE12 `7f03453`) updates its text and direction, and the header layout holds at 320, 768 and 1280 px;
- every earlier R8-R13 regression spec still passes.

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
Write `docs/delivery/reviews/DG2/round-14/qa-verifier.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-14/qa-verifier-rerun.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 14`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`. **Every check that counts toward the verdict must be PASS. If a run fails, investigate and report it as a finding; do not leave a failed check in a PASS record.**
- `requirements_checked[]`: exactly the 32 ids;
- `findings[]`: only the ids of NEW findings;
- `verdict`: PASS only if every requirement is verifiable with evidence, nothing has regressed, and no Critical, High or mandatory finding is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-520 to F-DG2-529**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412, 430, 440-441, 460 and 480 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-14/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/qa-verifier.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("qa-verifier")
- `reported_in` ("docs/delivery/reviews/DG2/round-14/qa-verifier.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
