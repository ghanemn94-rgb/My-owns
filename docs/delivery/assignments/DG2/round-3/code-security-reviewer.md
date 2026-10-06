# DG2 gate review — code-security-reviewer (round 3)

Task ID: `T-DG2-REV-SEC-R3`. You are the independent code and security reviewer. Re-review the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:b98c44db7ef91295eec25a21cbd394a91890b01caeeb6bfd269eb1ee6d132be5`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (519 files). Use a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/b98c44db7ef91295.manifest.json`.
- **source_commit:** `9e13947e`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, and 22.22.2 at `/opt/node22/bin`.
- DG1 is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-2 finding on THIS candidate — adversarially
**F-DG2-143 (Low, REQ-S16-001): flaky required unit check.**

Claimed fix:
- BE4 `05abd88` added an explicit 30 s timeout (`AST_TEST_TIMEOUT_MS`, `apps/api/src/architecture.testkit.ts`) to every AST-walking boundary test (`architecture.test.ts` and the per-module boundary tests). The global unit default is unchanged.
- BE5 `c65fcc3` removed a real-time retry back-off that made `apps/web/src/pages/transformations/transformations.test.tsx` take about 3.2 s. It now runs with `retryDelayMs: 0` and has an explicit timeout.

What to do:
- Re-run your round-2 repro: `pnpm test` under moderate concurrent CPU load, for example while a second clone builds.
- Check that no unit test without an explicit timeout is within 2x of it. Use `--reporter=verbose` on Node 22 and 24.

Write `docs/delivery/reviews/DG2/round-3/code-security-reviewer.verifications.json` as `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason in `note`.

## Re-review: no regression, plus checks
Re-inspect what changed since round 2 (diff `eb8163e2..9e13947e`, product code only).
- **Blank-text hardening (D-063).** The shared `freeText()` and `hasText()` in `packages/shared/src/schemas/common.ts` are now used in every P2 schema.
  - Look for any P2 input route that bypasses the shared schemas, for example partial PATCH merges or query/filter params.
  - Test Unicode whitespace.
  - A 400 must write nothing and leave no audit row.
- **Readiness.** `apps/api/src/modules/workflows/criteria.ts` (G1-G3) and the charter pre-checks now use `hasText`.
- **Exclusions pre-check.** It now returns `attention`. Confirm that authz, If-Match/409 and audit are unchanged.
- **The web retry test change.** Check that the assertion was not weakened.

Run these with real output. A missing tool or DB is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 and on Node 24.
- The integration suite on a disposable PostgreSQL with a unique port, run **twice**, including `contract.test.ts` (161 ops) and migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-3/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, and note the residual:
- the live registry (REQ-DLV-042 AC-1, D-057);
- live CI (REQ-DLV-025 A24, D-058);
- Keycloak (D-049).

A BLOCKED check fails the gate round.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-3/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-3/code-security-reviewer.md` (bare path);
- `candidate_id` above;
- `reviewer_role: code-security-reviewer`;
- `round: 3`;
- `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-143 verifies CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-160 to F-DG2-169**, used in order. Never reuse another id. Other reviewers have their own ranges; 140-152 and 201-206 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-3/code-security-reviewer.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-2/code-security-reviewer.findings.json` field for field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`, `stage_id` ("DG2"), `requirement`
- `severity` (Critical|High|Medium|Low), `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer"), `reported_in` ("docs/delivery/reviews/DG2/round-3/code-security-reviewer.json")
- `owner` (an implementer role), `status` ("OPEN"), `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
