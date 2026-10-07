# DG2 gate review — code-security-reviewer (round 17)

Task ID: `T-DG2-REV-SEC-R17`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (564 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/ddaab3cc264b0e13.manifest.json`.
- **source_commit:** `805da3e2`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-15 finding on THIS candidate — adversarially
**F-DG2-530 (Low).** Your round-16 verification FAILED it for the class. The failing case was Y1: the create flow navigated B to A's new record after its post-create `/me`. Claimed fix: FE15 `ac81298` (D-077, web only). The session generation is captured at the start of every user action. It is re-checked after every `await`, before any `setQueryData`, `navigate`, router state or render effect, through one mechanism that is used everywhere (see the handback's sweep). An identity change is now also detected on in-app navigation, not only on refocus, so the header, the permissions and the data belong to one identity.
The same class also covers domain's F-DG2-570 (in-app navigation within the fresh window) and qa's F-DG2-580 (the create path on the real stack). Those reviewers verify their own findings.

To verify:
1. Re-run your round-16 probe (`docs/delivery/test-evidence/DG2/code-security/round-16/probes/zz-sec-r16-web-probe.test.tsx`, Y1/Y1c/Y4/Y5) and your round-15 probe (X1-X7) on this candidate.
2. Probe the class again for any remaining path where an effect of a request or action started under one identity lands under another, after any number of awaits.
3. Confirm FE10/FE13/FE14 guarantees hold.

   **Documented residual (D-077); challenge it with a reproduction if you judge it unacceptable.** A page GET that is not a navigation (a filter, a page of results, a refetch after the user's own write), sent less than 2 s after the last `/me` and less than 2 s after another tab signed someone else in, can still be fetched under the new cookie under the previous header. It ends at the next navigation, the next GET after the window, or a refocus. Navigations have no window.

Write `docs/delivery/reviews/DG2/round-17/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 16 (`git diff fe22d759..cbdb4f68`, product code):
- **The per-action generation guard and navigation-time identity check (FE15, web only).** It must not weaken the sign-in or sign-out flow, CSRF, the OIDC `returnTo` handling, the bilingual messages, or FE10 to FE14. A normal write that finishes under the same identity must still update the cache and navigate.

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

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-17/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-17/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-17/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 17`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-530 verifies CLOSED, every cited log's failures are disclosed and explained, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-590 to F-DG2-599**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412, 430, 440-441, 460, 480, 500, 530, 570 and 580 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-17/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-17/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
