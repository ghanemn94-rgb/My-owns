# code-security-reviewer DG2 round-12 probes (T-DG2-REV-SEC-R12)

None of these files is part of the candidate. Each was copied into a disposable clone at `apps/api/test/integration/` and run on a disposable PostgreSQL 16 cluster (`../with-pg.sh`). All data is SYNTHETIC. Every assertion states the secure or declared expectation, so a failing assertion is a defect, unless it is listed below as an inverted round-11 assertion. Each observation is logged as `PROBE <key>: <json>`.

| Probe | sha256 (prefix) |
|---|---|
| `../../round-11/probes/zz-sec-r11-probe.test.ts` (round-11 probe, re-run unchanged) | `0b60ece28601515b` |
| `zz-sec-r12-probe.test.ts` (three-phase upload: TOCTOU, races, leftovers, incomplete-body over-match, pool) | `71cbe705545c06bf` |
| `zz-sec-r12-oidc-probe.test.ts` (sweep: a transaction held while waiting on a remote IdP) | `db10609c2939e142` |

## Runs (`../probe-runs.sh`; clone `$TMPDIR/r12p` at 744af0b = candidate 5dfecce4)

| Log | Node, locale | Result | Failing assertions |
|---|---|---|---|
| `../probe-r11-node22-lang-unset.log` | 22.22.2, LANG unset | 16 pass, 1 fail, exit 1 | R8b `meMs > 1500` (inverted, see below) |
| `../probe-r11-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 16 pass, 1 fail, exit 1 | R8b `meMs > 1500` (inverted) |
| `../probe-r12-node22-lang-unset.log` | 22.22.2, LANG unset | 7 pass, 2 fail, exit 1 | Q1, Q1b: finding F-DG2-440 |
| `../probe-r12-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 7 pass, 2 fail, exit 1 | Q1, Q1b: finding F-DG2-440 |
| `../probe-r12-oidc-node22-lang-unset.log` | 22.22.2, LANG unset | 0 pass, 1 fail, exit 1 | Q7: finding F-DG2-441 |
| `../probe-r12-oidc-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 0 pass, 1 fail, exit 1 | Q7: finding F-DG2-441 |
| `../probe-r12-Q1-on-round11-23e6c0a2.log` | 22.22.2, LANG unset; clone `$TMPDIR/r11c` at 309aff2 = ROUND-11 candidate 23e6c0a2 (before BE17); `-t Q1` | 2 fail, 7 skipped, exit 1 | Q1, Q1b: same 200 there, so F-DG2-440 pre-dates BE17. This used an earlier revision of the r12 probe; its sha is in the log header. Q1/Q1b were unchanged except the control, which then expected 403 and now expects 404. |

No log contains `Hook timed out` or `Failed Suites`. The only error-level line in any probe log is Q4's `"errs":["unhandled error"]`. It is the deliberately induced COMMIT failure, and Q4 asserts that this genuine fault is logged at error level and answered 500 (not hidden as a 4xx).

## Every failing assertion, explained

- **R8b `expect(meMs).toBeGreaterThan(1_500)` (round-11 probe):** this assertion encoded the round-11 DEFECT: `/me` stayed blocked until requestTimeout. With BE17 it answers in 6-10 ms, so the fix inverts it. In the same run, R8 (the F-DG2-411 check) passes: `/me` 200 in 10 ms and `/readyz` 200 in 3-4 ms while 6 uploads stall on a pool of 5. R6a and R6d (the F-DG2-412 checks) pass with `errs: []`.
- **Q1 `expect(r?.status).toBe(403)`:** the contributor's only grant (WL at the transformation) is revoked while the body streams. The upload still commits: 200, revision 1, an audit event attributed to the revoked user. A NEW request by the same session right after the revocation gets 404 (the probe's control). Cause: grants are loaded once per request, in `preValidation` (identity/routes.ts:133-139). The phase-3 `openWrite` re-runs the policy on that request-start snapshot. Finding **F-DG2-440**.
- **Q1b `expect(r?.status).toBe(401)`:** the uploading session is logged out while the body streams. Then `GET /me` with it is 401, but the in-flight upload still commits (200, content stored). Same cause (the session is resolved at request start). **F-DG2-440**.
- **Q7 `expect(act.find(state === 'idle in transaction')).toBeUndefined()`:** the IdP accepts connections but never answers. With the default discovery timeout of 10 s, three unauthenticated `GET /api/v1/auth/login` hold all three pooled connections `idle in transaction`, because OIDC discovery runs inside `db.transaction()` in startLogin (identity/routes.ts:268, oidc.ts:37-59). A signed-in user's `GET /me` then waits 9.0 s. The logins end in a 302 to `/login?error=idp_unavailable` after 10.0 s. Finding **F-DG2-441** (pre-existing since DG1 8332624).

## Passing checks (both Node versions)

- **Q2:** the transformation is archived during the body: 422 `transformation.archived`, nothing stored.
- **Q3:** two uploads with the same If-Match whose bodies complete together: exactly [200, 409 version_conflict]. One revision, one audit event, one object on disk (the committed key), and the sha256 is the winner's.
- **Q4:** a deferred constraint fails the COMMIT after `finalise`: 500 internal, error-level log, no content row, no final object and no `.part`.
- **Q5a:** client abort mid-upload: connection released, a level-30 `request body not received completely` log, no error log, no `.part` left.
- **Q5b:** a genuine store fault (the item directory cannot be created) while the body is still incomplete gives 503 unavailable at error level, not 400.
- **Q6a:** every API pool session has `idle_in_transaction_session_timeout=30s` and `statement_timeout=30s`.
- **Q6b:** pool max 2 with 6 stalled uploads: every api-test session is `idle` (read as SUPERUSER: not idle in transaction), `/me` answers 200 in 6-7 ms, and `FOR UPDATE NOWAIT` on a stalled item succeeds.
