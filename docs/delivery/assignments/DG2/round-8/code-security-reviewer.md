# DG2 gate review — code-security-reviewer (round 8)

Task ID: `T-DG2-REV-SEC-R8`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:9331e9d13e0ffa55f35ebc25ecdf9b60e159876dc2470fe56e9241a40fea124f`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (539 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/9331e9d13e0ffa55.manifest.json`.
- **source_commit:** `cf3446e4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-7 finding on THIS candidate — adversarially
**F-DG2-290 (Low, REQ-DLV-034).** Claimed fix (BE13 `d9c3f5d`, `apps/api/src/modules/platform/request-encoding.ts`, `server.ts`):
- `application/json` is read as raw bytes (`parseAs: "buffer"`), so `bodyLimit` and the length check apply to raw bytes.
- The bytes are decoded with `TextDecoder("utf-8", { fatal: true })`, then parsed by Fastify's default JSON parser, which keeps its errors and prototype-poisoning protection.
- Ill-formed UTF-8 gets the declared 400 `validation.json` under both Content-Length and chunked framing. It never gives a 500 and is never rewritten to U+FFFD. One BOM is stripped.
- A strict query-string parser gives 400 `validation.format` at `/query/<key>` for an undecodable component.
- Cookies and headers were swept; the User-Agent stays byte-faithful.

Re-run your round-7 repro. Then probe for any remaining path where client bytes are silently rewritten, or answered with an undeclared status or a 500.

Write `docs/delivery/reviews/DG2/round-8/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 7 (`git diff 90439483..cf3446e4`, product code and contract):
- **The new JSON parser.** It must not weaken `bodyLimit`, media-type checks or prototype-poisoning protection, and it must not change how the evidence octet-stream upload is handled.
- **The query-string parser.**
- **The contract amendment (ARCH-03).** 429 is now declared on 158 more operations, still 161 in total. Check the rule test `apps/api/test/integration/contract/platform-statuses.ts` and ADR-0007 §5b, including the out-of-contract-by-design classes (500, 408, unmatched-route 404, pre-routing parser 400). Note the `/healthz?x` rate-limit observation in D-068.
- **The harness port policy (DEVOPS3, `tests/qa/support/pg-port.sh`).** It must not introduce a security problem. Use ports below 32768; the harnesses now retry on collision.

Run these, with real output. A missing tool or database is BLOCKED.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm openapi:lint`
- `pnpm check:no-cdn`
- `pnpm format:check`
- `pnpm test` on Node 22 **and** Node 24, including one run under moderate concurrent CPU load.
- The integration suite on a disposable PostgreSQL with a unique port, run **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. Include `contract.test.ts` (161 ops), `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`, and migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-8/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-8/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-8/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 8`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-290 verifies CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-320 to F-DG2-329**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290 and 310 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-7/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-8/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
