# Handback T-DG7-DO-K2 (devops-engineer): check-handover tests and the connector handover list

- Stage DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `6ac122129432314ad2161d6a02d180c5601292af`, clean tree at start (only this run's `docs/delivery/runs/...` folder untracked).
- Invocation: `DG7-T-DG7-DO-K2-devops-engineer-20261115T101715Z-fa22c2fa`, session `fa22c2fa-69a6-4942-80e2-80d1ca04b5af`.
- Assignment `docs/delivery/assignments/DG7/T-DG7-DO-K2.md`, sha256 `2fbde924383c84d3df421ee23b1fa8a6e17091b4e82ab2f5ba3f527479a19cb8` (verified).
- Started 2026-11-15T10:17:27Z, ended about 10:59Z (about 42 minutes).
- Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no Docker daemon (D-243 Q1), PostgreSQL 16.15 binaries for `with-pg.sh`, HOME read-only in the sandbox.
- Logs: `docs/delivery/handbacks/DG7/T-DG7-DO-K2-evidence/`.

## 1. Files changed

| File | Purpose |
|---|---|
| `tools/release/tests/check-handover.test.mjs` | F-DG7-956. The test no longer pins `T-DG7-DO-I-evidence/protocol-audit-all.json`. It reads the report SHA-256 stated in the shipped `docs/handover/known-limitations.md` and resolves `REPORT` to the `protocol-audit*.json` under `docs/delivery/test-evidence/` or `docs/delivery/handbacks/` with that hash. A new first T-H4 test fails with a clear message if no such report exists, so there is no silent skip. The T-H4 `--check` test now names what it checks ("the report the shipped file was generated from"). |
| `docs/handover/api/connectors.md` | F-DG7-914. Regenerated with `node tools/release/connector-handover.mjs --write` from the refreshed `docs/delivery/environment.md`. The removed text: "**not yet written** at `135ff1d`", "handover guide for connectors (owner: slice B)" and "row to be confirmed by BE-T's handback". sha256 before `692fa5fa…13b7`, after `26bfa171…47a1`. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-K2-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-K2-evidence/*.log` | Command logs 01–13. |

No change to `tools/release/connector-handover.mjs`. Its own text holds no stale status: a grep for `planned|not yet|to be confirmed|TBD|owner:` over the generator and the regenerated file finds nothing. Every stale phrase came from the source rows, which the orchestrator had already refreshed. No migration, OpenAPI, permission, i18n or product code changed. No `p7-pending*.ts` entry belongs to this task.

## 2. Behaviour per requirement

- **REQ-S19-015 (F-DG7-956).**
  - The T-H4 and exit-code tests now run against the report that `known-limitations.md` was actually generated from: `docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json`, SHA-256 `2b322f4d5006f7fef53d5f6207c65d6aca0608b3b7b3fb8a9f0ef290a7ed8549`, head `b2ba3e3`.
  - If the orchestrator regenerates the file from a newer committed report, the tests follow it without another edit.
  - If the named report is not committed, the first T-H4 test fails and states the missing SHA-256.
  - Proof in log 13: `--check` exits 0 with the pre-freeze report and 1 with the superseded DO-I report.
  - The four tests listed in the finding now pass.
- **REQ-S17-004 (F-DG7-914).**
  - `connectors.md` is a fresh generation, and `connector-handover.mjs --check` exits 0.
  - The handover now lists `docs/operations/identity-saml-broker.md` as an existing guide.
  - The internal placeholders the finding names are gone.

## 3. Checks run (real exit codes)

| # | Command | Result | Log |
|---|---|---|---|
| 01 | `node --test tools/release/tests/check-handover.test.mjs` | exit 0, 51/51 pass | `01-check-handover-test.log` |
| 02 | `MTH_STRICT_HANDOVER=1 node --test tools/release/tests/check-handover.test.mjs` | exit 0, 51/51 pass | `02-…strict.log` |
| 03 | `node tools/release/connector-handover.mjs --write` then `--check` | write exit 0; check exit 0 "PASS: … equals a fresh generation". Before the write, `--check` exited 1 ("not a fresh generation") | `03-connector-handover.log` |
| 04 | `MTH_STRICT_HANDOVER=1 node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` (the full CI release-tool step) | **exit 1**: 466 tests, 463 pass, **1 fail**, 2 skipped, 863 s. The failure is T-A5 `build-from-archive` (details below). Skipped: T-A11 (BLOCKED: no assembled runtime tree, `MTH_RELEASE_RUNTIME_DIR` unset) and T-A3 bsdtar (bsdtar not installed) | `04-release-tool-suite.log` |
| 05 | `MTH_PNPM_STORE=$TMPDIR/pnpm-store-copy/v10 node --test tools/release/tests/build-from-archive.test.mjs` | exit 0, 2/2 pass, 205 s | `05-build-from-archive-writable-store.log` |
| 06 | `pnpm -r typecheck` | exit 0 (291 s) | `06-typecheck.log` |
| 07 | `pnpm lint` | exit 0 (42 s) | `07-lint.log` |
| 08 | `pnpm openapi:lint` | exit 0 | `08-openapi-lint.log` |
| 09 | `node tools/gates/validate.mjs --historical --stage DG6` | exit 0 (134 s) | `09-validate-historical-DG6.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (run before this handback was written; the handback was prettier-checked separately, see below) | `10-prettier.log` |
| 11 | `pnpm test` | exit 0: unit-node 3042, unit-web 2179, formula-nocodegen 259 + 2 skipped | `11-pnpm-test.log` |
| 12 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract` | exit 0, 3 files, 231 tests, PostgreSQL 16.15 disposable cluster (216 s) | `12-contract-with-pg.log` |
| 13 | Report-resolution probe plus `MTH_STRICT_HANDOVER=1 node tools/release/check-handover.mjs --protocol-audit <pre-freeze report>` | `--check` with the pre-freeze report exit 0; with the DO-I report exit 1 (expected); check-handover exit 0, all six parts PASS | `13-report-resolution-and-check-handover.log` |

**Why T-A5 failed in run 04, and why that's the sandbox, not the code.**

- In the sandbox, pnpm resolves its default store to `/root/.local/share/pnpm/store`, which sits under the read-only HOME.
- `pnpm install` then fails with `EROFS: read-only file system, symlink … -> /root/.local/share/pnpm/store/v10/projects/…` (exit 226).
- This is the same condition qa-verifier worked around in F-DG7-956 with `MTH_PNPM_STORE=<writable store copy>`.
- Run 05 repeats the test against a writable copy of the store (290 MB, deleted afterwards). It passes 2/2, including the build inside a network namespace (probes show ENETUNREACH and EAI_AGAIN).
- Taken together, runs 04 and 05 give 0 failures in the code. I did not re-run the whole 466-test suite with the writable store, because each full run takes about 15 minutes.

No integration test file was touched. Only the contract suite was run on PostgreSQL, as the acceptance asks.

## 4. Known gaps

- I did not re-run the full suite in a single invocation with a writable store; the T-A5 file was re-run on its own (see §3).
- `connectors.md` still copies some text verbatim from `environment.md` that the finding does not name:
  - the task tags "(DO-B)" and "DO-B's e2e";
  - for the `http_pull` row, the "Guide" cell `docs/handover/api/connectors.md`, which is now a self-reference inside that same file.
  These come from the orchestrator-owned source rows, not the generator, so I left them unchanged.
- The test resolves the report only from `docs/delivery/test-evidence/` and `docs/delivery/handbacks/`. Both are excluded from the candidate manifest (META_EXCLUDES), the same as the path pinned before. A tree without delivery records, such as a bare source archive, fails the first T-H4 test with an explicit message instead of passing.

## 5. Open questions / merge instructions

- Merge: no ordering constraints, no migrations. Commit `tools/release/tests/check-handover.test.mjs` and `docs/handover/api/connectors.md` together with this handback and its evidence folder.
- Question for the orchestrator: should the `environment.md` rows drop the remaining task tags ("DO-B") and the `http_pull` self-reference? If so, re-run `node tools/release/connector-handover.mjs --write` and `node tools/release/known-limitations.mjs --protocol-audit <report> --check`. `known-limitations.md` also copies that table, so it has to be regenerated whenever `environment.md` changes.
- Question for release tooling: should the release archive ship the protocol-audit report next to `known-limitations.md`? That would let check-handover's T-H4 run on an archive without delivery records.
- No finding is closed by this handback. Verification belongs to the originating reviewers (qa-verifier for F-DG7-956, domain-reviewer for F-DG7-914).
