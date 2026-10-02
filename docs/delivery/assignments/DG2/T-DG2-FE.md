# Assignment T-DG2-FE: P2 frontend — Diagnose/Charter/Define/Design/Decisions/Gates/Evidence screens (frontend-ux-engineer)

- **Stage:** P2 / DG2 (BUILDING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (`ecb3c0e`+). Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline (`node_modules` present). Pre-installed Chromium for e2e (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`). **Read `docs/architecture/p2-work-split.md` §4 (your column) in full.**
- **The P2 backend is merged and live:** all 160 contract operations are routed. The contract is `docs/api/openapi.yaml` (incl. the new `Outcome.goodOutcomeTest`/`goodOutcomePass`, REQ-PB-036). BE round 2 (`T-DG2-BE2`) runs **concurrently** on `apps/api/**` — disjoint from you. Do not touch `apps/api/**`, `apps/worker/**`, `packages/**`, `docs/**`, or anything outside `apps/web/**`.

## Own (write) — only `apps/web/**` (except `package.json` dependencies)
New pages under `apps/web/src/pages/{diagnose,define,design,decisions,gates,evidence}/**`; `app/router.tsx`, `app/nav.ts`; `api/client.ts`, `api/queries.ts`, `api/types.ts`; `components/**`, `lib/**`; new i18n namespaces `i18n/{en,ar}/{diagnose,define,design,decisions,gates,evidence,kpi}.json` (and edits to existing ones); the web tests. **No new dependency** (React, Vite, router, TanStack Query/Table, React Hook Form, i18next, the design tokens are all pinned); if you think you need one, record it in the handback instead.

## Consume (read-only)
`docs/api/openapi.yaml` (P2 schemas), `@mth/shared/schemas` (BE + KBE zod mirrors — `kpi.ts` re-exports `value.ts`), `@mth/shared` `PERMISSIONS` (for UI affordances only, never as security). Decimal amounts and value-pool totals go through `@mth/shared` `value.ts` helpers (`totalValuePools`, `formatDecimal` — returns null for Unknown, never 0).

## Screens (bilingual AR-RTL / EN-LTR; every user-facing string through i18next; no hardcoded text)
| Screen | Content |
|---|---|
| **Diagnose** | T01 grid of the 6 seeded dimensions (Confidence H/M/L, Impact SAR or KPI); findings by the 6 workstreams with their key questions; baselines; value pools — amounts via `value.ts`, **"unquantified" label never 0**, totals shown "partial: N unquantified" |
| **Charter** | 14 fields, the four-part thesis, the five scope checks with pre-checks, version history + diff, the 3–5 top-outcomes warning |
| **Define** | North Star (one sentence), outcome tree, **the good-outcome test per outcome with pass/fail/unknown + reasons (REQ-PB-036)**, T02 KPI tree (target date required), guardrails |
| **Design** | TOM canvas (10 boxes; per dimension current/target/gaps/owner/evidence/dependencies/decisions — REQ-S05-003), T03 gap matrix linked to T04, capability heatmap (build/buy/partner), journeys/processes with steps + pain points, workshop mode (convert unresolved items) |
| **Decisions** | T04 log via `GET /decisions?kind=design` (IDs D-01…, options A/B/C, status default Open) |
| **Gates** | G1–G3 readiness per criterion with evidence state (unverified shown as such, incl. failing good-outcome outcomes at G2), submit, approver decision with rationale, and the 403/409 problem messages. **Visibly labelled "business approval"; never mentions DG0–DG7.** |
| **Evidence** | Upload, link, review |

## Non-negotiable UX rules (ADR-0009, §15, CLAUDE.md)
- **AR-RTL and EN-LTR** for every screen, with `dir`/`lang` and CSS logical properties; every string localized (EN + AR namespaces).
- **Missing or stale data shows Unknown/Stale, never zero or green.** Unquantified value pools are labelled, never 0.
- **AUD (read-only auditor) sees read-only views** — no enabled write controls (the server still returns 403; affordances are UX only, never security).
- `#0078FF` stays provisional; use the provisional text wordmark, **no official Mobily logo/colour**; never claim PMI certification.
- No public CDN at build or runtime; locally bundled fonts only.

## Self-verification (real output in the handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm format:check` (your files), `pnpm --filter @mth/web test` (web unit, stubbed API responses), `pnpm --filter @mth/design-tokens run check:contrast`, and the e2e journeys for the new screens (pre-installed Chromium, `--workers=1`, unique `QA_PG_PORT`) **green in EN and AR**, including an AUD read-only pass and the "unquantified"/Unknown rendering. `node tools/gates/validate.mjs --historical --stage DG1` exit 0.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-FE-frontend-ux-engineer.md` — the diff summary, every check's real output (EN+AR e2e), and any contract/schema mismatch you hit.
