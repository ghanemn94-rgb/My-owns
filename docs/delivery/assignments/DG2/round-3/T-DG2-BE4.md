# Assignment T-DG2-BE4: DG2 round-2 repairs (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline.
- **Concurrency:** frontend-ux-engineer (T-DG2-FE4, `apps/web/**`) and transformation-analyst (T-DG2-AN3, `docs/delivery/requirements.csv`) run at the same time as you. Do **not** touch `apps/web/**` or `requirements.csv`.
- **Frozen files:** do not edit `docs/api/openapi.yaml` or migrations 0010-0019. The pre-check result enum (`pass | attention | not_applicable | unknown`) stays as it is; no contract change is needed.
- **Findings:** full text in `docs/delivery/findings.json`. Note the files and behaviour for each fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair

### 1. F-DG2-150 (Medium, **mandatory**, REQ-PB-031 / B0041): the exclusions pre-check never fails

The bug is in `apps/api/src/modules/transformations/charter.ts`, around lines 250-253 (`case "exclusions_present"`). Today:
- a saved charter with an empty Out of scope returns `unknown`;
- a whitespace-only Out of scope (`"   "`, accepted by `outOfScope: text(1, 20000)`) returns `pass`.

The register acceptance (A01) says: *"an empty Out of scope field makes 'Are explicit exclusions documented?' fail."* On a saved charter, an empty Out of scope is a definite B0041 answer (no exclusions are documented), not missing data.

Required behaviour:
- When `out_of_scope` is null, empty or whitespace-only (trimmed length 0), return result **`attention`**, with the detail `No explicit exclusions (out of scope) are documented; this check fails until Out of scope is completed.` `attention` is the existing non-pass result that the other system pre-checks already use for a detected failure.
- Return `pass` only when the trimmed value is non-empty.
- Never return `unknown` for this pre-check on a saved charter.

Also:
- Check whether anything else reads `scopeCheckPrechecks` or the exclusions result, such as G1/G2 readiness or gate criteria, and keep it consistent.
- Update ADR-0017 §2 (`docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md`): state that for `exclusions_present` an empty or blank Out of scope on a saved charter is a failing answer (`attention`), not missing data, and cite B0041 and REQ-PB-031 A01.
- Update the integration test `apps/api/test/integration/registers.test.ts`, around line 90, which asserts `["exclusions_documented","unknown"]`.
- Add regression tests:
  - empty gives `attention`;
  - whitespace-only gives `attention`;
  - a real exclusion text gives `pass`;
  - clearing it again (PATCH with If-Match) gives `attention`.

### 2. F-DG2-143 (Low, REQ-S16-001): the flaky required unit check

`apps/api/src/architecture.test.ts:107` ("every import respects dependsOn, public surfaces and allowed packages") runs in the `unit-node` project, which has no `testTimeout`, so vitest's 5 s default applies. The test takes 4.3-4.6 s without load and timed out at 5.8 s under moderate load.

Required:
- Make it deterministic. Give the AST-walking architecture tests an explicit timeout with real headroom: per-test `30_000`, with a comment citing F-DG2-143. Also make them cheaper where that is easy, for example by parsing each source file once and sharing the result between the boundary tests.
- Then run the unit suites with a duration reporter (e.g. `pnpm vitest run --project unit-node --reporter=verbose`) and list in the handback every unit test slower than 2.5 s.
- Any other unit test within 2x of its timeout also gets explicit headroom.
- Do not raise the global default for all unit tests.

## Conventions (unchanged)
- Server-side authz, If-Match/409 and an audit event on every mutation.
- Decimal money.
- Unknown/Stale is never shown as 0 or green.
- Product gates G1-G6 are business approvals and never DG0-DG7.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** 24.
- The integration suite on a disposable PostgreSQL (unique `QA_PG_PORT`, e.g. 55471, via `tests/qa/support/with-pg.sh`), including `registers.test.ts`, your new tests and `contract.test.ts` (161 ops).
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0.

If a build or test error looks like a concurrent write by the frontend run in the same tree (for example ENOENT under a `dist/` folder), re-run once and say so in the handback.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE4-backend-workflow-engineer.md`. For each finding, give the fix, the files changed and every check's real output.
