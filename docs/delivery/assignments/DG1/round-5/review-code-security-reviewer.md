# DG1 round-5: code-security-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-SEC-R5`.

## Findings you verify (file:line + a re-test)
- **F-DG1-122 (installer test non-destructive):** read `tools/deps/tests/install-sandbox.test.sh` AC-8; confirm it snapshots pre-existing paths and removes only a probe-created path. **Prove non-destructiveness:** plant a dummy `.vscode/tasks.json` (or `CLAUDE.local.md`) in a throwaway clone, run the suite, confirm it survives. Run the suite: 13/13.
- **F-DG1-123 (copy-back):** `tools/deps/install-sandbox.sh` copies back node_modules only at the real pnpm-workspace members (root + `packages:` globs with a package.json), and a failed rm/cp fails the install. Re-run AC-9 (planted non-member node_modules not copied); confirm create/frozen populate node_modules on the real workspace.
- **F-DG1-124 (module lint):** `apps/api/src/architecture.test.ts` bans the dynamic-code primitives in `src/modules/**` written any way, and rejects non-literal computed keys. Plant `f["constr"+"uctor"]` and `Reflect.get(fn,"constructor")`; confirm both fail. Confirm the real module tree passes with zero findings and the refactors BE made to module source are correct (no behavioural change; the routes still work — covered by integration).
- **F-DG1-204 (SBOM):** `node licenses/generate-sbom.mjs --check` passes on the committed tree.
- **F-DG1-205 (ci.yml drift):** `.github/workflows/ci.yml`, `deploy/ci/ci.yml` and `docs/architecture/ci/ci.yml` are byte-identical.

## Checks (real output; BLOCKED if a tool/DB missing)
`pnpm -r typecheck/build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm test`, the integration suite on disposable PostgreSQL (unique port e.g. 5491), `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`, `node --test deploy/scripts/tests/*.test.mjs`, `tools/deps/tests/install-sandbox.test.sh`, `node licenses/generate-sbom.mjs --check`, `node tools/gates/validate.mjs --stage DG0 --historical`. Evidence under `docs/delivery/test-evidence/DG1/code-security/round-5/`.

## Requirements to check (record exactly these)
`REQ-DLV-025`, `REQ-DLV-033`, `REQ-DLV-042`, `REQ-S16-001`, `REQ-S16-003`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`.
