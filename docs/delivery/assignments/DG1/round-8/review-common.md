# DG1 round-8 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-7 all-PASS, which raised exactly one Low, non-mandatory finding. It is now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:e27eaf5fb5ada8640c4463b8e3c9d5f64e5aa629fa78b49cfd2861bdc7544876`
- **source_commit:** `11bc4c4a6f1e5eba58b0a0e0e9fdabbd62b22391` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/e27eaf5fb5ada864.manifest.json`.

## What changed since round 7 (one finding, now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-128 (Low, REQ-S16-003):** the module lint (`apps/api/src/architecture.testkit.ts`) closes the last two concrete loader/exec routes the round-7 exhaustive Node-22 sweep found: `test`/`node:test` added to `LOADER_BUILTINS` (`node:test` `run({files:[computed],isolation:"none"})` loads a file in-process; tests use vitest, no module imports it) and `execve` added to `PROCESS_LOADERS` (rule 3 flags global `process.execve`, the arbitrary-executable exec class). Self-checks R1/R2 added. The testkit header's residual (c) is tightened: the concrete loader/exec built-ins and `process.*` methods are now **enumerated exhaustively for the pinned Node 22** (validated by the round-7 sweep); residual (c) is narrowed to genuinely future/unknown built-ins and `WebAssembly`/`node:wasi`. D-054 records it (supersedes D-053's "closed as found" framing). Fix commit at the round-8 head.

This was the only open finding; no other candidate change.

## Your job
Verify the finding you own (your role file lists it); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements; confirm no regression. You did not implement this repair. Write `docs/delivery/reviews/DG1/round-8/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-8/`. PASS only if the fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. On an **adjacent** module-lint loader route, check it against the testkit header's stated+accepted residual class and the round-7 exhaustive-enumeration claim (D-054) before raising it as new: a route covered by a documented residual, or a genuinely future/unknown built-in, is not a new finding.
