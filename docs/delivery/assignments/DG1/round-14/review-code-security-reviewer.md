# DG1 round-14: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R14`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Finding you verify (file:line + a re-test)
- **F-DG1-135 (test classification aligned with the build):** read `apps/api/src/architecture.testkit.ts` — `TEST_FILE = /\.test\.tsx?$/`; `CODE_FILE = /\.[cm]?[jt]sx?$/` (unchanged broad scan). **Re-prove:** in a throwaway clone, plant `zz.test.mts` under a module dir importing `../../modules.ts` (and `vitest`) and confirm `fileViolations` now **flags** it (full boundary rules, no test exemption); plant `zz.test.ts` with the same imports and confirm it stays **allowed** (test exemption). Confirm the `TEST_FILE` extensions exactly match `apps/api/tsconfig.build.json`'s test `exclude` globs (`.test.ts`, `.test.tsx`). Run `architecture.test.ts` (expect ~128/128) and confirm the real module tree is zero `moduleViolations`. Confirm every real module test file is `.test.ts` (`find apps/api/src/modules -name '*.test.*' ! -name '*.test.ts'` empty).

## Checks (real output; BLOCKED if a tool/DB missing) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`), the integration suite on disposable PostgreSQL (unique port e.g. 5491) **run twice** (F-DG1-009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh` (AC-1..AC-10; AC-1-effect + real-repo install BLOCKED without registry — note it), `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --stage DG0 --historical`. Confirm the three ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-14/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
