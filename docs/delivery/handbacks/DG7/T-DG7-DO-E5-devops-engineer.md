# Handback T-DG7-DO-E5: asset-scan R4 hit in the dockerfile-context test fixtures (devops-engineer)

- Stage: DG7 (P7). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` `7ea65fa4ac735d832622207759df99fa3f131373`. Starting `git status` was clean apart from this run's own `docs/delivery/runs/...` directory.
- Invocation reference: `{"kind":"claude-code-cli-session","run_id":"DG7-T-DG7-DO-E5-devops-engineer-20261115T004644Z-12fefdd1","session_id":"12fefdd1-5f52-4927-8954-6ee7362fe85c"}`. Assignment sha256 `afa29313641a7c42f9cfa7d9e3de978e6d0f86f953431eb6966f79cdd097fe52` (verified).
- Time: started 2026-11-15T00:46:55Z, finished about 2026-11-15T01:05Z (about 18 minutes).
- Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no Docker daemon (D-243 Q1), sandboxed shell, offline.

## 1. Files changed

| File                                                    | Purpose                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/scripts/tests/dockerfile-context.test.mjs`      | Adds the `PROXY_PASSWORD` constant and a `proxyWithCredentials()` helper. The helper builds the credential-bearing proxy URL at runtime from `"http"`, `"://"`, `"u:"`, the password and `"@proxy.example:3128"`, and both fixtures use it (old lines 212 and 220). The dry-run test now also asserts that the password is never printed. sha256 `21155146ac7f5d865bc2d712cdedb43abef2daf4e81375704e698e3b33dd0f66`. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E5-devops-engineer.md` | This handback.                                                                                                                                                                                                                                                                                                                                |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E5-evidence/*.log`     | Logs of the checks below.                                                                                                                                                                                                                                                                                                                    |

I didn't add an allow-list entry: `tools/release/asset-scan-allowlist.json` is unchanged. I didn't touch any product code, `p7-pending*.ts`, the scanner or `build-image.sh`. The mutation drill below edited `build-image.sh` only temporarily, and the file was restored and verified against its sha256.

## 2. Behaviour delivered

**Why R4 matched.** `URL_RE` in `tools/release/scan-assets.mjs` needs a literal `http(s)://`, and the hostname it captures needs no dot. So the fragment `"http://u:"` was classified as host `u`, an unlisted host (R4, T2 because the file is under `deploy/**`).

**The fix.** The scheme and `://` are now separate string pieces, so the literal URL form appears nowhere in the source. I checked the other scanner patterns too:

- The second `URL_RE` form needs a `//` that isn't preceded by `:` or `/`, and the separate piece `"://"` fails that test.
- `HOST_TOKEN_RE` refuses a host that follows `@`.
- `EMAIL_RE` finds no local part before `"@proxy.example`.
- The regex assertion `/^http:\/\/u:p4ss@.../` contains escaped slashes and doesn't match either.

**What the tests still prove.** At runtime the value is a real credential-bearing proxy URL (HTTP scheme, user `u`, the test's `PROXY_PASSWORD`, host `proxy.example`, port 3128), and the test asserts that exact shape. (Wording changed by T-DG7-DO-E6: the earlier sentence spelled the URL out and matched secret-scan rule S2.) The tests still prove that `build-image.sh` passes only the _names_ of set proxy variables (`--build-arg HTTPS_PROXY`), never their values. The password never appears in stdout or stderr, either in the `--dry-run` default case (that assertion is new) or with `--proxy-from-env`. Docker is never called. The test "the Dockerfile declares no proxy ARG or ENV" is unchanged.

**Requirement IDs.** The assignment names none. The work serves the T-A5 build-from-archive check: REQ-S19-019's asset scan (ADR-0062 §8), as cited in the scanner header.

## 3. Checks run (real exit codes)

| #   | Command                                                                                                                                                                                                                         | Exit                      | Evidence                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | `scanLine` (exported by `tools/release/scan-assets.mjs`, target T2) over every line of the test file, at HEAD (`git show HEAD:...`) and in the working tree                                                                      | HEAD **1**, tree **0** | `T-DG7-DO-E5-evidence/scan-test-file.log`: at HEAD it reproduces exactly `:212 R4 host=u` and `:220 R4 host=u` (2 hits); the working tree has 0 raw hits |
| 2   | `node tools/release/scan-assets.mjs --web apps/web/dist --runtime <empty dir with empty node_modules/> --config .`                                                                                                             | **1**                     | `scan-assets-tree.log`: no hits. The only failures are 41 "stale allow-list entry" lines (34–74). I checked that all of them are exactly the allow-list's 41 T3 (`runtime/node_modules`) entries, which are stale only because the runtime tree was empty |
| 3   | The same command with `--allowlist <copy without the 41 T3 entries>` (T1 and T2 only)                                                                                                                                       | **0**                     | `scan-assets-tree-T1T2.log`: `scan-assets: PASS (3652 files; T1 3568, T2 84, T3 0)`, 4.3 s |
| 4   | `node --test deploy/scripts/tests/dockerfile-context.test.mjs`                                                                                                                                                                 | **0**                     | `dockerfile-context-test.log`: 14 pass, 0 fail                                           |
| 5   | Mutation: `build-image.sh` line 68 changed to `--build-arg "$v=${!v}"` (bakes the value), then `node --test --test-name-pattern=proxy-from-env ...`; the file was restored and checked with `sha256sum -c` (OK, `git diff` empty) | **1** (expected failure) | `mutation-proxy-value.log`                                                               |
| 6   | `node --test tools/release/tests/scan-assets.test.mjs`                                                                                                                                                                         | **0**                     | `scan-assets-unit-test.log`: 8 pass, 1 skipped (T-A11, BLOCKED by the test itself: no assembled runtime tree) |
| 7   | `pnpm -r typecheck`                                                                                                                                                                                                             | **0**                     | `pnpm_-r_typecheck.log`                                                                  |
| 8   | `pnpm lint`                                                                                                                                                                                                                     | **0**                     | `pnpm_lint.log`                                                                          |
| 9   | `pnpm openapi:lint`                                                                                                                                                                                                             | **0**                     | `pnpm_openapi_lint.log`                                                                  |
| 10  | `pnpm test` (MTH_PNPM_OFFLINE=1)                                                                                                                                                                                                | **0** (420 s)             | `pnpm-test.log`: 205 files / 3022 tests, 130 / 2179, 3 / 259 passed + 2 skipped          |
| 11  | `node tools/gates/validate.mjs --historical --stage DG6`                                                                                                                                                                        | **0**                     | `node_tools_gates_validate.mjs_--historical_--stage_DG6.log`                             |
| 12  | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`                                                                                                                                      | **0**                     | `prettier-check.log`. The first run (00:59:54Z) exited **123**: my own test file had a line that was too long. I fixed it with `prettier --write`, then reran checks 1, 2, 3, 4, 8 and 12 on the final file, all with the results shown                         |

Not run:

- `tools/release/tests/build-from-archive.test.mjs` (T-A5). The assignment reserves it for the orchestrator, and HOME is read-only in this sandbox.
- The disposable-PostgreSQL integration and contract tests. I touched no integration test, API or database code, so none apply.

## 4. Known gaps

- I didn't run the scan with a real assembled runtime tree (`deploy/scripts/assemble-runtime.sh`), so T3 wasn't exercised. Run 2 exits 1 only because of the T3 allow-list entries that an empty runtime makes stale. The orchestrator's T-A5 rerun is what checks T3 together with the archive's T2 tree.
- `apps/web/dist` was the one already in the working tree. I didn't rebuild it for this task.
- `deploy/scripts/tests/*.test.mjs` doesn't appear in the `pnpm test` output, so I ran it directly (check 4).

## 5. Open questions / merge instructions

- Merge: a single test-file change. No migrations, no ordering constraints and no expected conflicts.
- Open question: none. Rule R4 treats a dotless host after `http://` as a hit. That's intended (it caught this case), so I left the scanner unchanged.
