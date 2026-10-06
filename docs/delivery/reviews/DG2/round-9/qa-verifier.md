# DG2 round 9: qa-verifier narrative (T-DG2-REV-QA-R9)

**Candidate:** `sha256:45ebccc0…0066294` (544 files), source `7854770e`.
**Verdict: PASS.** No new findings.
**F-DG2-340:** CLOSED_VERIFIED (see `qa-verifier.verifications.json`).

## F-DG2-340 (one alert per form-level error): verified
- **R8-05, unchanged.** I re-ran my round-8 spec in chromium-en and chromium-ar, in both locale settings: 4/4 green. The screenshots now show "The request was not valid JSON." / "الطلب ليس بصيغة JSON صالحة." once. In round 8 they showed it twice.
- **R9-05a, c, d, e.** These checks run against the real server with a tampered invalid-UTF-8 body. They cover the charter, the P1 transformation create form, the P1 admin organization create form and the ReasonDialog. On each, exactly one `role="alert"` carries the message, it appears once in the page text, and nothing is written.
- **R9-05b.**
  - A server `validation.blank` at `/outOfScope` stays on its field. The form-errors list stays empty and the generic banner appears once.
  - The real server's pointer-`""` `unknown_field` message is also said once.
  - A genuinely different second message is still listed. For this sub-check only, the browser receives a fulfilled problem, because the real server never pairs a pointer-`""` error with a distinct error that maps to no field.
- **Static sweep.** I checked every `role="alert"` in the SPA: GateDetailPage, JourneysSection, RowActions, ReasonDialog, the admin and transformation forms, the evidence pages and DefinePage. None of them can render a pointer-`""` message in a second region.

## D-069 regression (declared request media types)
- **Undeclared uploads.** `uploadEvidenceContent` was sent in 9 undeclared media types × 2 framings. Every request got 400 `validation.content_type` at `""`, with 0 audit rows (psql on the real DB), no `evidence_content` row, no stored file, and a download of 404.
- **No session.** The same refusal is also a 400 without a session. That is the documented order: body parsing runs before authentication.
- **Valid binary.** Three revisions were uploaded: all 256 byte values plus random bytes with Content-Length, a chunked revision split mid-buffer, and one sent as `Application/Octet-Stream; charset=binary`. Each download is byte-identical, and its sha256 matches both the database and the `Digest` header. Each upload is audited, and the Arabic/emoji file name round-trips.
- **JSON operations.** Charter and transformation requests in 16 undeclared media-type variants are refused, and nothing is written. Logout (no request body) with a text/plain body is refused, and the session stays signed in. JSON with an iso-8859-1 or utf-16 body gets a 400 `validation.json`, never a 5xx. `application/json; charset=UTF-8` and `APPLICATION/JSON` are accepted.
- **Arabic/emoji text.** It round-trips verbatim, even when the body is cut at every continuation byte.
- **Observation, not a finding.** For the two bodiless operations, the 400 detail reads "Send the request body as application/json." The code is correct and declared, and the UI shows the localized code text, not this detail.

## Full regression (both locale settings)
| Area | Result |
|---|---|
| Static checks | typecheck, build, lint, openapi:lint (161 ops), no-cdn, format and contrast all pass |
| Unit | 7/7 runs, 718 tests each (Node 22 ×3, Node 24 ×3, plus one under load) |
| Integration | 6/6 runs, 559 tests each, PostgreSQL UTF8/C, port attempt 1 every time |
| QA acceptance suites | 599/599 in each locale setting |
| Product e2e | 64/64 in each locale setting, including Define→G2 and Design→G3 |
| qa-stack | 94 (unset) and 96 (C.UTF-8), plus the final R9 spec alone at 20/20; `server_encoding UTF8` logged |
| Axe | 636 scans, 0 serious or critical violations |
| Validators | register, pipeline and reconcile all PASS |

## Process note
My first QA-suite attempt failed 2 tests because I had also copied my superseded **round-1** `dg2-qa-journey.test.ts`. That file probes `PATCH status:active` instead of the `/activate` route. A control run on the round-8 candidate fails the same 2 tests, so this is not a regression. I re-ran with round 8's file set, and both locale settings were green. The details are in `13-attempt1-cause.log`.

## Residuals (not BLOCKED)
- D-057: no live registry (the offline frozen-lockfile install passes).
- D-058: no live CI run (the CI config was inspected).
- D-049: no live Keycloak (the offline OIDC suite, 33 tests, passes).

## Scope of this verdict
This verdict grants no business approval. Product G1–G6 never imply DG7. All data is synthetic.
