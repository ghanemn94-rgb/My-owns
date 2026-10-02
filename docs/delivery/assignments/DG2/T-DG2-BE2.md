# Assignment T-DG2-BE2: wire the good-outcome test (REQ-PB-036) and green the contract (backend-workflow-engineer)

- **Stage:** P2 / DG2 (BUILDING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (`ecb3c0e`+). Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline. **Read your prior handback `docs/delivery/handbacks/DG2/T-DG2-BE-backend-workflow-engineer.md` §4.1 and `docs/architecture/p2-work-split.md` §2.**
- **Context:** your T-DG2-BE work is merged (all 104 BE ops routed). The orchestrator amended the contract (D-060): the `Outcome` schema now **requires** the computed `goodOutcomeTest` (array of `GoodOutcomeResult {criterionCode, ordinal, result: pass|fail|unknown, reason}`) and `goodOutcomePass` (boolean). **The contract-response integration test is currently red** because your outcome responses do not yet return these fields. Your job: make them real and green.
- **frontend-ux-engineer runs concurrently** on `apps/web/**` (disjoint). Do not touch `apps/web/**`, KBE's `apps/api/src/modules/kpi/**`/`schemas/kpi.ts`/`value.ts`, migrations `0010`–`0018`, or `docs/api/openapi.yaml` (frozen; the amendment is done). If you need a further contract change, stop and record it in the handback.

## Deliver REQ-PB-036 (final_gate DG2) — "apply the good outcome test to every outcome; G2 readiness lists failing outcomes"
1. **Compute the test server-side** for every outcome, from the outcome's recorded inputs against the seeded `good_outcome_criterion` catalogue (migration 0011, B0051, 5 criteria). For each of the 5 criteria return `{criterionCode, ordinal, result, reason}`:
   - `pass`/`fail` derived from the outcome fields (e.g. specific/measurable needs a statement that is specific and `specificConfirmed`; has-a-KPI needs at least one `outcome_kpi` row referencing this outcome (consume KBE's data via the existing join or `loadKpiGateFacts` if convenient); strategically-relevant needs `strategicallyRelevantConfirmed`; time-bound needs a linked KPI target date; causal needs `causalChain`). Map each criterion to the fields that evidence it; where the catalogue's `evaluation` text implies the check, follow it.
   - `unknown` when the inputs the criterion needs are not recorded — **never a silent pass**; `reason` explains what is missing or why it failed (e.g. "no KPI linked", "statement is not specific").
   - `goodOutcomePass` = true only when no criterion is `fail` and none is `unknown`.
   - Return `goodOutcomeTest` + `goodOutcomePass` on every `Outcome` response (get, list, create, update). The acceptance fixture: an outcome worded "Launch new app" with no KPI must fail the test with reasons.
2. **G2 readiness lists failing outcomes.** Ensure the G2 "Direction" criterion evaluator reports the outcomes whose `goodOutcomePass` is false (ids + which criteria), so a G2 submission surfaces them (consistent with how the other criteria list incomplete items). Confirm REQ-PB-037 (G2 cannot be submitted with zero active guardrails) and REQ-PB-035 (3–5 top-outcome warning) still hold; if the good-outcome result should block/so-inform G2 per the source, wire it as a readiness signal (do not silently pass).
3. **Zod mirror:** add `goodOutcomeTest`/`goodOutcomePass` (and the `GoodOutcomeResult` shape) to the BE-owned `packages/shared/src/schemas/direction.ts` outcome mirror so the contract-exercise lockstep passes.
4. **Tests:** extend your outcome + gates integration tests to cover the computed test (pass, fail-with-reason, unknown) and the G2 failing-outcomes list. Update the contract exercises if needed so `contract.test.ts` is green again.

## Conventions (unchanged)
Server-side authorization, If-Match/409, audit event per mutation, decimal money, Unknown/Stale never 0/green, product gates G1–G6 separate from DG0–DG7. `goodOutcomeTest` is a **computed read field** — it is not stored and not writable (do not add it to `OutcomeCreate`/`OutcomeUpdate`).

## Self-verification (real output in the handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm format:check` (your files), `pnpm openapi:lint` (160 ops, contract unchanged by you), `pnpm test` (Node 22 + 24), and the integration suite on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`, unique `QA_PG_PORT`) — `contract.test.ts` **green again**, the good-outcome test cases, the G2 readiness list. `node tools/gates/validate.mjs --historical --stage DG1` exit 0.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-BE2-backend-workflow-engineer.md` — the diff, every check's real output, and confirmation that `contract.test.ts` is green and REQ-PB-036 is met.
