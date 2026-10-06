# Assignment T-DG2-BE6: DG2 round-3 repair, invisible-only free text (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline.
- **Frozen files:** do not edit `docs/api/openapi.yaml` or migrations 0010-0019.
- **Finding:** full text in `docs/delivery/findings.json`. Describe the fix in your handback; the orchestrator records `import-findings --fix`.

## Finding to repair

**F-DG2-160 (Low, REQ-PB-031; residual of F-DG2-150 / D-063): invisible-only free text counts as content.**

`hasText()` and `freeText()` in `packages/shared/src/schemas/common.ts` decide blankness with `String.prototype.trim()`. That strips only ECMAScript WhiteSpace/LineTerminator. It does not strip:
- U+0085 NEXT LINE;
- Cf format characters: U+200B ZWSP, U+200C/U+200D, U+2060 WORD JOINER, U+200E/U+200F LRM/RLM, U+061C ARABIC LETTER MARK, U+00AD soft hyphen, U+180E;
- the invisible fillers U+3164 / U+115F / U+1160 / U+FFA0 (Hangul fillers) and U+2800 (Braille blank).

So an Out of scope of `"‏"` is stored, the B0041 pre-check reads `pass`, and G1 treats it as documented. The same gap affects every `freeText` field and every `hasText` readiness test. The reviewer's repro and matrix are under `docs/delivery/test-evidence/DG2/code-security/round-3/` (`schema-unicode-matrix.log`, `probes/zz-sec-r3-invisible.test.ts`).

### Required
1. **One predicate.** Define a single "has visible content" predicate in `common.ts`. Both `hasText` and the `freeText` refinement use it, so the API, the pre-checks, readiness and the web stay consistent.
   - A value has content only if it contains at least one code point that is **not** any of:
     - `\p{White_Space}`;
     - `\p{Cf}` (format);
     - the invisible fillers U+115F, U+1160, U+3164, U+FFA0 and U+2800.
   - Use a Unicode-property regex (`/u` flag). Document the exact set in a comment citing F-DG2-160.
2. **Real content still passes.** The following must stay accepted and present, stored verbatim:
   - Arabic text containing RLM/ALM marks;
   - emoji ZWJ sequences;
   - text with a leading or trailing ZWSP;
   - a single visible character.
3. **Tests.**
   - Shared unit tests: a matrix of every invisible code point listed in the finding, each alone and repeated, is rejected (`validation.blank`) and not present. Mixed visible plus invisible input is accepted and present.
   - Integration (extend `apps/api/test/integration/blank-text.test.ts`): an Out of scope of `"‏"`, `"\u0085"`, `"⁠⁠⁠"` and `"؜"` returns 400 `validation.blank` at `/outOfScope`, writes nothing and adds no audit row. An Arabic Out of scope that contains an RLM is accepted, the pre-check reads `pass`, and G1 does not list it as missing.
4. **Web.** The EN/AR `validation__blank` message already exists. Check that the client-side form validation, which uses the shared schemas, catches an invisible-only value.
5. **ADR note.** Extend the ADR-0017 §2 rule text: "blank" means no visible content (White_Space, Cf and invisible fillers), citing F-DG2-160.

## Conventions (unchanged)
- Server-side authz, If-Match/409 and an audit event on every mutation.
- AR and EN for every user-facing string.
- Unknown/Stale is never shown as 0 or green.
- Product gates G1-G6 are business approvals and never DG0-DG7.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (if it fails only on unreadable sandbox-masked dotfiles, also run the `--ignore-path` variant and show both)
- `pnpm openapi:lint`
- `pnpm test` on Node 22 **and** Node 24
- the integration suite on a disposable PostgreSQL (`QA_PG_PORT=55471`), including `blank-text.test.ts` and `contract.test.ts` (161 ops)
- the web e2e P1+P2 journeys in chromium-en and chromium-ar (`--workers=1`, unique ports, pre-installed Chromium; never run `playwright install`)
- `node tools/gates/validate.mjs --historical --stage DG1` (must exit 0)

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-BE6-backend-workflow-engineer.md`: the fix, the files changed and every check's real output. Keep the evidence small (logs only).
