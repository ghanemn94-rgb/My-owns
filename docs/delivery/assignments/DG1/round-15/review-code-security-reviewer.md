# DG1 round-15: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R15`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Findings you verify (file:line + a re-test)
- **F-DG1-217 (lint declaration-file-safe):** read `apps/api/src/architecture.testkit.ts` — `DECLARATION_FILE`, `declarationSyntaxErrors()`, and the `syntaxErrors()` branch. **Re-prove:** in a throwaway clone, `fileViolations("transformations", <dir>/zz.d.ts, "export declare const x: number;")` returns **without throwing** (previously threw "Debug Failure"); a `.d.ts` with a deep cross-module **type** import is still flagged by the boundary check (still scanned); a `.d.ts` with a real syntax error yields a named `unparseable source` diagnostic, not a throw. Try `.d.mts`/`.d.cts` too. Confirm nothing is emitted/executed. `architecture.test.ts` green (~130/130); real module tree zero `moduleViolations`.
- **F-DG1-136 (integration hookTimeout):** read `vitest.config.ts` — the integration project sets `hookTimeout: 30_000`. Confirm the `access-derived-race.test.ts` teardown completes within it (run the integration suite; no "Hook timed out").

## Checks (real output; BLOCKED if a tool/DB missing) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`), the integration suite on disposable PostgreSQL (unique port e.g. 5491) **run twice** (F-DG1-009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh` (AC-1..AC-10; AC-1-effect + real-repo install BLOCKED without registry — note it), `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --stage DG0 --historical`. Confirm the three ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-15/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
