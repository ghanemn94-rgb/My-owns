# DG1 round-16: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R16`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Findings you verify (file:line + a re-test)
- **F-DG1-137 / F-DG1-218 (lint declaration-file classification):** read `apps/api/src/architecture.testkit.ts` — the new `isDeclarationFileName()` helper, and the `syntaxErrors()` branch that now calls it instead of the removed `DECLARATION_FILE` regex (grep to confirm 0 references to `DECLARATION_FILE` remain). **Re-prove the root cause and the fix in a throwaway clone:**
  - Before/after probe: `ts.transpileModule(..., { fileName: "styles.d.css.ts" })` throws `Debug Failure. Output generation failed`, while `fileViolations("transformations", <dir>/styles.d.css.ts, "export declare const x: number;")` returns **without throwing** and `[]`. Repeat for `data.d.json.ts` and `x.d.ts.ts`.
  - A `*.d.<ext>.ts` with a **real syntax error** yields a named `unparseable source: …` diagnostic, not a throw, and never matches `/Debug Failure/`.
  - Confirm declaration files are still **scanned** (not skipped): a `.d.ts`/`.d.<ext>.ts` with a deep cross-module type import is still flagged by the boundary check. Confirm nothing is emitted/executed (empty-parse classification; no-emit `declarationSyntaxErrors`).
  - Confirm the `*.d.ts`/`*.d.mts`/`*.d.cts` behaviour from F-DG1-217 is unchanged. `architecture.test.ts` green (132/132); real module tree zero `moduleViolations`.
- Independently sanity-check the public/internal agreement claim: `ts.createSourceFile(name, "").isDeclarationFile` equals the `@internal` `ts.isDeclarationFileName(name)` for the positive and negative forms in the self-check.

## Checks (real output; BLOCKED if a tool/DB missing) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`), the integration suite on disposable PostgreSQL (unique port e.g. 5491) **run twice** (F-DG1-009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh` (AC-1..AC-10; AC-1-effect + real-repo install BLOCKED without registry — note it), `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --stage DG0 --historical`. Confirm the three ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-16/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
