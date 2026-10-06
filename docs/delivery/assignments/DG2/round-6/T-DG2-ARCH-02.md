# Assignment T-DG2-ARCH-02: contract declares every 400 the server can return (solution-architect)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD` (BE10 `e057bf8` is integrated). No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **You may edit:** `docs/api/openapi.yaml` (contract owner) and the API code/tests named below.
- **Do not edit:** migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Why
The T-DG2-BE10 handback (§5) reports a pre-existing contract gap. **33 GET-by-id operations** (P1 and P2, for example `GET /api/v1/transformations/{transformationId}/tom-gaps/{tomGapId}` and `GET /api/v1/users/{userId}`) declare only 200/401/404. Yet the server has always answered a malformed path id, and now a path id containing U+0000, with **400** (validation problem). A response status the contract does not declare is contract drift. The tests guard against exactly this, but no test exercises a malformed id on those operations.

The same handback notes a second, smaller gap. `apps/api/src/modules/transformations/register-kit.ts` `paramsOf` parses each id with a bare `z.uuid()`, so the problem pointer is `/params/` without the parameter name. It should be `/params/<name>`, matching `validation.ts`'s pointer style.

## Required
1. **Contract.**
   - In `docs/api/openapi.yaml`, declare the standard 400 validation problem response, reusing the existing component used by other operations, on every operation where the server can return 400 but the contract does not declare it.
   - **Sweep all 161 operations.** Cover at least every operation with path parameters, plus every operation with query parameters that are validated (limits, cursors, filters).
   - Do not change any other part of the contract. The operation count must stay **161**.
   - In the handback, list every operation changed.
2. **Pointer.** Make register-kit `paramsOf` (and any similar path-param helper you find) report `/params/<name>`, for example `/params/tomGapId`.
3. **Tests.**
   - Extend the contract tests (`apps/api/test/integration/contract/**`) so every GET-by-id operation is exercised with a malformed id. Each must return 400 (declared), with the pointer `/params/<name>` and nothing written.
   - Add one case with a path id containing U+0000 → 400 `validation.invalid_character`.
   - The existing contract assertion that every observed status is declared must stay strict.
4. **Docs.** Record the contract amendment in the relevant ADR or the API conventions doc (`docs/api/**` or `docs/architecture/**`). The rule: every operation that validates input declares 400.

## Self-verification (real output in the handback)
Run every check in **both locale settings**: `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** 24
- the integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`), including `contract.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0

Also run a negative control: the new contract cases must fail on the old contract.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-ARCH-02-solution-architect.md` with the operations changed, the files changed and every check's real output. Keep the evidence to logs only.
