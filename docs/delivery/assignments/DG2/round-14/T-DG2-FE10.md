# Assignment T-DG2-FE10: a session that ends while the app is open lands once on sign-in (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** the full text is in `docs/delivery/findings.json`. The reviewer's probes, logs and screenshots are under `docs/delivery/test-evidence/DG2/domain/round-13/` (`r13-session-end-ui.mjs`, `r13-ui-withdrawn.mjs`, `with-stack-default-limits.sh`, `screens/`). Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair
**F-DG2-480 (High, non-mandatory, REQ-S16-030): when a session ends while the app is open, the client loops forever. Pre-existing since DG1; D-073's commit-time 401 now also leads into it.**
- **Triggers.** A session can end in several ways: access revoked, signed out in another tab, idle or absolute expiry, or an upload refused with 401 at commit.
- **What the user sees.** The page alternates between `/login?…&error=session_expired` and the original route:
  - a blank page, with no sign-in form and no localized message;
  - about 130-140 `/me` requests per second.
- **With default rate limits.** The per-IP bucket (an ended session is keyed by IP) is exhausted in about 2 s. The tab then shows a stale signed-in shell with "Too many requests", and other sign-ins from that IP are refused for the rest of the minute.
- **Cause.**
  - `apps/web/src/auth/session.tsx` `RequireSession` redirects on a 401 while `me.data`, the last successful `/me`, is still cached.
  - `apps/web/src/pages/LoginPage.tsx:66` (`if (me.data) return <Navigate to={returnTo} replace />`) sees the same stale `me.data` and sends the user straight back.
  - Each mount re-probes `/me`.

## Required
1. **One rule for "the session has ended".**
   - When any request answers 401 `unauthenticated` because the session ended, the client **clears the cached identity and every session-scoped query**, then navigates **once** to `/login?returnTo=…&error=session_expired`.
   - The sign-in page shows the localized `auth.errors.session_expired` message (EN LTR / AR RTL) and the sign-in form.
   - Signing in again returns the user to `returnTo`.
   - The login page decides "already signed in" only from a **fresh** `/me` result, never from a stale cache.
2. **Bounded requests.** At most a small, fixed number of `/me` requests per session-end, with no retry storm. A signed-out user never sees the signed-in shell. A dialog that received the 401, such as the evidence upload, either closes or shows its message before the redirect; it must not loop.
3. **Sweep.** List every place that reads the cached identity or reacts to 401/403 (`RequireSession`, `LoginPage`, `Shell` and sign-out, the `api` client, React Query defaults and retries, dialogs) and how each now behaves. Make sure a 403 (forbidden) is never treated as a session end.
4. **Tests.**
   - **Component/unit, EN and AR:** each trigger (401 on navigation, 401 on a mutation or dialog, sign-out elsewhere) ends with exactly one landing on sign-in with the message, a bounded `/me` count, and no stale shell.
   - **e2e on the real stack:** the reviewer's scenarios.
     - Sign out elsewhere, then click an in-app link: the sign-in form and message appear within about 1 s, with no loop, in chromium-en and chromium-ar.
     - The commit-time upload refusal after revocation: the dialog shows its message, then sign-in.
     - Run once with the product's **default** rate limits: no 429, and a second browser context from the same IP can still sign in.
     - axe: 0 serious or critical on the sign-in page with the message.
   - **Negative control:** the new tests fail on `HEAD` before your change.

## Self-verification (real output in the handback)
Run every check in **both locale settings**. **Report every non-zero exit, failed suite, hook timeout or React warning in any log, and explain it.**
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm test` on Node 22 **and** 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- the web e2e P1+P2+`p2-blank-text.spec.ts` plus your new spec, in chromium-en and chromium-ar (`--workers=1`), with axe reporting 0 serious or critical
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE10-frontend-ux-engineer.md` with the fix, the sweep table and every check's real output. Keep evidence to logs and at most two cited screenshots.
