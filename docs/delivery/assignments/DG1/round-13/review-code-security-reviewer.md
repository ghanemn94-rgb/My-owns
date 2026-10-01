# DG1 round-13: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R13`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Finding you verify (file:line + a re-test)
- **F-DG1-134 (lint file scope):** read `apps/api/src/architecture.testkit.ts` — `walk()` uses `CODE_FILE = /\.[cm]?[jt]sx?$/`, `scanSource` uses `scriptKindOf` (TSX for `.tsx/.jsx`), `isTest` uses `TEST_FILE`. **Re-prove:** in a throwaway clone, plant a module file `zz.mts` (and try `zz.mjs`, `zz.cts`) under a module dir containing a rule-violating import (e.g. `import * as c from "node:crypto"` and a deep cross-module import) and confirm `fileViolations`/`moduleViolations` now flags it (previously 0). Confirm `walk(MODULES_DIR)` includes a planted `.mts` file. Confirm the **real** module tree is unchanged: `find apps/api/src/modules -type f ! -name '*.ts' ! -name '*.tsx'` is empty, and `moduleViolations` is zero for every module. Run `architecture.test.ts` (expect ~127/127). Also sanity-check a `.tsx` plant is parsed as TSX (JSX text like `<a href="x">{require("y")}</a>` is still scanned for the `require` call, not swallowed).

## Checks (real output; BLOCKED if a tool/DB missing) — Node 22; confirm unit on Node 24
`pnpm -r typecheck`, `pnpm -r build` (or repo build), `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test` (and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`), the integration suite on disposable PostgreSQL (unique port e.g. 5491) **run twice** (F-DG1-009), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh` (AC-1..AC-10; AC-1-effect + real-repo install BLOCKED without registry — note it), `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --stage DG0 --historical`. Confirm the three ci.yml copies byte-identical. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-13/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
