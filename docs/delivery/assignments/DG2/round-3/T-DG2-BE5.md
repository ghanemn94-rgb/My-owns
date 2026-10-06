# Assignment T-DG2-BE5: DG2 round-3 hardening, blank free text and the web timeout residual (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. BE4, FE4 and AN3 are integrated; no other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **Frozen files:** do not edit `docs/api/openapi.yaml` or migrations 0010-0019.
- **Why:**
  - Part A follows from F-DG2-150 and from your BE4 handback, gap 3. A whitespace-only value is not content, but every P2 free-text field except Out of scope still accepts `"   "` and counts it as present (for example `in_scope`, `case_for_change`, T01 `current_state` and `root_cause`).
  - Part B is the open residual of F-DG2-143 from your BE4 handback, gap 1.

## A. Blank free text is never stored as content (same root cause as F-DG2-150)

1. **Validation.** In each P2 shared schema's local `text(min, max)` helper with `min >= 1`, reject a string whose trimmed length is 0:
   - The files: `packages/shared/src/schemas/{charter,decision,design,diagnose,direction,evidence,kpi,methodology,gate,team}.ts`, plus any other P2 input schema with free text.
   - The response is the standard 400 validation problem, with a JSON pointer to the field. Nothing is written and there is no audit event.
   - Nullable fields still accept `null` to clear them.
   - Keep the stored text exactly as entered. Do not add a trimming transform.
   - Keep the helpers' TypeScript types usable at every call site.
2. **Readiness.** Defense in depth for G1-G3 readiness (`apps/api/src/modules/workflows/criteria.ts` and the charter pre-checks):
   - Every free-text "is present" test uses one shared trimmed-non-empty helper (reuse or generalise `hasExclusions`), not `!== null`.
   - Also check `composeThesis` and the thesis "incomplete" warning: a blank thesis part is incomplete.
3. **Web forms.** Check that a 400 for a blank field shows a localized validation message in EN and AR. If a new message key is needed, add both languages. If web forms reuse these shared schemas client-side, check that the blank case is also caught there.
4. **ADR note.** Record the rule ("blank free text is rejected; null clears") in ADR-0017 or the P2 data-model ADR, citing F-DG2-150.
5. **Tests.**
   - Unit tests for the helper(s).
   - Integration tests on a disposable PostgreSQL. A whitespace-only value for a representative field of each kind returns 400 with the pointer, writes nothing and adds no audit event. The kinds are:
     - charter: `inScope`, `caseForChange`, a thesis part;
     - T01 diagnostic item: `currentState`;
     - T03 TOM gap;
     - T04 decision;
     - KPI definition name;
     - evidence note.
   - Valid text still succeeds, and `null` still clears a nullable field.
   - Update any existing test that relied on whitespace-only input.

## B. F-DG2-143 residual: unit-test timeout headroom on the web side

- `apps/web/src/pages/transformations/transformations.test.tsx`, the test "a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)", runs at about 3.2 s against vitest's 5 s default. Give it an explicit `30_000` timeout with a comment citing F-DG2-143. Find out why it takes 3 s (for example a real timer or retry back-off) and make it faster if you can do that without weakening the assertion; fake timers are fine.
- Re-run the unit suites with `--reporter=verbose` and confirm that no unit test anywhere (unit-node or unit-web) is within 2x of its timeout without an explicit timeout. List every test over 1.5 s in the handback.

## Conventions (unchanged)
- Server-side authz, If-Match/409 and an audit event on every mutation.
- Decimal money.
- Unknown/Stale is never shown as 0 or green.
- AR and EN for every user-facing string.
- Product gates G1-G6 are business approvals and never DG0-DG7.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (if it fails only on unreadable sandbox-masked dotfiles, also run the `--ignore-path` variant and show both)
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** 24.
- The integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`, `tests/qa/support/with-pg.sh`), including `contract.test.ts` (161 ops).
- The web e2e P1 and P2 journeys in chromium-en and chromium-ar (`--workers=1`, unique ports, the pre-installed Chromium; never run `playwright install`), with axe reporting 0 serious or critical violations.
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE5-backend-workflow-engineer.md`. Give the fix, the files changed and every check's real output. Keep the evidence small: logs and at most a few cited screenshots.
