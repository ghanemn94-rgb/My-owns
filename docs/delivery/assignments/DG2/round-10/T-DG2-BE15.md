# Assignment T-DG2-BE15: one media-type decision for every request, matched or not (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768; the harnesses retry on collision.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Findings:** the full text is in `docs/delivery/findings.json`. The reviewer's probe (`zz-sec-r9-probe.test.ts` S10/S11) and its logs are under `docs/delivery/test-evidence/DG2/code-security/round-9/`. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair (both Low, REQ-DLV-034, from your BE14 change)
**F-DG2-350: an unmatched route's answer depends on the media type.**
- An unmatched route sent `application/octet-stream` answers 400 `validation.content_type` ("Send the request body as application/json.") instead of 404. Text/plain and JSON already get 404.
- Cause: `assertDeclaredMediaType` skips `request.is404`, but `restrictParserTo` (`media-types.ts:88-100`) does not. Fastify's 404 context finds the octet-stream parser, and `consumesOf()` falls back to the JSON default.
- This is a regression: at `cf3446e4` it was 404. Your test "an unknown route keeps its 404, whatever the media type" (`media-types.test.ts:391`) sends only text/plain.

**F-DG2-351: the essence check and Fastify's parser lookup disagree.**
- `mediaTypeEssence` trims whitespace around the type. Fastify 5.6.1's `getParser` (`lib/contentTypeParser.js:116-125`) matches a prefix only when the next character is `;` or a space.
- So `application/octet-stream\t; x=1` passes the central check, but no parser matches it. Fastify raises `FST_ERR_CTP_INVALID_MEDIA_TYPE`, and `mapError` (`hooks.ts:66-67`) answers it with a hard-coded "Send the request body as application/json.", even on the octet-stream-only upload.
- On a JSON operation, `application/json\t; charset=utf-8` is refused too, although RFC 9110 allows that whitespace (`parameters = *( OWS ";" OWS [ parameter ] )`, where OWS is SP or HTAB).

## Required: one decision, made once
1. **One media-type parse decides, and the parser lookup agrees with it.**
   - The central check parses `Content-Type` per RFC 9110 §8.3.1 into an essence (lower-cased type/subtype) and parameters. OWS (SP/HTAB) is allowed around `;`. Leading/trailing whitespace is handled consistently. A malformed value is refused.
   - A request is accepted if and only if its essence is in the route's declared `consumes`.
   - After a request is accepted, Fastify must find the matching parser for every accepted spelling. For example, normalise the header to a canonical `essence[; params]` in the central hook before parsing; Fastify reads it after `preParsing`.
   - Show in a test that every spelling the check accepts reaches the declared parser, and every spelling it refuses gets the 400.
   - Decide whether `charset` parameters other than UTF-8 on JSON are accepted (the body is decoded as strict UTF-8 regardless) or refused. Say which you chose and why.
2. **Every media-type refusal names the operation's declared set.** Map `FST_ERR_CTP_INVALID_MEDIA_TYPE` through `undeclaredMediaTypeProblem(consumesOf(request))` and remove the hard-coded JSON text. Sweep for any other hard-coded "application/json" refusal text.
3. **An unmatched route is 404 whatever its body.**
   - For `request.is404`, no parser refuses or parses the body. The not-found handler answers 404 `not_found` for every media type, both with and without a session. This covers octet-stream, JSON (valid or not), text/plain, a body with no Content-Type, and chunked framing.
   - The unread body must not leak into the next request on a keep-alive connection: close the connection or drain the body, and state which you chose.
   - Keep `bodyLimit` behaviour sensible, and document it.
4. **Sweep and table.** Fill in the handback table for both matched and unmatched routes, covering:
   - each Content-Type spelling class: case, parameters, SP/HTAB OWS, leading/trailing whitespace, duplicate headers, empty value, malformed value;
   - each framing: Content-Length and chunked;
   - the status and detail before and after.
5. **Tests.**
   - **Integration:**
     - S10 and S11 from the reviewer's probe, as permanent regression cases;
     - unmatched routes × {octet-stream, JSON, invalid JSON, text/plain, no Content-Type with a body, chunked} → 404;
     - the OWS/whitespace variants on the upload (stored byte-exact; the sha256 matches) and on a JSON operation (accepted and stored verbatim);
     - every refusal detail names the route's declared set.
   - **Unit tests** for the parser and normaliser.
   - **Negative control:** the new tests fail on `HEAD` before your change.

## Self-verification (real output in the handback)
Run every check in **both locale settings**: `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite **twice per locale setting**, including `contract.test.ts`, `media-types.test.ts`, `invalid-utf8.test.ts`, `framework-errors.test.ts` and the evidence tests
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE15-backend-workflow-engineer.md` with the fix, the sweep table and every check's real output. List any remaining gap honestly; the orchestrator closes gaps before freezing. Keep evidence to logs only.
