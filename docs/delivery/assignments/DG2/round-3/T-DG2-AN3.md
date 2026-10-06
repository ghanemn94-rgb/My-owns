# Assignment T-DG2-AN3: DG2 register correction (transformation-analyst)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Environment:** Node 24.21.0; offline.
- **Your files:** you own the delivery register `docs/delivery/requirements.csv` and `docs/analysis/**`.
- **Do NOT touch:**
  - application code (`apps/**`, `packages/**`);
  - `docs/api/**`, `docs/architecture/**` and migrations;
  - reviews, runs, gate records, `stages.json` and `findings.json`;
  - `tools/**` and `docs/source/**`.
- **Concurrency:** backend-workflow-engineer (T-DG2-BE4) and frontend-ux-engineer (T-DG2-FE4) run at the same time, in code only.

## Finding to repair
**F-DG2-152 (Low, REQ-S05-003).** The register row REQ-S05-003 has `screen_api` = `Target Operating Model > Dimension; GET /api/v1/transformations/{id}/tom/dimensions/{dim}`. That endpoint does not exist: there is no such path in `docs/api/openapi.yaml`, and the live call returns 404. The per-dimension view is actually served by:
- `GET /api/v1/transformations/{transformationId}/tom-canvas`, which returns 10 cells, each with the cell (current/target design, owner), the dimension, gaps, decisions, dependencies and evidence;
- the Design page's per-dimension view (`apps/web/src/pages/design/DesignPage.tsx`, DimensionView).

## Task
1. Correct the REQ-S05-003 `screen_api` so it names the real contract and screen. Copy the exact path spelling from `docs/api/openapi.yaml`. Leave the acceptance and the source refs unchanged.
2. **Sweep the other 31 DG2-final rows** (`final_gate` = DG2). For every `METHOD /api/v1/...` path named in `screen_api`, `procedure` or `evidence`, check that it exists in `docs/api/openapi.yaml` with that method. For every repository path named in `evidence`, check that the file exists. Fix any drift you find. Record the sweep in the handback as a table: row, cited item, exists?, fix.
3. Do not change any `status`. Do not change evidence pointers that are correct.

## Self-verification (real output in the handback)
- `node tools/gates/validate.mjs --register DG2`, which must exit 0.
- `node tools/gates/validate.mjs --pipeline`
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-AN3-transformation-analyst.md`.
