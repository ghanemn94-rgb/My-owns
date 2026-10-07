# Assignment T-DG2-FE13: a session end clears session data wherever it happens, and no identity ever sees another's cache (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** the full text is in `docs/delivery/findings.json`. The reviewer's probe is `docs/delivery/test-evidence/DG2/code-security/round-14/probes/zz-sec-r14-web-probe.test.tsx` (W5/W5b), and its logs are alongside. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair
**F-DG2-500 (Medium): a session that ends while the sign-in page is shown never clears the session-scoped cache. The next identity to sign in in that tab sees the previous user's records.**
- FE10 moved the session-end rule into the API client (`apps/web/src/api/client.ts` `endSession`), but **only `<RequireSession>`** clears the cache (`auth/session.tsx` `claimSessionEnd()` + `removeQueries`), and only while it is mounted.
- The sign-in page is outside `<RequireSession>`. It re-probes `/me` on mount, and a 401 there ends the session but clears nothing.
- The next successful `/me` sets the phase back to `active` (`queries.ts` `markSessionActive`). The end is never claimed, and the sign-in page navigates to `returnTo` with the previous user's queries still cached.
- One way to reach it: the browser Back button returns to an in-document `/login` entry after a sign-in in that document. Another: a refocus `/me` after an IdP sign-in in another tab.

## Required: make the invariant structural
1. **Clear wherever the session ends.** The session-scoped cache is cleared **in the same place the session-end transition happens**, whatever page is mounted. This includes the sign-in page and any route outside `<RequireSession>`. It must not depend on a component being mounted. For example, the client's `endSession` calls a registered cache-reset hook that the app wires to the `QueryClient`.
2. **Defence in depth on identity change.** Whenever `/me` returns an identity, its user id or session subject, that differs from the last identity this document rendered, every session-scoped query is removed **before** anything renders under the new identity. This covers every path, including sign-in in another tab and Back/Forward navigation.
3. **Sign-out in this tab** keeps clearing as today. FE10's guarantees still hold: one navigation, bounded `/me` requests, no stale shell, and a 403 is never a session end.
4. **Sweep.** List every cache that can hold session data (React Query, module state, `localStorage`/`sessionStorage`, in-memory singletons such as the CSRF token, people or user caches, draft forms) and how each is reset on a session end and on an identity change.
5. **Tests.**
   - Unit/component tests:
     - the reviewer's W5 (Back to `/login` after a session end, then the dev-login of user B: B never sees A's records) and W5b;
     - an identity change via a refocus `/me`;
     - sign-out here;
     - a 403 is not an end.
   - e2e on the real stack, EN and AR: user A sees a record; A's session ends while the sign-in page is shown; user B signs in in the same tab and never sees A's record.
   - Negative control: the new tests fail on `HEAD`.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or React warning in any log, and explain it.**
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm test` on Node 22 **and** 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- the web e2e P1+P2+`p2-blank-text.spec.ts`+`session-end.spec.ts`, in chromium-en and chromium-ar (`--workers=1`), with axe reporting 0 serious or critical
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE13-frontend-ux-engineer.md` with the fix, the sweep table and every check's real output. Keep evidence to logs and at most two cited screenshots.
