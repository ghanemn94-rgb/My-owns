# DG2 gate review — code-security-reviewer (round 11)

Task ID: `T-DG2-REV-SEC-R11`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:23e6c0a2834d2f255410e23197864ce283979964128791cfafc3e7075c7f7bad`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (547 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/23e6c0a2834d2f25.manifest.json`.
- **source_commit:** `cbdb4f68`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Triage and verify the release-auditor's defect — adversarially
The round-10 release-auditor BLOCKED the gate (`docs/delivery/gates/DG2.json`, blocking conditions; evidence under `docs/delivery/test-evidence/DG2/audit/round-11/`). It reproduced a product defect that no specialist had triaged:
- A 30 MiB **chunked** over-limit upload to `uploadEvidenceContent` over a real socket gets 413 `evidence.too_large`.
- The server **does not close the connection**. It holds the socket about 65 s after the client has destroyed it.
- `app.close()`, which SIGTERM also runs, therefore stalls about 65 s.
- The defect predates BE15.
- It is also why your round-10 probe's `afterAll(() => api.close())` hook timed out, a failure your round-10 record did not disclose.

The auditor cannot raise findings. You are the specialist who triages this one:
1. **Reproduce it** on the round-10 candidate `7fd1a89c` (source `fe22d75`) in a disposable clone.
2. **Raise it as a finding** in your id range, with your own severity and mandatory classification and your reproduction at `7fd1a89c`. Status is `OPEN`, as always when raising. If you judge it not a defect, say why, with evidence; do not raise it.
3. **Verify the claimed fix on THIS candidate**, adversarially. The fix was made before the freeze. The claim is BE16 `258b7e5`: the round-10 behaviour has this root cause. The upload's async iterator detaches the socket before destroying the request, so the HTTP parser `readStop()`s a socket that is never read again. It survives until `keepAliveTimeout` (72 s). `forceCloseConnections: "idle"` skips it, so `app.close()` waits.

The fix is in `apps/api/src/modules/platform/connection-hygiene.ts`, `server.ts`, `main.ts` and `evidence/routes.ts`:
- an `onSend` hook sets `Connection: close` on any response sent while `request.raw.complete` is false, and `frameworkErrors` does the same;
- a bounded lingering close replaces Node's `destroySoon` for those sockets only: FIN after the flush, destroy after 500 ms, hard cap 2 s;
- `preClose` marks the instance as closing and starts a 5 s grace, then calls `closeAllConnections()`. `main.ts` has a backstop exit;
- `requestTimeout` is 300 s and is passed to `http.createServer`, so a stalled body gets 408;
- a client abort mid-upload gets the declared 400 instead of a 500.

The fix also covers a sibling defect: when a request was refused before its body was read, `_dump()` drained the whole body without limit. Unmatched routes are now rate-limited. ADR-0007 §5b records the unmatched-route 429 as out of contract by design.
4. **Probe the whole class.** Look for any other path where the server answers before consuming a body and leaves a socket open, or where shutdown stalls. Unmatched-route rate limiting is new in BE16; check that it neither breaks the SPA fallback nor bypasses CSRF or authorization.

Write `docs/delivery/reviews/DG2/round-11/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, with an entry for the finding you raise:
- if the fix is genuine on this candidate: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

The orchestrator records the fix commit on the finding after import.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 10 (`git diff fe22d759..cbdb4f68`, product code):
- **The connection and shutdown change (BE16).**
  - It must not weaken any of these: `bodyLimit`; the evidence upload's streaming size limit and its sha256 over the raw bytes; the strict UTF-8 JSON parser; the media-type decision (D-070); CSRF; authorization; rate limiting.
  - A normal keep-alive client must keep its connection after a 200.
  - Bounded shutdown must not cut off in-flight requests that would complete normally, beyond the policy BE16 documents.
  - Overriding Node's undocumented `socket.destroySoon` for the affected sockets must be safe. Check its fallback.
- **The F-DG2-206 owner record correction (D-071).** It is a records change only. Confirm it matches the fix commit `ee46813`.

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
  - BE16's connection/shutdown tests;
  - `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`;
  - the evidence tests;
  - migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-11/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-11/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-11/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 11`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if the auditor's defect is triaged and, if raised, its fix verifies CLOSED on this candidate, every cited log's failures are disclosed and explained, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-410 to F-DG2-419**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340 and 350-351 are taken (all closed).

If you raise findings, write `docs/delivery/reviews/DG2/round-11/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-11/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
