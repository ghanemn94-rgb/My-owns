# DG2 gate review — code-security-reviewer (round 6)

Task ID: `T-DG2-REV-SEC-R6`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:bb3e75811631cbabef8f807972f36396e0be2cf7b1d1b1281fa2fdf16f52eb1f`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (528 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/bb3e75811631cbab.manifest.json`.
- **source_commit:** `51a692b1`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-5 findings on THIS candidate — adversarially

- **F-DG2-230 (Low, REQ-PB-031).**
  - **Claimed fix** (BE10 `e057bf8`): U+16FE4 and U+1D159 were added next to U+2800 in the single shared predicate (`packages/shared/src/schemas/common.ts`).
  - **To do:** re-run your round-5 repro and your exhaustive code-point sweep through the schema and the API (Out of scope, reason, name). Confirm there is no residual. Confirm that text with visible content keeps its marks.
- **F-DG2-231 (Low, REQ-DLV-034).**
  - **Claimed fix:** BE10 `e057bf8` and ARCH-02 `a1e748b`.
    - A central request check (`apps/api/src/modules/platform/validation.ts`/`hooks.ts`) refuses any string with U+0000 in the body, query or params. It returns 400 `validation.invalid_character` at the pointer, writes nothing and adds no audit row.
    - The shared `freeText`/`name`/`reason` refuse it too.
    - `db-errors` maps SQLSTATE 22021/22P05 to 400.
    - The OIDC callback refuses it through its declared 302 `invalid_request`. A NUL `iss`/`sub` gives `token_invalid` (audited). A NUL User-Agent is not stored.
    - ARCH-02 declared the 400 on the 41 operations that lacked it (still 161), and path-param pointers now name the parameter.
  - **To do:**
    - Re-run your three round-5 repros.
    - Probe for any path that still returns 500 or an undeclared status for input the database cannot store: other characters PostgreSQL rejects, headers that reach audit, and OIDC claims.

Write `docs/delivery/reviews/DG2/round-6/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- For a genuine fix: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 5 (`git diff 96a3c293..51a692b1`, product code only). In particular:
- the central U+0000 check: it must not bypass authz or rate limits, and must not reject legitimate input;
- the OIDC callback changes (`apps/api/src/modules/identity/routes.ts`, `oidc.ts`): identity, session and authorization behaviour must be unchanged;
- the `db-errors` mapping: it must not leak internals;
- the contract amendment (`docs/api/openapi.yaml`, 41 operations gain 400) and the new contract tests (`apps/api/test/integration/contract/malformed-input.ts`).

Run these, with real output. A missing tool or database is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24, including one run under moderate concurrent CPU load.
- The integration suite on a disposable PostgreSQL with a unique port, run **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Include `contract.test.ts` (161 ops), `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `encoding.test.ts`, and migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-6/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-6/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-6/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 6`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-230 and F-DG2-231 verify CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-260 to F-DG2-269**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220 and 230-231 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-6/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-5/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-6/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
