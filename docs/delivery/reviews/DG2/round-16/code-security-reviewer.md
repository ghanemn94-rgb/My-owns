# DG2 round 16 — code-security-reviewer (T-DG2-REV-SEC-R16)

**Candidate:** sha256:0cab0a8c… (562 files), source e3b2375, frozen at f4242ae.
**Verdict:** FAIL. F-DG2-530 does not verify CLOSED. No new finding ids.

## F-DG2-530: verification FAIL; stays OPEN (Low, not mandatory)

**What FE14 gets right.** The session generation in `apps/web/src/api/client.ts` is correct:
- Each request records the generation when it is sent, and checks it again on every exit path.
- The generation moves before the reset hooks run.
- A stale 401 can no longer end the new identity's session.

My round-15 probe, rerun unchanged, now passes 6/6, X3 included.

**X6.** It holds with the production defaults: a refocus sends GET /me first, so the header and the data are the same identity's.

**FE10/FE13.** My round-14 probe, rerun unchanged, passes 26/26: returnTo, 403s, one navigation, bounded /me, no stale shell.

**Remaining gap (probe Y1, Node 22 and 24).**
1. In `TransformationCreatePage.tsx:186-201`, A's POST returns 201 under A's generation, so the client correctly returns it.
2. The handler then awaits `invalidateQueries` and `refreshEffectivePermissions` (a GET /me).
3. If A signed out and B signed in in another tab while the POST was in flight, that /me returns B. The state is reset, but the handler still navigates to `/transformations/<A's id>` with A's code and name in router state.
4. B's GET answers 404, so the detail page renders `CreatedNotVisible` from that router state. Under B's header, B reads "TR-A-NEW-SECRET · A-CREATED-SECRET-NAME was saved as a draft…".

This breaks the finding's expected result ("no response to a request issued under a previous identity … rendered") and FE14's claim ("no late success handler can … navigate or render").

The same navigate-after-await pattern, which navigates without showing any data, is at:
- `TransformationEditPage.tsx:131-133`
- `OrganizationsPage.tsx:157-159`
- `UsersPage.tsx:292-294`

**Suggested fix.** Capture the generation at submit and check it again after each `await`, before any `setQueryData`, navigation or router state. Or wrap `navigate` so that it drops navigations from a previous generation. Add a create-flow test in which the /me after the create returns another identity.

## Observation (not raised)

**Y5.** An in-app navigation with no focus or visibility event fetches the new page with the current cookie. If B signed in elsewhere, the page shows B's data under A's header until the next /me. Only the cookie holder's own, server-authorised data is shown. Writes carry A's CSRF token, which is bound to A's session, so the server refuses them with 403.

## Checks

Every required check ran and exited 0:
- typecheck, build, lint, openapi-lint (161 operations), no-cdn, format
- unit tests 892/892 on Node 22, on Node 24, and under load on both
- integration 612/612 in two runs: SQL_ASCII with LANG unset, and UTF8 with LANG=C.UTF-8. Every named suite passed, as did migrations 0001-0019.
- AUD-403 sweep 146/146
- `validate.mjs --historical` for DG0 and DG1

Disclosed, non-failing lines:
- install `WARN` lines about the `mth-db` bin (it doesn't exist before the build)
- Vite's chunk-size advisory
- one Fastify FSTDEP022 deprecation notice in the unit logs

The only non-zero exits are the r16 probe runs (exit 1). That is by design: Y1 fails.

The assignment's diff range `fe22d759..cbdb4f68` is stale (round 10→11). I reviewed the actual round-15→16 product change, `ed80b23..e3b2375`.

The environmental residuals D-057, D-058 and D-049 pass on the offline/config surface, with each residual noted.
