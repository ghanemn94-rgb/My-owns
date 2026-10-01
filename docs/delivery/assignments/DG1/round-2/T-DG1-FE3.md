# Assignment T-DG1-FE3: web transition/UX consistency with the P1 close rule (frontend-ux-engineer)

- **Stage:** P1 / gate DG1 (round-2 repair, follow-up). **Base revision:** current `HEAD` (≥ `98e3d72`, includes the BE round-2 close rule). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`.
- This is a small consistency fix created by the backend repair **F-DG1-001**: the API now **refuses** closing a transformation in P1 (`→closed` returns 422 `invalid-transition`, governed by the G6 business approval, arriving in P2+). The web must not offer or promise a transition the API refuses.

## Scope — write ONLY `apps/web/**`.
Do not touch `apps/api/**`, `packages/**`, `docs/**` (except your handback), `deploy/**`, `.github/**`, `tools/**`, `pnpm-lock.yaml`.

## Fix
1. **Do not offer `closed` as a selectable next status in P1.** `apps/web/src/pages/transformations/TransformationEditPage.tsx` builds `statusOptions` from `TRANSFORMATION_STATUS_TRANSITIONS[base.status]`, which includes `closed`. Exclude the **governed** target(s) — in P1 that is `closed` — from the offered options, so the select offers only `draft→active`, `active→on_hold`, `on_hold→active` (plus the current status). Add a local, clearly-commented constant (e.g. `P1_GOVERNED_STATUSES = ["closed"]`) that mirrors the API's `GOVERNED_TARGET_STATUSES` (`apps/api/src/modules/transformations/routes.ts`), with a comment that it is refused by the API in P1 (G6) and that the shared source of truth is to be lifted to `@mth/shared` in P2. Keep `base.status` itself always present so an already-`closed` record (none exist in P1, but defensively) still renders.
2. **Fix the status hint** `transformations.form.statusHint` in `apps/web/src/i18n/en/transformations.json` and `…/ar/transformations.json` so it no longer promises `→closed`: state the P1 transitions (draft→active; active→on hold; on hold→active) and that closing a transformation needs the G6 business approval, available in a later stage. Keep Arabic RTL wording consistent with the DG0 glossary terms you aligned in F-DG1-003 (التحوّل, etc.).
3. **Keep** the audit-trail rendering of the `closed` label (`auditChanges.ts` / `transformations.status.closed`) — displaying a historical/enum `closed` label is correct and must stay (do not remove the enum label).
4. Add/adjust a unit/component test asserting `closed` is **not** among the offered status options for `active` and `on_hold`, and that the status hint no longer claims a close transition. If a test currently expects `closed` to be offered, update it.

## Self-verification (offline)
- `pnpm --filter @mth/web typecheck`, `pnpm --filter @mth/web build`, `pnpm lint` (max-warnings=0), `pnpm check:no-cdn`, and `pnpm test` web suites — all green, including your new/updated test.
- RTL (ar) / LTR (en) correct for the hint string.

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-FE3-frontend-ux-engineer.md` — the change, the test, real output.
