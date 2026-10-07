# DG2 round 14: code-security review (T-DG2-REV-SEC-R14)

**Candidate:** `sha256:9f3ca298d029f691330de1eddab806df57d5876307926b50df0312f8882b684e` (560 files). Source `ea9051b`; HEAD `d99de98` = source + the round-14 freeze metadata. The ID was recomputed in the working tree and in a clean clone.

**Verdict: PASS**, with one new finding: **F-DG2-500 (Medium, not a mandatory violation)**. There are no Critical or High findings and no mandatory violations. I have no open finding from earlier rounds to verify.

## Scope note: the diff range in the assignment

The assignment asks for `git diff fe22d759..cbdb4f68`. Those are round-10/11 commits (D-070, D-071). The round-13 candidate's source was `aa0a68f` (my round-13 record), so the round-14 product diff is `aa0a68f..ea9051b`. That diff touches 26 files, all under `apps/web`; I reviewed it plus the full files it touches. The orchestrator may want to correct the range in future assignments.

## What FE10–FE12 change, security-wise

- **Session phase (client.ts).** Module state `unknown | active | ended`. A 401 `unauthenticated`, or a 401 with no problem body, while the phase is `active` ends the session and clears the in-memory CSRF token. A 403 (forbidden or csrf) is never a session end, and neither is a 401 with any other code. GET /me is no longer `silent401`.
- **RequireSession.** When the phase is `ended`, it renders nothing (no stale shell), claims the end once, cancels and removes every query, and navigates once to `/login?returnTo=…&error=session_expired`. The /me query is disabled while the phase is `ended`, so nothing can bounce the user back.
- **LoginPage.** "Already signed in" is decided only from a /me answered after the page mounted (`refetchOnMount: "always"`, `dataUpdatedAt >= mountedAt`). This removes the stale-cache bounce that caused the F-DG2-480 loop.
- **Shell sign-out.** `silent401` on logout, then `markSignedOut()`, `cancelQueries()` and `clear()`. The IdP `endSessionUrl` is still the server-provided value.
- **FE11/FE12.** Messages are held as codes and translated at render time. Output stays React-escaped text, and there is no `dangerouslySetInnerHTML` anywhere in `apps/web/src`.

## Adversarial probes (web, jsdom, product fixtures, synthetic data)

| Case | Result |
|---|---|
| W1 `returnTo`: 16 hostile forms (`//`, `/\`, tab, newline, U+2028, U+00A0, `javascript:`, `data:`, `https:`, nested `/login`, …); the OIDC href; the signed-in Navigate | All refused → `/`. The OIDC href carries `returnTo=/`. No cross-origin navigation. |
| W2/W3: 403 forbidden, 403 csrf, 401 `auth.login_failed` | Not a session end. The phase stays `active` and the shell stays. |
| W4 request storm: an inconsistent server (/me 200, every other GET 401, with or without a problem body) | 4 requests and 1 navigation in 2 s; no loop. |
| **W5/W5b cross-user cache** | **FAIL → F-DG2-500** |
| W6: Back ×3 after a landing | Stale shell never rendered; 1 request. |

API regression: my round-12 probes (9/9; OIDC 1/1) and round-13 probe (7/7) were rerun unchanged on Node 22 (LANG unset) and Node 24 (LANG=C.UTF-8). All pass.

## F-DG2-500 in short

Only `<RequireSession>` clears the cache when the phase becomes `ended`. The sign-in page lies outside it, but its /me goes through the same client, so a 401 there ends the session and nothing claims or clears that end. The next GET /me 200 sets the phase back to `active`.

Reproduction: user A's session ends while an in-document `/login` entry is shown (Back after the sign-in page's wordmark link). User B then signs in in that tab, either with the development form (W5) or, in OIDC mode, through the /me re-probe after an IdP sign-in in another tab (W5b). B is shown A's cached row `TR-A-SECRET` until B's own list request returns.

Why Medium and not mandatory: server-side authorisation is intact, and the data is what A already held in that tab's memory. In production the chain needs a pushed in-document `/login` entry, a session end, Back to that entry, and a different identity on the same browser profile.

Suggested fix: clear session-scoped queries where the phase changes, independent of which route is mounted. Alternatively, drop every query on any transition into `active` whose user differs from the cached one.

## Observation (no finding)

In the exploratory trace (W4 variant, not retained as evidence), after a landing caused by a non-/me 401 the sign-in page's own fresh /me 200 did not re-render the page. It proceeds on the next /me re-probe (a refocus), which I verified ad hoc. This is bounded and safe from a security standpoint. Domain/QA may want to look at it as UX.

## Not run

The Playwright e2e `apps/web/e2e/session-end.spec.ts` was not run: no browser binary is installed in this sandbox. It is not on my required-check list, and the jsdom probes above cover the same client logic.

## Disclosure of non-zero exits and error lines

- **Web probe logs.** Exit 1 on both Nodes: W5 and W5b fail, which is the finding. The dry-run log (an earlier probe draft) also failed two cases. One was a wrong expectation of `/my-work`. In the other, W6 navigated to a page that issued no request. Both were corrected before the recorded runs.
- **Everything else exits 0.** The error-like lines in those logs come from passing tests:
  - Fastify FSTDEP022 deprecation notices;
  - the expected `mth-db` bin warnings before the build;
  - Vite's chunk-size advisory;
  - by-design 408, abort, ECONNRESET→500 and idp_unavailable diagnostics in the integration runs;
  - the round-12 Q4/Q5b and round-13 V3 by-design 500/503 assertions.

  Each is explained in the corresponding check.
