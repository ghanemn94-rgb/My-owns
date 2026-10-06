# Handback T-DG2-AN3: DG2 register correction (transformation-analyst)

- **Stage:** P2 / DG2 (FIXING), round-3 repair. **Assignment:** `docs/delivery/assignments/DG2/round-3/T-DG2-AN3.md` (sha256 `cbc7bfb9…177089`, verified).
- **Base:** `HEAD` = `e9b14ca7523d7a1c120284ebce7365efa8979a53`. Concurrent code edits by other agents were in the working tree (`apps/api/...`, ADR-0017). I did not touch them.
- **Invocation:** run `DG2-T-DG2-AN3-transformation-analyst-20261006T050611Z-3ba48e0a`, session `3ba48e0a-adbf-474e-a209-868b2ae41471`.
- **Finding addressed:** F-DG2-152 (Low, REQ-S05-003). I am the author of this fix, so I do not close the finding. A non-author reviewer has to verify it.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | Corrected `screen_api` on 16 DG2-final rows so that every cited API path matches `docs/api/openapi.yaml` exactly. No other column changed. |
| `docs/delivery/handbacks/DG2/T-DG2-AN3-transformation-analyst.md` | This handback. |

I compared the register before and after the edit with a script. Only the `screen_api` column changed, and only on these rows: REQ-PB-012, 023, 024, 025, 026, 027, 028, 029, 034, 037, 038, 039, 041, 042, REQ-S05-003 and REQ-S10-001. No `status`, `acceptance`, `source_ref`, `procedure` or `evidence` value changed. The row set is identical.

## 2. Behaviour delivered

**REQ-S05-003 (F-DG2-152).**
- Before: `screen_api` was `Target Operating Model > Dimension; GET /api/v1/transformations/{id}/tom/dimensions/{dim}`. That path is not in the contract.
- Now: `Target Operating Model > Design > per-dimension view (DesignPage DimensionView); GET /api/v1/transformations/{transformationId}/tom-canvas; GET /api/v1/transformations/{transformationId}/tom-canvas/{dimensionCode}`.
- Why both paths:
  - `getTomCanvas` returns `TomCanvas` with 10 `TomCanvasCellView` cells. Each cell holds the cell (current/target design, owner), the dimension, gaps, decisions, dependencies and evidence.
  - The contract also has `getTomCanvasCell` (`GET .../tom-canvas/{dimensionCode}`, `TomCanvasCellView`). This is the actual per-dimension read. `apps/web/src/pages/design/DesignPage.tsx` lines 183–185 call it, and `apps/api/test/integration/registers.test.ts:514` tests it.
- The screen is `DimensionView` in `DesignPage.tsx` (line 201).
- Acceptance and source refs are unchanged.

**Sweep of the other 31 DG2-final rows.** Method: a script parsed every `[METHOD[/METHOD]] /api/v1/...` occurrence in `screen_api`, `procedure` and `evidence`. It matched each one against the path and method keys of `docs/api/openapi.yaml`, comparing paths with placeholder names normalised. It also checked every `evidence` entry with `os.path.isfile`.

The task text covers `METHOD /api/v1/...` paths. I also checked bare `/api/v1/...` paths without a method, because they are the same kind of drift. 10 bare paths did not exist in the contract, and I fixed them. Where a correct path used `{id}` instead of the contract's `{transformationId}`, I changed the placeholder to the exact contract spelling.

### API paths cited (screen_api; no API paths are cited in `procedure` or `evidence` for any DG2 row)

| Row | Cited item (before) | Exists? | Fix (now) |
|---|---|---|---|
| REQ-PB-003 | `POST /api/v1/transformations` | Yes | none |
| REQ-PB-012 | `/api/v1/transformations/{id}/role-assignments` | **No** | `GET/POST /api/v1/role-assignments; GET/POST /api/v1/transformations/{transformationId}/scoped-assignments; GET /api/v1/role-accountabilities` (team.ts, admin/routes.ts) |
| REQ-PB-016 | (no API path; screen only) | n/a | none |
| REQ-PB-017 | (no API path) | n/a | none |
| REQ-PB-018 | (no API path) | n/a | none |
| REQ-PB-023 | `/api/v1/transformations/{id}/diagnostic-workstreams` | **No** | `GET .../{transformationId}/methodology` (the six workstreams with key questions); `GET/POST .../{transformationId}/workstream-outputs` (attached outputs) |
| REQ-PB-024 | `/api/v1/capabilities` | **No** | `GET/POST /api/v1/transformations/{transformationId}/capability-heatmap` |
| REQ-PB-025 | `/api/v1/journeys` | **No** | `GET/POST /api/v1/transformations/{transformationId}/journeys` |
| REQ-PB-026 | `/api/v1/transformations/{id}/diagnostic-items` | Yes (placeholder spelling differs) | placeholder changed to `{transformationId}` |
| REQ-PB-027 | `/api/v1/baselines` | **No** | `GET/POST .../{transformationId}/baselines; POST .../{transformationId}/baselines/{baselineId}/validation` |
| REQ-PB-028 | `/api/v1/value-pools` | **No** | `GET/POST .../{transformationId}/value-pools; POST .../{transformationId}/value-pools/{valuePoolId}/validation` |
| REQ-PB-029 | `/api/v1/transformations/{id}/charter` | Yes (placeholder) | placeholder changed to `{transformationId}` |
| REQ-PB-030 | (no API path) | n/a | none |
| REQ-PB-031 | (no API path) | n/a | none |
| REQ-PB-033 | (no API path) | n/a | none |
| REQ-PB-034 | `/api/v1/transformations/{id}/outcome-kpis` | Yes (placeholder) | placeholder changed to `{transformationId}` |
| REQ-PB-035 | (no API path) | n/a | none |
| REQ-PB-036 | (no API path) | n/a | none |
| REQ-PB-037 | `/api/v1/guardrails` | **No** | `GET/POST /api/v1/transformations/{transformationId}/strategic-guardrails` (contract summary cites B0035 / REQ-PB-037) |
| REQ-PB-038 | `GET /api/v1/tom-dimensions` | **No** | `GET /api/v1/transformations/{transformationId}/methodology; PATCH /api/v1/methodology/tom-dimensions/{dimensionCode}` (methodology/routes.ts) |
| REQ-PB-039 | `/api/v1/transformations/{id}/tom-gaps` | Yes (placeholder) | placeholder changed to `{transformationId}` |
| REQ-PB-041 | `/api/v1/transformations/{id}/tom-canvas` | Yes (placeholder) | placeholder changed to `{transformationId}` |
| REQ-PB-042 | `POST /api/v1/tom-workshops/{id}/convert` | **No** | `POST /api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/items/{itemId}/convert` |
| REQ-PB-043 | `/api/v1/decisions?kind=design` | Yes (`GET /api/v1/decisions` with the `kind` query parameter; `design` = T04) | none |
| REQ-DLV-034 | (no API path) | n/a | none |
| REQ-S04-003 | (no API path) | n/a | none |
| REQ-S04-004 | (no API path) | n/a | none |
| REQ-S04-005 | (no API path) | n/a | none |
| REQ-S05-003 | `GET /api/v1/transformations/{id}/tom/dimensions/{dim}` | **No** (F-DG2-152) | `GET .../{transformationId}/tom-canvas; GET .../{transformationId}/tom-canvas/{dimensionCode}` + DesignPage DimensionView |
| REQ-S10-001 | `/api/v1/scoped-assignments` | **No** | `GET/POST /api/v1/role-assignments; POST /api/v1/role-assignments/{assignmentId}/revoke; GET/POST /api/v1/transformations/{transformationId}/scoped-assignments` |
| REQ-S13-012 | (no API path) | n/a | none |
| REQ-S16-013 | `/api/v1 resources` (generic, not a path) | n/a | none |

After the fix, the script found 27 API-path citations across the 32 rows. All 27 exist in `openapi.yaml` with every method they name (0 MISSING).

### Evidence files (repository paths in `evidence`)

| Row | Files cited | All exist? | Fix |
|---|---|---|---|
| REQ-PB-003 | 9 | Yes | none |
| REQ-PB-012 | 9 | Yes | none |
| REQ-PB-016 | 10 | Yes | none |
| REQ-PB-017 | 9 | Yes | none |
| REQ-PB-018 | 8 | Yes | none |
| REQ-PB-023 | 9 | Yes | none |
| REQ-PB-024 | 9 | Yes | none |
| REQ-PB-025 | 9 | Yes | none |
| REQ-PB-026 | 10 | Yes | none |
| REQ-PB-027 | 9 | Yes | none |
| REQ-PB-028 | 11 | Yes | none |
| REQ-PB-029 | 10 | Yes | none |
| REQ-PB-030 | 7 | Yes | none |
| REQ-PB-031 | 7 | Yes | none |
| REQ-PB-033 | 9 | Yes | none |
| REQ-PB-034 | 10 | Yes | none |
| REQ-PB-035 | 7 | Yes | none |
| REQ-PB-036 | 11 | Yes | none |
| REQ-PB-037 | 8 | Yes | none |
| REQ-PB-038 | 7 | Yes | none |
| REQ-PB-039 | 7 | Yes | none |
| REQ-PB-041 | 9 | Yes | none |
| REQ-PB-042 | 11 | Yes | none |
| REQ-PB-043 | 10 | Yes | none |
| REQ-DLV-034 | 17 | Yes | none |
| REQ-S04-003 | 11 | Yes | none |
| REQ-S04-004 | 10 | Yes | none |
| REQ-S04-005 | 10 | Yes | none |
| REQ-S05-003 | 9 | Yes | none |
| REQ-S10-001 | 12 | Yes | none |
| REQ-S13-012 | 11 | Yes | none |
| REQ-S16-013 | 13 | Yes | none |

The check is existence only, run at base `e9b14ca` plus the concurrent working-tree state. I did not re-judge whether each file's content supports its row.

## 3. Checks actually run

Environment: Node 24.21.0, offline, sandboxed analyst run, working tree at `e9b14ca` + my register edit (+ concurrent uncommitted code edits by BE4/FE4).

```
$ node tools/gates/validate.mjs --register DG2
PASS register rules at DG2
exit=0

$ node tools/gates/validate.mjs --pipeline
PASS pipeline (active stage: DG2 FIXING)
exit=0

$ node tools/gates/validate.mjs --historical --stage DG1
PASS gate DG1 (historical)
exit=0
```

Other checks:
- **Sweep script** (`python3 -I`, scratch only):
  - First run: 11 MISSING path citations (the 10 listed above plus REQ-S05-003).
  - After the fix: 0 MISSING out of 27 citations, and 0 missing evidence files.
- **Column diff** (original register vs edited): only `screen_api` differs, on 16 rows. No status or other column changed.

## 4. Known gaps / not done

- I did not make live HTTP calls. Paths were checked against the contract file and the route registrations in source (`canvas.ts`, `team.ts`, `admin/routes.ts`, `methodology/routes.ts`). For runtime existence, `GET .../tom-canvas/{dimensionCode}` is exercised in `registers.test.ts:514` and `contract/p2-exercises.ts:399`. I did not run those tests myself.
- **Out of scope:** 15 non-DG2 rows still use the `/api/v1/transformations/{id}/...` placeholder or may cite paths that only later stages will add. I did not sweep them.
- F-DG2-152 stays OPEN until a non-author reviewer verifies it.

## 5. Merge instructions

- Register-only change. No migrations and no code.
- Conflicts are unlikely: BE4/FE4 do not edit `requirements.csv`.
- The candidate manifest includes the register, so freeze the candidate after this change merges.
