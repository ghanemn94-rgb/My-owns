# Assignment T-DG1-BE2: implement GET /api/v1/branding/tokens (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (BUILDING). **Base revision:** current HEAD. A follow-up to T-DG1-BE: one missing P1 endpoint.
- `node_modules` is installed; typecheck/build/test run **offline**. Do not run `pnpm install`.

## Why
REQ-S15-002 (final gate DG1, acceptance A20) requires the API to return the seven seeded design tokens with their
values and `provenance=provisional`. The `screen_api` is `GET /api/v1/branding/tokens`. The tokens exist in
`@mth/design-tokens` but the endpoint was not built. The **contract is already updated** (the orchestrator added
`getBrandingTokens` and the `BrandingTokens` schema to the frozen `docs/api/openapi.yaml`); implement it to match.

## Scope — you own (write)
- `apps/api/src/modules/**` (a `branding` module, or add to an existing module you judge appropriate — keep it consistent
  with `apps/api/src/modules.ts` boundaries and the dependency rules; if you add a `branding` module, declare it in
  `modules.ts` under the existing reserved/active convention and keep `architecture.test.ts` green), `apps/api/src/server.ts`
  (route registration), `apps/api/test/**`.
- `packages/shared/src/schemas/**` (a zod mirror of `BrandingTokens`, in lockstep with `docs/api/openapi.yaml`).
- You may edit the `scripts` field of package.json files you own. **Do not** change any dependency, the lockfile, or other frozen files.

## Deliver
- `GET /api/v1/branding/tokens` returning `{ provenance: "provisional", tokens: [ { name, value, purpose?, provisional } … ] }`
  for the **seven seeded §15 tokens** read from `@mth/design-tokens` (`colorTokens`), with `provenance=provisional` while
  `tokensAreProvisional` is true. Match the contract operation `getBrandingTokens` and the `BrandingTokens` schema exactly
  (contract tests must pass).
- Access: an authenticated read (401 when unauthenticated), consistent with the other read endpoints; choose an existing
  permission if one fits, else authenticated-only — follow the codebase's route `access` declaration convention so the
  route-coverage and access-declaration tests stay green. No new permission unless necessary.
- Unit/contract test(s): the endpoint returns the seven tokens with the listed values and `provenance=provisional`; the
  response validates against the shared schema / contract. No UI string or response claims official Mobily brand compliance.

## Must not touch
`docs/api/openapi.yaml` (already updated — code against it), `docs/architecture/**`, `apps/web/**`, `packages/db/**`,
`packages/config/**`, `packages/design-tokens/**` (consume it read-only), `deploy/**`, `.github/**`, `tools/**`, and the
frozen files / delivery records.

## Acceptance checks (reviewers verify)
1. `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint` pass.
2. `pnpm test` (unit-node) passes, including your branding test and the architecture/route-coverage/contract tests.
3. `GET /api/v1/branding/tokens` returns the seven seeded tokens with `provenance=provisional` and validates against the contract.

## Handback
`docs/delivery/handbacks/DG1/T-DG1-BE2-backend-workflow-engineer.md` — files changed, the access decision, checks run with real output, anything BLOCKED.
