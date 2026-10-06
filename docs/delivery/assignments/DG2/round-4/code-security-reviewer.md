# DG2 gate review — code-security-reviewer (round 4)

Task ID: `T-DG2-REV-SEC-R4`. You are the independent code and security reviewer. Re-review the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (521 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/29ced0ed896ab9bf.manifest.json`.
- **source_commit:** `e37f6ea4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- DG1 is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-3 finding on THIS candidate — adversarially
**F-DG2-160 (Low, REQ-PB-031): invisible-only free text counted as content.**

Claimed fix:
- **BE6 `35fb823`:** one shared predicate `hasVisibleContent` = `/[^\p{White_Space}\p{Cf}ᅟᅠㅤﾠ⠀]/u` in `packages/shared/src/schemas/common.ts`, behind `hasText`/`freeText`.
- **BE7 `1905041`:** the shared `name`/`reason` and the two inline reason parsers use it too. The sweep also moved the admin issuer check and the OIDC display-name fallback onto it.
- **FE5/FE6:** the web forms decide "blank" with the same `hasText`.

What to do:
- Re-run your round-3 repro (`docs/delivery/test-evidence/DG2/code-security/round-3/probes/zz-sec-r3-invisible.test.ts`) and the full Unicode matrix, API and schema.
- Probe for residual bypasses:
  - any P2 or P1 input that still decides blankness with `trim()`;
  - format characters outside `\p{Cf}` that render invisibly;
  - combining marks alone;
  - very long invisible strings (ReDoS or performance of the regex).

Write `docs/delivery/reviews/DG2/round-4/code-security-reviewer.verifications.json` as `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason in `note`.

## Re-review: no regression, plus checks
Re-inspect product changes since round 3: `git diff 9e13947e..e37f6ea4`, product code only.
- **The OIDC change** (`apps/api/src/modules/identity/oidc.ts`, display-name fallback). Confirm it affects only the display-name choice, never identity, session or authorization decisions.
- **The admin issuer check** (`apps/api/src/modules/admin/routes.ts`).
- **The shared `reason` reuse** in `register-kit.ts` and `evidence/routes.ts`. The archive/remove paths keep authz, If-Match/409 and audit, and a 400 writes nothing.
- **The web form changes** (RecordForm, CharterPage, GateDetailPage, JourneysSection, RowActions, ReasonDialog, Form.tsx). Check that no form can now send a request the server should refuse, and that client-side validation is never the only guard. The server must still refuse blank input.

Run with real output. A missing tool or DB is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** 24, including once under moderate concurrent CPU load (your F-DG2-143 repro)
- the integration suite on a disposable PostgreSQL with a unique port, run **twice**, including `contract.test.ts` (161 ops), `blank-text.test.ts` and migrations 0001→0019
- the AUD-403 sweep
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-4/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, with a note naming the residual:
- live registry (REQ-DLV-042 AC-1, D-057);
- live CI (REQ-DLV-025 A24, D-058);
- Keycloak (D-049).

A BLOCKED check fails the gate round.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-4/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-4/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`;
- `round: 4`;
- `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-160 verifies CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-180 to F-DG2-189**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160 and 201-211 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-4/code-security-reviewer.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-3/code-security-reviewer.findings.json` field-for-field.

Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (an array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-4/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
