# DG2 round 6 — code-security-reviewer narrative (T-DG2-REV-SEC-R6)

**Verdict: PASS.**

- F-DG2-230 and F-DG2-231 are **CLOSED_VERIFIED**.
- One new **Low, non-mandatory** finding: **F-DG2-260**.
- Nothing Critical, High or mandatory is unresolved.
- Every required check ran and passed. The environmental residuals (live registry, live CI, Keycloak) are recorded on the offline and config surface, as the assignment directs.

## Candidate

- `sha256:bb3e75811631cbabef8f807972f36396e0be2cf7b1d1b1281fa2fdf16f52eb1f` (528 files). I recomputed it in the working tree and in a disposable clone, at both `51a692b1` and `bd2e809`.
- HEAD `bd2e809` is the freeze commit. It adds only the assignments, the manifest and `stages.json` on top of source commit `51a692b1`.
- Assignment sha256 `9c9fe5e5…` matches.

## F-DG2-230 (placeholders): CLOSED_VERIFIED

- My round-5 repro (part E), rerun unchanged, now passes in both database runs.
- The exhaustive sweep over 0..10FFFF shows the not-visible set is exactly WS ∪ Cc ∪ Cf ∪ Cs ∪ DI ∪ {U+2800, U+16FE4, U+1D159}: no residual and no over-blocking.
- Text with visible content keeps the placeholders verbatim, both at schema level and through the API.

## F-DG2-231 (U+0000): CLOSED_VERIFIED

- My three round-5 repros, rerun unchanged, now each return 400 `validation.invalid_character` at the field pointer. Nothing is written and nothing is audited.
- **Central check.**
  - It runs as a `preHandler`, so the rate limiter (onRequest) and authentication/CSRF (preValidation) run first: the probe saw 401 and 403.
  - It walks params, query and JSON values and keys iteratively, and never reads the octet-stream upload.
  - It does not reject legitimate text (`\0`, `%00`, U+0001, U+FFFD).
  - For an authorized-but-unpermitted caller, the 400 now comes before the handler's 403. It does not depend on whether the record exists (no oracle), and that matches the existing pre-authorization 400 for malformed JSON. **Observation only.**
- **db-errors.** The 22021/22P05 mapping has a fixed message and leaks no detail.
- **OIDC.**
  - A NUL in the callback query gives the declared 302 `invalid_request`.
  - A NUL in `sub` gives `token_invalid` and is audited.
  - A NUL in name or email falls through to the next claim.
  - The (iss, sub) binding, no roles at JIT, the session and the single-use login cookie are unchanged.
- **Real HTTP.** llhttp refuses NUL in headers and in the raw target, so no header-borne NUL reaches storage.
- **Contract.** The amendment is exactly 41 added `400: ValidationError` lines, and the count is still 161 operations. `contract.test.ts` (with the new malformed-input cases and the 161 assertion) passes in both runs.

## New finding

**F-DG2-260 (Low, REQ-DLV-034, non-mandatory).** A lone UTF-16 surrogate in the ID token's `sub` makes the OIDC callback answer an undeclared **400 problem JSON**, with no `session.login_failed` audit row.

- Cause: JSON.stringify keeps `\ud800` as an escape in `audit_event.changes` (jsonb), PostgreSQL raises 22P02, and the API maps that to 400.
- The input is issued by the trusted IdP, so an end user cannot trigger it.
- Everything rolls back and nothing leaks.

## Observations (no finding)

- On the main API, lone surrogates in free text are stored as U+FFFD: a silent replacement, never a 5xx.
- A lone surrogate that reaches jsonb directly (a journey step name) gets a declared but generic 400 `validation.format` at pointer "".

## Checks

All checks ran in disposable clones under `$TMPDIR` and on disposable PostgreSQL 16.13 clusters, which were deleted afterwards. All of them passed, with exit 0:

- build, typecheck, lint, openapi:lint (161 operations), no-cdn, format:check;
- unit tests on Node 22 and Node 24: 656/656 each, and again under load (loadavg ≈ 8 on 4 vCPU);
- integration, run twice:
  - LANG unset (SQL_ASCII cluster; the product's database is UTF8);
  - LANG=C.UTF-8;
  - each run: 31 files and 507/507 tests, 19 migrations applied, the AUD-403 sweep at 146/146;
- validate `--historical` for DG0 and for DG1.

Evidence is in `docs/delivery/test-evidence/DG2/code-security/round-6/`.

## Independence

I wrote this verdict before reading any other reviewer's round-6 record. I authored no DG2 implementation.
