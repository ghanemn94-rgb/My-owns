# Handback: T-DG1-FE5 (frontend-ux-engineer), DG1 round-4 repair

- **Stage:** DG1, round 4. **Task:** T-DG1-FE5. **Finding:** F-DG1-210 (Medium).
- **Assignment:** `docs/delivery/assignments/DG1/round-4/T-DG1-FE5.md` (sha256 `6e555b3e…13ca4e63813`, verified).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE5-frontend-ux-engineer-20261001T100859Z-976d7db1","session_id":"976d7db1-ab0b-4ce2-9f37-d15e5c0ae93d"}`
- **Base revision:** `c6cd4111cce837b817a76726f8d13bf30f0d6bf6` (≥ `96e75cc`), worktree `/home/user/mth-wt-fe5`. The tree was clean apart from untracked home-dotfiles that are not mine. All runs were offline, and I did not run `pnpm install`.
- **Changes are uncommitted** in the worktree, for the orchestrator to integrate. I am the author of this fix, so I do not verify or close F-DG1-210.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/transformations/TransformationCreatePage.tsx` | After a 201, `await refreshEffectivePermissions(queryClient)` runs **before** navigating to the new record. The new exported helper invalidates and refetches the `me` query (`keys.me`, `refetchType: "all"`). It is bounded by `ME_REFRESH_TIMEOUT_MS` (5 s), and it never rejects, so a slow or failed refetch can't block the navigation. |
| `apps/web/src/pages/transformations/transformations.test.tsx` | Adds the suite `effective permissions refresh after create (F-DG1-210)` with 4 tests: EN, AR RTL, no over-grant, and a failed refresh that doesn't block. |
| `apps/web/e2e/journeys.spec.ts` | The BU-Lead journey no longer calls `page.reload()` after the create. It now asserts that Edit and Archive are visible straight away, uses a `window` marker to prove no document reload happened, then checks the audit trail (F-DG1-008 assertions unchanged). It also adds the screenshot `17a-lead-created-controls` and an axe check. |
| `docs/delivery/handbacks/DG1/round-4/T-DG1-FE5-frontend-ux-engineer.md` | This handback. |

## 2. Behaviour delivered (F-DG1-210)

- A business-unit-scoped Lead creates a transformation. The server grants a derived transformation-scope TL assignment (F-DG1-106). The create page then re-reads `GET /api/v1/me`, and only after that does it navigate to `/transformations/:id`. The detail page's `canOn(...)` checks read the refreshed `effectivePermissions`, so **Edit, Archive and the audit trail appear without a reload**, in English LTR and Arabic RTL.
- **Nothing is granted on the client.** The refreshed state is exactly the server's `/me` answer. If the server adds no grant, the controls stay hidden (unit test "does not over-grant"). The server still re-checks every request.
- **Fail-safe:** if the `/me` refetch fails (for example a 5xx after `useMeQuery`'s two retries), navigation still happens. `RequireSession` keeps the previous `/me` data, the UI under-represents access as before, and no controls are offered. If the refetch takes longer than 5 s, navigation goes ahead anyway and the refetch keeps running. A 401 on refetch keeps the existing behaviour, which is redirect to sign-in.
- The existing behaviours are unchanged:
  - The record is read back from the server after the create.
  - F-DG1-004's localized "created, but you cannot open it" state still shows on a 403/404.
  - The `transformations` list invalidation still runs.
  - The draft banner still says "not submitted or approved".

## 3. Checks actually run

All checks ran in the worktree, offline, with Node and pnpm from the environment. No network was used.

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm --filter @mth/web typecheck` | exit 0 |
| Build (web) | `pnpm --filter @mth/web build` | exit 0 (`✓ built in 4.04s`) |
| Lint | `pnpm lint` (eslint `--max-warnings=0`) | exit 0 |
| No-CDN | `pnpm check:no-cdn` | exit 0, `PASS no-cdn: scanned apps, packages` |
| Prettier on the changed files | `npx prettier --write …` (all three were prettier-clean at HEAD; now formatted) | ok |
| Unit/component, full | `pnpm test` | exit 0, `Test Files 21 passed (21)`, `Tests 239 passed (239)` |
| **Regression proof (unit)** | The `refreshEffectivePermissions` call was temporarily replaced by a comment, then `vitest run src/pages/transformations -t "F-DG1-210"` | EN and AR tests **fail** (`2 failed / 2 passed`); the no-over-grant and failed-refresh tests pass as expected. Source restored afterwards. |
| Build (all) | `pnpm -r build` | exit 0 |
| **E2E, full, EN + AR, real stack** | `QA_E2E_PG_PORT=5482 e2e/support/qa-stack.sh npx playwright test --workers=1` (pre-installed Chromium at `/opt/pw-browsers`; disposable PostgreSQL 16.13; migrate + seed-dev; API with AUTH_MODE=dev serving built SPA) | exit 0, **`22 passed (52.7s)`**, including `[chromium-en]` and `[chromium-ar]` `journeys.spec.ts:371 › a business-unit Lead creates a record: Edit/Archive and the audit trail appear without a reload (F-DG1-210), the derived grant localized (F-DG1-008)` |
| **Regression proof (e2e)** | The fix was disabled again, the SPA rebuilt, then `E2E_SCREENSHOT_DIR=$TMPDIR/neg-shots QA_E2E_PG_PORT=5482 e2e/support/qa-stack.sh npx playwright test apps/web/e2e --workers=1 -g "F-DG1-210"` | exit 1. Both projects fail at `journeys.spec.ts:395` (`expect(Edit link).toBeVisible()`: element(s) not found), which reproduces the finding. Afterwards the source was restored and `pnpm --filter @mth/web build` re-run (exit 0), so `dist` matches the fixed source. |
| Accessibility (axe, WCAG 2.0/2.1 A+AA) on the new step | part of the e2e run | `en/lead-created-controls` and `ar/lead-created-controls`: **0 violations** (from `axe-summary.json`) |

Unit test tail (full run):
```
 ✓ |unit-web| src/pages/transformations/transformations.test.tsx (21 tests)
   ✓ effective permissions refresh after create (F-DG1-210) > English: Edit, Archive and the audit trail appear after create, without a reload
   ✓ effective permissions refresh after create (F-DG1-210) > Arabic (RTL): the same controls and the audit trail appear after create, without a reload
   ✓ effective permissions refresh after create (F-DG1-210) > a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)
 Test Files  21 passed (21)
      Tests  239 passed (239)
```

### What the tests assert

- **Unit EN and AR:** `GET /me` returns the BU-only TL grants (no archive, no audit.read, no downward inheritance) until the POST succeeds. After that it returns those grants plus the derived transformation-scope grant. The tests then check:
  - the route changes to the new id;
  - the `Edit`/`تعديل` link, the `Archive`/`أرشفة` button and the `Audit trail`/`سجل التدقيق` heading appear in the same rendered app, with no remount;
  - `/me` was requested after the POST;
  - `dir` is `ltr` for EN and `rtl` for AR.
- **No over-grant:** `/me` is unchanged after the POST, so Edit, Archive and the audit trail stay absent and no `/audit` request is made.
- **Failed refresh:** `/me` returns 503 after the POST. Navigation still happens, and no Archive control or audit trail is shown.
- **E2E (real API and DB, seeded `dev.lead` at SYN-RETAIL):** after the create, with no `page.reload()`, Edit and Archive are visible. The `window.__mthNoReload` marker survives, which proves there was no document reload. The derived-grant audit row is then localized as before.

### Visual evidence and interaction checks

The e2e run wrote the screenshots below. `apps/web/e2e/screenshots/` is gitignored, so these are local files in the worktree and are not committed. The QA or reviewer run regenerates them with the same command.

- `apps/web/e2e/screenshots/en/17a-lead-created-controls.png`: new record right after the create, English LTR. It shows the draft banner, Edit and Archive in the header, and the audit trail.
- `apps/web/e2e/screenshots/ar/17a-lead-created-controls.png`: the same screen in Arabic RTL, with the layout mirrored and `تعديل`/`أرشفة` on the leading-end side.
- `apps/web/e2e/screenshots/{en,ar}/17-lead-audit-trail.png`: the audit trail with the derived grant, now reached without a reload.

I inspected both 17a screenshots. Each shows the draft and "not submitted" status chip with its icon and text, Unknown summary cards (never zero or green), and correct RTL/LTR direction.

## 4. Known gaps / not done

- None for F-DG1-210.
- **Scope note:** the assignment says "Write ONLY `apps/web/**`" but also requires this handback under `docs/delivery/handbacks/…`. I wrote only `apps/web/**` plus this handback file.
- The refresh is wired into the create flow only, which is where the finding is. Other mutations that could change the caller's own grants (for example an administrator assigning roles to themselves in Administration) are not part of this finding and were not changed.
- Screenshots aren't committed because the folder is gitignored by the existing repo rule. If a committed copy is needed under `docs/delivery/test-evidence/`, that path is outside my write scope.

## 5. Merge instructions

- There are no migrations, dependency changes, API changes or i18n catalogue changes.
- Expect conflicts only if another round-4 change edits the BU-Lead journey (`journeys.spec.ts` around line 371) or the `onSubmit` of `TransformationCreatePage.tsx`.
- After merging, rebuild with `pnpm -r build` before running e2e.
