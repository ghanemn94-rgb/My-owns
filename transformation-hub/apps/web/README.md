# @hub/web — web client

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · TanStack Query 5. Arabic (RTL) and English (LTR).

## Run

```bash
# API first (DEMO mode), from transformation-hub/
HUB_MODE=demo bash scripts/dev/svc.sh start api   # http://127.0.0.1:4000

pnpm --filter @hub/web dev        # http://127.0.0.1:3000 (hot reload)
pnpm --filter @hub/web build      # production build (output: standalone)
pnpm --filter @hub/web start      # serve the build (next start; prints a harmless "standalone" warning)
node apps/web/.next/standalone/apps/web/server.js   # standalone server (copy .next/static + public next to it)

pnpm --filter @hub/web typecheck  # next typegen && tsc --noEmit
pnpm --filter @hub/web i18n:check # en/ar key parity, placeholders, every domain enum translated
pnpm --filter @hub/e2e test       # Playwright smoke (starts `dev` if nothing listens on :3000)
```

## Configuration (runtime environment)

| Variable | Default | Purpose |
|---|---|---|
| `HUB_API_URL` | `http://127.0.0.1:4000` | API origin used by the `/api/*` rewrite (same-origin proxy, so session and CSRF cookies work). Read at **build** time (compiled into the routes manifest); in production the ingress routes `/api` to the API directly. |
| `HUB_APP_NAME` | "Transformation & Transactions Hub" | Text wordmark / product name. There is no logo; no official branding is fabricated. |
| `NEXT_TELEMETRY_DISABLED` | set to `1` by every package script | **Private mode: Next.js telemetry must stay disabled.** Set it in any deployment environment too. |

No CDN, web fonts or analytics are loaded: IBM Plex Sans / IBM Plex Sans Arabic are bundled from `@fontsource`.

## Structure

```
src/app/layout.tsx                 root layout: reads `hub_locale` cookie → <html lang dir>, passes one catalogue to the client
src/app/login/                     demo personas (DEMO mode only) + honest SSO status
src/app/(app)/                     authenticated shell (AppShell): portfolio, wizard, inbox, admin
src/app/(app)/projects/[projectId] project workspace: overview/cockpit, charter, workstreams, members, phase placeholders
src/app/(app)/partner-access/      counterparty (external partner) view: only its granted rooms' released items and DD Q&A
                                   (partner-access API projection; external accounts cannot open the project workspace)
src/components/                    shared UI (DataTable, StatusBadge, Dialog, ConfirmCommandDialog, states, …)
src/lib/api.ts                     typed client from @hub/contracts route definitions (CSRF header, RFC 7807 → ApiError)
src/lib/queries.ts                 query keys, useMe/useProject/…, permission hints (the API stays the authority)
src/lib/sections.ts                project sections, required permissions and delivery phase
src/i18n/messages/{en,ar}/*.json   UI text; `statuses.json` translates every enum in packages/domain (generated keys:
                                   statuses.<camelCase enum constant>.<value>)
```

## Conventions

- All text through `useI18n().t('<namespace>.<key>')` (keys are type-checked); enum values through `tStatus(enum, value)`.
- Logical CSS only (`ms-/me-/ps-/pe-/start-/end-`, `rtl:` for icon mirroring). User-entered text gets `dir="auto"`.
- Dates: Gregorian calendar, `Asia/Riyadh`, Latin digits (`INTL_LOCALE` in `src/i18n/config.ts`); business dates
  (`YYYY-MM-DD`) are formatted without time-zone shifting.
- 404 and 403 render the same `RestrictedState` ("Not found or you don't have access"). 409 shows "reload and review";
  422/400 show the server's `detail`; every error shows the correlation id.
- Counts the caller may not see arrive as `null` and render as "—", never 0.
- Screens of later phases render `NotImplementedYet` with the phase label — never sample data.

## Known limitations

- CSP allows `'unsafe-inline'` scripts (the App Router inlines its flight payload). A nonce-based CSP via `proxy.ts`
  is a follow-up.
- Server strings follow the bilingual pattern of `docs/architecture/module-guide.md` §2 (QA-P1-14): template-seeded
  names/titles come as `<field>` + `<field>Ar` and are picked by locale (`src/lib/i18n-data.ts`); status-dimension
  explanations, gate blockers and JV signing / closing blockers come as message codes translated from
  `gates.messages.*`. Still English only (no codes yet): RAG / measurement explanations and data-quality notes on the
  plan Health tab, schedule issues and assumptions, governance quorum / tally explanations, template RACI function
  labels, the `detail` of refused commands (JV refusals also carry the blockers, which are shown translated) and the
  audit action codes of the activity history. Data entered in English
  only (or edited after instantiation without an Arabic text) is shown as entered — nothing is machine-translated.
