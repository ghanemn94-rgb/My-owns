# Assignment T-DG2-FE14: nothing fetched or written under one identity lands after the tab moves to another (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`. Keep ports below 32768.
- **Do not edit:** `packages/shared/**`, `apps/api/**`, `docs/api/openapi.yaml`, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Finding:** the full text is in `docs/delivery/findings.json`. The reviewer's probe is `docs/delivery/test-evidence/DG2/code-security/round-15/probes/zz-sec-r15-web-probe.test.tsx` (X1-X7), and its logs and record are in `docs/delivery/reviews/DG2/round-15/code-security-reviewer.json` (SEC-R15-19). Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair
**F-DG2-530 (Low): a write that was in flight when the identity changed lands in the new identity's cache.**
- FE13 (`29da00d`) purges every session-scoped query when `/me` returns another identity.
- The success continuations of in-flight writes are plain async handlers that call `queryClient.setQueryData` after `await api.send(...)`. They are not TanStack mutations, so clearing the mutation cache does not stop them. The affected handlers are:
  - `TransformationEditPage.tsx:130` and its conflict path at `:140`;
  - `TransformationDetailPage.tsx:143`;
  - `OrganizationsPage.tsx:255` and `:572`;
  - `UsersPage.tsx:387`.
- Probe X3:
  1. A's PATCH is in flight.
  2. A signs out, and B signs in in another tab.
  3. This tab re-probes `/me`, gets B and resets.
  4. A's PATCH then answers 200.
  5. The handler writes A's record into the cache and navigates B to it.
  6. B sees A's record, even after B's own GET answers 404.

**Related observation X6 (not raised; close it in the same change).**
- Within `/me`'s `staleTime`, a refocus refetches the page queries with the new cookie but not `/me`.
- The tab then shows A's name in the header with B's rows.
- That is the cookie holder's own data, but the header contradicts it.

## Required: make the invariant structural
1. **Identity generation in the API client.**
   - Every request records the identity or session generation current when it is **sent**.
   - If the session ended or the identity changed before the answer arrives, the client throws a typed "session changed" error instead of returning data, and logs nothing at error level. No caller can then write it into the cache, navigate on it, or show it.
   - Callers treat that error as silent: no error banner, no navigation.
   - This covers every `setQueryData` path at once, with no per-page guards. Verify it with a grep sweep and list every such path in the handback.
2. **`/me` is always revalidated before or with page data on refocus or reconnect.** When the tab refetches on focus or reconnect, `/me` is checked first, or together with the page queries, so the header and the data always belong to the same identity. Bound it; there is no extra `/me` storm.
3. **Keep every FE10/FE13 guarantee:**
   - one navigation on a session end;
   - a bounded `/me`;
   - no stale shell;
   - a 403 is never an end;
   - `returnTo` is safe;
   - a same-person new session keeps drafts and purges queries.
4. **Tests.**
   - Unit/component tests: the reviewer's X3 (and X3b), an in-flight archive or organisation or user write across an identity change, and X6 (after a refocus with a new identity, the header and data agree).
   - A sanity test: a normal in-flight write that finishes under the same identity still updates the cache and navigates.
   - The e2e session-end spec stays green in EN and AR.
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
Write `docs/delivery/handbacks/DG2/T-DG2-FE14-frontend-ux-engineer.md` with the fix, the sweep list and every check's real output. Keep evidence to logs and at most two cited screenshots.
