# DG2 gate review — code-security-reviewer (round 13)

Task ID: `T-DG2-REV-SEC-R13`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:6824b8b8d36a688178a058c11c4882737a79cf7f39b438dcf2390eafb88d3afc`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (556 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/6824b8b8d36a6881.manifest.json`.
- **source_commit:** `aa0a68f1`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-12 findings on THIS candidate — adversarially
**F-DG2-440 (Medium) and F-DG2-441 (Low).** Claimed fix: BE18A `8c0083e` (D-073).
- **F-440.**
  - Phase 3 of the upload re-authorises inside its write transaction, through the identity module's own resolution:
    - the session must still be active (not revoked, logged out, idle- or absolute-expired, and the user not disabled); otherwise 401;
    - the grants are reloaded and the policy is re-run; otherwise 403, with the denied-mutation audit.
  - The received object is discarded on refusal.
  - The stated residual window is the few milliseconds of phase 3's own transaction.
- **F-441.**
  - `/auth/login` resolves OIDC discovery (`prepareLogin`) before any transaction. `saveLoginState` then runs in a short transaction.
  - An AST sweep of every `await` inside a transaction or a checked-out client found no other non-database await. The evidence finalise `rename` is the documented exception.
- **Also changed in BE18A (qa's F-DG2-460, which qa verifies).**
  - Graceful shutdown waits, bounded at 3 s, for in-flight handlers to settle before `db.destroy()`.
  - The filesystem store sweeps `.part` temporaries older than 1 h at start-up.

Re-run your round-12 probes on this candidate (`zz-sec-r12-probe.test.ts` Q1/Q1b, `zz-sec-r12-oidc-probe.test.ts`). Then probe both classes adversarially:
- any remaining write that commits on stale authority: a session or grant change at each phase boundary, a role downgrade rather than a revocation, a transformation archived mid-body, or a re-grant race;
- any other remote or slow call inside a transaction;
- whether the shutdown settle-wait or the start-up sweep opens a new hole:
  - the sweep deleting a live temporary on shared storage;
  - symlinks or path traversal in the sweep;
  - a stuck handler delaying shutdown past the backstop.

Write `docs/delivery/reviews/DG2/round-13/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, with one entry per finding (F-DG2-440, F-DG2-441):
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 12 (`git diff fe22d759..cbdb4f68`, product code):
- **The commit-time authorisation, OIDC and shutdown/sweep changes (BE18A).**
  - They must not weaken authorization, CSRF, optimistic concurrency, the audit trail, the evidence size limit or the raw sha256, BE16/BE17's connection and pool behaviour, or the OIDC login and callback (state, nonce, PKCE, binding).

Run these, with real output. A missing tool or database is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24, including one run under moderate concurrent CPU load.
- The integration suite on a disposable PostgreSQL, run **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Use ports below 32768; the harnesses retry on collision. Include:
  - `contract.test.ts` (161 ops);
  - `media-types.test.ts`;
  - BE16's connection/shutdown tests, and BE17's `request-io.test.ts` and `packages/db/test/integration/pool-bounds.test.ts`, and BE18A's `commit-time-auth.test.ts` and `shutdown-cleanup.test.ts`;
  - `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`;
  - the evidence tests;
  - migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-13/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-13/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-13/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 13`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-440 and F-DG2-441 verify CLOSED, every cited log's failures are disclosed and explained, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-470 to F-DG2-479**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412, 430, 440-441 and 460 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-13/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-13/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
