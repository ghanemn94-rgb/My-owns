# Assignment T-DG1-BE10: F-DG1-129/213/010 — flip the module lint to DEFAULT-DENY (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-9 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`.
- Fix F-DG1-129, F-DG1-213 (duplicate: process `_debugProcess`/`kill`→inspector) and the module-lint part of F-DG1-010 (full text in `docs/delivery/findings.json`). Edit **only**:
  - `apps/api/src/architecture.testkit.ts`
  - `apps/api/src/architecture.test.ts`
  No module source, other product code, `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/**`. (The orchestrator records the decision D-055 separately.)

## Why (the root cause)
Rounds 4–8 closed loader/exec routes one at a time with **denylists** (`LOADER_BUILTINS`, `PROCESS_LOADERS`): F-DG1-124/125/127/128 and now F-DG1-129/213 (`process.kill(pid,'SIGUSR1')` / `process._debugProcess(pid)` start the in-process V8 inspector — the capability of the banned `node:inspector` — with 0 violations). F-DG1-010 further shows the "exhaustive for the pinned Node" claim named the wrong version (production is Node 24; the sweep ran on Node 22). A denylist over Node's evolving surface cannot converge or be version-independent. **Flip both checks to DEFAULT-DENY**: allow only the small set of `node:` built-ins and `process.*` members that module source legitimately uses; deny everything else. This closes the whole class at once (node:inspector/vm/sqlite/test/worker_threads/child_process/cluster/repl/module/wasi/net/http/…; process.kill/_kill/_debugProcess/execve/binding/_linkedBinding/dlopen/getBuiltinModule/abort/…) and is **version-independent** — a new built-in or process method in any Node version is denied by default.

## Required change — `node:` built-ins (rule 1 / `bareAllowed`)
Replace the `LOADER_BUILTINS` **denylist** with a `SAFE_NODE_BUILTINS` **allow-list**. In `bareAllowed` (currently `if (LOADER_BUILTINS.has(spec)) return false; if (spec.startsWith("node:")) return true; …`), change the `node:` branch to **default-deny**:
```ts
if (spec.startsWith("node:")) return SAFE_NODE_BUILTINS.has(spec.slice("node:".length));
```
(keep the `SHARED_ALLOWED` and `THIRD_PARTY` branches; a bare non-`node:` builtin like `"fs"` stays a violation as today.) Seed `SAFE_NODE_BUILTINS` from what module source actually imports — `crypto, fs, fs/promises, os, path, url, util` — then run `moduleViolations` across every module and **add only genuinely non-loader/non-exec built-ins** that a real module import flags (e.g. `assert`, `buffer`, `events`, `stream`, `string_decoder`, `timers`, `querystring`, `zlib` if used). NEVER add a code-loading/exec/native/debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test, wasi, v8, net, http, https, dgram, async_hooks, …). The violation message for a denied one: e.g. `imports non-allow-listed node built-in ${spec}`.

## Required change — `process.*` members (rule 3)
Replace the `PROCESS_LOADERS` **denylist** with a `SAFE_PROCESS_MEMBERS` **allow-list**. In the rule-3 branch (currently `if (root === "process" && PROCESS_LOADERS.has(name)) evasions.push(\`module loader via process.${name}…\`)`), change to **default-deny**:
```ts
if (root === "process" && !SAFE_PROCESS_MEMBERS.has(name))
  evasions.push(`non-allow-listed process.${name} member (${at(node)})`);
```
Keep the existing process-as-value / aliased / indexed / `globalThis.process` checks unchanged. Seed `SAFE_PROCESS_MEMBERS` from what module source uses — `env, exit, argv, once` — then run `moduleViolations` and add only safe read/lifecycle members a real module uses (e.g. `on, off, cwd, platform, arch, version, versions, pid, nextTick, hrtime, exitCode, stdout, stderr, stdin, env, argv0`). NEVER add `kill, _kill, _debugProcess, execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, reallyExit, setSourceMapsEnabled, …`.

## Header + self-checks
- Rewrite the testkit header: the lint is now **DEFAULT-DENY** for `node:` built-ins and `process.*` members (allow-list the safe set used by module source; deny everything else), which is **version-independent** — remove the "exhaustive for Node 22/24" and "closed as found" framing and the per-version sweep language. State the shrunken residuals: (a) runtime data-flow; (b) runtime code-generation then `import()` of a literal same-module path (an allowed built-in like `node:fs` can write a file the lint never sees) — irreducible; (c) `WebAssembly` global instantiation (a wasm exec, not a JS-module loader). Keep the rationale (static defence-in-depth for ADR-0002, read-only prod tree, not a runtime boundary).
- Update the self-check table so the messages match the new default-deny wording, and ADD positive + negative controls:
  - **denied (violations):** `import { Session } from "node:inspector"` → non-allow-listed built-in; `process.kill(process.pid, "SIGUSR1")`, `process._debugProcess(process.pid)`, `process.execve(...)`, `(process as any).binding("fs")`, `import { DatabaseSync } from "node:sqlite"`, `import { run } from "node:test"`, `import vm from "node:vm"`, `import { Worker } from "node:worker_threads"` → each a violation (keep the existing P12/X6–X8/A1/R1/R2 intent, adjusting regexes to the new messages).
  - **allowed (NOT violations):** `import { randomUUID } from "node:crypto"`, `import { readFileSync } from "node:fs"`, `import { join } from "node:path"`, `import { pathToFileURL } from "node:url"`, `const e = process.env.X`, `process.exit(1)`, `process.argv` — assert `fileViolations(...)` is empty for a module file using these.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — whole suite green incl. the new default-deny controls AND the real-module-tree check (`moduleViolations` zero for every module). Show a before/after for the F-DG1-129 route (process.kill/_debugProcess now a violation).
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files.
- `pnpm test` — the FULL unit suite still green (no legit module import/member newly flagged). If any legit module file is flagged, add the safe built-in/member to the allow-list (never a loader/exec/debug one) and re-run.
- `grep` the final `SAFE_NODE_BUILTINS` / `SAFE_PROCESS_MEMBERS` against module source to confirm every legit import/member is covered and nothing dangerous is listed.

## Handback
`docs/delivery/handbacks/DG1/round-9/T-DG1-BE10-backend-workflow-engineer.md` — the exact diff and rationale, the final allow-lists with justification for each entry, the real vitest output (default-deny controls + module tree + full unit suite), and typecheck/lint/prettier output.
