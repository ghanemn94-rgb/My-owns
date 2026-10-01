# Assignment T-DG1-BE17: F-DG1-137 + F-DG1-218 (lint still crashes on arbitrary-extension declaration files) (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-16 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.
- Fix **only** F-DG1-137 and F-DG1-218 (both Low, same root cause; full text in `docs/delivery/findings.json`). Edit **only**: `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. Do **not** change product/runtime code, API, other apps/packages, `vitest.config.ts`, `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/**`.

## The defect (one root cause, two reports)
The round-15 repair (F-DG1-217) routes declaration files around `ts.transpileModule` (which throws `Debug Failure. Output generation failed` when asked to emit a declaration-file name) via the guard `DECLARATION_FILE.test(fileName)` where `DECLARATION_FILE = /\.d\.[cm]?ts$/` (`apps/api/src/architecture.testkit.ts:445`, used at `:478` in `syntaxErrors()`).

That hand-rolled regex matches only `*.d.ts` / `*.d.mts` / `*.d.cts`. TypeScript (>= 5.0, `allowArbitraryExtensions`) also treats the **arbitrary-extension** form `<name>.d.<ext>.ts` as a declaration file — e.g. `styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts`. `walk()` collects these via `CODE_FILE = /\.[cm]?[jt]sx?$/` (they end in `.ts`), so they reach `syntaxErrors()`, fail the narrow regex, go to `ts.transpileModule`, and throw the same internal `Debug Failure` with **no file name in the message**. The lint fails closed (it throws → `architecture.test.ts` goes red → nothing slips through), but it crashes instead of reporting a named diagnostic. Latent today (0 such files in-tree); pre-existing since the F-DG1-217 repair.

I verified against the in-tree TypeScript (6.0.2): `ts.transpileModule` throws `Debug Failure…` for all four forms; `ts.isDeclarationFileName()` returns `true` for all four; the existing `declarationSyntaxErrors()` helper handles all four with no throw and still returns the real syntactic diagnostics.

## Fix (preferred — authoritative API, no new regex to keep in sync)
In `apps/api/src/architecture.testkit.ts`, decide the declaration-file branch in `syntaxErrors()` with **TypeScript's own** `ts.isDeclarationFileName(fileName)` instead of the hand-rolled `DECLARATION_FILE` regex:
- Replace `DECLARATION_FILE.test(fileName)` (`:478`) with `ts.isDeclarationFileName(fileName)`.
- Remove the now-unused `DECLARATION_FILE` constant and its comment (`:444-445`); grep to confirm it has no other reference.
- Update the `declarationSyntaxErrors()` / `syntaxErrors()` comments to cite F-DG1-137 and F-DG1-218 and state that the branch now follows `ts.isDeclarationFileName` (covers `allowArbitraryExtensions` `*.d.<ext>.ts`), so no declaration-file name reaches `ts.transpileModule`.
- `declarationSyntaxErrors()` already parses with `ts.ScriptKind.TS`, which is correct for every declaration-file form (declaration files are never TSX). Leave it; do not widen `CODE_FILE` or `walk()`.

(The alternative — widening the regex to `/\.d\.([cm]?ts|[^.]+\.ts)$/` — also works but reintroduces a hand-maintained pattern the next TS release can outgrow. Prefer the API. If you have a concrete reason to reject `ts.isDeclarationFileName`, say so in the handback and use the widened regex.)

## Required self-checks (architecture.test.ts)
Extend the existing F-DG1-217 declaration-file test (or add an adjacent `it(...)`) to cover the arbitrary-extension forms. For each of `styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts` (planted in a module dir):
- `fileViolations("transformations", <dir>/<name>, "export declare const x: number;")` returns **cleanly** — `not.toThrow()` and `toEqual([])`.
- A declaration file whose body has a **real syntax error** (e.g. `"export declare const x: = ;"`) yields a **named** `unparseable source: …` diagnostic and **never** matches `/Debug Failure/`.
- Pin the classification directly: `expect(ts.isDeclarationFileName("styles.d.css.ts")).toBe(true)` and `expect(ts.isDeclarationFileName("a.ts")).toBe(false)` (import `ts` the same way the suite already does), so a future refactor that drops the API is caught.
- Keep the existing `*.d.ts`/`*.d.mts`/`*.d.cts` assertions green. Keep the whole architecture suite green.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the new arbitrary-extension `.d.<ext>.ts` self-check; `moduleViolations` does not throw for any module file.
- A short probe (paste it) showing `ts.transpileModule` throws `Debug Failure` on `styles.d.css.ts` while your fixed `syntaxErrors()` path returns cleanly — the before/after proof.
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two edited files; `pnpm test` (Node 22) and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24) — both green. (These two edits are test-only; no integration/db run is needed, but keep the full unit suite green on both runtimes.)

## Handback
`docs/delivery/handbacks/DG1/round-16/T-DG1-BE17-backend-workflow-engineer.md` — the exact diff and rationale, the before/after probe output, the new self-check, and the real vitest output (architecture suite + full unit on Node 22 and Node 24).
