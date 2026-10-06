# Assignment T-DG2-BE10: DG2 round-5 repairs (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`.
- **Do not edit:** `docs/api/openapi.yaml`, migrations 0001-0019, `tools/**`, `.claude/**`, `docs/source/**`, reviews or gate records.
- **Findings:** full text in `docs/delivery/findings.json`. The reviewer's repros are under `docs/delivery/test-evidence/DG2/code-security/round-5/`. Describe each fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair

### 1. F-DG2-230 (Low, REQ-PB-031): two placeholder characters still count as visible content
U+16FE4 KHITAN SMALL SCRIPT FILLER and U+1D159 MUSICAL SYMBOL NULL NOTEHEAD are meant to render as nothing, yet the predicate treats them as visible. The reviewer's exhaustive sweep found no other residual: every White_Space, Cc, Cf, Cs and Default_Ignorable code point is already rejected.

**Required:**
- Add both characters next to U+2800 in the single shared predicate in `packages/shared/src/schemas/common.ts`: `/[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀\u{16FE4}\u{1D159}]/u`.
- Update the comment and cite F-DG2-230.
- **Tests:**
  - shared unit matrix: each character alone, repeated, and mixed with whitespace;
  - integration: an Out of scope of `"\u{16FE4}"` and of `"\u{1D159}"` returns 400 `validation.blank` at `/outOfScope`, writes nothing, and adds no audit row;
  - visible text that contains them is still accepted.

### 2. F-DG2-231 (Low, REQ-DLV-034): U+0000 (NUL) in free text gives an undeclared 500
PostgreSQL text cannot store NUL (SQLSTATE 22021). A NUL inside otherwise visible text passes validation and reaches the database. The API then answers with an undeclared **500 Internal error** instead of a 400 validation problem. Integrity holds (rollback, no audit, no leak). It applies to every free-text, name and reason field.

**Required.** Fix it once, centrally, so that no route can miss it:
1. **Central request check.** In the API request-parsing layer (`apps/api/src/modules/platform/validation.ts` `parseBody` and the equivalent query/params parsing, or a single Fastify hook that every route goes through), reject any string **anywhere** in the JSON body or query that contains U+0000. Return a 400 validation problem with a stable code `validation.invalid_character` and the JSON pointer of the offending field. Nothing is written and there is no audit row.
2. **Shared schemas.** `freeText`, `trimmedText`/`name`/`reason` also reject U+0000 with `validation.invalid_character`, so the web client catches it before sending.
3. **Web message.** Add the localized `problems.validation__invalid_character` in EN and AR (`apps/web/src/i18n/{en,ar}/problems.json`). For example:
   - EN: "Remove the unsupported invisible character from this text."
   - AR: "أزِل الحرف غير المدعوم من هذا النص."
4. **Defense in depth.** In `apps/api/src/modules/platform/db-errors.ts`, map SQLSTATE `22021` (character_not_in_repertoire) and `22P05` (untranslatable_character) to a 400 validation problem (`validation.invalid_character`) instead of a 500. Add a unit test.
5. **Sweep.** Check every other place where client strings reach the database outside `parseBody`, such as path params, query filters, headers stored in audit, and OIDC claims. Confirm that each one is covered by (1) or (4). List them in the handback.

**Tests:**
- Integration: a NUL inside visible text returns 400 `validation.invalid_character` at the pointer, writes nothing and adds no audit row, for:
  - a charter field;
  - a T03 TOM gap field;
  - an archive reason;
  - a query/filter parameter (if any route stores or queries one).
- A db-errors unit test for 22021 and 22P05.
- A contract check that no 500 is produced.

## Conventions (unchanged)
- Every mutation keeps its server-side authz check, If-Match/409 and an audit event.
- Product gates G1-G6 are business approvals and never DG0-DG7.

## Self-verification (real output in the handback)
Run everything **with `LANG`/`LC_ALL` unset AND with `LANG=C.UTF-8`**:
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** Node 24
- the integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`), including `contract.test.ts` (161 ops), `blank-text.test.ts`, `oidc.test.ts` and `encoding.test.ts`
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

Also run a negative control: the new tests must fail on the old code.

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE10-backend-workflow-engineer.md` with the fix, the files changed, the sweep list and every check's real output. Keep the evidence to logs only.
