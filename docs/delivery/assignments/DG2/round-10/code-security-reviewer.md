# DG2 gate review — code-security-reviewer (round 10)

Task ID: `T-DG2-REV-SEC-R10`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:7fd1a89ca090dbdea5ae9f014853684239cbf80e89dc5cce50914155cb9d484a`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (544 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/7fd1a89ca090dbde.manifest.json`.
- **source_commit:** `fe22d759`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-9 findings on THIS candidate — adversarially
**F-DG2-350 and F-DG2-351 (Low, REQ-DLV-034).** Claimed fix: BE15 `08a4f63` + `e974d78`, in `apps/api/src/modules/platform/media-types.ts` and `hooks.ts`. The first BE15 run was interrupted; its WIP `08a4f63` was completed by BE15B (D-070).
- One RFC 9110 §8.3.1 parse (`parseContentType`) decides in the central `preParsing` hook. OWS (SP/HTAB) is allowed around `;`. A malformed value, duplicate Content-Type lines, or a JSON charset other than UTF-8 is refused.
- An accepted header is rewritten to the canonical `essence[; name=value]` before Fastify's parser lookup, so the check and the lookup agree.
- Every refusal names the route's declared set, including the `FST_ERR_CTP_INVALID_MEDIA_TYPE` backstop.
- An unmatched route never has its body parsed or refused: it answers 404 `not_found` with `Connection: close`, whatever the media type or framing.

Re-run your round-9 probe (`zz-sec-r9-probe.test.ts`, S1-S11) on this candidate. Then probe for any remaining Content-Type spelling or framing where:
- the central decision and the parser lookup disagree;
- a refusal names the wrong media type;
- an unmatched route answers anything other than 404;
- or a body is rewritten, or answered with an undeclared status or a 500.

Write `docs/delivery/reviews/DG2/round-10/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, with one entry per finding:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 9 (`git diff 7854770e..fe22d759`, product code):
- **The media-type decision (BE15).**
  - It must not weaken `bodyLimit`, the strict UTF-8 JSON parser, prototype-poisoning protection, CSRF, authorization or rate limiting.
  - It must not change the evidence upload's streaming size limit or its sha256 over the raw bytes.
  - It must not let an unread body on an unmatched route affect the next request on a keep-alive connection.
  - The D-069 design choices still stand; challenge them only with a reproduction.
  - The three deliberate tightenings in D-070 (malformed parameters, duplicate Content-Type lines and a non-UTF-8 JSON charset are all refused) must not break a legitimate client.

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
  - `media-types.test.ts` (including your S10/S11 cases);
  - `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`;
  - the evidence tests;
  - migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-10/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-10/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-10/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 10`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-350 and F-DG2-351 verify CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-380 to F-DG2-389**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340 and 350-351 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-10/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-10/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
