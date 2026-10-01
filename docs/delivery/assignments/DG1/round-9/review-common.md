# DG1 round-9 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-8 all-PASS, which raised three Low, non-mandatory findings. All are now resolved by one change. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:05915c32b3f5c5b2a9e14324a70fbf5cd16e76a48bc3235d6cc30b290591babd`
- **source_commit:** `273d21f78b8ee4369ed7e864d5a1fe76cc4e3de1` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/05915c32b3f5c5b2.manifest.json`.

## What changed since round 8 (all three findings now `FIXED_PENDING_VERIFICATION`)
The module lint (`apps/api/src/architecture.testkit.ts`) now uses **DEFAULT-DENY allow-lists** instead of denylists for Node built-ins and `process` members (D-055, supersedes D-053/D-054):
- `SAFE_NODE_BUILTINS = {crypto, fs, fs/promises, os, path, url, util}` — `bareAllowed` allows a `node:` specifier only if its name is in this set; every other built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test, wasi, v8, net, http, …) is a violation.
- `SAFE_PROCESS_MEMBERS = {env, exit, argv, once}` — rule 3 flags `process.<member>` unless the member is in this set; every other member (kill, _kill, _debugProcess, execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, …) is a violation.
This closes **F-DG1-129 / F-DG1-213** (`process.kill(pid,'SIGUSR1')` / `process._debugProcess(pid)` → in-process V8 inspector) and dissolves **F-DG1-010**'s root cause: the check is now **version-independent** (no per-Node enumeration/sweep; anything a later Node adds is denied by default). Self-check table extended with default-deny positive controls (safe built-ins/members allowed) and negative controls (loader/exec routes denied). Residuals shrink to the irreducible: runtime data-flow; runtime code-gen then `import()` of a literal same-module path via an allowed built-in (`node:fs`); `WebAssembly` global instantiation. Fix commit at the round-9 head.

These were the only open findings; no other candidate change.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements; confirm no regression. You did not implement this repair. Write `docs/delivery/reviews/DG1/round-9/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-9/`. PASS only if the fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. Note: with default-deny, probing "another built-in/process route" should now find it already **denied** — that is the fix working, not a new finding. A genuinely legitimate module import the allow-list wrongly denies (a real regression) IS worth raising.
