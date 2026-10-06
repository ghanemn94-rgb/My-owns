# DG2 round 8: code-security-reviewer

| | |
|---|---|
| **Candidate** | `sha256:9331e9d13e0ffa55f35ebc25ecdf9b60e159876dc2470fe56e9241a40fea124f` (539 files) |
| **Source commit** | `cf3446e4` |
| **HEAD at review** | `4053630c`: the freeze commit, which adds only delivery metadata |
| **Task** | `T-DG2-REV-SEC-R8` |
| **Session** | `1704237b-be59-49e3-8bfc-f693f2cda5c0` |

**Verdict: PASS.**
- F-DG2-290 is **CLOSED_VERIFIED**.
- One new finding: **F-DG2-320** (Low, non-mandatory). It predates this round, is not a regression, and is owned by backend-workflow-engineer.
- Nothing Critical, High or mandatory is open.

The record lists check SEC-R8-03 as **FAIL**, because it found F-DG2-320. The validator rejects any non-PASS check at gate time. That is intended: the gate should not approve while F-DG2-320 is open, unless it is fixed or accepted as an observation through the D-018 path.

I authored no DG2 implementation. I formed this verdict before reading any other reviewer's round-8 output.

## F-DG2-290: verified fixed

**My round-7 repro**, `round-7/probes/zz-sec-r7-probe.test.ts`, rerun unchanged, passes 14/14 under both locales (LANG unset, which gives an SQL_ASCII cluster, and LANG=C.UTF-8, which gives UTF8). The three cases that failed in round 7 now behave as follows:

| Case | Round 7 | Round 8 |
|---|---|---|
| B1: Content-Length body | 500 | 400 `validation.json` |
| B2: unauthenticated, over a socket | 500 | 400 `validation.json` |
| B3: chunked body | 201, with U+FFFD stored and audited | 400; nothing stored or audited |

**I read the fix against the Fastify 5.6.1 sources:**
- **Body limit.** `addContentTypeParser` fills a missing `bodyLimit` with the server's limit (`contentTypeParser.js:344`). `parseAs: "buffer"` makes `rawBody` count raw bytes (`:246`), so the Content-Length comparison is on raw bytes.
- **Decoding.** Each request gets a fresh fatal `TextDecoder`. Exactly one BOM is stripped.
- **JSON parsing.** The text then goes to `getDefaultJsonParser("error","error")`, Fastify's own secure-json-parse path, so its error codes and prototype-poisoning protection are unchanged.
- **Framing errors.** `FST_ERR_CTP_INVALID_CONTENT_LENGTH` is now mapped to 400, so no framing error can fall through to the 500 path.
- **Query strings.** The parser marks undecodable components in a WeakMap. Nothing reassigns `request.query`, and there is no `validatorCompiler` that could replace it, so the mark survives until the preHandler check. That check runs after authentication and CSRF. The OIDC callback (`invalidCharacters: "route"`) keeps its 302.

**My round-8 probe** (`round-8/probes/zz-sec-r8-probe.test.ts`; details in `test-evidence/.../round-8/probes/README.md`) found only declared responses on:
- ten ill-formed UTF-8 classes, in both framings;
- BOM variants, including that a U+FEFF *inside* a string is kept verbatim;
- `charset` parameters, which never switch the decoder;
- other `+json` media types (400 `validation.content_type`);
- prototype poisoning, plain and `\u`-escaped (400, no pollution);
- the raw-byte body limit: 1,048,629 bytes in 349,571 characters gives 400 `body_too_large` in both framings;
- query-pointer escaping, a stray `%`, repeated keys, `__proto__`, and the health routes;
- X-File-Name ordering: a non-editor gets 403, never a 400 oracle;
- a chunked request with no session.

None of these left an error-level log line or a U+FFFD row.

## F-DG2-320 (new, Low, non-mandatory): the evidence upload accepts undeclared media types

`uploadEvidenceContent` declares only `application/octet-stream`. Fastify's default `text/plain` parser and the root JSON parser still reach the route, and `FileSystemEvidenceStore.put` (`store.ts:75-83`) iterates whatever body it receives. What happens:

- **`text/plain` (chunked) with `FF C3 ED A0 80`.** The answer is **200**. The file is stored and downloaded as U+FFFD (`EF BF BD`), and the recorded sha256 is of the rewritten bytes.
- **`application/json` with `{"a":1}` or `[1,2,3]`.** An **undeclared 500**, plus an error-level log line.
- **`application/json` with `"…"`.** The decoded text is stored, not the bytes sent.

It needs an authorized editor using a non-browser client; the web client always sends octet-stream. It has no authorization, confidentiality or audit impact.

It is not a regression. At `90439483` the behaviour is the same (`probe-r6-baseline-90439483.log`), and there `text/plain` with a Content-Length was also a 500; BE13 turned that into a 400.

**Suggested fix:** refuse any non-octet-stream Content-Type on this route with 400 `validation.content_type`, or check that the body is a stream or Buffer before calling `store.put`. Add an integration test for it.

## No regression: BE13, ARCH-03, DEVOPS3

- **Contract amendment.** It is additive: 158 `429` refs added and one description reworded. There are 161 operations, and every one declares 429.
- **Rule test.** `platform-statuses.ts` derives 400/401/403/409/428/429 from each route's declared access, its method and the If-Match parameter. It pins five operations, and a live sweep checks the 429 on all 161 operations.
- **Out-of-contract classes.** 500, 408, the unmatched-route 404 and the pre-routing parser 400 are justified in ADR-0007 §5b.
- **`/healthz?x` and the rate limit (D-068).** It counts only against the caller's own IP bucket and is declared. This is an observation, not a defect.
- **Port policy (`pg-port.sh`).** It introduces no exposure:
  - PostgreSQL binds 127.0.0.1 only;
  - readiness is tied to our own postmaster's log;
  - a port that already accepts connections is skipped;
  - the pool is validated and kept outside the ephemeral range;
  - retries are bounded, and strict mode returns BLOCKED.

  Two things predate this diff and are only local-harness context: the 0644 secret files in `clean-start-local.sh` (throwaway random values) and the API's 0.0.0.0 bind.

## Checks: all run, with real output

| Check | Result |
|---|---|
| build, typecheck, lint, openapi-lint (161 operations), no-cdn, format | PASS |
| `pnpm test` on Node 22 and Node 24 | 691/691 each |
| `pnpm test` under load (load average up to 17 on 4 vCPU) | 691/691 on both versions |
| Integration, LANG unset (SQL_ASCII) | 547/547 |
| Integration, LANG=C.UTF-8 (UTF8) | 547/547 |
| AUD-403 sweep | 146/146 in each run |
| Historical validation of DG0 and DG1 | PASS |

The integration runs include contract 16, blank-text 29, oidc 33, invalid-character 20, framework-errors 11, invalid-utf8 14, encoding 8 and migrate 7 (0001→0019).

The environmental residuals (D-057 live registry, D-058 live CI, D-049 Keycloak) were checked on their offline and config surfaces only, as the assignment directs. They are recorded as PASS with the residual noted.
