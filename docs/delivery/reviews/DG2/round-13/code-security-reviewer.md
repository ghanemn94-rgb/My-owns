# DG2 round 13 — code-security-reviewer narrative

- Candidate: `sha256:6824b8b8d36a688178a058c11c4882737a79cf7f39b438dcf2390eafb88d3afc` (556 files). I recomputed it in the working tree and in a clean clone at the freeze commit 5699f72.
- Source commit: aa0a68f.
- Session: 6525d5f1.
- **Verdict: PASS. No new findings.**

## Scope note

The assignment names `fe22d759..cbdb4f68` as the re-review range. That is the round-10 to round-11 range, which round 11 already reviewed. The product change since round 12 is `8488e7a..aa0a68f`, a single commit: BE18A 8c0083e (18 files). I reviewed that range.

## F-DG2-440: commit-time authorisation — CLOSED_VERIFIED

**How the fix works.** Phase 3 of the upload calls `openWrite(..., { atCommit: true })`.

- This calls `refreshPrincipal`, which runs `request.reauthenticate(tx)`. That is the identity module's own `principalFor`, the same resolution the authentication hook uses.
- `principalFor` re-reads the session row inside the write transaction. It checks that the session is not revoked, has not hit its idle or absolute expiry against `now()`, and that the user is still active.
- It requires the same user ID and reloads the grants.
- If there is no session (or no resolver at all), the request gets 401.
- The read and write gates then run on the reloaded principal. A read right revoked meanwhile becomes 403 with the denial kept, so the denied-mutation audit fires.
- The catch block discards the temporary object.

**Why JSON routes are not exposed.** Fastify parses JSON bodies before `preValidation`. Their request-start snapshot is therefore already taken after the client has finished sending.

**Results:**

- My round-12 Q1 (grant revoked mid-body) now gets 403 and Q1b (logout mid-body) gets 401, with nothing stored in either case. Both returned 200 in round 12.
- New adversarial cases:
  - **Role downgrade** (WL → AUD at the same scope, read right kept): 403, audited as `authorization.denied` with "requires evidence.create".
  - **Owner reassigned** away from the uploader mid-body: 403.
- The candidate's own tests cover idle and absolute expiry, a disabled user and the re-grant race. They pass in both locale runs.

**Observation, not a finding (S3).** Phase 3 reads authority first and takes the item's `FOR UPDATE` lock afterwards. A revocation that commits while phase 3 waits on that lock does not stop the upload; the probe measured a 200.

- This is the residual the fix declares: phase 3's own transaction.
- Only another short transaction holding the item's row lock can lengthen it. `statement_timeout` (30 s) bounds it.
- The uploader cannot extend it through the API.
- Optional hardening: take the lock before re-authorising.

## F-DG2-441: no remote call inside a transaction — CLOSED_VERIFIED

- `prepareLogin` (OIDC discovery and the random values) now runs before any transaction. `saveLoginState` is a single INSERT.
- My round-12 Q7, run with a never-answering IdP:
  - all sessions are `idle`, none idle in transaction;
  - `/me` answers in 18–22 ms (9 s in round 12);
  - the logins end in a 302 `idp_unavailable`.
- My own TypeScript-AST sweep covered 135 source files. The only non-database await inside a transaction is the documented `finalise` rename.
- State, nonce, PKCE and browser binding are unchanged. `oidc.test.ts` passes 33/33.

## Do the BE18A shutdown and sweep open a new hole? No

**The sweep:**

- It removes only a regular `<uuid>.part` file, exactly three levels deep, older than 1 h.
- It ignores symlinks, both file and directory symlinks; outside targets survive.
- It ignores wrong depths, upper-case UUIDs, other suffixes and directories.

**A live upload on shared storage:**

- A fresh live temporary is kept, and that upload then commits.
- If the live temporary is back-dated beyond the 1 h margin, it is swept. The upload then fails closed: 500, no content row and no object. So no committed row ever points at a missing object.

**Shutdown with a stuck handler:**

- I held a PATCH on a row lock, then sent SIGTERM. The process exited at 10.0 s through the backstop, after logging that a handler was still pending.
- The PATCH did not commit.
- The settle wait cannot extend shutdown past the backstop.

## Checks run

All exited 0:

- typecheck, build, lint, OpenAPI lint (161 operations), no-CDN, format;
- unit tests: 796/796 on Node 22 and Node 24, and again under load (loadavg up to 8.4 on 4 vCPU);
- integration: 612/612 twice — LANG unset (SQL_ASCII) on Node 22, and C.UTF-8 on Node 24. This includes contract, media-types, BE16, BE17, BE18A, oidc and encoding suites, migrations 0001–0019, and the AUD sweep (146/146);
- historical validation of DG0 and DG1.

Every error-level line in the cited probe logs comes from a fault I induced on purpose, and each is explained in `test-evidence/DG2/code-security/round-13/probes/README.md`:

- Q4: COMMIT failure;
- Q5b: store fault;
- V3: a live temporary swept;
- X1: the backstop.

**Environmental residuals.** D-049 (Keycloak), D-057 (live registry) and D-058 (live CI) are recorded as PASS on their offline or config surface, as the assignment requires.
