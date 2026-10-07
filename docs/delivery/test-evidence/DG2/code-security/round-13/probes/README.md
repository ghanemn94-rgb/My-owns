# code-security-reviewer DG2 round-13 probes (T-DG2-REV-SEC-R13)

None of these files is part of the candidate. Each was copied into a disposable clone (`$TMPDIR/r13p`, HEAD 5699f72 = candidate 6824b8b8, source aa0a68f) at `apps/api/test/integration/` and run on a disposable PostgreSQL 16 cluster (`../with-pg.sh`, deleted afterwards). All data is SYNTHETIC. Every assertion states the secure or declared expectation, except S3 which is a labelled MEASUREMENT (it asserts consistency, not refusal). Each observation is logged as `PROBE <key>: <json>`.

| Probe | sha256 (prefix) |
|---|---|
| `../../round-12/probes/zz-sec-r12-probe.test.ts` (round-12 probe, re-run UNCHANGED: Q1/Q1b are the F-DG2-440 reproductions) | `71cbe705545c06bf` |
| `../../round-12/probes/zz-sec-r12-oidc-probe.test.ts` (round-12 probe, re-run UNCHANGED: Q7 is the F-DG2-441 reproduction) | `db10609c2939e142` |
| `zz-sec-r13-probe.test.ts` (adversarial: role downgrade, owner reassignment, lock-wait residual, sweep traversal/symlinks/names, sweep vs live upload on shared storage, stuck handler at shutdown) | `8ae4840f168fac7d` |

## Runs (`../probe-runs.sh`)

| Log | Node, locale | Result |
|---|---|---|
| `../probe-r12-node22-lang-unset.log` | 22.22.2, LANG unset | 9 pass, 0 fail, exit 0 |
| `../probe-r12-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 9 pass, 0 fail, exit 0 |
| `../probe-r12-oidc-node22-lang-unset.log` | 22.22.2, LANG unset | 1 pass, 0 fail, exit 0 |
| `../probe-r12-oidc-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 1 pass, 0 fail, exit 0 |
| `../probe-r13-node22-lang-unset.log` | 22.22.2, LANG unset | 7 pass, 0 fail, exit 0 |
| `../probe-r13-node24-lang-c-utf8.log` | 24.21.0, LANG=C.UTF-8 | 7 pass, 0 fail, exit 0 |
| `../probe-r13-dryrun-node22.log` | 22.22.2, LANG unset (dry run before the recorded runs, same probe sha) | 7 pass, 0 fail, exit 0 |

No log contains `Hook timed out`, `Failed Suites`, a failing (×) test or a `stderr |` block. Every error-level line in them is a DELIBERATELY induced fault whose error-level logging the probe asserts or records:

- r12 **Q4** `"errs":["unhandled error"]`: a deferred constraint trigger makes the COMMIT fail after `finalise`; Q4 asserts the genuine fault is answered 500 and logged at error level, with nothing stored.
- r12 **Q5b** `"errs":["request failed"]`: a plain file blocks the item directory (genuine store fault); Q5b asserts 503 at error level, not a hidden 400.
- r13 **V3** `"errs":["unhandled error"]`: the probe back-dates a LIVE `.part` by 2 h (beyond the documented 1 h clock-skew margin) so a second instance's start-up sweep removes it; `finalise` (rename) then fails with ENOENT and the upload answers 500 with no content row, no current content and no object. V3 asserts exactly this fail-closed outcome.
- r13 **X1** `{"level":50,"msg":"shutdown did not finish in time; exiting"}` (inside the PROBE X1 JSON): a PATCH is held on a row lock by the probe, then SIGTERM; the backstop exits the process (code 1) at ~10.0 s. X1 asserts the exit happens within the bound and that the PATCH did not commit.

## Results

- **Q1 (F-DG2-440, unchanged):** grant revoked mid-body: 403 `forbidden`, nothing stored, no `.part`, no upload audit (round 12: 200).
- **Q1b (F-DG2-440, unchanged):** session logged out mid-body: 401 `unauthenticated`, nothing stored (round 12: 200).
- **Q7 (F-DG2-441, unchanged):** never-answering IdP, pool max 3, three concurrent logins: every API session `idle` (none idle in transaction), `/me` 200 in 18-22 ms, logins 302 `idp_unavailable` after the 10 s discovery timeout (round 12: 3 sessions idle in transaction, /me waited 9 s).
- **Q2-Q6b** unchanged results as in round 12 (archive 422, [200, 409] race, COMMIT failure, abort leaves nothing, pool timeouts, no idle-in-transaction).
- **S1:** role DOWNGRADE WL -> AUD mid-body (read kept, `evidence.create` lost): 403 `forbidden`, one `authorization.denied` audit "... requires evidence.create", nothing stored.
- **S2:** the item's owner reassigned away from the uploader mid-body: 403 (the own-row rule on the reloaded ownership), nothing stored.
- **S3 (measurement):** phase 3 authorises, then waits for the item's row lock held by another transaction; a revocation committed during that wait does not stop the commit (200, one row, its object present). This is the documented residual window: phase 3's own transaction, which a concurrent lock holder can lengthen only by its own (short, BE17: no client I/O) transaction, bounded by statement_timeout 30 s. Not attacker-extendable through the API. Recorded as an observation, not a finding.
- **V1:** sweep removes ONLY a regular stale `<lowercase-uuid>.part` exactly 3 levels deep; a fresh `.part`, a stale final object, a `.part` at depth 2 and 4, an upper-case-UUID `.part`, `<uuid>.part.bak`, a DIRECTORY named `<uuid>.part`, a stale `<uuid>.part` SYMLINK to an outside file, and a stale `.part` in an outside tree reached through a depth-0 directory SYMLINK all survive. One info log line, key relative and opaque.
- **V2:** live upload on instance A; instance B (same store) starts and sweeps: removed 0, keptFresh 1; A's upload then commits 200.
- **V3:** see above: fail closed, no committed row pointing at a missing object.
- **X1:** stuck handler at shutdown: exit at 10.0 s (backstop, code 1), log sequence `shutting down` -> grace elapsed -> `request handlers still running after the settle period` (pending 1) -> backstop; the PATCH did not commit.
