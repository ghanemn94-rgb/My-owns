# DG2 gate review — code-security-reviewer (round 12)

Task ID: `T-DG2-REV-SEC-R12`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (552 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/5dfecce44b9d7d4d.manifest.json`.
- **source_commit:** `8488e7a4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-11 findings on THIS candidate — adversarially
**F-DG2-411 (Medium, REQ-S16-013) and F-DG2-412 (Low, REQ-DLV-034).** Claimed fix: BE17 `eb455d3` (D-072).
- **F-411.** `uploadEvidenceContent` now runs in three phases:
  1. A short transaction runs the same checks in the same order and commits **before** any body byte is read.
  2. The body is received into the store's `.part` file **holding no connection**. The size limit and the raw-byte sha256 still apply.
  3. A short write transaction re-authorises, locks the row, **re-checks If-Match against the locked version** (409 on a concurrent edit), and inserts the content row and the audit event. The object is finalised before commit and discarded on any failure.
- **F-411, pool defence in depth.** `connectionTimeoutMillis` is 10 s, giving a bounded 503, which ADR-0007 §5b now lists as out of contract by design. `idle_in_transaction_session_timeout` is 30 s, and every client has an error listener.
- **F-412.** A central `isIncompleteBodyError` check in `mapError` gives the declared 400 `validation.malformed_request`, logged at info, for an incomplete body on any route. A real database reset stays a 500.

Re-run your round-11 probe R6/R8 (`zz-sec-r11-probe.test.ts`) on this candidate. Then probe the class adversarially. Look for:
- any remaining path that holds a pooled connection, transaction or row lock while it waits on the client;
- races in the three-phase upload: a TOCTOU between phase 1 and phase 3, a revoked grant, an archive during the body, an orphaned `.part` or final object, or a double revision;
- an over-match in the incomplete-body mapping, where a genuine fault gets hidden as a 400;
- any pool setting that breaks the worker, the migrate CLI or long legitimate transactions.

Write `docs/delivery/reviews/DG2/round-12/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, with one entry per finding:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 11 (`git diff fe22d759..cbdb4f68`, product code):
- **The three-phase upload and pool change (BE17), and the pure-updater change (FE9, web only).**
  - They must not weaken any of these: authorization, CSRF, optimistic concurrency, the audit event, the evidence size limit and raw sha256, BE16's connection hygiene and bounded shutdown, the media-type decision, or rate limiting.
  - The FE9 warning guard must not mask legitimate error output.

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
  - BE16's connection/shutdown tests, and BE17's `request-io.test.ts` and `packages/db/test/integration/pool-bounds.test.ts`;
  - `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`;
  - the evidence tests;
  - migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-12/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-12/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-12/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 12`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-411 and F-DG2-412 verify CLOSED, every cited log's failures are disclosed and explained, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-440 to F-DG2-449**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412 and 430 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-12/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-12/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
