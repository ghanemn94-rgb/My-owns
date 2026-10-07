# code-security-reviewer DG2 round-11 probe (T-DG2-REV-SEC-R11)

`zz-sec-r11-probe.test.ts` (sha256 0b60ece2…) is NOT part of the candidate. It was copied into disposable clones at
`apps/api/test/integration/` and run on disposable PostgreSQL 16 clusters (`../with-pg.sh`). All data is SYNTHETIC.
Every assertion states the secure/declared expectation, so a failing assertion is a defect (or, at 7fd1a89c, an option
that does not exist there). Each observation is logged as `PROBE <key>: <json>`.

| Log | Clone / candidate | Node, locale | Result |
|---|---|---|---|
| `../repro-7fd1a89c.log` | 68fe3394 = round-10 candidate 7fd1a89c (source fe22d759) | 22.22.2, LANG unset | 3 pass, 14 fail, exit 1 |
| `../probe-23e6c0a2-node22-lang-unset.log` | 309aff2 = round-11 candidate 23e6c0a2 (source cbdb4f6) | 22.22.2, LANG unset | 14 pass, 3 fail, exit 1 |
| `../probe-23e6c0a2-node24-lang-c-utf8.log` | 309aff2 = round-11 candidate 23e6c0a2 | 24.21.0, LANG=C.UTF-8 | 14 pass, 3 fail, exit 1 |

No log contains `Hook timed out` or `Failed Suites`. The afterAll hook closes the shared instance; every test closes its
own instance with a capped close (`timedClose`) and reports the time.

## Every failing assertion, explained

At **23e6c0a2** (both runs, identical):
- `R6a` stalled JSON body cut by requestTimeout: 408 and close are correct; the assertion that fails is `errs == []`:
  one level-50 `unhandled error` (`aborted`, ECONNRESET, statusCode 400) → finding **F-DG2-412**.
- `R6d` client aborts a JSON body: same `unhandled error` → **F-DG2-412** (also at 7fd1a89c).
- `R8` six stalled uploads on six items (harness pool max 5): another user's `GET /api/v1/me` and `/readyz` get no
  answer within 5 s → finding **F-DG2-411** (also at 7fd1a89c). R8b shows that the hold ends at requestTimeout here.

At **7fd1a89c** (the round-10 candidate):
- `R1` chunked and content-length, `R1c`: the auditor's defect reproduced → finding **F-DG2-410**. 413 with
  `Connection: keep-alive`; the server never closes; it releases the socket 69,985/69,998 ms after the client destroyed
  it; `app.close()` right after the client destroy takes 71,994 ms.
- `R3`: the sibling defect (part of F-DG2-410): 401/403/428/404 refusals before the body is read stay keep-alive and
  drain 292-302 MiB in 6 s without closing.
- `R6d`, `R8`: as above (F-DG2-412, F-DG2-411). `R6e`: client abort mid-upload gave an `unhandled error` (fixed by BE16).
- NOT evidence, they fail only because the option does not exist at 7fd1a89c (the harness ignores `server: {...}`):
  `R4`/`R4b` (no SPA webRoot, unmatched routes not metered), `R5` (no shutdown grace), `R6a`/`R6b`/`R6c` (no
  requestTimeout: no 408 within 6 s), `R8b` (no requestTimeout: `/me` still blocked after 15 s).

## Sections
R1/R1c over-limit 30 MiB upload (chunked, CL) · R2 keep-alive after 200 and byte-exact sha256 · R2b over-limit body
received in full · R3 refusals before the body is read · R4/R4b unmatched-route rate limiting, SPA fallback, CSRF ·
R5 bounded shutdown · R6a-e requestTimeout and aborts · R7 bodyLimit/UTF-8/media type/CSRF/authz matrix (compared across
candidates: identical) · R8/R8b stalled uploads and the DB pool.
