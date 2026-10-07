# DG2 round 11: qa-verifier narrative (T-DG2-REV-QA-R11)

**Verdict: PASS.** Candidate `sha256:23e6c0a2…7bad` (547 files, source `cbdb4f68`). One new finding, F-DG2-430 (Low, non-mandatory, pre-existing).

## Setup
- **Clones.** I ran everything in two disposable clones of `309aff2` under `$TMPDIR`, removed afterwards. The candidate ID matched at the start and at the end.
- **HEAD moved** only through the other reviewers' round-11 evidence commits. I did not open them, and no candidate file changed.
- **Independence.** I read no other reviewer's round-11 record.

## Regression (both locale settings: LANG/LC_ALL unset, LANG=C.UTF-8)
| Area | Result |
|---|---|
| typecheck, build, lint, openapi:lint (161 ops), no-cdn, format, contrast | all exit 0 |
| Unit `pnpm test` | 7 runs (Node 22 ×3, Node 24 ×3, plus one under load): 771/771 each |
| Integration (disposable PG UTF8/C, unique ports) | 6 runs (3 per setting): 623/623 each, every assigned file green, BE16 connection-hygiene 13/13 |
| Product e2e (chromium-en + chromium-ar) | 64/64 per setting, including Define→G2, Design→G3 and p2-blank-text |
| qa-stack acceptance (`server_encoding UTF8` logged) | 118/118 per setting (a20, R8, R9, R10, new R11, apps/web/e2e) |
| axe | 636 scans, 0 serious or critical, error states included |
| validate `--register` / `--pipeline` / `--reconcile`; `--historical DG1` | PASS |

## New BE16 checks (`tests/round-11/e2e/dg2-qa-r11.spec.ts`, raw TCP against the built API, PostgreSQL and the store)
- **R11-01: over-limit uploads.**
  - I replayed the auditor's repro: 30 MiB chunked, HTAB spelling, one write, then an 8 s wait. The server sent 413 and `Connection: close`, and closed the socket about 0.5 s later, not after ~65 s.
  - Content-Length and chunked bodies, fully sent or stalled with the client still open, all got 413 and a close within 1 ms.
  - When a 25 MiB + 1 body has fully arrived, the 413 keeps the connection, per BE16 policy 3. I checked that this connection is not held: the next GET /me on it returned 200.
  - Nothing was stored, no audit row was written, and the version did not change.
- **R11-02: shutdown.**
  - I ran a second API process. It got SIGTERM while holding a refused upload, an idle keep-alive socket and a fully-sent 413; it exited 0 in under 0.4 s.
  - With an upload stalled in flight, it exited 0 in about 5.03 s (the grace period) and closed the stalled socket.
- **R11-03: binary uploads.**
  - 1 MiB of random data plus all 256 byte values, sent with Content-Length and chunked, and exactly 25 MiB: each was stored byte-exact, with sha256 = DB = Digest, and audited.
  - 25 MiB + 1 got 413.
- **R11-04/05: keep-alive and text.**
  - One keep-alive socket carried 200, 200, 409, 201 and 200 responses and was still open afterwards.
  - Arabic, emoji and ZWJ text cut at every continuation byte, and an Arabic file name, round-trip verbatim (API and DB).
- **R11-06: rate limit.** Unmatched routes return 404 up to the limit, then 429 `rate_limited`.
- **R8-05 / R9-05a–e:** each message is still shown once, in EN and AR.

## Evidence honesty
Every non-test line in the cited logs is explained in the record:
- **Build:** Vite's chunk-size advisory.
- **Contrast:** the documented prohibited pairs, which must fail.
- **Install:** the `mth-db` bin warning, printed before the first build.
- **npx:** `npm warn Unknown project config` (pnpm-only `.npmrc` keys).
- **`deps:verify` exit 124:** the sandbox has no network (D-057).
- **Unit runs:**
  - The FSTDEP022 deprecation comes from a test-only Fastify instance in `framework-errors.test.ts:91`.
  - The React setState-in-render warning is raised as **F-DG2-430**. `RecordForm` calls `onValuesChange` inside a `setValues` updater, which the Team assign dialog uses. Behaviour is correct and the warning was already present in round 10.

My first dry run of the new spec failed one assertion: I had expected `Connection: close` even after a fully-received over-limit body. That was my error, not a product defect. The dry run isn't counted; I corrected the spec before the counted runs.

## Residuals (PASS on the offline/config surface, not BLOCKED)
- **D-057 (live registry):** the offline frozen install works; `deps:verify` can't reach the registry.
- **D-058 (live CI):** the workflow configuration is unchanged since round 10; there was no live run.
- **D-049 (Keycloak):** `oidc.test.ts` passed 33/33 in all 6 integration runs.

All data is synthetic. This engineering review grants no business approval (G1–G6) and is unrelated to DG7.
