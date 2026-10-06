# code-security-reviewer DG2 round-9 probes (T-DG2-REV-SEC-R9)

**Candidate.** `sha256:45ebccc0…066294` (544 files). I recomputed it in the working tree, in a disposable clone at the source commit `7854770e`, and at HEAD `041478cb`, which adds only delivery metadata (the round-9 assignments, the manifest and `stages.json`).

**Clones.** All three are disposable clones under `$TMPDIR`, removed after the run:
- `review-r9` at `041478cb`, for the checks (`../checks.sh`);
- `probe-r9` at `041478cb`, for the probes and the load generator (`../load-repro.sh`);
- `probe-r8base` at `cf3446e4`, the round-8 candidate, used only for the S10/S11 baseline.

**Setup.** Each clone was installed offline (`pnpm install --offline --frozen-lockfile`) from a scratch copy of the host store, then built with `pnpm -r build`. The probe files were copied into `apps/api/test/integration/` of the probe clones only, never into the candidate.

**Database.** Disposable PostgreSQL 16 clusters (`../with-pg.sh`) on ports 29861–29891, all below 32768, deleted afterwards. Run 1 has LANG unset (an SQL_ASCII cluster); run 2 has LANG=C.UTF-8 (a UTF8 cluster). All data is SYNTHETIC.

**How to read the results.** Each assertion states the secure or declared expectation, so a failing test shows a defect. Every observation is logged as `PROBE <key>: <json>`, and responses are checked against `docs/api/openapi.yaml` (`assertContract`).

## Logs

| Log | Contents | Result |
|---|---|---|
| `../probe-run1-lang-unset.log` | r7 + r8 probes (unchanged) + `zz-sec-r9-probe.test.ts` | 33 pass, 2 fail (S10, S11) |
| `../probe-run2-lang-c-utf8.log` | the same three files | 33 pass, 2 fail (S10, S11). The normalised observations match run 1, apart from a random display-name suffix in A3. |
| `../probe-baseline-cf3446e4-S10-S11.log` | S10/S11 only, at the round-8 candidate | S10 at cf3446e4: an octet-stream body on an unmatched route gave **404**, so the 400 is a BE14 regression. S11 is the same at cf3446e4, so it predates BE14. |

Exploratory runs while I developed the probe aren't kept. They fixed probe-side bugs: a socket half-close, a wrong chunk length in S6, and HEAD missing from the contract helper. Their observations match the final runs.

## F-DG2-320 repro (round-8 `zz-sec-r8-probe.test.ts` R6, rerun unchanged)

R6 now **passes** in both runs:
- octet-stream (Content-Length and chunked) is stored and downloaded byte-exact, with a matching sha256;
- `text/plain` (Content-Length, chunked, chunked valid UTF-8, chunked without NUL) gives 400 `validation.content_type`, with nothing stored;
- JSON object, array and string give 400 `validation.content_type`, with nothing stored;
- no error-level log line.

In round 8 the results were 200 with a U+FFFD rewrite, a 500, and a 500 plus a decoded string. The round-7 file (14 tests) and the other round-8 tests (R1–R5, R7–R10) still pass.

## Round-9 probe: `zz-sec-r9-probe.test.ts`

| Id | Probe | Result |
|---|---|---|
| S1 | Upload with 15 Content-Type variants, both framings | PASS. These are stored byte-exact: `APPLICATION/OCTET-STREAM`, mixed case with a charset, `… ; x=1`, `…;`, `…;;;=`. These give 400 `validation.content_type`: `octet-streamx`, lists, `*/*`, `application/*`, empty, `text/plain; x=application/octet-stream`, `+json`, `problem+json`. No 500 and no error log. Observation: `application/octet-stream\t; x=1` (tab) gives 400 with the detail "Send the request body as **application/json**." (S11). |
| S2 | createEvidence with 13 variants | PASS. Accepted: `APPLICATION/JSON; CHARSET=UTF-8`, a quoted charset, a space before `;`. Refused with 400 and nothing created: `problem+json`, `json-seq`, `jsonp`, `text/json`, `x-json`, a list, empty, a tab before `;`, `application/json x`, and octet with a json parameter. |
| S3 | Duplicate Content-Type headers, real socket | PASS. Node keeps the first header, and both the hook and the parser see that same value. Results: text-then-octet → 400; json-then-octet → 400; octet-then-text → 200, stored byte-exact. |
| S4 | No Content-Type with a body (Content-Length and chunked); logout / activateKpiDefinition (D-069 b) | PASS. createEvidence → 400 `validation.content_type`, nothing created. activate: text/plain → 400; JSON or no body → 404 (unknown id; the body is ignored); text/plain with Content-Length 0 → 400. logout: no body → 200; text/plain → 400; an empty JSON body → 400 `validation.json`, unchanged. The web client sends no Content-Type without a body (`apps/web/src/api/client.ts:106`). All declared. |
| S5 | DELETE / OPTIONS / PUT carrying a body on a path that has no such operation | No 500 and nothing stored. text/plain, JSON or no Content-Type → 404. **application/octet-stream → 400** (S10). |
| S6 | GET/HEAD with a body and text/plain (D-069 a), plus a request smuggled in the chunked body of a keep-alive GET over a real socket | PASS. 200 each time. The socket returns exactly one response: the GET body is consumed, never parsed as a second request. I agree with D-069 (a). |
| S7 | Rate limit 3/min, 5 text/plain POSTs | PASS. `[400, 400, 400, 429, 429]`: onRequest rate limiting precedes the media-type refusal. |
| S8 | F-DG2-320 repro on a real socket, chunked | PASS. text/plain, authenticated or not → 400 `validation.content_type`; a JSON string → 400. Nothing stored. Control octet → 200, sha256 of the bytes sent. |
| S9 | U+FFFD sweep plus error-log count over the whole file | PASS: 0 / 0 / 0. |
| **S10** | POST / PUT / DELETE to unmatched URLs, with text/plain, JSON and octet-stream, with and without a session | **FAIL → F-DG2-350.** text/plain and JSON → 404. **application/octet-stream → 400 `validation.content_type` "Send the request body as application/json."** At cf3446e4 the same request gave 404. |
| **S11** | Upload with `application/octet-stream\t; x=1` | **FAIL → F-DG2-351.** Declared 400 `validation.content_type`, nothing stored, but the detail names application/json, which the operation does not accept. The same at cf3446e4. |
