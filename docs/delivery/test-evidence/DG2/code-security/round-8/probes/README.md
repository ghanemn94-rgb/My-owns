# code-security-reviewer DG2 round-8 probes (T-DG2-REV-SEC-R8)

**Candidate.** `sha256:9331e9d1…a124f` (539 files). I recomputed it in a disposable clone at the source commit `cf3446e4` and again at HEAD `4053630c`, which adds only delivery metadata.

**Clones.** I used three disposable clones under `$TMPDIR`, all removed after the run:
- `review-r8`, at `4053630c`, for the checks (`../checks.sh`);
- `probe-r8`, at `4053630c`, for the probes and the load generator;
- `probe-r7base`, at `90439483`, the round-7 candidate, used only for the R6 baseline.

**Setup.** Each clone was installed offline with `pnpm install --frozen-lockfile` from a scratch copy of the host store, then built with `pnpm -r build`. The probe files were copied into `apps/api/test/integration/` of the probe clones only, never into the candidate.

**Database.** Disposable PostgreSQL 16 clusters (`../with-pg.sh`, ports 29771–29774 and 29781, all below 32768), deleted afterwards. Run 1 had LANG unset (an SQL_ASCII cluster); run 2 had LANG=C.UTF-8 (a UTF8 cluster). All data is SYNTHETIC.

**How to read the results.** Each assertion states the secure or declared expectation, so a failing test means a defect was shown. Every observation is logged as `PROBE <key>: <json>`, and each response is checked against `docs/api/openapi.yaml` (`assertContract`).

## Logs

| Log | Contents | Result |
|---|---|---|
| `../probe-run1-lang-unset.log` | `zz-sec-r7-probe.test.ts` (unchanged) + `zz-sec-r8-probe.test.ts` | 23 pass, 1 fail (R6) |
| `../probe-run2-lang-c-utf8.log` | the same two files | 23 pass, 1 fail (R6); observations identical to run 1 |
| `../probe-r6-baseline-90439483.log` | R6 alone at the round-7 candidate | shows R6 predates BE13 |

An earlier exploratory run of the round-8 probe, made before I added the `text-chunked-noNUL` row, is not kept. Its observations match the final runs, except for that missing row.

## Round-7 repro of F-DG2-290, rerun unchanged: `../../round-7/probes/zz-sec-r7-probe.test.ts`

All 14 tests pass in both runs. In round 7 the same file gave 12 passes and 2 failures (B1, B2); the round-7 log's "15 pass" also counted the 3 round-6 surrogate tests.

| Id | Round 7 | Round 8 |
|---|---|---|
| B1 | `ED A0 80` / `FF` / `C3` with a Content-Length gave **500 internal** | **400 `validation.json`** at pointer `""`. No charter and no audit row. Control `0x41` gives 201. |
| B2 | unauthenticated, real socket: **500** before 401 | **400 `validation.json`** (problem+json). Control: 401. |
| B3 | chunked, authenticated: **201**, with `Synthetic� text` stored and audited | **400**. Nothing stored; no U+FFFD in `charter` or in the audit `changes`. |

A, C, D and E are unchanged: OIDC claims, User-Agent (byte-faithful Latin-1), X-Request-Id, pre-routing errors, and the U+FFFD sweep.

## Round-8 probe: `zz-sec-r8-probe.test.ts`

| Id | Probe | Result |
|---|---|---|
| R1 | Ten ill-formed UTF-8 classes in a charter body, both framings: overlong `C0 AF` / `E0 80 AF`, `F4 90 80 80` (> U+10FFFF), the 5-byte `F8…`, a lone `80`, truncated `E2 82` (mid-string and after the closing brace), CESU low surrogate `ED B0 80`, Latin-1 `E9` | PASS. Each is 400 `validation.json` and declared. Nothing stored, and no error-level log line. |
| R2 | BOM variants | PASS. One BOM gives 201 with the exact text. Two BOMs, BOM + `FF`, a BOM alone, and UTF-16LE/BE BOM bodies each give 400 `validation.json`. A U+FEFF *inside* a string value is stored verbatim, not stripped. |
| R3 | Content-Type variants | PASS. `charset=iso-8859-1` and `charset=utf-16le` never switch the decoder (400 `validation.json`). `APPLICATION/JSON` is matched case-insensitively. `application/vnd.api+json` and `merge-patch+json` give 400 `validation.content_type`. Observation: `application/json;;;=` is accepted as JSON (201), which is harmless. |
| R4 | Prototype poisoning through the new parser: `__proto__`, `__proto__`, `constructor.prototype` | PASS. 400 `validation.json`; `({}).polluted` stays undefined. |
| R5 | `bodyLimit` on raw bytes: 349,571 characters = 1,048,629 bytes (U+20AC) | PASS. 400 `validation.body_too_large` with Content-Length and chunked. A body just under 1 MiB is not refused as too large. |
| **R6** | `uploadEvidenceContent` with media types outside its contract (`application/octet-stream` only) | **FAIL → F-DG2-320.** octet-stream bytes are stored verbatim. **`text/plain`, chunked, with `FF C3 ED A0 80`: 200, and the stored and downloaded content is `EF BF BD` × 5 (U+FFFD); the recorded sha256 is of the rewritten bytes.** `application/json` with `{"a":1}` or `[1,2,3]`: **500 internal (undeclared)** plus an error-level "unhandled error" log line. `application/json` with `"Synthetic"`: 200, and the JSON-decoded text is stored, not the bytes sent. `text/plain` with a Content-Length gives 400 `validation.malformed_request`, a BE13 improvement: it was a 500 at `90439483`. |
| R7 | Query strings | PASS. `?q=%FF` gives 400 `validation.format` at `/query/q`. `?%FF=1` → `/query`. A repeated key → `/query/q`. RFC 6901 escaping → `/query/a~0b~1c`. A stray `%` → 400. `50%25`, `a+b` and an emoji → 200. `__proto__` / `constructor` → 400 `unknown_field`. `%00` → 400 `invalid_character`. `/api/v1/me`, `/healthz` and `/readyz` with `%FF` → declared 400. Unauthenticated → 401 first. Unmatched route → 404. No error log. |
| R8 | X-File-Name ordering | PASS. A contributor or auditor who may not edit the item gets **403** for `x%FF.csv`, so there is no 400-before-authorization oracle. `%41%.csv` → 400 `validation.file_name`. `50%.csv` is stored literally. |
| R9 | A real socket, chunked, no session, `FF` in the JSON | 400 `validation.json`. Body parsing precedes authentication, as documented; it is declared. |
| R10 | U+FFFD sweep of `charter`, `audit_event.changes` and `evidence_content.file_name` | PASS: 0 / 0 / 0. The only error-level log lines in the whole file are the two R6 JSON 500s. |

## R6 at the round-7 candidate (`../probe-r6-baseline-90439483.log`)

The R6 observations are the same at `90439483`, except that `text/plain` with a Content-Length was then a 500. F-DG2-320 therefore **predates BE13**; it is not a regression. The upload route installs its own octet-stream parser, but Fastify's default `text/plain` parser and the root JSON parser stay registered and reach the handler. `FileSystemEvidenceStore.put` (`apps/api/src/modules/evidence/store.ts:75-83`) then iterates whatever it is given: a string character by character, or a plain object, which throws a TypeError and gives the 500.
