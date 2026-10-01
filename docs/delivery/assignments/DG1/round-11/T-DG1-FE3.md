# Assignment T-DG1-FE3: F-DG1-214 — unit-web suite fails on Node 24 (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (round-11 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install` (if you must, `pnpm install --offline --frozen-lockfile`).
- Fix **only** F-DG1-214 (Medium; full text in `docs/delivery/findings.json`). Edit the **web test harness only** — e.g. `apps/web/vitest.config.ts`, a new `apps/web/test/*.ts` setup file, `apps/web/vite.config.ts` if needed. Do **not** change product behaviour, the API, other apps/packages, `tools/**`, `docs/source/**`, reviews or gate records. You may add test-only files under `apps/web/`. Handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-214, Medium, REQ-DLV-033)
The unit-web suite fails **deterministically on Node 24** (ADR-0001's production target; CI runs product jobs on **24 and 22**). 12 of 110 unit-web tests fail, all with:
```
TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
  ❯ new Request node:internal/deps/undici/undici
  ❯ createClientSideRequest  react-router@7.9.0/.../chunk-VHEBI3C5.js
  ❯ startNavigation ...
```
**Root cause (confirmed):** the test `environment: "jsdom"` installs jsdom's own `AbortController`/`AbortSignal` as globals. On Node 24 the global `Request` is undici 7.29.1, which validates `init.signal instanceof AbortSignal` against **Node's native** `AbortSignal`. react-router 7.9.0's `createClientSideRequest` builds `new Request(url, { signal })` with a signal from `new AbortController()` (jsdom's), so undici rejects it. On Node 22 (undici 6.x) it did not throw, so this was invisible until a Node 24 binary became available. Failing files: `apps/web/src/app/app.test.tsx` (3) and `apps/web/src/pages/transformations/transformations.test.tsx` (9), including the F-DG1-004 and F-DG1-210 regression tests.

## Required fix
Make the web unit harness pass on **both Node 22 and Node 24** without weakening the tests. The fix must be in the **test harness**, not the product. Align the DOM `AbortController`/`AbortSignal` (and, if needed, `Request`/`fetch`) so that the signal react-router creates is accepted by the global `Request` on Node 24. Candidate approaches (pick the one you verify works on both runtimes; keep it minimal and well-commented):
- A `setupFiles` module that installs **Node's native** `AbortController`/`AbortSignal` as the globals used in tests (capturing the native constructors before jsdom overrides them — e.g. snapshot them in `vite.config.ts`/`vitest.config.ts`, which load in Node's realm, and re-assign on `globalThis` in setup), so react-router's signal and undici's `Request` share one realm; or
- configure the jsdom environment / a custom environment so `AbortController`/`AbortSignal`/`Request` are Node's native; or
- another harness-level alignment you verify.
Do NOT: skip/disable the 12 tests, drop the Node 24 CI leg, or change product code to dodge the harness bug. Keep the jsdom DOM behaviour the tests rely on intact.

## Self-verification (real output, paste into the handback — BOTH runtimes)
- **Node 22 (default):** `pnpm test` green (unit-node + unit-web), and `pnpm vitest run --project unit-web` green (110/110).
- **Node 24:** `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm vitest run --project unit-web` green (110/110), and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` green — the 12 previously-failing tests now pass, with the same assertions (show the before: 12 failed on Node 24, and the after: 0 failed).
- `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` clean. Confirm you did not change any product/runtime file (only the web test harness).

## Handback
`docs/delivery/handbacks/DG1/round-11/T-DG1-FE3-frontend-ux-engineer.md` — the exact diff and rationale, and the real Node-22 and Node-24 `pnpm test` / unit-web output (before/after on Node 24).
