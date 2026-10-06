# DG2 gate review — code-security-reviewer (round 9)

Task ID: `T-DG2-REV-SEC-R9`. You are the independent code and security reviewer re-reviewing the **repaired** DG2 candidate. You did not implement any DG2 requirement.

## Candidate
- **candidate_id:** `sha256:45ebccc04d8efc0c4fdc6a842eb3c9ec330bab2ec517b1c592af60b05a066294`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (544 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/45ebccc04d8efc0c.manifest.json`.
- **source_commit:** `7854770e`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **DG1** is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-8 finding on THIS candidate — adversarially
**F-DG2-320 (Low, REQ-DLV-034).** Claimed fix (BE14 `a7b84d8`, `apps/api/src/modules/platform/media-types.ts`, `server.ts`, `evidence/routes.ts`):
- Each route declares `config.consumes`. The default is `application/json`; `uploadEvidenceContent` declares `application/octet-stream`. A registration check refuses an empty set or a type without a parser.
- One central `preParsing` hook refuses any other media type with the declared 400 `validation.content_type` before a body byte is read. It runs after `onRequest`, so rate limiting still applies.
- Fastify's built-in `text/plain` parser is removed. Both parsers re-check the route's set, and the upload handler stores only a raw byte stream.
- A contract test asserts that every route's set equals its operation's declared `requestBody.content` (87 operations with a body: 86 JSON, 1 octet-stream). A live sweep sends each undeclared media type to every body-carrying operation.

Re-run your round-8 repro (text/plain with Content-Length and chunked, and JSON object/array/string on `uploadEvidenceContent`). Then probe for any remaining path where a request body is accepted in an undeclared media type, silently rewritten, or answered with an undeclared status or a 500. Examples: Content-Type case and parameter variants, duplicate Content-Type headers, `+json` suffixes, an absent Content-Type with a body, and DELETE/OPTIONS with a body.

Write `docs/delivery/reviews/DG2/round-9/code-security-reviewer.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`:
- if the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`;
- otherwise: `result: "FAIL"`, with the reason.

## Re-review: no regression, plus checks
Re-inspect the product changes since round 8 (`git diff cf3446e4..7854770e`, product code):
- **The media-type enforcement (BE14).**
  - It must not weaken `bodyLimit`, the strict UTF-8 JSON parser, prototype-poisoning protection, CSRF, authorization or the evidence upload's streaming size limit and sha256 over the raw bytes.
  - Two deliberate design choices are recorded in D-069; challenge them if you disagree, with a reproduction:
    - GET/HEAD bodies are never read, so their Content-Type is ignored, not refused.
    - The two POST operations that declare no request body (`logout`, `activateKpiDefinition`) keep the default JSON set, and their body is never read by the handler.
- **The form-error change (FE8, web only).** It must not drop a distinct error message or leak internals.

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
  - `blank-text.test.ts`, `oidc.test.ts`, `invalid-character.test.ts`, `framework-errors.test.ts`, `invalid-utf8.test.ts`, `encoding.test.ts`;
  - the evidence tests;
  - migrations 0001→0019.
- The AUD-403 sweep.
- `node tools/gates/validate.mjs --historical --stage DG0` and `--historical --stage DG1`.

Put evidence under `docs/delivery/test-evidence/DG2/code-security/round-9/`.

## Requirements to check (record EXACTLY these)
`REQ-S10-001`, `REQ-S16-013`, `REQ-S13-012`, `REQ-DLV-034`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-9/code-security-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-9/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 9`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if F-DG2-320 verifies CLOSED, the requirements are complete, and nothing Critical, High or mandatory is unresolved.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-350 to F-DG2-359**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320 and 340 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-9/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-8/code-security-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("code-security-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-9/code-security-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.
