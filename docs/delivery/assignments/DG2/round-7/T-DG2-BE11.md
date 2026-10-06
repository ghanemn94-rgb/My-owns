# Assignment T-DG2-BE11: DG2 round-6 repair: lone UTF-16 surrogates (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING). **Branch:** `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium; never run `playwright install`.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Findings:** full text in `docs/delivery/findings.json`; the reviewer's repro is under `docs/delivery/test-evidence/DG2/code-security/round-6/`. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair

**F-DG2-260 (Low, REQ-DLV-034).** A lone UTF-16 surrogate in the ID token's `sub` makes the OIDC callback answer an **undeclared 400** (`validation.format`) instead of its declared 302. The failed sign-in also leaves **no audit row**.

The reviewer also observed related behaviour on the main API:
- In text columns, a lone surrogate is silently replaced by U+FFFD on the way to PostgreSQL.
- A value that reaches jsonb directly (for example a journey step name) gets a declared 400 `validation.format`, but at pointer `''` instead of the field's pointer.

### Root cause and required fix
`hasInvalidCharacter()` in `packages/shared/src/schemas/common.ts` detects only U+0000. A string that is not well-formed UTF-16 is just as unstorable or unfaithful.

1. **Detection.** `hasInvalidCharacter(value)` must be true when `value` contains U+0000 **or a lone surrogate**. For example: `value.includes("\u0000") || /\p{Cs}/u.test(value)`. In `/u` mode, `\p{Cs}` matches only *unpaired* surrogates; a valid astral pair such as an emoji is one code point and does not match. Cite F-DG2-260 in the comment.
2. **Coverage.** Everything that already uses this helper picks up the change. Confirm with tests that each of these does:
   - the central request check (body, query and params → 400 `validation.invalid_character` at the **field's** pointer);
   - the shared `freeText`, `name` and `reason` schemas (the web client catches it);
   - `identityClaimsStorable`.

   A lone surrogate in an ID-token `iss` or `sub` must then follow the declared callback contract: **302 `/login?error=token_invalid`, with a `session.login_failed` audit row**, exactly like the NUL case.
3. **OIDC display claims.** In `displayNameCandidate` (`oidc.ts`), a `name`/`preferred_username`/`email` claim containing an invalid character is treated as absent. It falls back to the next claim, so U+FFFD is never stored silently. Do the same for any other claim value that gets stored.
4. **Sweep.** Find any other place where a client- or IdP-supplied string reaches storage or audit without passing through the central check or the shared schemas, for example headers recorded in audit or the request id. Make each one use the same helper. List them in the handback.

### Tests
- **Shared unit:**
  - `hasInvalidCharacter` is true for `"a\uD800"`, `"\uDC00b"` and `"\uD800\uD800"`;
  - it is false for `"\u{1F600}"` and Arabic text;
  - the schemas refuse these values with `validation.invalid_character`.
- **Integration:**
  - a lone surrogate in a charter field and in a journey step name returns 400 `validation.invalid_character` at the field's pointer, writes nothing and creates no audit row;
  - OIDC: a lone surrogate in `sub` and in `iss` gives 302 `token_invalid` plus a `session.login_failed` audit row, and no user, identity or session is created;
  - a lone surrogate in the `name` claim falls back to `email`;
  - valid emoji and Arabic text still pass everywhere.
- **Negative control:** the new tests fail on the old code.

## Conventions (unchanged)
- Every mutation keeps a server-side authz check, If-Match/409 and an audit event.
- Product gates G1-G6 are business approvals and never DG0-DG7.

## Self-verification (real output in the handback)
Run every check below in **both locale settings**: `env -u LANG -u LC_ALL …` and `LANG=C.UTF-8 …`.
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint` (161 operations)
- `pnpm test` on Node 22 **and** Node 24
- the integration suite (`QA_PG_PORT=55471`), including `contract.test.ts`, `invalid-character.test.ts`, `oidc.test.ts` and `blank-text.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE11-backend-workflow-engineer.md` with the fix, the files changed, the sweep list and every check's real output. Keep the evidence to logs only.
