# DG2 round 10 — qa-verifier narrative (T-DG2-REV-QA-R10)

**Verdict: PASS.** Candidate `sha256:7fd1a89c…484a` (544 files, source `fe22d759`). No new findings, and no finding of mine is open.

## Setup
- I ran everything in two disposable clones of `68fe3394` under `$TMPDIR`, removed afterwards.
- The candidate ID matched at the start and at the end.
- HEAD moved twice during the run: first a stages.json timestamp fix, then other reviewers' evidence commits. Neither touched a candidate file (`00-head-moved.log`, `00-candidate-end.log`).
- I didn't read any other reviewer's round-10 record.

## Regression (both locale settings: LANG/LC_ALL unset, LANG=C.UTF-8)
| Area | Result |
|---|---|
| typecheck, build, lint, openapi:lint (161 ops), no-cdn, format, contrast | all exit 0 |
| Unit `pnpm test` | 7/7 runs: Node 22 ×3, Node 24 ×3, plus a load run; 765/765 each |
| Integration (disposable PG, UTF8/C, unique ports) | 6/6 runs (3 per setting): 39 files, 610/610, QA suites included. The assigned files (migrate, protection, bu-hierarchy guard, contract with 161 ops, blank-text, encoding, invalid-character, framework-errors, invalid-utf8, media-types 21, evidence) have 0 failures in every run. |
| Product e2e (chromium-en + chromium-ar) | 64/64 per setting, including Define→G2, Design→G3 and p2-blank-text |
| qa-stack acceptance journey (`server_encoding UTF8` logged) | 108/108 per setting (a20, R8, R9, new R10, plus apps/web/e2e) |
| axe | 636 scans, 0 serious or critical, error states included |
| validate `--register` / `--pipeline` / `--reconcile`; `--historical DG1` | PASS |

## New D-070 checks (`tests/round-10/e2e/dg2-qa-r10.spec.ts`, raw TCP against the real built API + psql)
- **R10-01:** an unmatched route returns exactly one 404 `not_found` with `Connection: close`. I sent 1153 requests per project and setting: 3 paths × 4 methods × 12 bodies (octet-stream, JSON, invalid JSON, invalid UTF-8, text/plain, no or malformed CT, duplicate CT, an embedded HTTP request) × 2 framings × session or anonymous × same-write or delayed body, plus a declared 500 MB body. The audit count did not change, and the embedded request was never answered.
- **R10-02:** uploads with `; x=1`, with HTAB before `;` (Content-Length and split chunks), with a quoted parameter and in mixed case all returned 200. The downloads are byte-exact, sha256 = DB = Digest, and each upload is audited.
- **R10-03:** `application/json\t; charset=utf-8` and the related spellings were accepted. Arabic, emoji, ZWJ and combining-mark text, cut at every continuation byte, is stored and returned verbatim (API and DB). A charter PATCH with HTAB returned 200.
- **R10-04:** duplicate Content-Type lines on a JSON operation and on the upload returned 400 `validation.content_type`, with a detail naming the declared set. Nothing was written: no rows, no version change, no stored files, no audit rows.
- **R10-05:** non-UTF-8 JSON charsets (utf8, latin1, us-ascii, utf-16, windows-1256, utf-8 followed by latin1, and `"utf-8 "`) returned 400 naming application/json, and nothing was written.
- **R10-06:** for 12 malformed or undeclared types, the JSON operation's refusal always names application/json and the upload's always names application/octet-stream, never JSON.

The shipped web client sends only `application/json` and `application/octet-stream`, so none of the tightenings affects it (`40-static-web-content-types.log`).

## Residuals (PASS on the offline/config surface, not BLOCKED)
- **D-057 (live registry):** the offline frozen install works; `deps:verify` timed out with no network.
- **D-058 (live CI):** the workflow configuration was inspected; there was no live run.
- **D-049 (Keycloak):** `oidc.test.ts` 33/33 against the in-process provider; there was no live Keycloak.

All data is synthetic. This engineering review grants no business approval (G1–G6) and is unrelated to DG7.
