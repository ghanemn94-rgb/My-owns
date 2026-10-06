# Assignment T-DG2-BE13: DG2 round-7 repair, ill-formed UTF-8 input (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** the full text is in `docs/delivery/findings.json`, and the reviewer's repro is under `docs/delivery/test-evidence/DG2/code-security/round-7/`. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair
**F-DG2-290 (Low, REQ-DLV-034).** A JSON request body containing invalid UTF-8 bytes is handled two ways, depending on framing:
- **With a `Content-Length`:** the API returns an **undeclared 500** before authentication and logs `unhandled error`.
- **Chunked:** the bytes are silently decoded to U+FFFD, then **stored and audited**.

Both break the faithfulness rule that F-DG2-260 applied to lone surrogates: client text is never rewritten silently, and unrepresentable input gets the declared 400. This behaviour predates the current round.

## Required: fix the whole class, not one framing
1. **JSON bodies.** Replace Fastify's default `application/json` parser with one registered with `parseAs: "buffer"`:
   - Decode with `new TextDecoder("utf-8", { fatal: true })`. Invalid UTF-8 is a 400 problem with code `validation.json`, or `validation.invalid_character` if you judge that clearer (say which you chose and why), pointer `""`. Nothing is written and no audit row is created.
   - Handle a UTF-8 BOM consistently. Accepting and stripping it is fine; document your choice.
   - Keep everything else unchanged: `JSON_BODY_LIMIT_BYTES`, empty-body behaviour, invalid-JSON → `validation.json`, media-type checks, the U+0000/lone-surrogate central check (it still runs after parsing), and the evidence `application/octet-stream` upload parser.
   - Both `Content-Length` and chunked framing must give the same answer.
2. **Query strings, cookies and headers.** Sweep every other place where client bytes become strings:
   - **Query strings.** Invalid UTF-8 percent sequences such as `?q=%FF`, and lone-surrogate escapes such as `?q=%ED%A0%80`, must give the declared 400 problem. They must never reach a handler as U+FFFD or a lone surrogate.
   - **Cookie values** and any **header values** that are stored or used: session cookie, CSRF token, User-Agent recorded on sessions, request-id header.
   - Path parameters are already covered by BE12 (`FST_ERR_BAD_URL`). Confirm this.
   - In the handback, list each place, its behaviour before and after, and whether the status is declared.
3. **Tests.**
   - **Integration:**
     - A body with invalid UTF-8, sent once with `Content-Length` and once chunked, on a mutating P2 operation (for example charter PATCH or T03 create): the declared 400, nothing written, no audit row, and no `unhandled error` log entry.
     - An unauthenticated request with such a body: a 400 or 401 as declared, never 500.
     - A query with `%FF`: 400.
     - A BOM case.
     - Valid UTF-8 bodies with Arabic text and emoji still round-trip verbatim.
   - **Unit tests** for the parser.
   - **Negative control:** the new tests fail on the old code.

## Conventions (unchanged)
- Server-side authz, If-Match/409, and an audit event on every mutation.
- Rate limiting keeps working on the refused requests.
- Product gates G1-G6 are business approvals and never DG0-DG7.

## Self-verification (real output in the handback)
Run every check in **both locale settings**: `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite (`QA_PG_PORT=55471`), **twice per locale setting**, including `contract.test.ts`, `invalid-character.test.ts` and `framework-errors.test.ts`, keeping the full log of every run
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE13-backend-workflow-engineer.md` with the fix, the sweep table and every check's real output. Keep evidence to logs only.
