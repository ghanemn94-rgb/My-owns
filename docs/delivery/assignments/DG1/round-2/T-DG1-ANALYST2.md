# Assignment T-DG1-ANALYST2: register reconciliation round-2 (transformation-analyst)

- **Stage:** P1 / gate DG1 (round-2 repair). **Base revision:** current `HEAD` (after the BE round-2 merge, which BUILDS the three module scaffolds — read `docs/delivery/decisions.md` D-048). You run in the main tree. `node_modules` is present; run **offline**; no `pnpm install`.
- Fix **only** the register findings below. Keep the register truthful: never mark IMPLEMENTED unless the evidence exists in the tree and implements the requirement (CLAUDE.md).

## Scope — write ONLY `docs/analysis/**`, `docs/delivery/requirements.csv`, `docs/delivery/handbacks/**`.
Edit the source parts under `docs/analysis/parts/**` and re-merge to `docs/delivery/requirements.csv` with the project's merge tool (`python3 tools/source/merge_register.py` or the documented command), then verify `node tools/gates/validate.mjs --register DG1` passes.

## Findings to fix

- **F-DG1-105 / F-DG1-002 (register side) — REQ-S16-003 and REQ-S16-004 accuracy.** The BE round-2 work (D-048) built `workflows`, `kpi` (formulas/KPI) and `reporting` as **active P1 module scaffolds** with their own test suites, so all six §16 business modules now exist. Rewrite REQ-S16-003's note to describe the **six-module scaffold set** (identity/access, transformations, workflows, formulas/KPI, reporting, admin — plus platform/audit/organization/jobs infra, methodology/evidence reserved), its evidence listing the three new module dirs + per-module `*.test.ts` + `modules.ts` (`P1_MODULES`) + `architecture.test.ts`. Drop the D-047 "architecture-only / reserved names" wording; cite **D-048**. Verify REQ-S16-004's note is accurate for what DG1 actually delivers (persistence + restore scope deferred to DG7 as already noted). Status stays IMPLEMENTED **only** because the modules now genuinely exist — confirm by `ls apps/api/src/modules/{workflows,kpi,reporting}/` and the test files.

- **F-DG1-207 / F-DG1-006 — stale/reinterpreted register text.**
  - REQ-S19-006 note cites "32 operations" and "contract tests 8/8": update to the real count after BE added `getBrandingTokens` coverage — the OpenAPI now has **33** operations; state the actual contract-test count from the BE round-2 handback / QA evidence (do not invent a number — read it).
  - Correct the **409-vs-422** transition contract wording so it matches what the API actually returns for a rejected transition (confirm against `docs/api/openapi.yaml` and the BE handback for F-DG1-001).
  - Remove or correct the **untested worker-stop** criterion claim in REQ-S16-001's note (A22: "stopping the worker does not stop the API") — either cite a test that now exercises it or state plainly that it is asserted by process separation and not yet covered by an automated stop-the-worker test (honest, not overclaimed).
  - Any other "32 operations" / stale-count references in the parts: fix to 33.

## Self-verification
- `node tools/gates/validate.mjs --register DG1` passes (all 12 DG1-final rows IMPLEMENTED with existing evidence).
- `node tools/gates/validate.mjs --reconcile` and the analysis-consistency checks (counts, test-refs, acceptance-map) pass — in round 1 these broke on a stale README op-count and a `#D-046` fragment; make sure your op-count edits keep every consistency check green.
- The merged `requirements.csv` equals a fresh merge of the parts (no hand-editing drift).

## Handback
`docs/delivery/handbacks/DG1/round-2/T-DG1-ANALYST2-transformation-analyst.md` — per finding: what text changed and why, the real op/contract counts you used and their source, and the validator/consistency output.
