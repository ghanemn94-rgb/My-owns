# code-security-reviewer DG2 round-10 probes (T-DG2-REV-SEC-R10)

**Candidate.** `sha256:7fd1a89c…cb9d484a` (544 files), recomputed in the working tree and in a disposable clone at HEAD
`68fe3394` (= source `fe22d759` + delivery metadata only: the round-10 assignments, the manifest, `stages.json`).

**Clones** (disposable, under `$TMPDIR`, removed after the run):
- `review-r10` at `68fe3394`: the checks (`../checks.sh`) and the unit runs under load (`../load-repro.sh`);
- `probe-r10` at `68fe3394`: the probes and the load generator;
- `probe-r9base` at `041478cb` (the round-9 candidate, before BE15): only the P5c baseline.

Each clone was installed offline (`pnpm install --offline --frozen-lockfile`) from a scratch copy of the host store and
built with `pnpm -r build`. Probe files were copied into `apps/api/test/integration/` of the probe clones only, never
into the candidate. **Database:** disposable PostgreSQL 16 clusters (`../with-pg.sh`) on ports 29961-29991 (< 32768),
deleted afterwards. Run 1 has LANG unset (SQL_ASCII cluster), run 2 LANG=C.UTF-8 (UTF8 cluster). All data SYNTHETIC.

## Logs

| Log | Contents | Result |
|---|---|---|
| `../probe-run1-lang-unset.log` | `zz-sec-r9-probe.test.ts` (round 9, unchanged) + `zz-sec-r10-probe.test.ts` | 28 pass, 1 fail: r9 **S11**, by design (see below) |
| `../probe-run2-lang-c-utf8.log` | the same two files | identical: 28 pass, 1 fail (r9 S11) |
| `../probe-baseline-041478cb-P5c.log` | `zz-sec-r10-baseline-p5c.test.ts` at the round-9 candidate | P5c identical before BE15 (pre-existing) |

## Round-9 probe re-run (S1-S11) on this candidate

- **S10 (F-DG2-350): PASS.** POST/PUT/DELETE to unmatched URLs x text/plain, JSON, **application/octet-stream** x
  with/without a session: 404 in every case (was 400 for octet-stream at 45ebccc0).
- **S11 (F-DG2-351): the round-9 assertion now fails BY DESIGN, and the fix is genuine.** The round-9 assertion expected
  the HTAB spelling to be *refused* with a detail naming octet-stream. BE15 instead makes the essence check and Fastify's
  lookup agree (the finding's second suggested remedy): `application/octet-stream\t; x=1` is now **accepted, 200, and stored
  byte-exact** (sha256 of the raw bytes, both framings: S1 rows). The refusal-detail half of the finding is covered by
  P1/P1b/P4d/P6b below: every refusal on the octet operation names application/octet-stream, including the
  `FST_ERR_CTP_INVALID_MEDIA_TYPE` backstop.
- S1/S2: the HTAB rows are now accepted (200 stored byte-exact / 201 created). All other rows as in round 9.
- S3: duplicate Content-Type lines are now refused in every order (D-070 tightening), including octet-then-text (was 200
  in round 9 with the first value honoured). Nothing stored.
- S4-S9: unchanged PASS.

## Round-10 probe: `zz-sec-r10-probe.test.ts`

| Id | Probe | Result |
|---|---|---|
| P1 | Upload with 19 spellings x 2 framings: quoted `;`, escaped quote, quoted " application/json", HTAB both sides, leading/trailing OWS, empty params, `X=""`; and malformed (OWS around `=`, empty value, no `=`, unterminated quote, trailing backslash, space in essence, JSON essence, list, comment, NUL) | PASS. Every accepted one is 200 and stored byte-exact; every refusal is 400 `validation.content_type` "Send the request body as application/octet-stream.", nothing stored, contract-declared. No 500, no error log. |
| P1b | Over llhttp: obs-text (0xE9 0xFF 0x80) inside a quoted parameter / as a bare token / after the essence | PASS. Quoted: 200 byte-exact. Token / essence: 400 naming octet-stream. |
| P2 | createEvidence with 12 charset spellings | PASS. UTF-8 in any spelling (`;charset=UTF-8`, quoted-pair `"utf\-8"`, twice, with another parameter, HTAB) is 201 and stored verbatim (`é`); `utf8`, iso-8859-1, utf-16, utf-8-then-latin1, `""`, OWS around `=` are 400 naming application/json. |
| P2b | Strict UTF-8 decoder + prototype poisoning behind accepted parameterised spellings | PASS. Invalid UTF-8: 400 `validation.json`; `__proto__` / `constructor.prototype`: 400; nothing created. |
| P2c | 3 MiB JSON, chunked, HTAB spelling | PASS. Declared 400 (bodyLimit), never parsed. |
| P3 | CSRF / Origin / session with accepted non-canonical spellings (JSON and octet) | PASS. 403 / 403 / 401 / 403; nothing created or stored. |
| P3b | Rate limit 3/min, `charset=latin1` refusals | PASS. `[400,400,400,429,429]`: onRequest still precedes the refusal. |
| P3c | OBSERVATION | Unmatched-route 404s are not metered by `@fastify/rate-limit` (`[404 x6]`). Pre-existing plugin behaviour (no route, no onRoute hook), not BE15. ADR-0007 §5b scopes the limiter to "every operation"; unmatched URLs have none. Recorded, not raised (see the review narrative). |
| P4a | inject: 4 unmatched method/URL pairs x 7 Content-Types (HTAB, unterminated quote, `*/*`, latin1 charset, multipart, urlencoded, none) | PASS. 404 `not_found`, `Connection: close`, every case; no error log. |
| P4b | llhttp: Content-Length 10 GB / 900 MB, `Expect: 100-continue`, never-ending chunked, on unmatched routes | PASS. Prompt 404 (first byte <= 3 ms), never 413/400, socket closed by the server. |
| P4c | llhttp keep-alive smuggling: a signed-in logout hidden in an unmatched route's body (CL, no CT, chunked, duplicate CT) plus a pipelined GET | PASS. Exactly one response (404) and close; the session is still valid afterwards (`/me` 200). |
| P4d | llhttp: matched-route refusals (two identical Content-Type lines; malformed) with a pipelined request in the body | PASS. One 400 naming octet-stream, then close; nothing stored. |
| P5 | Over-limit (25 MiB + 1) upload with the HTAB spelling; a 1 MiB binary with leading OWS and a quoted parameter | PASS. 413 `evidence.too_large`, nothing stored; the 1 MiB file is stored and downloaded with the sha256 of the raw bytes. |
| P5s | llhttp: 30 MiB chunked upload with the HTAB spelling | PASS. 413 `evidence.too_large`, nothing stored, no error log. |
| P5c | OBSERVATION: `inject` with a chunked over-limit Readable | The inject promise rejects with AbortError and Fastify logs one `request errored` line; nothing stored. **Identical at 041478cb** (before BE15), and absent over a real socket (P5s): a light-my-request transport artifact, not a product regression. Excluded from P7's error-log count. |
| P6 | Fuzz: 20,000 random Content-Type strings over a hostile alphabet x both declared sets, through `decideMediaType` | PASS. 1,760 accepted, 38,240 refused, **0 mismatches**: every accepted canonical form maps (by Fastify 5.6.1's getParser rule) to exactly the declared parser, and every refusal names the route's set. |
| P6b | `frameworkProblem(FST_ERR_CTP_INVALID_MEDIA_TYPE)` with an octet route / no route config | PASS. Names octet-stream / falls back to JSON without throwing. |
| P7 | U+FFFD sweep + error-log count over the file | PASS. 0 / 0 / 0 (excluding P5c's artifact). |
