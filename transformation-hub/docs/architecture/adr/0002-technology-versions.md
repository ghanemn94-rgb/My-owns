# ADR-0002 — Technology stack and pinned versions

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §13 ("Choose supported versions and pin them in the lockfile")

## Decision (all exact versions pinned in `pnpm-lock.yaml`)
| Area | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 22.x LTS (>= 22.12) | `require(esm)` available for ESM-only deps |
| Package manager | pnpm workspaces | 10.33 | |
| Language | TypeScript | 5.9.3 | TS 7 (native compiler, released 2026-07) not adopted yet: NestJS relies on `emitDecoratorMetadata`; revisit in P7 |
| API framework | NestJS | 11.2.6 (CommonJS) | NestJS 12 (2026-08-27) is ESM-only; 11.2.x is actively maintained (11.2.6 released 2026-09-23). Upgrade path documented for P7 |
| Web | Next.js / React | 16.3.6 / 19.3.0 | App Router; `output: standalone` for containers |
| Styling | Tailwind CSS | 4.3.3 | logical properties for RTL |
| Data fetching | TanStack Query | 5.104 | |
| Validation / contracts | Zod | 4.6.5 | JSON Schema export for OpenAPI |
| ORM | Drizzle ORM / drizzle-kit | 0.45.3 / 0.31.11 | SQL-first; see ADR-0003 |
| DB | PostgreSQL | 16 (tested) | |
| Tests | Vitest / Playwright | 4.1.11 / 1.56.1 | Playwright pinned to match the Chromium build available in the build environment |
| Office outputs | exceljs / docx / pptxgenjs | 4.4.0 / 9.8.1 / 4.0.1 | |
| PDF | playwright-core + Chromium | 1.56.1 | HTML → PDF keeps Arabic shaping correct |
| Identity | openid-client | 6.8.8 | OIDC; SAML via IdP broker |

Licences: all MIT/Apache-2.0/BSD/ISC at selection time — verify with the licence check in CI (P7).
