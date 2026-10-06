# Handback T-DG2-BE7: one blank-text rule for names and reasons (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), round 4. Finding: **F-DG2-160** (residual scope from the BE6 handback §4).
- **Invocation:** `DG2-T-DG2-BE7-backend-workflow-engineer-20261006T063203Z-74bc7fb4` (session `74bc7fb4-b20a-4e03-86e8-303381fe9e4a`).
- **Assignment:** `docs/delivery/assignments/DG2/round-4/T-DG2-BE7.md`, sha256 `f4f45e3a0b862f36a3b5b9a68ef936239d1fc3ca2e5d42e978736c3b9c59e039` (verified).
- **Base:** `HEAD` = `80fc0b88a36e881b67d8f04924688f21a291ddaa` on `claude/mobily-transformation-platform-regate`. The tree was clean apart from sandbox-masked dotfiles. Changes are left uncommitted for the orchestrator.
- **Frozen files respected:** `docs/api/openapi.yaml`, migrations 0010-0019 and `apps/web/**` were not touched. No new migration, no new endpoint.
- **Product gates:** G1-G6 are business approvals inside the product. This work grants none and implies nothing about DG0-DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | `name` and `reason` are now built by a private `trimmedText(min, max)`: `z.string().trim().min().max().refine(v => v.length < min \|\| hasVisibleContent(v), BLANK_TEXT_CODE)`. It is declared **after** `hasVisibleContent`/`BLANK_TEXT_CODE`, so there is no TDZ. `reasonRequest` (also after it) picks up the rule. |
| `apps/api/src/modules/transformations/register-kit.ts` | P2 register archive (old line 505): the inline `z.strictObject({ reason: z.string().trim().min(3).max(1000) })` is replaced by the shared `reasonRequest`. |
| `apps/api/src/modules/evidence/routes.ts` | Evidence-link removal (old line 637): the same inline parser is replaced by the shared `reasonRequest`. |
| `apps/api/src/modules/admin/routes.ts` | Sweep: the "empty identity issuer" check `issuer.trim() === ""` becomes `!hasVisibleContent(issuer)`. Same 400 `validation.too_small` at `/identity/issuer`, so the contract is unchanged. |
| `apps/api/src/modules/identity/oidc.ts` | Sweep: the display-name claim fallback `v.trim().length > 0` becomes `hasText(v)`, so an invisible-only `name` claim falls through to `preferred_username`/`email`. |
| `packages/shared/src/schemas/schemas.test.ts` | New unit block "name and reason: one blank rule" (7 tests). |
| `apps/api/test/integration/blank-text.test.ts` | New describe "invisible-only reasons are blank on every reason endpoint" (3 tests: T03 TOM gap archive, evidence-link removal, P1 transformation archive). |
| `apps/api/test/integration/admin.test.ts` | Extends the empty-issuer assertion: blank and invisible issuers (`"   "`, U+200F×2, U+2060, U+0085) are rejected with 400 at `/identity/issuer`. |
| `apps/api/test/integration/oidc.test.ts` | New test: a JIT user whose `name` claim is `"‏⁠\u0085"` gets the e-mail as display name. |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` | §2 blank rule: new bullet "`name` and `reason` follow the same rule (F-DG2-160, T-DG2-BE7)". |
| `docs/delivery/handbacks/DG2/T-DG2-BE7-evidence/*.log` | Check logs (below). |

## 2. Behaviour delivered (F-DG2-160)

1. **Shared schemas.** `name` (1-200) and `reason` (3-1000) behave as follows:
   - They still trim leading and trailing ECMAScript whitespace, and still apply `min`/`max` to the trimmed value.
   - They now reject a value with no visible content with `validation.blank`. Examples: `"‏‏‏"`, `"⁠⁠⁠"`, `"\u0085\u0085\u0085"`.
   - Each value gets exactly one error:
     - `"   "` and `""` fail `too_small` only.
     - A value that is invisible and too short (e.g. a single `"‏"` for `reason`, length 1 < 3) fails `too_small` only.
     - An invisible value long enough for `min` fails `validation.blank` only.
   - **Note on the "mirror `freeText`" instruction:** I used `v.length < min` rather than `freeText`'s literal `v.length === 0`.
     - For `min = 1` (`name`) the two are identical.
     - For `reason` (`min = 3`), the literal form would give `"‏"` two errors (`too_small` + `validation.blank`), because zod 4 keeps running refinements after a failed `min`. That would break the assignment's "a value must never get two errors". The generalized form keeps the invariant.
   - `freeText` itself is unchanged. With `min > 1`, `freeText` can still give two errors for an invisible value shorter than `min` (e.g. `freeText(3, …)` on `"‏"`). That is outside this assignment's scope; see §4.
2. **Inline parsers.** Both now use `reasonRequest`, so one definition remains. Authorization (`lockForChange` / `requireRecordWrite`), If-Match/409 and the audit event are unchanged and in the same order.
3. **Sweep** of `apps/api/src`, `apps/worker/src` and `packages/shared/src` for `.trim()` (non-test files). Regex patterns such as `^\s*$`, `\S`, `trimStart` and `trimEnd` returned no hits. Final grep: `T-DG2-BE7-evidence/sweep-trim.log`.

| Hit | Blank decision? | Action |
|---|---|---|
| `packages/shared/src/schemas/common.ts:32-33` `name`/`reason` = `z.string().trim().min()` | Yes (user text) | Moved onto `hasVisibleContent` via `trimmedText` (item 1). `trim()` stays as normalization only. |
| `apps/api/src/modules/transformations/register-kit.ts:505` inline reason | Yes | Replaced by shared `reasonRequest`. |
| `apps/api/src/modules/evidence/routes.ts:637` inline reason | Yes | Replaced by shared `reasonRequest`. |
| `apps/api/src/modules/admin/routes.ts:102` `issuer.trim() === ""` | Yes (no own regex, so not excluded) | Now `!hasVisibleContent(issuer)`. Code and pointer are unchanged. Covered in `admin.test.ts`. |
| `apps/api/src/modules/identity/oidc.ts:165` `v.trim().length > 0` (display-name claim) | Yes (user name) | Now `typeof v === "string" && hasText(v)`. `trim().slice(0,200)` stays as normalization of accepted text. Covered in `oidc.test.ts`. |
| `apps/api/src/modules/transformations/good-outcome.ts:59` `statement.trim()` | No: normalization before the activity-verb regex. Presence is already decided by `hasText`. | None |
| `packages/shared/src/schemas/direction.ts:38` `s.trim().match(...)` | No: counts sentence terminators (`single_sentence`). Blankness is decided by `freeText` (`text(1,300)`). | None |
| `packages/shared/src/schemas/charter.ts:157-159` `thesisPartText` | No: normalization. Blankness is already `hasText(t)` (BE6). | None |
| `packages/shared/src/schemas/common.ts:42` | Doc comment | None |
| `apps/worker/src` | No hits | None |

4. **Tests.**
   - **Shared unit tests:**
     - `name`, `reason` and `reasonRequest` reject `"‏‏‏"`, `"⁠⁠⁠"` and `"\u0085\u0085\u0085"` with exactly `[["", "validation.blank"]]`.
     - `"   "`, `""` and `" \t\n "` give `too_small` only.
     - Visible text, including Arabic wrapped in RLMs, is accepted and trimmed as before.
     - `max` still applies after trimming.
   - **Integration on a disposable PostgreSQL:** each of the three endpoints (T03 TOM gap archive, evidence-link removal, P1 transformation archive via `reasonRequest`) gets the three invisible reasons. Each one returns:
     - 400 `validation` with `{pointer: "/reason", code: "validation.blank"}`;
     - no audit row for the request;
     - the record unchanged (version, status, reason) and its audit trail unchanged.

     A valid reason then succeeds: 200 for the archives, `removed` v2 for the link, with exactly one new audit event.
   - **Negative control:** I swapped `common.ts`, `register-kit.ts` and `evidence/routes.ts` back to `HEAD`, then restored them. The 3 new unit tests and the 3 new integration tests failed. The same with `admin/routes.ts` and `oidc.ts` made the 2 sweep tests fail. All files were then restored (`git diff --stat` re-checked).
5. **ADR-0017 §2:** extended as in §1.

## 3. Checks actually run

These ran on the working tree at base `80fc0b8` plus the changes above. Logs are in `docs/delivery/handbacks/DG2/T-DG2-BE7-evidence/`.

| Command | Env | Result |
|---|---|---|
| `pnpm -r typecheck` | Node 24.21.0 | **exit 0**: `apps/worker typecheck: Done`, `apps/api typecheck: Done` (`typecheck.log`) |
| `pnpm -r build` | Node 24.21.0 | **exit 0**: `apps/worker build: Done`, `apps/api build: Done` (`build.log`) |
| `pnpm lint` | Node 24.21.0 | **exit 0**: `eslint . --max-warnings=0`, no output (`lint.log`) |
| `pnpm format:check` | Node 24.21.0 | **exit 2**. The only failures are 12 `EACCES` on sandbox-masked paths (`.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`). There are no style warnings: two test files were reformatted with `prettier --write` before this run (`format-check.log`). |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <those 12 paths>` | Node 24.21.0 | **exit 0**: "All matched files use Prettier code style!" (`format-check-ignore-path.log`) |
| `pnpm openapi:lint` | Node 24.21.0 | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` (`openapi-lint.log`) |
| `pnpm test` | Node 22.22.2 | **exit 0**: `Test Files 31 passed (31)`, `Tests 558 passed (558)` (`unit-node22.log`) |
| `pnpm test` | Node 24.21.0 | **exit 0**: `Test Files 31 passed (31)`, `Tests 558 passed (558)` (`unit-node24.log`) |
| `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | Node 22.22.2, disposable PostgreSQL 16.13 | **exit 0**: `Test Files 29 passed (29)`, `Tests 465 passed (465)`. That is 461 before, +3 in `blank-text.test.ts` (now 20/20) and +1 in `oidc.test.ts` (now 20/20). `admin.test.ts` is 11/11 (extended in place). `contract/contract.test.ts` is 11/11, including `expect(operations).toHaveLength(161)` (`integration-run.log`). |
| `node tools/gates/validate.mjs --historical --stage DG1` | Node 24.21.0 | **exit 0**: `PASS gate DG1 (historical)` (`validate-dg1-historical.log`) |

## 4. Known gaps / not done

- **`freeText` with `min > 1`.** For example `gateDecisionCreate.rationale = freeText(3, 8000)`: an invisible value *shorter* than `min` (e.g. `"‏"`) still gets two errors (`too_small` + `validation.blank`). It does so before and after this task. I did not change `freeText`, because the assignment scoped item 1 to `name`/`reason` and told me to mirror `freeText`. A follow-up could switch its guard to `v.length < min`, as `trimmedText` now does. No value is accepted wrongly, so this is cosmetic. Assigning it is the orchestrator's call.
- **Response schemas.** `archiveReason`/`removeReason` in responses use `reason.nullable()`. A row archived before this fix with an invisible-only reason would no longer match the response schema in contract-style validation. No such data exists in the seed or the tests, and there is no deployed environment. No migration or backfill was written (migrations 0010-0019 are frozen, and no new migration was assigned).
- **Web (`apps/web/**`).** Not touched; FE5 owns it next. Web unit tests (which use the shared schemas) still pass (558/558 above). Web forms that use the shared `name`/`reason` will now get `validation.blank` client-side for invisible-only input. FE5 should confirm that each such field shows the EN/AR message.

## 5. Merge instructions

- No migrations and no new API endpoints. The OpenAPI file is unchanged (161 operations).
- Commit the 10 changed files plus `docs/delivery/handbacks/DG2/T-DG2-BE7-*`. No conflicts are expected: nothing else ran concurrently. FE5 runs next on `apps/web/**`, which this task does not touch.
