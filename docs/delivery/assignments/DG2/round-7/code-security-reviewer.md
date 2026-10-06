# DG2 gate review — code-security-reviewer (round 7)

Task ID: `T-DG2-REV-SEC-R7`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:ede1a9362bb276ce620e440bf9f6a599f6695d395b8e495eaefec30107b016de`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (532 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/ede1a9362bb276ce.manifest.json`.
- **source_commit:** `90439483`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-6 finding on THIS candidate — adversarially
**F-DG2-260 (Low, REQ-DLV-034).** Claimed fix (BE11 `cf9c653`):
- `hasInvalidCharacter` (`packages/shared/src/schemas/common.ts`) also matches lone UTF-16 surrogates (`/\p{Cs}/u`).
- The central request check and the shared schemas therefore refuse lone surrogates with 400 `validation.invalid_character` at the field pointer.
- `identityClaimsStorable` makes a lone surrogate in `iss` or `sub` follow the declared callback contract: 302 `/login?error=token_invalid`, plus a `session.login_failed` audit row, with no user, identity or session created.
- Display-name claims that contain an invalid character fall back to the next claim.
- Stored truncations cut on code-point boundaries (`truncateText`).

Re-run your round-6 repro. Then probe adversarially for any path that still stores, audits or returns something unfaithful or undeclared for strings that are not well-formed. Cover at least: headers, other claims, path and query values, and anything written to `audit_event`.

Write `docs/delivery/reviews/DG2/round-7/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- A genuine fix: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 6 (`git diff 51a692b1..90439483`, product code only). In particular:
- **BE11's sweep** (`access/assignments.ts`, `identity/sessions.ts`, `workflows/gates.ts`, `apps/worker/src/relay.ts`, the OIDC routes): no behaviour change other than code-point-safe truncation.
- **BE12's framework- and connection-level error handling** (`apps/api/src/modules/platform/framework-errors.ts`, `server.ts`):
  - the helmet options were extracted into `HELMET_OPTIONS` with the same values; confirm the CSP is unchanged;
  - error responses carry the same security headers;
  - no internals leak (the raw URL is no longer echoed);
  - `frameworkErrors` and `clientErrorHandler` cannot be abused to bypass authz or rate limiting.

D-067 documents 408 (request timeout) as a transport-level response outside the operation contract. Judge whether that is acceptable.

Run these, with real output. A missing tool or database is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24, including one run under moderate concurrent CPU load.
- The integration suite on a disposable PostgreSQL with a unique port, run **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Include `contract.test.ts` (161 ops), `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `encoding.test.ts`, and migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-7/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-7/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-7/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 7`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-260 verifies CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-290 to F-DG2-299**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231 and 260 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-7/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-6/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-7/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
