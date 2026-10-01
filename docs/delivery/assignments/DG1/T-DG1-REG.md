# Assignment T-DG1-REG: mark the DG1-completing requirements IMPLEMENTED with evidence (transformation-analyst)

- **Stage:** P1 / gate DG1 (BUILDING). **Base revision:** current HEAD. You run after the four implementers; their work is integrated and committed.
- **Why:** the register (`docs/delivery/requirements.csv`, generated from `docs/analysis/parts/**` via `tools/source/merge_register.py`) still marks the DG1-completing requirements `SPECIFIED` (their DG0 state). Now that P1 has implemented them, each must be `IMPLEMENTED` with **evidence that exists and implements it**, or the gate validator fails (`node tools/gates/validate.mjs --register DG1`).

## Scope — you own (write) ONLY
`docs/analysis/**` (the part files) and `docs/delivery/requirements.csv`. Do not touch product code, `tools/**`, `docs/api/**`, `docs/architecture/**`, reviews, gates, or other delivery records.

## Task
1. **Read the evidence:** the four handbacks in `docs/delivery/handbacks/DG1/`, the ADRs in `docs/architecture/adr/`, and the implemented tree (`apps/**`, `packages/**`, `deploy/**`, `tools/deps/**`, `.github/workflows/ci.yml`, `docs/api/openapi.yaml`).
2. **For each of the 12 requirements whose `final_gate` is `DG1`**, set `status = IMPLEMENTED` and `evidence` to a `;`-separated list of **existing** repository paths (files or dirs, optionally `#fragment`) that implement and test it. Edit the row in its part file under `docs/analysis/parts/` (not the generated CSV directly). The 12:
   - `REQ-DLV-025` (CI with `needs: delivery-gates`) → `.github/workflows/ci.yml`, `docs/architecture/adr/ADR-0013-ci-delivery-gate-dependency.md`
   - `REQ-DLV-033` (repo/build/working-foundation) → `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`, `docs/architecture/`
   - `REQ-DLV-042` (sandboxed dependency install) → `tools/deps/install-sandbox.sh`, `tools/deps/tests/install-sandbox.test.sh`, `docs/delivery/test-evidence/DG1/orchestrator/install-sandbox-acceptance.log`
   - `REQ-S15-002` (design tokens + contrast gate) → `packages/design-tokens/src/tokens.json`, `packages/design-tokens/src/contrast.ts`
   - `REQ-S15-005` (locally bundled fonts, no CDN) → `apps/web/package.json`, `scripts/check-no-cdn.mjs`, plus the web font setup you locate under `apps/web/src/`
   - `REQ-S15-006` (provisional text wordmark) → the wordmark component you locate under `apps/web/src/`
   - `REQ-S16-001` (modular monolith + worker) → `docs/architecture/adr/ADR-0002-modular-monolith-boundaries.md`, `apps/api/src/modules.ts`, `apps/worker/src/`
   - `REQ-S16-002` (web application) → `apps/web/`, `docs/architecture/adr/ADR-0009-frontend.md`
   - `REQ-S16-003` (API modules) → `apps/api/src/modules/`
   - `REQ-S16-004` (PostgreSQL + schema) → `packages/db/migrations/`, `docs/architecture/data-dictionary.md`, `docs/architecture/adr/ADR-0003-persistence.md`
   - `REQ-S19-004` (ERD, data dictionary, migrations) → `docs/architecture/erd.md`, `docs/architecture/data-dictionary.md`, `packages/db/migrations/`
   - `REQ-S19-006` (versioned API contract) → `docs/api/openapi.yaml`, `apps/api/src/`
   Verify every path you cite actually exists (`ls`/`test -e`). Prefer the most specific existing file over a directory where one exists. These evidence suggestions are a starting point — correct or extend them to match what you find.
3. **Do NOT change** requirements whose `final_gate` is a later gate (the 80 with only a P1 *increment* stay as they are — they complete later). Only the 12 DG1-final rows change to IMPLEMENTED.
4. **Regenerate** the register and coverage: `python3 -I -B tools/source/merge_register.py`, then confirm `git diff --stat` shows only the intended rows changed in `docs/delivery/requirements.csv` (and `docs/analysis/master-prompt-coverage.csv` if affected).
5. **Verify:** `node tools/gates/validate.mjs --register DG1` reports no `SPECIFIED`/`without evidence` failures for the 12, and the register equals the merge output.

## Handback
`docs/delivery/handbacks/DG1/T-DG1-REG-transformation-analyst.md` — the 12 rows changed, the evidence cited per row, the merge + validate output, and anything you could not evidence (BLOCKED).
