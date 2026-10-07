# Assignment T-DG2-FE15: complete F-DG2-530 and repair F-DG2-570 and F-DG2-580, so the header, the data and every effect belong to one identity (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** F-DG2-530 stays OPEN. Code-security's round-16 verification **FAILED** it: the fix is real for the original reproduction but incomplete for the class.
  - The note is in `docs/delivery/reviews/DG2/round-16/code-security-reviewer.verifications.json`.
  - The probe is `docs/delivery/test-evidence/DG2/code-security/round-16/probes/zz-sec-r16-web-probe.test.tsx` (Y1, Y1c, Y4, Y5).
  - The check is SEC-R16-19 in `docs/delivery/reviews/DG2/round-16/code-security-reviewer.json`.

## What is still wrong
- **FE14 gates the answer of each request. It does not gate what a success handler does after a further `await`.**
  - In `TransformationCreatePage.tsx:186-201`, the handler takes the 201 under A's generation. It then awaits `invalidateQueries` (:193) and `refreshEffectivePermissions` (:199, a `GET /me`).
  - If B signed in in another tab meanwhile, that `/me` returns B and the generation moves. The handler still navigates to `/transformations/<A's new id>` with A's code and name in router state (:200-201).
  - `TransformationDetailPage.tsx:58-66` then renders `CreatedNotVisible` from that state. **B reads A's new record's code and name, presented as B's own creation.**
- **F-DG2-580 (Low; qa round 16) is the same create path, reproduced on the real stack.** The spec is `docs/delivery/test-evidence/DG2/qa/tests/round-16/e2e/dg2-qa-r16.spec.ts` R16-06, which failed 6 of 6 in EN and AR. It also failed on FE14's parent, so it is not a regression. It must pass after your change.
- **The same unguarded navigate-after-await pattern** is in `TransformationEditPage.tsx:131-133`, `OrganizationsPage.tsx:157-159` and `UsersPage.tsx:292-294`. There it navigates B to A's record id, but the server still authorises what B can see.
- **F-DG2-570 (Low; domain round 16; code-security's observation Y5).**
  - The full text is in `docs/delivery/findings.json`. The probe is `docs/delivery/test-evidence/DG2/domain/round-16/r16-identity-nav.mjs`, with its log alongside.
  - After the user changes in another tab, a return to the tab within the 15 s fresh window asks no `GET /me`. Pages opened afterwards are fetched under the new identity, while the header, the permissions and the empty-state text stay those of the previous identity, until a later refocus finds `/me` stale (60 s).
  - The header and the data must belong to one identity (D-076 (2)).

## Required: make the invariant structural, not per call site
1. **The session generation is captured at the start of every user action and re-checked after every `await`.** Re-check it before any `setQueryData`, `navigate`, router `state`, toast, notice or other render effect.
   - Provide **one** mechanism, for example a `useSessionBoundAction()` / `runInSession(gen, …)` helper, or a `navigate` wrapper and a `setQueryData` wrapper that silently drop effects from a previous generation.
   - Use it everywhere. Grep-sweep every handler that awaits more than once, every `navigate(` and every `setQueryData(`, and list each one in the handback.
   - Add a lint rule or a unit test that fails if a page calls the raw `navigate`/`setQueryData` after an `await` without the guard, if you can do so reliably. Otherwise document the convention in the client module and test every current site.
2. **F-570 / Y5: the header, the permissions and the data always belong to the same identity, including on in-app navigation and within any fresh window.**
   - Detect a session change before or with page requests, not only on focus or reconnect. For example, revalidate `/me` on route change when it is older than a short bound. Or, if the CSRF cookie is readable, compare it before each request and bump the generation and revalidate `/me` when it changed.
   - Keep `/me` requests bounded.
3. **Keep every FE10, FE13 and FE14 guarantee:**
   - one navigation on a session end;
   - a bounded number of `/me` requests;
   - no stale shell;
   - a 403 is never a session end;
   - `returnTo` is safe;
   - a same-person new session keeps its drafts;
   - a same-identity write still updates the cache and navigates.
4. **Tests.**
   - **Reviewer's cases:** Y1, a create whose post-create `/me` returns another identity, where B never sees A's code or name and is not navigated; and Y1c.
   - **qa's R16-06** (F-580) passes on the real stack in chromium-en and chromium-ar.
   - **Same pattern elsewhere:** edit, organisation and user saves where the identity changes between awaits.
   - **F-570:** the domain probe scenario (tab-2 sign-out/sign-in, tab-1 refocus within 15 s, then N1/N2 navigations) shows the header and the data agree, in EN and AR.
   - **Sanity:** the same flows under the same identity still navigate and update.
   - **e2e:** `session-end.spec.ts` stays green in EN and AR.
   - **Negative control:** the new tests fail on `HEAD`.

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
Write `docs/delivery/handbacks/DG2/T-DG2-FE15-frontend-ux-engineer.md` with the fix, the sweep list and every check's real output. Keep evidence to logs and at most two cited screenshots.
