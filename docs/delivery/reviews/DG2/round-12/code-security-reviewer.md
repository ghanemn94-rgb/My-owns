# DG2 round 12: code-security-reviewer narrative

- **Candidate:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8` (552 files; source 8488e7a; freeze 744af0b). Recomputed in the working tree and in a clean clone.
- **Verdict: PASS.** Two new findings, both pre-existing, neither Critical, High nor mandatory.

## Round-11 findings
- **F-DG2-411: CLOSED_VERIFIED.** The upload now holds no pooled connection, transaction or row lock while it receives the body.
  - The round-11 probe's R8 passes: `/me` answers in 10 ms while 6 uploads stall on a pool of 5. In round 11 it got no answer.
  - My new Q6b (read as superuser) shows no session idle in transaction, and `FOR UPDATE NOWAIT` succeeds on a stalled item.
  - The three-phase design holds under attack:
    - same-If-Match race: exactly [200, 409], with one revision, one audit event and one object;
    - archive during the body: 422;
    - COMMIT failure after finalise: 500, with no row, object or `.part` left;
    - client abort: no `.part` left.
  - The pool settings don't affect the migrate CLI (its own `pg.Client`) or the worker (SQL-only transactions).
- **F-DG2-412: CLOSED_VERIFIED.** R6a and R6d no longer log errors, and a client abort is logged at info level. There's no over-match: a store fault while the body is incomplete stays 503, a COMMIT failure stays 500, and the candidate's database-ECONNRESET test stays 500.

## New findings
- **F-DG2-440 (Medium, not mandatory, REQ-S10-001).** Phase 3 "authorises again", but against the grants and session loaded in `preValidation` at request start.
  - An in-flight upload therefore still commits after the uploader's only grant is revoked (Q1), or after their session is logged out (Q1b). The window is up to `requestTimeout` (300 s).
  - New requests are refused correctly.
  - The same result occurs at the round-11 candidate, so BE17 did not introduce it.
  - Fix: re-resolve the session and reload grants inside the phase-3 transaction.
- **F-DG2-441 (Low, REQ-S16-007).** `GET /auth/login` runs OIDC discovery (an HTTP call to the IdP) inside `db.transaction()`.
  - With an unresponsive IdP, 3 login attempts held all 3 pooled connections idle in transaction, and a signed-in user's `/me` waited 9 s.
  - This dates from DG1 and contradicts the "no remote call" note in `pool.ts`.
  - Fix: resolve discovery before opening the transaction, as the callback already does.

## Evidence honesty
Every non-zero exit in the cited logs is explained in the record and in `docs/delivery/test-evidence/DG2/code-security/round-12/probes/README.md`:
- **round-11 probe:** R8b's `meMs > 1500` is a round-11 defect assertion that the fix inverts;
- **round-12 probe:** Q1 and Q1b fail, which is F-DG2-440;
- **OIDC probe:** Q7 fails, which is F-DG2-441.

Q4's single "unhandled error" log line is the deliberately induced COMMIT failure. Non-failing advisories are also disclosed: Vite's chunk-size line, Fastify's FSTDEP022, and the expected pnpm "Failed to create bin" warnings before the build.

The assignment's re-review range `fe22d759..cbdb4f68` is round 10→11. I reviewed the BE17/FE9 range `cbdb4f6..8488e7a`, which is the one it describes.
