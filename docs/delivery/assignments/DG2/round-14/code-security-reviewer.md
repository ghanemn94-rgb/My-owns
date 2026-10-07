# DG2 gate review — code-security-reviewer (round 14)

Task ID: `T-DG2-REV-SEC-R14`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:9f3ca298d029f691330de1eddab806df57d5876307926b50df0312f8882b684e`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (560 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/9f3ca298d029f691.manifest.json`.
- **source_commit:** `ea9051b2`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Context
Your round-12 findings F-DG2-440 and F-DG2-441 are CLOSED_VERIFIED, and you have **no open finding to verify**, so do not write a `.verifications.json`.

Since round 13 the product changes are web only (D-074). FE10 `8cb3bb8` repairs the domain finding F-DG2-480. FE11 `59d38ad` makes the language-not-saved notice speak the language the user now sees. FE12 `7f03453` translates every notice or error at render time and moves that notice out of the header. Both close gaps flagged in handbacks. Before it, a session that ended while the app was open made the web client loop between `/login?error=session_expired` and the page, because the login page trusted a stale cached `/me`. A stuck tab sent about 130 `/me` requests per second and could exhaust the per-IP rate-limit bucket.

Probe the security side of the change adversarially:
- **`returnTo` handling.** No open redirect, no protocol-relative or `javascript:` URL, no cross-origin target.
- **Session-end handling.** A 401 clears every cached identity and session-scoped query. A 403 is never treated as a session end.
- **No leakage.** A signed-out user never sees a stale signed-in shell or cached data from the previous session.
- **Bounded requests.** The client cannot be driven into a request storm against the API or the per-IP limiter.
- **No regression in the API** from rounds 9-13: media types, connection hygiene, pool, commit-time authorisation, OIDC and shutdown. Re-run your round-13 probes as a regression.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 13 (`git diff fe22d759..cbdb4f68`, product code):
- **The session-end handling change (FE10, web only).** It must not weaken the sign-in or sign-out flow, CSRF, the OIDC `returnTo` handling, or the bilingual error messages.

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

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-14/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-14/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-14/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 14`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if every cited log's failures are disclosed and explained, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-500 to F-DG2-509**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412, 430, 440-441, 460 and 480 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-14/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-14/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
