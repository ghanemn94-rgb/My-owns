# Assignment T-DG2-AN-P2: DG2 register update — mark the 32 DG2-final requirements IMPLEMENTED with evidence (transformation-analyst)

- **Stage:** P2 / DG2 (FIXING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. Node 24.21.0; offline. You own the delivery register `docs/delivery/requirements.csv` and `docs/analysis/**`. Do NOT touch application code (`apps/**`, `packages/**`), `docs/api/**`, `docs/architecture/**`, migrations, reviews, runs, gate records, `stages.json`, `findings.json`, `tools/**`, `docs/source/**`.

## Finding to repair
**F-DG2-202 (High, REQ-DLV-034):** the register does not record DG2 completion — all 32 DG2-final requirements are still `status = SPECIFIED` with no evidence, and `node tools/gates/validate.mjs --register DG2` FAILS (~64 problems). The P2 implementation is complete and green; the register must reflect it.

## Task
For **each of the 32 rows whose `final_gate` = DG2** in `docs/delivery/requirements.csv`, set `status = IMPLEMENTED` and fill `evidence` with accurate, specific pointers to where the requirement is implemented and verified — drawn from the real P2 deliverables, not invented:
- the implementing code (e.g. `apps/api/src/modules/<module>/...` route/service, `packages/db/migrations/00NN_*.sql`, `apps/web/src/pages/<area>/...`), per `docs/architecture/p2-work-split.md` §7 (requirement→owner map);
- the verifying tests (`apps/api/test/integration/...`, `apps/web/.../*.test.tsx`, the e2e specs), and the round-1 review records where relevant;
- the contract (`docs/api/openapi.yaml` operationIds) and ADRs (0015-0020) where the requirement is a design/contract one.
Keep each row's `req_id`, `class`, `title`, `source_ref`, `acceptance`, `increments`, `final_gate` unchanged — only `status` and `evidence` (and `notes` if helpful) change. Match the existing register's evidence style (how the DG0/DG1 rows cite evidence). Do not mark a requirement IMPLEMENTED whose behaviour you cannot point to — if any of the 32 genuinely is not implemented, leave it and flag it in the handback (that would be a real gap, not a register fix).

The 32 rows: `REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

## Self-verification (real output in handback)
- `node tools/gates/validate.mjs --register DG2` → **PASS** (exit 0). Paste the output.
- `node tools/gates/validate.mjs --historical --stage DG1` still exit 0 (you did not disturb DG1 rows).
- The CSV still parses (no broken quoting): `node -e "..."` or `pnpm` register tooling if present.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-AN-P2-transformation-analyst.md` — the rows changed, the `validate --register DG2` PASS output, and any requirement you could NOT evidence (flagged as a real gap).
