# Handback T-DG2-BE8: DG2 round-4 repairs (backend-workflow-engineer)

- **Stage / task:** DG2 (FIXING), T-DG2-BE8. The assignment is `docs/delivery/assignments/DG2/round-5/T-DG2-BE8.md`, sha256 `045f6cb787f7c1f0a1b668d23774ba129a39ecdacf70c90463e05606412ee743`; I verified the hash before starting.
- **Base:** `HEAD` = `1a9efc40b514ec57f45c9a1f29088b3bd9185235`, on branch `claude/mobily-transformation-platform-regate`. Nothing is committed: the orchestrator commits and records `import-findings --fix`.
- **Invocation:** `DG2-T-DG2-BE8-backend-workflow-engineer-20261006T075806Z-b7bc99e0` (session `b7bc99e0-4513-4e93-8e01-20a08de1d414`).
- **Frozen items:** no edits to `docs/api/openapi.yaml`, to any migration (no new migration either) or to `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.
- **No new API endpoints and no new migrations.**
- **Product gates:** G1–G6 are business approvals inside the product, and nothing here grants one. G1 readiness appears only in tests that use synthetic data. None of this says anything about DG0–DG7.
- **Evidence:** logs only, in `docs/delivery/handbacks/DG2/T-DG2-BE8-evidence/`.

## 1. Fixes

### F-DG2-180 (Low, REQ-PB-031): characters that render as nothing counted as visible content

The one shared predicate in `packages/shared/src/schemas/common.ts` is now exactly what the assignment required:

```ts
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀]/u;
```

- **What it now rejects.** These no longer count as visible content:
  - variation selectors U+FE00–FE0F and U+E0100–E01EF;
  - U+034F COMBINING GRAPHEME JOINER;
  - the Mongolian FVS U+180B–180D and U+180F;
  - the Khmer inherent vowels U+17B4/U+17B5;
  - C0/C1 controls (`Cc`);
  - lone surrogates (`Cs`).
- **Fillers and tags.** The Hangul fillers and the tag characters are covered by Default_Ignorable_Code_Point. U+2800 is still listed explicitly, because it is not DI.
- **Surrogate pairs.** A well-formed surrogate pair is a single astral code point under `/u`, so it is never matched as `Cs`.
- **Still one definition.** `hasVisibleContent`, `hasText`, `freeText`, `trimmedText` (`name`, `reason`) and the web (it imports the shared module) all use this predicate. A grep finds no other `\p{Cf}`/`\p{White_Space}` predicate in `apps/` or `packages/` source.
- **Comment.** The comment above the regex now lists the exact set and cites F-DG2-180.
- **Visible text is unchanged.** It is still accepted and stored verbatim. Tested examples:
  - `❤️` (VS16);
  - an emoji with a skin tone and VS16;
  - Arabic with RLM;
  - Mongolian with an FVS;
  - `e` + U+0301;
  - a Devanagari conjunct;
  - a CJK ideograph + U+E0100;
  - an astral emoji.
- **ADR-0017 §2** has a new bullet that states the rule, the exact regex and examples (F-DG2-180).

### F-DG2-181 (Low, REQ-S16-007): the OIDC display name was truncated after the visible-content check

In `apps/api/src/modules/identity/oidc.ts`, the new exported `displayNameCandidate(v)` works in this order:

1. Trim the claim.
2. Truncate it to `DISPLAY_NAME_MAX` = 200 **code points** with `Array.from(...).slice(0, 200).join("")`, so a surrogate pair is never split. Then trim again.
3. Only then apply `hasText` to the truncated value.

`displayNameOf` tries `name`, then `preferred_username`, then `email`, and finally the generated `User xxxxxx`.

Identity resolution, (iss, sub) binding, sessions and authorization are untouched; only the display-name derivation changed. The ADR-0017 §2 text about the OIDC fallback now says the check is "applied after truncation".

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | F-180: the new single predicate and its documented code-point set. |
| `packages/shared/src/schemas/schemas.test.ts` | F-180 unit matrix covers every listed code point (FE00, FE0E, FE0F, E0100, E01EF, 034F, 180B–180D, 180F, 17B4, 17B5, E0041 tag, 0001, 001F, 007F, 0080, 009F, lone DC00, lone D800), each one alone, repeated and mixed with whitespace, through `hasVisibleContent`, `hasText`, `freeText` and nullable `freeText` → `validation.blank`. Also covers the full mix, the visible-content acceptance list, `name`/`reason` invisible cases, the `name`/`reason` visible cases, and `reasonRequest` with `"᠋᠋᠋"` → `/reason`. |
| `apps/api/src/modules/identity/oidc.ts` | F-181: truncate by code points first, then `hasText`, then fall back to the next claim. |
| `apps/api/test/integration/oidc.test.ts` | F-181 integration tests (4 new, listed below). |
| `apps/api/test/support/fake-idp.ts` | Test IdP: allows a `preferred_username` claim. |
| `apps/api/test/integration/blank-text.test.ts` | F-180 integration tests, listed below. |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` | §2: the F-180 rule (exact regex and examples) and the F-181 truncate-then-check order. |
| `docs/delivery/handbacks/DG2/T-DG2-BE8-evidence/*.log` | Check logs. |

**New OIDC tests (`oidc.test.ts`):**
- 200 × U+200F followed by visible text: the name is ignored and `preferred_username` is used.
- An invisible-after-truncation name and `preferred_username` fall back to the e-mail; with no other claim, the generated `User xxxxxx` is used.
- 199 × `a` + 😀😁 is cut to `a×199 + 😀`: exactly 200 code points and no lone surrogate. A 240-code-point ZWJ emoji name is cut to its first 200 code points.
- Normal names stay unchanged: a plain name, trimmed Arabic with RLM, and `❤️ Synthetic`.

**New blank-text cases (`blank-text.test.ts`):**
- Out of scope `"️͏"` (the assignment's `"️͏"`), `"᠋᠏"`, `"\u0001"`, `"\ud800"` and `"\u{E0100} ឴឵"`. Each gets 400 `validation.blank` at `/outOfScope` on both create and PATCH. Nothing is written (GET returns 404, or version 1 with the old value) and the audit rows are unchanged.
- Reasons `"᠋᠋᠋"` (the assignment's `"᠋᠋᠋"`), `"️️️"` and `"\u0001\u0001\u0001"` on the TOM-gap archive, the evidence-link removal and the P1 transformation archive. Each gets 400 at `/reason`, with no write and no audit row.

Mutation conventions are unchanged: server-side authz, If-Match/409 and audit events are untouched, and the tests above assert that rejected mutations add no audit rows.

## 3. Checks actually run

All checks ran in the sandbox, offline, at `/home/user/My-owns`, on Node 24.21.0 unless stated otherwise. Logs are in `T-DG2-BE8-evidence/`.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (`typecheck.log`) |
| `pnpm -r build` | **exit 0** (`build.log`) |
| `pnpm lint` | **exit 0**, `--max-warnings=0` (`lint.log`) |
| `pnpm format:check` | **exit 2**, only from `EACCES` on 12 sandbox-masked dotfiles and `CLAUDE.local.md`. After `prettier --write` on `oidc.test.ts`, no repository file is reported (`format-check.log`). |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path $TMPDIR/masked.txt` (the 12 masked paths) | **exit 0**: "All matched files use Prettier code style!" (`format-check-ignore-path.log`) |
| `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` (`openapi-lint.log`) |
| `pnpm test` on Node 22.22.2 (`/opt/node22/bin`) | **exit 0**: `Test Files 32 passed (32)`, `Tests 636 passed (636)` (`unit-node22.log`) |
| `pnpm test` on Node 24.21.0 | **exit 0**: `Test Files 32 passed (32)`, `Tests 636 passed (636)` (`unit-node24.log`) |
| `with-pg.sh 55471 pnpm test:integration` | **exit 0**: `Test Files 29 passed (29)`, `Tests 474 passed (474)`, including `blank-text.test.ts` (25), `oidc.test.ts` (24) and `contract/contract.test.ts` (11; it asserts the 161 operations) (`integration-run.log`) |
| `E2E_PG_PORT=54581 E2E_API_PORT=3581 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **exit 0**: `58 passed (3.7m)` (`e2e-run.log`). Pre-installed Chromium; `playwright install` was not run. |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` (`validate-historical-DG1.log`) |
| **Negative control:** HEAD's `common.ts` and `oidc.ts` swapped in, `@mth/shared` rebuilt, new tests run | **exit 1 for both runs** (`negative-control-old-code.log`). Unit: `23 failed \| 34 passed (57)`. These are every new F-180 code-point case, the mix, and the `name`/`reason`/`reasonRequest` invisible cases. Integration (blank-text + oidc): `11 failed \| 38 passed (49)`. These are the 5 new Out of scope cases, the 3 reason endpoints, and 3 F-181 OIDC tests (the invisible prefix, the fallback chain and the astral boundary). The "normal name unchanged" test passes on the old code, as a non-regression test should. |
| Restore check (`cmp` against the saved new files, then the targeted rerun) | Files identical. Unit `57 passed`; blank-text + oidc `49 passed`; both **exit 0** (`after-restore-targeted.log`) |

The disposable PostgreSQL is PG16 via `with-pg.sh`, a copy of the reviewer's round-4 helper placed in `$TMPDIR`. Each run gets a fresh cluster, which is deleted afterwards.

## 4. Known gaps / not done

- **`pnpm format:check` without `--ignore-path` exits 2**, but only because the sandbox masks those dotfiles (`EACCES`). It is not a formatting problem in the repository.
- **The web has no dedicated F-180 test.** It uses the same shared predicate, and the unchanged web unit tests and e2e still pass. I added no web-only test.
- **Every listed code point is tested, but not every DI code point.** The predicate relies on the engine's Unicode property data: Node 22 and 24 both pass the same matrix.

## 5. Merge instructions

- No migrations. No OpenAPI change.
- Rebuild `@mth/shared` (`pnpm -r build`) so that consumers of `dist` get the new predicate.
- I expect no conflicts: only the files listed above changed.
- The orchestrator records `import-findings --fix` for F-DG2-180 and F-DG2-181.
