# Frontend journeys (Playwright)

`journeys.spec.ts` drives the built SPA against the **real API and a real PostgreSQL** (no mocks):

1. sign-in page (Arabic RTL by default, provisional wordmark, development form only in dev mode, bundled fonts);
2. shell as the Transformation Office (13 areas; no Administration), language persistence across reload, skip link;
3. create a Modular transformation with an entry phase (validation messages first);
4. list: sort, status filter chip, column selection, pagination controls;
5. edit with a concurrent change from another request: 409 conflict panel, re-apply on the current version (the other
   change is kept);
6. archive with a mandatory reason (read-only afterwards);
7. administration as the access/technical administrator (14 areas; organizations, business units, users, role
   assignments; no business-record access);
8. a user without roles: no Administration, no-permission and empty states.

Each project runs the whole file in its language: `chromium-en` (English LTR) and `chromium-ar` (Arabic RTL).
Every step saves a full-page screenshot to `screenshots/<lang>/` and runs axe (`@axe-core/playwright`, WCAG 2.0/2.1
A+AA tags); any serious or critical violation fails the test, and `screenshots/<lang>/axe-summary.json` lists all
violations found (of any impact). Every request is asserted to stay on the application origin.

## Running

```bash
pnpm -r build
apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1
```

`support/with-stack.sh` creates a disposable PostgreSQL cluster, runs `mth-db migrate` and `mth-db seed-dev`
(SYNTHETIC users `dev.admin`, `dev.office`, `dev.lead`, `dev.auditor`, `dev.nobody`), starts the API with
`AUTH_MODE=dev` on `http://localhost:3000` (serving `apps/web/dist`), runs the command and deletes everything. Ports
(PostgreSQL default 24331, API default 3000, both below the Linux ephemeral range) are starting points. On a bind
conflict the stack retries on another free port and exports `E2E_BASE_URL` with the port actually used. See
`docs/operations/clean-start.md`, "Harness port policy" (`E2E_PG_STRICT_PORT` / `E2E_API_STRICT_PORT` disable this).
Browsers are never downloaded (ADR-0012): `PLAYWRIGHT_BROWSERS_PATH` must point at the pre-installed chromium-1194.
Set `E2E_SCREENSHOT_DIR` to write screenshots elsewhere.

All data is synthetic. Nothing here represents Mobily data, people or approvals.
