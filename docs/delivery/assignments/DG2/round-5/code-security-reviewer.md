# DG2 gate review — code-security-reviewer (round 5)

Task ID: `T-DG2-REV-SEC-R5`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:2f81c60ab1347986b3a2c31f8cd7642e0f8e4c0b6de59f1636f05268f3558c46`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (526 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/2f81c60ab1347986.manifest.json`.
- **source_commit:** `96a3c293`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-4 findings on THIS candidate — adversarially
- **F-DG2-180 (Low, REQ-PB-031).**
  - **Claimed fix (BE8 `9b4ded0`):** the single shared predicate in `packages/shared/src/schemas/common.ts` is now `/[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀]/u`.
  - **To do:** re-run your round-4 repro and the full Unicode matrix through the schema and the API, covering Out of scope, reason and name. Probe for anything else that renders as nothing but still counts as content. Confirm that text with visible content keeps its marks: an emoji with VS16, Arabic with RLM, combining marks.
- **F-DG2-181 (Low, REQ-S16-007).**
  - **Claimed fix:** `apps/api/src/modules/identity/oidc.ts` `displayNameCandidate` truncates to 200 code points first, then applies `hasText`, then falls back to `preferred_username`, then `email`, then a generated name.
  - **To do:** re-run your repro. Confirm that identity, session and authorization behaviour is unchanged (binding stays on (iss, sub)).

Write `docs/delivery/reviews/DG2/round-5/code-security-reviewer.verifications.json` as `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- A genuine fix: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 4: `git diff e37f6ea4..96a3c293`, product code only. In particular, **the new UTF8 database requirement (BE9 `786f574`, D-065):**
- `packages/db/src/encoding.ts`, and its use in `migrate()` and the `mth-db` CLI. It must refuse a non-UTF8 database before any lock, table or migration.
- `/readyz` (`apps/api/src/modules/platform/health.ts`). Check that the positive-result cache cannot mask a later change, that the not-ready path writes nothing, and that it does not leak internals.
- The deploy changes: `deploy/compose/compose.yaml` `POSTGRES_INITDB_ARGS`, `db-init/10-mth-roles.sh` and `deploy/scripts/ci-e2e-stack.mjs`. Check that no secret is exposed and that no privilege changes.
- The test-cluster scripts, which now run `initdb --encoding=UTF8 --locale=C`.

Run these, with real output. A missing tool or database is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24, including one run under moderate concurrent CPU load.
- The integration suite on a disposable PostgreSQL with a unique port, run **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Include `contract.test.ts` (161 ops), `blank-text.test.ts`, `oidc.test.ts`, the new `packages/db/test/integration/encoding.test.ts`, and migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-5/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-5/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-5/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 5`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-180 and F-DG2-181 verify CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-230 to F-DG2-239**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181 and 201-220 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-5/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-4/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-5/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
