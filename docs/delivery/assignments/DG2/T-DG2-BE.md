# Assignment T-DG2-BE: P2 backend — diagnose/define/design resources, gates G1–G3, evidence, methodology (backend-workflow-engineer)

- **Stage:** P2 "Diagnose, define and design" / gate DG2 (BUILDING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (`ef99eb0`+). The P2 architecture is frozen and in place: migrations `0010`–`0018`, `schema.ts`, `permissions.ts`, `docs/api/openapi.yaml` (160 ops), ADR-0015…0020, `docs/architecture/p2-work-split.md`. **Read `docs/architecture/p2-work-split.md` in full — it is the contract for who owns what.** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; run offline (`node_modules` present).
- **You are the backend owner.** `kpi-benefits-engineer` (KBE) is building `apps/api/src/modules/kpi/**` + `packages/shared/src/schemas/kpi.ts` + `packages/shared/src/value.ts` **concurrently** — do not touch those. `frontend-ux-engineer` (FE) builds `apps/web/**` later. Two agents never edit the same file.

## Own (write) — exactly the BE column of the work split §2
- `apps/api/src/modules/{transformations,workflows,access,platform,audit,identity,organization,jobs,admin}/**` and the **new** modules `apps/api/src/modules/{evidence,methodology}/**`.
- `apps/api/src/{modules.ts,server.ts,architecture.test.ts,architecture.testkit.ts,index.ts,main.ts}`.
- `apps/api/test/**` **except** the KBE paths (`test/integration/kpi/**`, `test/integration/contract/kpi-exercises.ts`, `test/support/p2-pending-kpi.ts`). You own `test/integration/contract/contract.test.ts`, `test/support/p2-pending.ts`, `test/support/harness.ts`, `test/support/contract.ts`.
- `apps/worker/**`.
- `packages/db/**` except the frozen `0010`–`0018` (new migrations `0019+` only if genuinely needed; you are the only migration writer), `schema.ts` entries for `0019+`, `dev-seed.ts` (synthetic, marked), `packages/db/test/**`.
- New zod mirrors `packages/shared/src/schemas/{methodology,charter,direction,diagnose,design,decision,gate,evidence,team}.ts` and the barrel `packages/shared/src/schemas/index.ts` (**`kpi.ts` is KBE's — already exported; do not edit it**).

## Frozen / off-limits (do NOT edit)
`docs/api/openapi.yaml`, `docs/architecture/**`, `docs/analysis/permissions-matrix.md`, migrations `0010`–`0018`, `packages/shared/src/{permissions.ts,constants.ts,problem.ts}`, root build config, all dependencies/lockfile. KBE's files (above). All `apps/web/**`. The write guard also blocks `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gate records, `stages.json`, `findings.json`, `candidates/**`, `runs/**`, `test-evidence/**`, `trading_agent/**`. If the contract or a frozen migration genuinely must change, **stop and record it in the handback** for the architect — do not edit it.

## First change (do this first; KBE/FE depend on it)
In `apps/api/src/modules.ts`: add `methodology` and `evidence` to the module lists (create each dir with `index.ts` + `*.test.ts`); `workflows.dependsOn += ["kpi","evidence"]`; keep `transformations` free of `workflows` (no cycle). Update `architecture.test.ts`. Add the `platform` problem mapping for the P2 DB-guard errors (work split §2 / ADR-0016 §3 / ADR-0015): `*_version_step` → 409 version-conflict; `gate_decision_not_submitter` → 403 `gate.submitter_cannot_decide`; `gate_decision_current_submission` → 409 `gate.submission_superseded`; template CHECK/NOT NULL → 400/422 with field pointers; `*_audit_required` → 500. Commit-sanity: `pnpm -r typecheck` green after the skeletons.

## Resources to route + exercise (shrink `p2-pending.ts` toward empty)
Implement every BE OpenAPI operation (work split §2 table) with real behaviour, and **remove each from `test/support/p2-pending.ts` as it becomes routed and exercised**:
- `transformations`: `charter` (+ `/charter/versions`), `north-star` (+ `/history`), `strategic-guardrails`, `outcomes`, `diagnostic-items` (T01), `diagnostic-findings`, `workstream-outputs`, `tom-gaps` (T03), `capability-heatmap`, `journeys` (+ `pain-points`); `POST /transformations` calls `p2_instantiate_transformation()` in its own transaction.
- `workflows`: `/decisions` (+ `options`, `decide`), `tom-workshops` (+ `participants`,`items`,`convert`), `actions`, `dependencies`, `tom-canvas` (aggregated read model + cell PATCH), `gates` (list/get/configure/submissions/decision) and the G1/G2/G3 criterion evaluators. The G1/G2 evaluators consume KBE's `loadKpiGateFacts(db, transformationId)` exported from `apps/api/src/modules/kpi/index.ts` (interface in work split §3) — import it; if KBE's build is not yet merged when you reach the evaluators, code against that exact interface and leave the kpi-fact-dependent criteria in `p2-pending.ts` with a clear TODO for the orchestrator to close after KBE merges.
- `evidence` (new): `evidence` (+ `content` upload/download, `review`), `evidence-links`.
- `methodology` (new): `GET /transformations/{id}/methodology`, `PATCH /methodology/tom-dimensions/{dimensionCode}`.
- `access`: `GET /role-accountabilities`, `GET`/`POST /transformations/{id}/scoped-assignments`; the record-level rule helpers of ADR-0020 §3.

## Non-negotiable conventions (every mutation; ADRs + CLAUDE.md)
- **Server-side authorization on every mutation** via the single policy function (P1 pattern), scoped per ADR-0020; **technical admins are not business approvers**. A **read-only auditor (AUD) gets 403 on every P2 mutation** — add the generated test that enumerates every P2 mutation route and asserts AUD→403 (KBE covers the kpi part).
- **Validation** with the shared zod schemas (author the BE mirrors); reject out-of-domain values server-side (e.g., T01 confidence ∉ H/M/L → 400/422; T02 missing target date → 422; T03 missing dimension → 422; charter invalid baseline date → 422).
- **Optimistic concurrency**: `If-Match`/ETag on every update, 409 on mismatch; the DB `version` must step by exactly 1 and the audit event must exist (the guards enforce it — map their errors, don't fight them).
- **Audit event per mutation** (actor, action, record type/id, prior+new version, reason, request id).
- **Product gates G1–G3**: evidence that is only a filename or inaccessible link is **unverified** and leaves the criterion incomplete (REQ-S13-012); a decision by a non-configured approver **or the submitter** → **403**; a decision on a superseded submission version → **409**; approval advances the phase (ADR-0015). **These are business gates — never read or write the engineering DG0–DG7 records; label nothing as a DG approval.**
- **Decimal** for money/rates; **Unknown/Stale** never shown as 0/green. User-facing strings that the API emits (problem titles/details) should be translatable where the design calls for it.

## Self-verification (real output in the handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm format:check` on your files, `pnpm openapi:lint` (contract unchanged, 160 ops), `pnpm test` (unit, Node 22 and Node 24), and the integration suite twice on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, unique `QA_PG_PORT`) — including `contract.test.ts` (every routed op exercised; `p2-pending.ts` only the still-unrouted ops), the per-template validation, the gate 403/409 behaviours, optimistic-concurrency 409, and the AUD-403 sweep. `node tools/gates/validate.mjs --historical --stage DG1` must stay exit 0 (you did not disturb DG1). A missing tool/DB is BLOCKED, not a skipped check.

## If you cannot finish in one run
Prioritise: first change → transformations resources → gates/decisions/workflows → evidence/methodology → access → AUD sweep. Keep everything you land **green** (typecheck/build/unit/integration pass; `p2-pending.ts` accurately lists what is still unrouted). State precisely in the handback what is done and what remains, so the orchestrator can re-launch you for the remainder.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-BE-backend-workflow-engineer.md` — the diff summary, every check's real output, the remaining `p2-pending.ts` contents, and any contract/migration change you need the architect to make.
