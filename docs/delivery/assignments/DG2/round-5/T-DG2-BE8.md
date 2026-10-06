# Assignment T-DG2-BE8: DG2 round-4 repairs (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time as you.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium and never run `playwright install`.
- **Frozen:** do not edit `docs/api/openapi.yaml` or migrations 0010-0019.
- **Findings:** full text is in `docs/delivery/findings.json`. The reviewer's repro is under `docs/delivery/test-evidence/DG2/code-security/round-4/`. Describe each fix in your handback; the orchestrator records `import-findings --fix`.

## Findings to repair

### 1. F-DG2-180 (Low, REQ-PB-031): characters that render as nothing still count as visible content
The shared predicate in `packages/shared/src/schemas/common.ts` is `VISIBLE_CONTENT = /[^\p{White_Space}\p{Cf}ᅟᅠㅤﾠ⠀]/u`. It still treats the following as visible:
- Default_Ignorable code points outside `\p{Cf}`: variation selectors U+FE00-FE0F and U+E0100-E01EF, COMBINING GRAPHEME JOINER U+034F, Mongolian FVS U+180B-180D and U+180F, Khmer inherent vowels U+17B4/17B5;
- lone C0/C1 control characters (`\p{Cc}`, e.g. U+0001);
- lone surrogates (`\p{Cs}`, e.g. a lone U+D800).

An Out of scope or a reason made only of these is accepted. B0041 reads `pass`, and G1 treats the field as documented.

**Required:** make the single shared predicate
`/[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀]/u`.
DI already covers the Hangul fillers U+115F/U+1160/U+3164/U+FFA0 and the tag characters. Keep the predicate in that one place; `hasText`, `freeText`, `trimmedText`/`name`/`reason` and the web all use it.

Text with visible content must stay accepted and verbatim, for example:
- an emoji with VS16 (`"❤️"`);
- Arabic with RLM;
- Mongolian text with an FVS;
- a letter with a combining mark.

Update the comment so that it documents the exact set and cites F-DG2-180.

**Tests:**
- Extend the shared unit matrix with every code point above: alone, repeated, and mixed with whitespace. Each must be rejected with `validation.blank` and not count as present. The visible-content cases above must be accepted.
- Extend `apps/api/test/integration/blank-text.test.ts`:
  - an Out of scope of `"️͏"` → 400 `validation.blank` at `/outOfScope`, nothing written, no audit row;
  - an archive reason of `"᠋᠋᠋"` → 400 at `/reason`.
- Update ADR-0017 §2 to state the rule.

### 2. F-DG2-181 (Low, REQ-S16-007): the OIDC display name is truncated after the visible-content check
`apps/api/src/modules/identity/oidc.ts` `displayNameOf` checks `hasText(v)`, then stores `v.trim().slice(0, 200)`. A name claim of 200 invisible characters followed by visible text therefore becomes an invisible display name. `.slice` can also split a surrogate pair.

**Required:**
- Truncate first, by **code points** (for example `Array.from(s).slice(0, 200).join("")`), never splitting a surrogate pair.
- Then apply `hasText` to the truncated value. Fall back to the next claim (`preferred_username`, then `email`) and finally to the generated name.
- Identity, session and authorization behaviour must not change. Binding stays on (iss, sub).

**Tests:** add OIDC integration tests:
- 200 invisible characters followed by visible text falls back to the next claim;
- a name containing astral characters (emoji) near the 200 boundary is cut on a code-point boundary;
- a normal name is unchanged.

## Conventions (unchanged)
- Every mutation keeps a server-side authz check, If-Match/409 and an audit event.
- Product gates G1-G6 are business approvals and never DG0-DG7.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** 24
- the integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`), including `blank-text.test.ts`, `oidc.test.ts` and `contract.test.ts` (161 ops)
- the web e2e P1+P2+`p2-blank-text.spec.ts` in chromium-en and chromium-ar (`--workers=1`, unique ports)
- `node tools/gates/validate.mjs --historical --stage DG1` (exit 0)
- a negative control: the new tests fail on the old code

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE8-backend-workflow-engineer.md` with the fix, the files changed and every check's real output. Keep evidence to logs only.
