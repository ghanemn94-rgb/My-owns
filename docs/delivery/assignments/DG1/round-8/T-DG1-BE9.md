# Assignment T-DG1-BE9: F-DG1-128 module-lint — close the last two concrete loader/exec routes (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-8 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** F-DG1-128 (full text in `docs/delivery/findings.json`). Edit **only**:
  - `apps/api/src/architecture.testkit.ts`
  - `apps/api/src/architecture.test.ts`
  No module source, other product code, `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-128, Low, REQ-S16-003)
The round-7 code-security reviewer did an **exhaustive sweep** of Node 22.22.2's `builtinModules` + `process.*` for loader/exec capabilities not in `LOADER_BUILTINS`/`PROCESS_LOADERS` and found exactly **two** concrete, existing routes that give 0 violations and are not named by any stated residual:
- **R1 — `node:test`:** `import { run } from "node:test"; const p = ["../access/","policy.ts"].join(""); for await (const _ of run({ files: [new URL(p, import.meta.url).pathname], isolation: "none" })) {}` loads and runs a file from a runtime-computed path **in-process** (isolation:'none') — a loader built-in, not code generation (so not residual (b)).
- **R2 — global `process.execve`:** `process.execve("/bin/sh", ["sh","-c","id"])` replaces the process with an arbitrary executable — the same class as the banned `child_process`/`cluster`. A `process.*` exec method not in `PROCESS_LOADERS`.
Low/non-mandatory (static defence-in-depth lint over human-reviewed code; no module uses `node:test` or `process.execve`; R1 loads only on-disk code, R2 is terminal/visible). Per D-053's own reopen criterion ("a native/loader route a module could reach that is NOT a stated residual → close it like sqlite"), both are to be closed.

## Required fix
1. **`node:test`:** add `test` to `LOADER_BUILTINS` (the `.flatMap(b => [b, \`node:${b}\`])` then bans both `test` and `node:test`). No runtime module uses `node:test` — tests use `vitest` — and a repo-wide grep finds zero imports, so no legitimate-use cost.
2. **`process.execve`:** add `execve` to `PROCESS_LOADERS` (alongside `binding`/`_linkedBinding`/`dlopen`), so rule 3 flags `process.execve` as `module loader via process.execve`. (The `node:process` **import** route to it is already closed by F-DG1-125.)
3. **Header + residual framing:** update the `LOADER_BUILTINS` JSDoc and the header's built-in list to include `test`, and `PROCESS_LOADERS` to include `execve`. Then **tighten residual (c)**: state that the concrete loader/exec built-ins and `process.*` methods known in the **pinned Node version** are now **enumerated exhaustively** (validated by the round-7 reviewer's builtinModules + process.* sweep; module/vm/worker_threads/inspector/repl/child_process/cluster/process/sqlite/test, and process.binding/_linkedBinding/dlopen/execve), and that residual (c) is narrowed to genuinely **future/unknown** built-ins of a later Node version and `WebAssembly`/`node:wasi` instantiation (a wasm exec, not a JS-module loader). Keep the rationale (static defence-in-depth for ADR-0002, read-only prod tree, not a runtime boundary). You MAY note that a future hardening could switch module-source `node:` imports to a default-deny allow-list (module source uses only node:crypto/fs/path/url), but that is deferred (bigger blast radius, not P1).
4. **Self-check:** add R1 and R2 to the F-DG1-124 `it.each` table (4th column `"missed"`):
   - `R1 node:test in-process run` → source as above → `/imports package node:test/`.
   - `R2 process.execve` → source `process.execve("/bin/sh", ["sh", "-c", "id"]);` → `/module loader via process\.execve/`.
   Keep P12 (process.binding), X6–X8 (node:process), A1 (node:sqlite) as regression guards.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — whole suite green incl. R1/R2 and the real-module-tree check (`moduleViolations` zero). Show R1/R2 before (0 violations / fail) vs after.
- `pnpm --filter @mth/api run typecheck`; `pnpm exec eslint` + `pnpm exec prettier --check` the two files.
- `grep -rn "node:test\|process.execve" apps packages` — no import/use in source.

## Handback
`docs/delivery/handbacks/DG1/round-8/T-DG1-BE9-backend-workflow-engineer.md` — the exact diff and why, the real vitest output (R1/R2 before/after + module tree), and typecheck/eslint/prettier output.
