# DG1 review: common context (read together with your role-specific assignment)

- **Stage:** P1 "Architecture and working foundation" / gate DG1. The stage is REVIEWING.
- **Frozen candidate:** `sha256:7fcc4943694dc9d7d207b18b53c42eab1efa131da46b898f733ae20298b39367`, source commit `85e5bbd601643d21b7420c704f99176d9e94b35a`. Manifest `docs/delivery/candidates/DG1/7fcc4943694dc9d7.manifest.json`.
  - Confirm `node tools/gates/candidate.mjs --stage DG1` prints the candidate ID (metadata-only commits may follow the freeze).
  - **This repository must be a COMPLETE clone** (`git rev-parse --is-shallow-repository` = `false`). For disposable clones use `git clone --no-local`.
- **Review round:** `1`. Write your record to `docs/delivery/reviews/DG1/round-1/<your-role>.json`.
- **Preceding gate:** DG0 is APPROVED. `node tools/gates/validate.mjs --stage DG0 --historical` must pass.
- **Implementation authors:** `solution-architect` (T-DG1-ARCH-01), `backend-workflow-engineer` (T-DG1-BE, T-DG1-BE2), `frontend-ux-engineer` (T-DG1-FE), `devops-engineer` (T-DG1-DEVOPS), `transformation-analyst` (T-DG1-REG), and `delivery-orchestrator` (integration: REQ-DLV-042 installer, vitest/ci/prettier integration, branding wiring, register fixes). Put the ones relevant to your scope in `implementation_author`; none of them is you.

## DG1 approval conditions (master prompt §21, row P1; stage-plan "P1 … DG1")
> **Outputs:** architecture decisions, ERD/API contracts, repo/build/CI, DB migrations, authentication/scoped access, bilingual shell, design tokens, persisted transformation creation and audit baseline.
> **Evidence required before approval:** clean startup; real create/read/update and authorization checks; agreed data/contracts; Arabic/English screen review; migration and baseline audit checks.

## What's in the candidate (a map, not a claim of correctness)
- **Architecture** `docs/architecture/`: 14 ADRs (ADR-0001..0014), `erd.md`, `data-dictionary.md`, `p1-work-split.md`, `discovery/`, `ci/ci.yml` (installed at `.github/workflows/ci.yml`). API contract `docs/api/openapi.yaml` (OpenAPI 3.1, 33 operations).
- **Product** (TypeScript, ESM, pnpm workspace; Node 24 LTS / 22.18+ floor; PostgreSQL 18/16 floor; React 19 + Vite 7; OIDC/Keycloak): `apps/api` (modular monolith — see `apps/api/src/modules.ts` + `architecture.test.ts`), `apps/worker`, `apps/web`, `packages/{shared,db,config,design-tokens}`, reserved `packages/{calc,reporting}`.
- **Delivery/infra:** `tools/deps/install-sandbox.sh` (+ tests) — the sandboxed dependency installer (REQ-DLV-042, D-046); `deploy/` (Dockerfile, Compose, Keycloak test realm); `licenses/` (SBOM).
- **Delivery records** `docs/delivery/`: `requirements.csv` (register), `decisions.md` (D-001..D-047), `threat-model.md`, handbacks `handbacks/DG1/`, run evidence `runs/DG1/`, test-evidence `test-evidence/DG1/`.
- **Excluded from the candidate (D-005):** `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md`, `stages.json`; plus `node_modules`, `dist`, `coverage`, `apps/web/e2e/screenshots` (gitignored).

## Requirements
- The **12 DG1-completing** requirements (must be completely + correctly IMPLEMENTED with existing evidence): `REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`. Your role-specific file says which subset you own; qa checks all 12.
- The **80 P1-increment** requirements are only required to have their P1 increment in place (they complete later); see `docs/analysis/stage-plan.md`.

## Open items the orchestrator asks you to assess (recorded in decisions/handbacks)
- **REQ-S16-003 / D-047:** the DG1 deliverable is the module **architecture** (all boundaries in `apps/api/src/modules.ts` + the `architecture.test.ts` dependency-lint + the 8 P1-active modules implemented/tested); workflows/kpi/reporting are declared-reserved boundaries for P2/P4/P5. Judge whether A12 is met at this scope or requires the reserved modules now.
- **Contract items (within the frozen contract):** BE returned 400/403 where the contract declares no 422 (T-DG1-BE handback R-2); FE signs in via an empty dev-login probe because `/me` needs a session, and requests a public `GET /api/v1/auth/options` (T-DG1-FE handback). Assess whether these are acceptable for P1 or must change now.
- **DevOps flags (T-DG1-DEVOPS handback):** image digests not yet pinned; the EN/AR e2e same-user race (CI pinned to 1 worker); `pnpm deploy --prod` note; `.env.example` at root vs register's `deploy/`. Assess.
- **Provisional brand:** `#0078FF` and the seven tokens are labelled provisional; the wordmark is a provisional text wordmark with a badge. No string claims official Mobily/PMI compliance.

## Findings and output format
- Findings in `docs/delivery/reviews/DG1/round-1/<your-role>.findings.json` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer, `stage_id` `DG1`. **ID blocks:** domain from `F-DG1-001`; code-security from `F-DG1-101`; qa from `F-DG1-201`.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS as `"severity":"Low"` findings.
- Put every check in `checks_run`; put the requirement IDs you verified in `requirements_checked`. **Independence:** form your verdict before reading any other round-1 review record.
- **Build/run offline:** `node_modules` is installed; `pnpm -r build/typecheck/lint/test`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm --filter @mth/design-tokens run check:contrast` run offline. Integration + e2e need a real PostgreSQL + the stack — use `e2e/support/qa-stack.sh` and the disposable-DB `packages/db/test/global-setup.ts`; a missing tool/DB makes a check **BLOCKED**, never a silent pass. Never run `pnpm install` (no network); never run `playwright install` (Chromium is at `/opt/pw-browsers`).
- **Write your record and sidecars only with the Write/Edit tools.** Every evidence path must be an existing repository file (optionally `#fragment`).
