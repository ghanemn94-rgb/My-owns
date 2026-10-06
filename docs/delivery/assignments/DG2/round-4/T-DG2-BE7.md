# Assignment T-DG2-BE7: one blank-text rule for names and reasons too (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (BE6 `35fb823` is integrated). No other agent runs at the same time. frontend-ux-engineer T-DG2-FE5 runs **after** you.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **Frozen files:** do not edit `docs/api/openapi.yaml` or migrations 0010-0019. Do not touch `apps/web/**`; FE5 owns it next.
- **Why:** this closes the gap your BE6 handback (§4, "Scope boundary") left open. F-DG2-160 makes `hasVisibleContent()` the single blank rule for P2 free text. Some schemas still decide blankness with `trim()`, so an invisible-only value such as `"‏‏‏"` passes them as a valid reason or name:
  - the shared `name` (`z.string().trim().min(1).max(200)`) and `reason` (`z.string().trim().min(3).max(1000)`) in `packages/shared/src/schemas/common.ts`, used by `reasonRequest` and the P1/admin records;
  - two inline reason parsers: `apps/api/src/modules/transformations/register-kit.ts:505` (register archive) and `apps/api/src/modules/evidence/routes.ts:637`.

  One rule must apply everywhere.

## Required
1. **Shared schemas.** In `common.ts`, make `name` and `reason` reject a value that has no visible content, with `validation.blank` (`BLANK_TEXT_CODE`). Keep the existing `trim()` and min/max behaviour, so that leading and trailing spaces are still trimmed and a spaces-only value still fails `min` with `too_small`. A value must never get two errors: mirror `freeText`'s `v.length === 0 || hasVisibleContent(v)`.
   - Watch declaration order. `BLANK_TEXT_CODE` and `hasVisibleContent` must be defined before any schema that uses them is constructed, or you hit a TDZ error.
2. **Inline reason parsers.** Replace both inline parsers (`register-kit.ts:505`, `evidence/routes.ts:637`) with the shared `reason` schema, so there is one definition.
3. **Sweep.** Search `apps/api/src`, `apps/worker/src` and `packages/shared/src` for any other user-text schema or check that decides "blank" with `trim()`, such as `z.string().trim()` or `.trim() === ""` / `.trim().length`, and move it onto `hasVisibleContent`/`hasText`. Exclude identifiers and codes that have their own regex. List every hit in the handback with what you did to it.
4. **Tests.**
   - Shared unit tests:
     - `reason` and `name` reject `"‏‏‏"`, `"⁠⁠⁠"` and `"\u0085\u0085\u0085"` with `validation.blank`.
     - `"   "` still fails `too_small` only.
     - Visible text, including Arabic with an RLM, is accepted and trimmed as before.
   - Integration, on a disposable PostgreSQL, extending `apps/api/test/integration/blank-text.test.ts`:
     - archiving a P2 register record (for example a T03 TOM gap) with an invisible-only reason returns 400 `validation.blank` at `/reason`, writes nothing and adds no audit row;
     - the same check for the evidence reason endpoint at `routes.ts:637`;
     - a P1 reason endpoint, for example deactivating or archiving a P1 record through `reasonRequest`;
     - a valid reason still succeeds.
5. **ADR note.** Extend the ADR-0017 §2 rule to say that `name` and `reason` follow the same visible-content rule, citing F-DG2-160.

## Conventions (unchanged)
- Every mutation keeps its server-side authz check, If-Match/409 and audit event.
- Product gates G1-G6 are business approvals and never DG0-DG7.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** 24
- the integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`), including `blank-text.test.ts` and `contract.test.ts` (161 ops)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE7-backend-workflow-engineer.md` with the fix, the files changed, the sweep table and every check's real output. Keep the evidence to logs only.
