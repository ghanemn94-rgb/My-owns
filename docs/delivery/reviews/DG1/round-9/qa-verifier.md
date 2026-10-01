# DG1 round 9: qa-verifier review

- **Candidate:** `sha256:05915c32b3f5c5b2a9e14324a70fbf5cd16e76a48bc3235d6cc30b290591babd`, source commit `273d21f`. HEAD `07f1a54` adds only metadata. The ID recomputes identically in a full disposable clone.
- **Verdict: PASS.** No new findings. F-DG1-213 and F-DG1-129 are verified as `CLOSED_VERIFIED` (see `qa-verifier.verifications.json`).
- **Invocation:** `DG1-T-DG1-REV-QA-R9-qa-verifier-20261001T140344Z-39a6f4ff` / session `39a6f4ff-d966-4bd2-ab51-dce825ce90c6`.

## What I ran (all in a disposable clone at 273d21f, real output in `docs/delivery/test-evidence/DG1/qa/round-9/`)

| Area | Result |
|---|---|
| typecheck, build, lint, openapi:lint (33 ops), check:no-cdn, format:check, contrast | all exit 0 |
| Unit (`pnpm test`) | 294/294 (architecture.test.ts 101) |
| Integration, real PostgreSQL 16.13 on port 5492, **twice** | 200/200 and 200/200, exit 0; 8 migrations; 0× 57P01 in the server logs (F-DG1-009 holds) |
| Audit trigger probe | UPDATE/DELETE/TRUNCATE rejected for superuser, owner and app |
| Contract (verbose) | 9/9, including getBrandingTokens |
| e2e, Chromium, `--workers=1`, PG on port 5493 | 22/22, EN and AR, including the BU-Lead create→Edit/Archive journey without a reload (F-DG1-210 holds) |
| A12 / A13 / A14 | green in both integration runs |
| A18 clean start | PASS (31.7 s) |
| A20 token propagation | PASS (#003B73 → #6B1D5C rendered) |
| Independent F-DG1-210 spec | 2/2 |
| Validators: register DG1, pipeline, reconcile | PASS |
| 12 DG1-final requirements | all IMPLEMENTED, no missing evidence |

## F-DG1-129 / F-DG1-213 (default-deny, D-055)

- **Independent enumeration probe** (`qa/tests/dg1-r9-default-deny-probe.test.ts`, 34/34). It checks every built-in (72) and every `process` property (120) of the running Node v22.22.2 against a QA-held safe set: none missed and none wrongly denied. It also covers 23 evasion spellings (all flagged) and 6 positive controls (all clean).
- **Round-8 gap probe replay:** all three plants (the full `_debugProcess` + `fetch` + `WebSocket` route, `_debugProcess`, `kill SIGUSR1`) now report violations. The test that documented the gap fails, as it should.
- **Negative control:** with the pre-fix testkit, the format-independent probe fails exactly on the kill / `_debugProcess` / `_kill` / `process?.kill` routes (and v8, wasi, net, `process.on`).
- **Real-file plant** in `modules/transformations`: the module-tree check turns red for kill, `_debugProcess` and `node:inspector`, and it is green again after removal.
- **Test-only change:** the only code paths changed are `architecture.test.ts` and `architecture.testkit.ts`. The testkit is excluded from the build, and module source uses only `node:crypto`/`fs`/`path`/`url` and no `process.*`, so no legitimate import is wrongly denied.

## F-DG1-212

The REQ-DLV-042 installer log is unchanged since round 7 (14 PASS / 0 FAIL), and `tools/deps` is unchanged.

## BLOCKED (does not affect the verdict)

`tools/deps/tests/install-sandbox.test.sh` gives 13/14 here. The live AC-1 (effect) case needs npm registry metadata, and the sandbox has no network (ECONNREFUSED). The offline-equivalent fixture passes through the unchanged wrapper. The register cites the orchestrator's 14-case log as the evidence.

## Observations (not findings)

- The allow-list also denies harmless read-only members and subpaths, such as `process.pid`, `process.cwd`, `process.platform`, `process.on` and `node:path/posix`. No module uses them today, so nothing regresses. A future module that needs one will need a deliberate allow-list review, which is the intended default-deny behaviour.
- The lint is static defence-in-depth. The SIGUSR1 / `_debugProcess` capability still exists at Node runtime level; that is the stated scope, not a defect.
- During my run the runner auto-committed the domain-reviewer record (HEAD → `39cfc4e`). I did not read it. The candidate ID is unchanged.
