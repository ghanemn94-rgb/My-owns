# Handback: T-DG2-BE15 (completed by T-DG2-BE15B), backend-workflow-engineer

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`.
- **Base:** `08a4f63`, the WIP salvaged from the interrupted BE15 run. The base before the WIP is `3b2ab15`.
- **Run:** `DG2-T-DG2-BE15B-backend-workflow-engineer-20261006T220322Z-7e00b4b0`, session `7e00b4b0-aa66-458f-99f2-5148de68058b`.
- **Assignments:**
  - `docs/delivery/assignments/DG2/round-10/T-DG2-BE15.md`;
  - `docs/delivery/assignments/DG2/round-10/T-DG2-BE15B.md` (sha256 `b76e05e5…87462f91`, verified before starting).
- **Findings repaired:** F-DG2-350 and F-DG2-351 (both Low, REQ-DLV-034).
- **Not touched:** no migrations, no API endpoints added or changed, no `docs/api/openapi.yaml` change, no dependency change.
- **Gates:** this is engineering delivery work. It grants no G1–G6 business approval and implies nothing about DG7.

**Provenance.** Everything in this handback was run from scratch by this run. Nothing is cited from `docs/delivery/test-evidence/DG2/be15-orphaned/`. I read the orphaned run's sweep source only to see its approach. My sweep (`sweep-source.log`) is my own, and so are its two runs.

## 1. Critical review of the salvaged WIP

I reviewed `08a4f63` against every point of T-DG2-BE15 as if someone else had written it. I also read the Fastify 5.6.1 sources that decide its behaviour (`lib/handleRequest.js`, `lib/contentTypeParser.js`).

| Point | Verdict on the WIP | Action |
|---|---|---|
| RFC 9110 §8.3.1 parse (`parseContentType`) | **Sound.** Field OWS at both ends is dropped. OWS (SP/HTAB) is allowed around every `;`. Type, subtype and parameter name are tokens. A value is a token or a quoted-string, with quoted-pair checking. Empty parameters (`a/b;`, `;;`) are allowed, as the grammar `*( OWS ";" OWS [ parameter ] )` permits. A list, a missing `=`, an empty name or value, an unterminated quote, trailing text, CTLs and CR/LF are refused. | Kept. |
| Accept iff the essence is in `consumes` | Sound. | Kept. |
| Parser lookup agrees with the check | **Sound.** An accepted header is rewritten to the canonical `essence[; name=value]…` on `request.raw.headers` in `preParsing`, and `handleRequest` reads `request.headers['content-type']` after `preParsing`. The canonical form starts with the exact essence, followed by end-of-string or `;`, so `getParser` always finds the declared parser. A refused header never reaches the lookup. | Kept. Proven on a real socket (§4, §5). |
| **Duplicate Content-Type lines** | **Gap.** Node keeps only the first Content-Type line in `headers` and drops the rest silently; they remain visible only in `rawHeaders` (verified with a raw-socket probe on Node 24). So `Content-Type: application/json` + `Content-Type: application/octet-stream` was decided as JSON. The WIP's "header array" branch never fires for Content-Type on a real socket. The parser and the check still agreed (both used the first line), so this was not a parse/lookup split. But Content-Type is a singleton field (RFC 9110 §5.3, §8.3), and an intermediary may honour the last line instead of the first. | **Fixed.** `contentTypeFieldLines(rawHeaders)` is added, and `decideMediaType` refuses more than one line on a matched route with the same 400, naming the declared set. An unmatched route still gets 404. |
| Unmatched route, body with Content-Type removed (`run('')`) | **Sound.** With Content-Type deleted and a body present, `handleRequest` calls `contentTypeParser.run('')`. `getParser('')` finds no custom parser: no `''` or `*` parser is registered, and the prefix loop cannot match an empty string. It also has no regexp parsers. So it returns `undefined`, and `run` takes the `request.is404 === true` branch to the not-found handler, which answers 404 `not_found`. It is never a 400, 415 or 500. | Kept. Proven by the sweep (all 184 unmatched cases are 404 `+close`) and by the integration tests. |
| Keep-alive after an unmatched 404 | Sound: `Connection: close` is set, and the unread body is never drained into the server. | Kept, with an added test: the client's next keep-alive connection serves two pipelined requests normally. |
| `restrictParserTo` refusal text | Sound. It already used `undeclaredMediaTypeProblem(consumesOf(request))`. It is reachable only as defence in depth, because the central check already accepted the essence. | Added a unit test for its refusal detail. |
| `FST_ERR_CTP_INVALID_MEDIA_TYPE` backstop | Sound. `mapError` now names `consumesOf(request)`. `frameworkProblem` and `problemForError` take the request (the router-level handler passes it). | Kept. |
| Sweep for any other hard-coded refusal text | `grep -rn "Send the request body" apps/api/src` (excluding tests) finds only `undeclaredMediaTypeProblem` in `media-types.ts`. `grep "application/json"` in non-test API source finds only the constant, comments, and the response's own `application/problem+json` type. | None needed. |
| Canonicalisation safety | **Sound.** No code reads the request Content-Type after parsing: the evidence store records no request media type, and nothing echoes it. The JSON parser decodes the raw buffer as strict UTF-8 whatever the header says, and the octet parser hands over the raw stream. Quoted-string values are kept verbatim, quotes and quoted-pairs included (unit: `a/b; q="x\"y; z"` round-trips; sweep: `x="a; b"` stored and created). The canonical form is a fixed point of the parser (unit test). | Kept. |
| JSON charset | The WIP refuses any `charset` other than UTF-8 on `application/json`. | Kept; justified in §2. |
| `bodyLimit` | Matched routes are unchanged: JSON uses `JSON_BODY_LIMIT_BYTES` and returns the existing 400 `validation.body_too_large`; the octet upload keeps its streaming 413 `evidence.too_large`. An unmatched route reads no body, so no limit applies. Even a 2 MiB JSON body is a 404, and the connection closes instead of the server reading the body. | Documented here. Already tested in the WIP ("json over bodyLimit"). |

**Why close, not drain.** Node itself would `_dump()` an unread request body after the response. That keeps the framing correct, but it reads the whole body, however large. Closing means the server never reads an unmatched route's body. The cost is that a client pipelining behind it must reconnect, and `Connection: close` tells it to.

## 2. Decision for D-070: a JSON charset other than UTF-8 is refused

On a JSON operation, a `charset` parameter whose unquoted, case-insensitive value is not `utf-8` gets the 400 `validation.content_type` ("Send the request body as application/json."). `charset=utf-8`, `charset=UTF-8` and `charset="utf-8"` are accepted, and other parameters are ignored.

Why:

1. **RFC 8259 §8.1:** JSON exchanged between systems that are not part of a closed ecosystem MUST be encoded in UTF-8. Its IANA registration (§11) defines no charset parameter, so a non-UTF-8 charset declares a body this API cannot legitimately receive.
2. **Strict UTF-8 decoding (F-DG2-290).** The API always decodes JSON as strict UTF-8. If it accepted `charset=iso-8859-1`, the header and the decoder would disagree silently. Latin-1 bytes that happen to be valid UTF-8 would be stored as different characters (mojibake). Other bytes would get a confusing "not valid UTF-8 JSON" error. Refusing up front gives one clear, declared answer that names the accepted type.
3. **No legitimate client sends it.** No client of this API sends a non-UTF-8 charset: the web client sends `application/json`.

**Edge case:** the non-registered spelling `utf8` (no hyphen) is refused too. IANA's name is `UTF-8`.

## 3. Changed files (relative to `3b2ab15`; the WIP plus this run)

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/media-types.ts` | `parseContentType` (RFC 9110), `canonicalContentType`, `parametersAcceptable` (JSON charset rule), `contentTypeFieldLines` (**BE15B**: duplicate lines), `decideMediaType` (the one decision: no-body / unmatched-route / accept / refuse), `assertDeclaredMediaType` (applies it: throws the 400, rewrites to canonical, or removes Content-Type for `is404`), and `Connection: close` on a refusal or an unmatched route |
| `apps/api/src/modules/platform/hooks.ts` | `FST_ERR_CTP_INVALID_MEDIA_TYPE` maps to `undeclaredMediaTypeProblem(consumesOf(request))`; the hard-coded JSON text is removed |
| `apps/api/src/modules/platform/framework-errors.ts` | `frameworkProblem(error, request)` passes the route to the mapping |
| `apps/api/src/modules/platform/index.ts` | exports the new functions and types (BE15B: `contentTypeFieldLines`) |
| `apps/api/src/modules/platform/media-types.test.ts` | unit tests: parser accept and refuse tables, canonical fixed point, charset rule, `decideMediaType`, every accepted spelling reaches the declared parser, every refused one gets the 400, unmatched routes get 404, the backstop. **BE15B:** duplicate-line refusal, `contentTypeFieldLines`, `restrictParserTo` refusal detail |
| `apps/api/src/modules/platform/framework-errors.test.ts` | the backstop names the route's set (JSON and octet-only routes) |
| `apps/api/test/integration/media-types.test.ts` | integration tests on real PostgreSQL (§4). **BE15B:** the three "on a real socket" tests |
| `docs/delivery/handbacks/DG2/T-DG2-BE15-backend-workflow-engineer.md` | this handback |
| `docs/delivery/handbacks/DG2/T-DG2-BE15-evidence/*.log` | evidence logs (§5–§7) |

## 4. Tests (behaviour per requirement, REQ-DLV-034)

**Integration** (`apps/api/test/integration/media-types.test.ts`, 21 tests, 11 of them new). Every light-my-request response is asserted against the OpenAPI contract.

- **F-DG2-350 (unmatched routes):**
  - S10 from the round-9 probe as a permanent regression: POST/PUT/DELETE × text/plain, JSON and octet-stream × with and without a session give 404 `not_found`.
  - POST/PUT/PATCH/DELETE × 3 unmatched URLs × {octet-stream CL, octet-stream chunked, JSON, invalid JSON, JSON chunked, text/plain, no Content-Type with a CL body, no Content-Type chunked, malformed, 2 MiB JSON over `bodyLimit`} × session/none give 404 `not_found`, problem+json and `Connection: close`, with no error-level log line.
  - On a real keep-alive socket, a body that is itself a complete HTTP request is never answered as a second request, for octet-stream, JSON, text/plain chunked and no Content-Type.
  - **BE15B:** after that 404 closes, a fresh keep-alive connection answers two pipelined requests (200, then 404) normally.
- **F-DG2-351 (one decision):**
  - S11 as a regression: `application/octet-stream\t; x=1` is stored byte-exact, its sha256 matches, in both framings.
  - Every refusal on the upload names `application/octet-stream`; nothing is stored, and no file is written.
  - 7 OWS/whitespace spellings on the upload × 2 framings are stored byte-exact (sha256 and size) and can be downloaded.
  - 5 OWS spellings on `createEvidence` × 2 framings are accepted, and the Arabic/Latin title is stored verbatim.
  - Every refusal on a JSON operation names `application/json`.
  - **BE15B, on a real socket (llhttp):** S11 on upload and JSON. Two Content-Type lines (same, JSON+octet, octet+JSON) on `createEvidence` give 400 naming JSON, and nothing is created. On the upload they give 400 naming octet-stream, and nothing is stored. On an unmatched route they give 404.

**Unit** (`media-types.test.ts`, 57 tests; `framework-errors.test.ts`, 6 tests): the parser and normaliser tables, the charset rule, `decideMediaType`, an in-process Fastify app showing that every accepted spelling reaches its declared parser and every refused one is the 400 naming the set with no parser run, and the backstop mapping.

## 5. Sweep table (real sockets; matched and unmatched; before and after)

- **Method:** a temporary harness, never part of the candidate. Its source is kept as `T-DG2-BE15-evidence/sweep-source.log`. It sends each case over a real TCP socket (llhttp, so Node's own trimming and duplicate handling apply), against a disposable PostgreSQL 16.
- **Matrix:** 23 Content-Type classes × 2 framings (Content-Length, chunked) × {upload (declares octet-stream only), `createEvidence` (JSON only), an unmatched POST with an octet body and with an invalid-JSON body, each with and without a session}. That is 276 cases.
- **Runs:**
  - Before: `3b2ab15` in a disposable clone, `sweep-before-3b2ab15.log`.
  - After: the working tree, `sweep-after.log`.
  - Full 276-row table: `sweep-table.log`.
- **Result:** 206 of 276 cases changed.
- **Notation:**
  - `+close` means the response carried `Connection: close`.
  - "(stored)" means one `evidence_content` row was written.
  - `content_type: X` means 400 `validation.content_type` "Send the request body as X."
  - Every row is identical across both framings, and, for unmatched routes, across session and no session.

| Route | Content-Type class | Before (3b2ab15) | After |
|---|---|---|---|
| upload (octet-stream) | exact | 200 (stored) | 200 (stored) |
| upload (octet-stream) | upper case | 200 (stored) | 200 (stored) |
| upload (octet-stream) | charset=utf-8 | 200 (stored) | 200 (stored) |
| upload (octet-stream) | charset="UTF-8" (quoted) | 200 (stored) | 200 (stored) |
| upload (octet-stream) | charset=iso-8859-1 | 200 (stored) | 200 (stored) |
| upload (octet-stream) | quoted param with ; and SP | 200 (stored) | 200 (stored) |
| upload (octet-stream) | SP before ; | 200 (stored) | 200 (stored) |
| upload (octet-stream) | HTAB before ; | 400 content_type: application/json. | 200 (stored) |
| upload (octet-stream) | HTAB after ; | 200 (stored) | 200 (stored) |
| upload (octet-stream) | leading/trailing SP+HTAB | 200 (stored) | 200 (stored) |
| upload (octet-stream) | trailing ; | 200 (stored) | 200 (stored) |
| upload (octet-stream) | param without = | 200 (stored) | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | garbage ;;;= | 200 (stored) | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | text after subtype | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | list | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | empty value | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | `*/*` | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | text/plain | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | other declared type | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | duplicate (same) | 200 (stored) | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | duplicate (other first) | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | duplicate (declared first) | 200 (stored) | 400 content_type: application/octet-stream. +close |
| upload (octet-stream) | no Content-Type | 400 content_type: application/octet-stream. +close | 400 content_type: application/octet-stream. +close |
| createEvidence (json) | exact | 201 | 201 |
| createEvidence (json) | upper case | 201 | 201 |
| createEvidence (json) | charset=utf-8 | 201 | 201 |
| createEvidence (json) | charset="UTF-8" (quoted) | 201 | 201 |
| createEvidence (json) | charset=iso-8859-1 | 201 | 400 content_type: application/json. +close |
| createEvidence (json) | quoted param with ; and SP | 201 | 201 |
| createEvidence (json) | SP before ; | 201 | 201 |
| createEvidence (json) | HTAB before ; | 400 content_type: application/json. | 201 |
| createEvidence (json) | HTAB after ; | 201 | 201 |
| createEvidence (json) | leading/trailing SP+HTAB | 201 | 201 |
| createEvidence (json) | trailing ; | 201 | 201 |
| createEvidence (json) | param without = | 201 | 400 content_type: application/json. +close |
| createEvidence (json) | garbage ;;;= | 201 | 400 content_type: application/json. +close |
| createEvidence (json) | text after subtype | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | list | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | empty value | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | `*/*` | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | text/plain | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | other declared type | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | duplicate (same) | 201 | 400 content_type: application/json. +close |
| createEvidence (json) | duplicate (other first) | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| createEvidence (json) | duplicate (declared first) | 201 | 400 content_type: application/json. +close |
| createEvidence (json) | no Content-Type | 400 content_type: application/json. +close | 400 content_type: application/json. +close |
| unmatched POST (octet body) | exact | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | upper case | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | charset=utf-8 | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | charset="UTF-8" (quoted) | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | charset=iso-8859-1 | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | quoted param with ; and SP | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | SP before ; | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | HTAB before ; | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | HTAB after ; | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | leading/trailing SP+HTAB | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | trailing ; | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | param without = | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | garbage ;;;= | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | text after subtype | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | list | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | empty value | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | `*/*` | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | text/plain | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | other declared type | 400 validation.json (not valid UTF-8 JSON) +close | 404 not_found +close |
| unmatched POST (octet body) | duplicate (same) | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | duplicate (other first) | 404 not_found | 404 not_found +close |
| unmatched POST (octet body) | duplicate (declared first) | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (octet body) | no Content-Type | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | exact | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | upper case | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | charset=utf-8 | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | charset="UTF-8" (quoted) | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | charset=iso-8859-1 | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | quoted param with ; and SP | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | SP before ; | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | HTAB before ; | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | HTAB after ; | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | leading/trailing SP+HTAB | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | trailing ; | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | param without = | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | garbage ;;;= | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | text after subtype | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | list | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | empty value | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | `*/*` | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | text/plain | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | other declared type | 400 content_type: application/json. +close | 404 not_found +close |
| unmatched POST (json body) | duplicate (same) | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | duplicate (other first) | 404 not_found | 404 not_found +close |
| unmatched POST (json body) | duplicate (declared first) | 400 validation.json +close | 404 not_found +close |
| unmatched POST (json body) | no Content-Type | 404 not_found | 404 not_found +close |

What the table shows:

- **Unmatched routes are now 404 for every class.** Before, the answer depended on the media type: 400 `content_type` naming JSON, or 400 `validation.json`. That is F-DG2-350.
- **The HTAB-before-`;` spelling is now accepted on both operations.** Before, it was refused with a JSON detail even on the upload. That is F-DG2-351.
- **Malformed parameters (`; x`, `;;;=`) are now refused.** Before, they were accepted.
- **Duplicate Content-Type lines are now refused** (BE15B).
- **A JSON body declared `charset=iso-8859-1` is now refused** (§2).
- **Every refusal names the route's own declared set.**

The duplicate-line classes are only reachable on a real socket. light-my-request cannot send two lines.

## 6. Negative control

**Against `3b2ab15`, the commit before the WIP.**

- **Method:** a disposable clone at `3b2ab15` with only the three test files copied in from the working tree, run against a disposable PostgreSQL 16.
- **Log:** `T-DG2-BE15-evidence/negative-control-3b2ab15.log`.
- **Unit:** 48 failed, 15 passed (63), exit 1. The passing ones are the pre-existing BE14 tests, plus the `restrictParserTo` detail test (old code already names the set there). The new parser and decision tests fail because the functions do not exist.
- **Integration:** **11 failed, 10 passed (21)**, exit 1. All 11 new tests fail: S10, the unmatched matrix, keep-alive, S11, the refusal details, the OWS spellings, and the three real-socket tests. All 10 pre-existing BE14 tests pass.

**Supplementary control against `08a4f63`, the salvaged WIP.**

- **Purpose:** proves the BE15B additions are not vacuous.
- **Log:** `T-DG2-BE15-evidence/control-wip-08a4f63.log`.
- **Unit:** 2 failed, 55 passed: the duplicate-line decision and `contentTypeFieldLines`.
- **Integration:** 1 failed, 20 passed: the duplicate Content-Type real-socket test. The WIP answered 201 to two JSON lines.

## 7. Checks actually run

**Setup.**

- **Matrix script:** `T-DG2-BE15-evidence/matrix-commands.log`. It is the BE14 script with only the evidence directory and the ports changed.
- **Logs:** each check writes `T-DG2-BE15-evidence/<mode>-NN-*.log`; the per-mode summary is `<mode>-00-summary.log`.
- **Modes:**
  - `nolocale`: `env -u LANG -u LC_ALL -u LC_CTYPE -u LC_COLLATE -u LC_MESSAGES -u LC_NUMERIC -u LC_TIME -u LC_MONETARY …`
  - `cutf8`: the same, plus `LANG=C.UTF-8`.
- **Node:** 24.21.0 everywhere, except check 07, which uses 22.22.2.
- **Ports (all below 32768):** QA PostgreSQL 24391 (`nolocale`) and 24381 (`cutf8`); E2E PostgreSQL 24392 and 24382; E2E API 3611 and 3612.
- **Run:** one clean sequential job on the final source, from 22:39 to 22:56 UTC.

| # | Check | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: only the 12 sandbox-masked, untracked dotfiles fail ("Unable to read file": `.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`); no other file is reported | same |
| 05 | `npx prettier --check . '!.bash_profile' … '!CLAUDE.local.md'` (the masked-dotfiles variant) | exit 0, "All matched files use Prettier code style!" | same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, Test Files 40 passed (40), Tests 765 passed (765) | same |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 40 / 765 passed | same |
| 09a | `tests/qa/support/with-pg.sh pnpm test:integration`, run 1 | exit 0, Test Files 34 passed (34), Tests 570 passed (570) | same |
| 09b | the same, run 2 | exit 0, 34 / 570 passed | same |
| 10 | `apps/web/e2e/support/with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (pre-installed Chromium, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `playwright install` was never run) | exit 0, `60 passed (3.7m)` | exit 0, `60 passed (3.8m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | same |

**What the integration runs include.** Every 09a and 09b run includes these files, and all of them passed:

- `contract/contract.test.ts` (18 tests);
- `media-types.test.ts` (21);
- `invalid-utf8.test.ts` (14);
- `framework-errors.test.ts` (11);
- `evidence.test.ts` (6);
- `aud-write-deny.test.ts` (128);
- `kpi/kpi-aud-write-deny.test.ts` (18).

**What the e2e runs include.** "Evidence: note, filename reference and file upload; a link; review by another person" passed in chromium-en and chromium-ar.

**Other runs, in order:**

1. **Early targeted runs.**
   - `npx vitest run --project unit-node apps/api/src/modules/platform/`: 91 passed.
   - `with-pg.sh npx vitest run --project integration media-types.test.ts framework-errors.test.ts`: 32 passed.
2. **First full matrix: discarded, not evidence.** Its Node 22 and Node 24 unit checks (07/08) failed in `nolocale` on the ADR-0002 architecture test (`apps/api/src/architecture.test.ts`). My first `contentTypeFieldLines` read `rawHeaders[i]`, which that test rejects as a "computed member with a non-literal key".
   - **Fix:** I rewrote it with `filter` (same behaviour). The architecture test and the platform units then passed (226 tests), and so did the full `pnpm test` (765).
   - **Why discarded:** that first job could not be stopped (each shell runs in its own PID namespace), and the fix landed while it was still running, so its later checks ran on mixed source.
   - **Clean-up:** I deleted all of its logs and reran the whole matrix from scratch. The table above comes only from that rerun.
3. **Sweep reruns.** The after-sweep ran first before the refactor and again after it. The `SWEEP` lines are identical, and `sweep-after.log` is the post-refactor run.
4. **Controls.** The negative control and the WIP control run only test files, which did not change after they ran.

## 8. Known gaps / not done

- **Findings.** I did not change `findings.json`. The orchestrator records `import-findings --fix` for F-DG2-350 and F-DG2-351, and a non-author reviewer must verify them.
- **D-070.** D-070 is not written by me; the decision text is §2.
- **Behaviour changes beyond the two findings.** They are deliberate, and a reviewer should confirm them:
  - malformed parameters are refused (`; x`, `;;;=`, `charset=` empty);
  - duplicate Content-Type lines are refused;
  - non-UTF-8 JSON charsets are refused.
  - Each was 200/201 at `3b2ab15`. The web client sends none of them, and the e2e runs in §7 cover the web journeys.
- **Pipelined clients.** A pipelined request queued behind an unmatched 404 on the same connection is not served. The connection closes, and the client must retry on a new connection. That is the chosen close-not-drain trade-off (§1).
- **Assignment discrepancy.** None found.

## 9. Merge instructions

- Commit the working-tree changes on top of `08a4f63`.
- No migrations to run, no ordering constraints and no contract change.
- **Possible conflicts:** any concurrent change to `platform/media-types.ts`, `hooks.ts`, `framework-errors.ts`, or the parser registrations in `server.ts` or `evidence/routes.ts`.
