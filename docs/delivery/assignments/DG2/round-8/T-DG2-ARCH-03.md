# Assignment T-DG2-ARCH-03: the contract declares every status the platform layer can return (solution-architect)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`, which already includes BE13 `d9c3f5d` and DEVOPS3 `4e3c446`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium; never run `playwright install`.
- **You may edit:** `docs/api/openapi.yaml` (you own the contract), the contract tests under `apps/api/test/integration/contract/**`, ADR-0007, and any test that encodes the old contract, with a comment.
- **Do not edit:** product behaviour, migrations, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.

## Why
The T-DG2-BE13 handback (§6.1) reports a pre-existing contract gap. The **global rate limiter** (`@fastify/rate-limit`, registered in `apps/api/src/server.ts`) can answer **429** (`RateLimited` problem) on every operation, yet **158 of 161 operations** do not declare `"429"`. Only the three auth operations do.

BE13's rate-limit test currently has to skip the contract assertion for that call. This is the same kind of drift that ARCH-02 fixed for 400. A status the server can return but the operation does not declare is drift.

## Required
1. **Find every platform status.** Enumerate each status the **platform layer** can return for an operation, regardless of handler, and check the contract declares it. The platform layer means hooks, access/authz, CSRF, rate limiting, validation and framework/parser errors. At least:
   - 429 (rate limit). Read the limiter config: which routes are exempt (health, if any), and is the key per session or per IP?
   - 401 (unauthenticated) on every non-public operation.
   - 403 (forbidden / CSRF) on every operation that runs the access or CSRF checks.
   - 400. ARCH-02 already covered it; re-confirm.
   - 428 and 409 on every operation that requires If-Match.

   Declare each missing one with the existing components: `RateLimited`, `Unauthenticated`, `Forbidden`, `ValidationError`, `PreconditionRequired`, `VersionConflict`. The change is additive only; the contract stays at **161 operations**. List every operation changed in the handback.
2. **Out of scope by design (D-067).** These are deliberately not declared: 500 `internal` (a failure, never a contract response), 408 transport timeout, and 404 for an unmatched route. Record this rule in ADR-0007 next to the §5a rule from ARCH-02.
3. **Rule test.** Extend the contract rule test from ARCH-02. For every operation, it derives the platform statuses from the route's declared access (public or not, mutation or not, If-Match or not, rate-limited or not) and fails if any is undeclared. Re-enable the contract assertion in BE13's rate-limit test (`apps/api/test/integration/invalid-utf8.test.ts` or wherever it lives) so the 429 is checked against the contract.
4. **Negative control.** Run the new rule test against the old contract; it must fail.

## Self-verification (real output in the handback)
Run every check in **both locale settings**, `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`. Use ports below 32768; the harnesses now retry on collisions.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check`, plus the `--ignore-path` variant if only sandbox-masked dotfiles fail
- `pnpm openapi:lint`: 161 operations
- `pnpm test` on Node 22 **and** Node 24
- the integration suite, including `contract.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar, with `--workers=1`
- `node tools/gates/validate.mjs --historical --stage DG1`, which must exit 0

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-ARCH-03-solution-architect.md` with the operations changed, the files changed and every check's real output. Keep evidence to logs only.
