# Handback T-DG1-BE10: module lint flipped to DEFAULT-DENY (backend-workflow-engineer)

- **Stage:** DG1, round-9 repair. **Findings:** F-DG1-129, F-DG1-213 (duplicate route) and the module-lint part of F-DG1-010.
- **Invocation:** `DG1-T-DG1-BE10-backend-workflow-engineer-20261001T135207Z-3d677af8` (session `3d677af8-20cd-41c2-9200-17931f36e9af`).
- **Base:** `HEAD` = `ed436209ca2cac005f515926d30590f717909319`. The working tree had no tracked modifications before I started (only untracked dotfiles at the top level, which I left alone). Assignment file sha256 verified `2afeeb18…a44ab3f7`.
- **Environment:** Node v22.22.2 (build sandbox), offline, existing `node_modules`. No `pnpm install`.
- No migrations, no API endpoints, no product/runtime code changed. Both files are test-only: the testkit is excluded from the build.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Replaced the `LOADER_BUILTINS` denylist with the `SAFE_NODE_BUILTINS` allow-list and the `PROCESS_LOADERS` denylist with the `SAFE_PROCESS_MEMBERS` allow-list, so both checks are default-deny. Rewrote the header (version-independent, three residuals) and added a distinct violation message for denied `node:` built-ins. |
| `apps/api/src/architecture.test.ts` | Updated the self-check regexes to the new wording. Added 20 default-deny negative controls (DD1–DD20), each with its observed round-8 result, plus a positive-control test for the allow-listed built-ins and members. Added `bareAllowed` assertions. |

## 2. Behaviour delivered

- **Rule 1 / `bareAllowed` (F-DG1-129/213, F-DG1-010):** `if (spec.startsWith("node:")) return SAFE_NODE_BUILTINS.has(spec.slice("node:".length));`. Any `node:` built-in outside the allow-list is a violation. That includes built-ins a later Node version adds. A denied built-in now reports `imports non-allow-listed node built-in node:<x>`. A bare non-`node:` built-in such as `"fs"` or `"worker_threads"` is still a violation (`imports package <x>`), exactly as before. The `SHARED_ALLOWED` and `THIRD_PARTY` branches are unchanged.
- **Rule 3 / `process.*` (F-DG1-129/213):** `if (root === "process" && !SAFE_PROCESS_MEMBERS.has(name)) evasions.push(\`non-allow-listed process.${name} member (…)\`)`. `process.kill`, `_kill`, `_debugProcess`, `execve`, `binding`, `dlopen`, `abort` and any other member outside the list (including future ones) are now violations. The checks for process used as a value, aliased, indexed, and `globalThis.process` are unchanged. Optional chaining (`process?.kill`) is covered too (control DD9).
- **Header (F-DG1-010, module-lint part):** The "exhaustive for the pinned Node 22.x" claim, the "closed as found" framing and the per-version sweep wording are gone. The header now says both checks are allow-lists, so they don't depend on the Node version: production targets Node 24 and the floor is 22.18+. The residuals are now (a) runtime data flow, (b) runtime code generation followed by `import()` of a literal same-module path, which is irreducible (an allowed built-in like `node:fs` can write the file), and (c) `WebAssembly` global instantiation. The rationale is kept: static defence-in-depth for ADR-0002, not a runtime boundary. D-054 in `decisions.md` is outside my write scope; the orchestrator records D-055.

### Final allow-lists and why each entry is there

`SAFE_NODE_BUILTINS = crypto, fs, fs/promises, os, path, url, util`

| Entry | Justification |
|---|---|
| `crypto` | Used by module source (5 imports: `randomUUID`/`randomBytes`/hash). No loader or exec capability. |
| `fs` | Used by module source (1 import, `admin/branding.ts` reads a file). It's the irreducible residual (b), stated in the header. |
| `path` | Used by module source (3 imports). Pure string functions. |
| `url` | Used by module source (1 import, `fileURLToPath`/`pathToFileURL`). Pure. |
| `fs/promises` | Seeded by the assignment: the same capability as `fs` (already allowed), async form. No module uses it today. |
| `os` | Seeded by the assignment: read-only host info (`EOL`, `tmpdir`, …). No loader, exec or native route. No module uses it today. |
| `util` | Seeded by the assignment: formatting and `promisify`. No module uses it today. |

`SAFE_PROCESS_MEMBERS = env, exit, argv, once`

| Entry | Justification |
|---|---|
| `env` | Reads configuration from the environment. |
| `argv` | Reads arguments. |
| `exit` | Lifecycle: terminates its own process (no code or exec route). |
| `once` | Lifecycle: registers a one-shot signal or exit handler, e.g. `once("SIGTERM", …)`. |

All four come from the seed set the assignment specified. **Current module source uses no `process.*` member at all** (grep below), so nothing more was needed. The run over the real module tree (`moduleViolations`) flagged nothing, so I added no built-in or member beyond the seed. Nothing dangerous is listed: grep below.

One existing clean control changed: `const n = (process as NodeJS.Process).pid;` became `(process as NodeJS.Process).env.TZ`. Its purpose was to check that a type-wrapped member use is not reported as "process used as a value", and it still does that. `pid` itself is now (correctly) not allow-listed, so I didn't widen the list just for a test fixture. The `process.kill(process.pid, …)` plants therefore also report `process.pid`.

## 3. Checks actually run (Node v22.22.2, offline)

### Before/after for the F-DG1-129 / F-DG1-213 route (and the rest of the DD table)

I fed the same plants through `fileViolations("transformations", …/probe.ts, src)` twice: once with `HEAD`'s testkit (`git show HEAD:apps/api/src/architecture.testkit.ts` written to a temporary copy) and once with the new one. I ran a throw-away probe script under `node` and deleted it afterwards. The `round-8 lint: missed/caught` column in the new test table copies this observed output.

```
== round-8 lint (HEAD ed43620) ==
DD1	missed	[]
DD2	missed	[]
DD3	missed	[]
DD4	missed	[]
DD5	caught	["module loader via process.execve (line 1) bypasses the module-interface check"]
DD6	caught	["module loader via process.binding (line 1) bypasses the module-interface check"]
DD7	caught	["module loader via process.dlopen (line 1) bypasses the module-interface check"]
DD8	missed	[]
DD9	missed	[]
DD10	caught	["imports package node:inspector"]
DD11	caught	["imports package node:inspector/promises"]
DD12	caught	["imports package node:sqlite"]
DD13	caught	["imports package node:test"]
DD14	caught	["imports package node:vm"]
DD15	caught	["imports package node:worker_threads"]
DD16	missed	[]
DD17	missed	[]
DD18	missed	[]
DD19	missed	[]
DD20	missed	[]
ALLOWED	missed	[]
== D-055 default-deny lint ==
DD1	caught	["non-allow-listed process.kill member (line 1) bypasses the module-interface check","non-allow-listed process.pid member (line 1) bypasses the module-interface check"]
DD2	caught	["non-allow-listed process._debugProcess member (line 1) bypasses the module-interface check","non-allow-listed process.pid member (line 1) bypasses the module-interface check"]
DD3	caught	["non-allow-listed process._kill member (line 1) bypasses the module-interface check","non-allow-listed process.pid member (line 1) bypasses the module-interface check"]
DD4	caught	["non-allow-listed process._debugProcess member (line 1) bypasses the module-interface check","non-allow-listed process.pid member (line 1) bypasses the module-interface check"]
DD5	caught	["non-allow-listed process.execve member (line 1) bypasses the module-interface check"]
DD6	caught	["non-allow-listed process.binding member (line 1) bypasses the module-interface check"]
DD7	caught	["non-allow-listed process.dlopen member (line 1) bypasses the module-interface check"]
DD8	caught	["non-allow-listed process.abort member (line 1) bypasses the module-interface check"]
DD9	caught	["non-allow-listed process.kill member (line 1) bypasses the module-interface check","non-allow-listed process.pid member (line 1) bypasses the module-interface check"]
DD10	caught	["imports non-allow-listed node built-in node:inspector"]
DD11	caught	["imports non-allow-listed node built-in node:inspector/promises"]
DD12	caught	["imports non-allow-listed node built-in node:sqlite"]
DD13	caught	["imports non-allow-listed node built-in node:test"]
DD14	caught	["imports non-allow-listed node built-in node:vm"]
DD15	caught	["imports non-allow-listed node built-in node:worker_threads"]
DD16	caught	["imports non-allow-listed node built-in node:wasi"]
DD17	caught	["imports non-allow-listed node built-in node:v8"]
DD18	caught	["imports non-allow-listed node built-in node:http"]
DD19	caught	["imports non-allow-listed node built-in node:net"]
DD20	caught	["imports non-allow-listed node built-in node:some-future-builtin"]
ALLOWED	missed	[]
```
(`ALLOWED missed []` = the positive control is clean, which is the expected result.)

### `pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose` (exit 0)

The real module-tree check (`every import respects dependsOn, public surfaces and allowed packages`, which means `moduleViolations` returns `[]` for every module directory) passes.

```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 591ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > D2 node:module itself is a violation 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > M8 node:vm is a violation 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > M9 worker_threads is a violation 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > P12 process.binding is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > P13 node:inspector (in-process evaluation) is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > P14 node:child_process is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X6 node:process default import .dlopen is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X7 node:process default import .binding is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X8 node:process named import dlopen is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > A1 node:sqlite loadExtension is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R1 node:test in-process run is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R2 process.execve is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD1 process.kill(self, SIGUSR1) starts the inspector (F-DG1-129 N1) is a violation (default-deny; round-8 lint: 'missed') 7ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD2 process._debugProcess(self) (F-DG1-129 N2 / F-DG1-213 D2) is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD3 process._kill is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD4 F-DG1-213 D1 full route as module source is a violation (default-deny; round-8 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD5 process.execve is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD6 process.binding is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD7 process.dlopen is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD8 process.abort is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD9 optional-chained process?.kill is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD10 node:inspector is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD11 node:inspector/promises is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD12 node:sqlite is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD13 node:test is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD14 node:vm is a violation (default-deny; round-8 lint: 'caught') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD15 node:worker_threads is a violation (default-deny; round-8 lint: 'caught') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD16 node:wasi is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD17 node:v8 is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD18 node:http is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD19 node:net is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > DD20 a built-in a later Node version might add is a violation (default-deny; round-8 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > default-deny keeps the allow-listed built-ins and process members clean (D-055 positive controls) 3ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > allowed forms stay clean (public index of a declared dependency, shared packages, own files) 6ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > scanSource reports what it saw (paths resolve relative to the planted file) 1ms
 Test Files  1 passed (1)
      Tests  101 passed (101)
   Start at  13:56:37
   Duration  1.96s (transform 131ms, setup 0ms, collect 586ms, tests 1.09s, environment 0ms, prepare 61ms)

```

### `pnpm -r typecheck` (exit 0)
```
packages/db typecheck: Done
apps/api typecheck$ tsc -p tsconfig.json
apps/worker typecheck$ tsc -p tsconfig.json
apps/worker typecheck: Done
apps/api typecheck: Done
```

### `pnpm lint` (exit 0)
```
> mobily-transformation-hub@0.1.0 lint /home/user/My-owns
> eslint . --max-warnings=0

```

### `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` (exit 0)
```
Checking formatting...
All matched files use Prettier code style!
```

### `pnpm test`: full unit suite (exit 0)

This includes the module suites that import the testkit (`kpi`, `reporting`, `workflows`).

```
 ✓ |unit-web| src/components/States.test.tsx (15 tests)
 ✓ |unit-web| src/lib/lib.test.ts (18 tests)
 ✓ |unit-web| src/app/app.test.tsx (16 tests)
 ✓ |unit-web| src/lib/auditChanges.test.ts (15 tests)
 ✓ |unit-web| src/i18n/i18n.test.ts (11 tests)
 ✓ |unit-web| src/i18n/glossary.test.ts (8 tests)
 ✓ |unit-web| src/styles/styles.test.ts (6 tests)
 ✓ |unit-node| apps/api/src/server.test.ts (6 tests)
 ✓ |unit-node| apps/api/src/architecture.test.ts (101 tests)
 ✓ |unit-node| apps/api/src/modules/reporting/reporting.test.ts (4 tests)
 ✓ |unit-node| apps/api/src/modules/workflows/workflows.test.ts (5 tests)
 ✓ |unit-node| packages/config/src/load.test.ts (17 tests)
 ✓ |unit-web| src/pages/transformations/transformations.test.tsx (21 tests)
 ✓ |unit-node| apps/api/src/modules/kpi/kpi.test.ts (5 tests)
 ✓ |unit-node| packages/design-tokens/src/tokens.test.ts (15 tests)
 ✓ |unit-node| apps/api/src/modules/platform/platform.test.ts (7 tests)
 ✓ |unit-node| apps/api/src/modules/admin/branding.test.ts (4 tests)
 ✓ |unit-node| packages/db/src/seed.test.ts (4 tests)
 ✓ |unit-node| apps/api/src/modules/access/rules.test.ts (12 tests)
 ✓ |unit-node| packages/shared/src/schemas/schemas.test.ts (2 tests)
 ✓ |unit-node| apps/api/src/modules/transformations/transitions.test.ts (2 tests)
 Test Files  21 passed (21)
      Tests  294 passed (294)
   Start at  13:55:35
   Duration  9.37s (transform 1.62s, setup 0ms, collect 7.56s, tests 10.35s, environment 3.89s, prepare 1.49s)

```

### Allow-lists checked against module source (grep)
```
$ grep -nE "^const SAFE_(NODE_BUILTINS|PROCESS_MEMBERS)" apps/api/src/architecture.testkit.ts
77:const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
103:const SAFE_PROCESS_MEMBERS: ReadonlySet<string> = new Set(["env", "exit", "argv", "once"]);
$ grep -rhoE "[\"']node:[^\"']+[\"']" apps/api/src/modules | sort | uniq -c
      5 "node:crypto"
      1 "node:fs"
      3 "node:path"
      1 "node:url"
$ grep -rhoE "\bprocess\??\.[A-Za-z_\$]+" apps/api/src/modules | sort | uniq -c
(no output: module source uses no process.* member)
$ grep -E "^const SAFE_" …testkit.ts | grep -oE '"(module|vm|worker_threads|inspector|repl|child_process|cluster|process|sqlite|test|wasi|v8|net|http|https|dgram|async_hooks|kill|_kill|_debugProcess|_debugEnd|execve|binding|_linkedBinding|dlopen|getBuiltinModule|abort|reallyExit|setSourceMapsEnabled)"'
(no output: no loader/exec/native/debug entry is listed)
```

### Not run
- **Node 24:** BLOCKED. Only Node 22.22.2 is available in this sandbox, which has no network. The lint no longer enumerates any version-specific surface, so its result doesn't depend on the Node version. The CI matrix (`['24','22']`) will run the same suite on 24.
- **Integration tests** (`test/integration`, needs PostgreSQL): not run, not relevant. No runtime or persistence code changed, and no integration suite imports the testkit.

## 4. Known gaps / not done

- `docs/delivery/decisions.md` (D-054's "exhaustive" wording and the D-055 record) is outside my write scope. The assignment says the orchestrator records D-055. D-054's text still carries the old claim until then.
- The runtime mitigation suggested in F-DG1-129, running shipped processes with `--disable-sigusr1`, is outside this assignment's scope (`deploy/**`) and was not done. With default-deny, the static route through module source is closed. A separate decision on the runtime flag is open.
- Residuals (a) to (c) remain as stated in the header. They are accepted and can't be closed statically.
- Housekeeping: during the run the session harness created an empty `apps/api/src/modules/.claude/.cc-writes/` directory when my shell's working directory was briefly inside `modules/`. It made the existing "only mapped module directories" test fail on `.claude`. I removed that empty directory, which was my session's own artifact. No tracked file was involved. If a reviewer sees the same failure, check for a stray `.claude` directory under `src/modules/`.

## 5. Merge instructions

- No migrations, no new dependencies, no API endpoints. Merge the two files as-is. Expect conflicts only with concurrent edits to `architecture.test.ts` / `architecture.testkit.ts`.
- If a future module needs a new built-in or `process` member, it has to be added deliberately to `SAFE_NODE_BUILTINS` / `SAFE_PROCESS_MEMBERS` with a justification. Never add a loader, exec, native or debug one.

## Exact diff (`git diff` against `ed43620`)

```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index db34be0..ca30e94 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -1,14 +1,17 @@
 // Architecture test (ADR-0002). Parses every import (including type-only, re-exports, dynamic import() and require)
 // with the AST lint in architecture.testkit.ts and fails when:
 //  1. a module imports anything other than its own files, the index.ts of a module in its `dependsOn`, the shared
-//     packages (@mth/shared, @mth/config, @mth/db), node: built-ins or a third-party dependency of @mth/api;
+//     packages (@mth/shared, @mth/config, @mth/db), an ALLOW-LISTED node: built-in or a third-party dependency of
+//     @mth/api (D-055: every other node: built-in is denied by default);
 //  2. a module reaches into the composition root (server.ts, main.ts, index.ts, modules.ts) - except that a module's
 //     own *.test.ts may read the module map and the lint itself;
 //  3. a module evades the check: computed import()/require() specifiers, createRequire, or node:module (F-DG1-109);
 //     process.getBuiltinModule / computed members of process or globalThis, Function/eval/.constructor() code
 //     evaluation, or node:vm / worker_threads (F-DG1-117); and, since F-DG1-124, ANY occurrence of a dynamic-code
 //     primitive name (eval, Function & co., constructor, require, createRequire, Reflect, getPrototypeOf, ...) in any
-//     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them);
+//     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them); since
+//     D-055 (F-DG1-129/213), any member of the global process outside the allow-list (process.kill, _debugProcess,
+//     execve, binding, ...) - default-deny, independent of the Node version;
 //  4. a module directory is not in the module map, a P1 module has no index.ts, or a §16 business module has no
 //     test suite of its own (A12, D-048);
 //  5. the declared module graph has a cycle, or audit/access depend on a business module;
@@ -96,7 +99,11 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       `import { createRequire } from "node:module";\nconst p = createRequire(import.meta.url)("../access/policy.ts");`,
       /createRequire .* bypasses the module-interface check/,
     ],
-    ["D2 node:module itself", `import * as m from "node:module";`, /imports package node:module/],
+    [
+      "D2 node:module itself",
+      `import * as m from "node:module";`,
+      /imports non-allow-listed node built-in node:module/,
+    ],
     [
       "D3 createRequire via namespace",
       `import mod from "module";\nconst r = mod.createRequire(import.meta.url);`,
@@ -204,7 +211,7 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       `const C = Reflect.get(async () => {}, "constructor");`,
       /code evaluation via the "constructor" key as a value/,
     ],
-    ["M8 node:vm", `import vm from "node:vm";`, /imports package node:vm/],
+    ["M8 node:vm", `import vm from "node:vm";`, /imports non-allow-listed node built-in node:vm/],
     ["M9 worker_threads", `import { Worker } from "worker_threads";`, /imports package worker_threads/],
   ])("%s is a violation", (_case, source, message) => {
     const v = planted("transformations", source);
@@ -280,19 +287,19 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     [
       "P12 process.binding",
       `const fs = (process as any).binding("fs");`,
-      /module loader via process\.binding/,
+      /non-allow-listed process\.binding member/,
       "missed",
     ],
     [
       "P13 node:inspector (in-process evaluation)",
       `import { Session } from "node:inspector";`,
-      /package node:inspector/,
+      /non-allow-listed node built-in node:inspector/,
       "missed",
     ],
     [
       "P14 node:child_process",
       `import { execFileSync } from "node:child_process";`,
-      /package node:child_process/,
+      /non-allow-listed node built-in node:child_process/,
       "missed",
     ],
     [
@@ -314,49 +321,49 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       "missed",
     ],
     // F-DG1-125: an import of the process module aliased it past rule 3 (which only knows the global identifier
-    // `process`). Importing `process` / `node:process` is now itself a specifier violation (LOADER_BUILTINS).
+    // `process`). Importing `process` / `node:process` is now itself a specifier violation (D-055: not allow-listed).
     [
       "X6 node:process default import .dlopen",
       `import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`,
-      /imports package node:process/,
+      /imports non-allow-listed node built-in node:process/,
       "missed",
     ],
     [
       "X7 node:process default import .binding",
       `import proc from "node:process";\nconst fs = (proc as any).binding("fs");`,
-      /imports package node:process/,
+      /imports non-allow-listed node built-in node:process/,
       "missed",
     ],
     [
       "X8 node:process named import dlopen",
       `import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");`,
-      /imports package node:process/,
+      /imports non-allow-listed node built-in node:process/,
       "missed",
     ],
     // F-DG1-127 A1: node:sqlite's loadExtension loads a native shared object (same class as process.dlopen), so
-    // `sqlite` / `node:sqlite` is in LOADER_BUILTINS. A2 (write a file with node:fs, then `import("./gen.mjs")`) is
+    // `node:sqlite` is denied (D-055: not allow-listed). A2 (write a file with node:fs, then `import("./gen.mjs")`) is
     // NOT a case here: it is the stated, accepted residual of this static lint (architecture.testkit.ts header).
     [
       "A1 node:sqlite loadExtension",
       `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/tmp/x.so");`,
-      /imports package node:sqlite/,
+      /imports non-allow-listed node built-in node:sqlite/,
       "missed",
     ],
     // F-DG1-128: the last two concrete loader/exec routes of the pinned Node version (round-7 builtinModules +
     // process.* sweep). R1: node:test `run({ files, isolation: "none" })` imports a runtime-computed path IN-PROCESS
-    // (a loader built-in, no code generation), so `test` / `node:test` is in LOADER_BUILTINS. R2: the global
+    // (a loader built-in, no code generation), now denied by default (D-055). R2: the global
     // `process.execve` replaces the process with an arbitrary executable (the child_process/cluster class), so
-    // `execve` is in PROCESS_LOADERS (rule 3). "missed" = 0 violations before this fix.
+    // `execve` is denied by default (D-055, rule 3). "missed" = 0 violations before this fix.
     [
       "R1 node:test in-process run",
       `import { run } from "node:test";\nconst p = ["../access/", "policy.ts"].join("");\nfor await (const _ of run({ files: [new URL(p, import.meta.url).pathname], isolation: "none" })) {}`,
-      /imports package node:test/,
+      /imports non-allow-listed node built-in node:test/,
       "missed",
     ],
     [
       "R2 process.execve",
       `process.execve("/bin/sh", ["sh", "-c", "id"]);`,
-      /module loader via process\.execve/,
+      /non-allow-listed process\.execve member/,
       "missed",
     ],
     // Prior forms (F-DG1-117/121), still caught: regression guards for the blanket rules.
@@ -379,6 +386,114 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(v.join("\n")).toMatch(message);
   });
 
+  // D-055 / F-DG1-129, F-DG1-213, F-DG1-010: DEFAULT-DENY for node: built-ins and process.* members. The third column
+  // records what the round-8 lint (HEAD ed43620, denylists LOADER_BUILTINS / PROCESS_LOADERS) did with the same plant:
+  // "missed" = 0 violations; "caught" = flagged by the old denylist (kept as a regression guard).
+  it.each([
+    [
+      "DD1 process.kill(self, SIGUSR1) starts the inspector (F-DG1-129 N1)",
+      `process.kill(process.pid, "SIGUSR1");`,
+      /non-allow-listed process\.kill member/,
+      "missed",
+    ],
+    [
+      "DD2 process._debugProcess(self) (F-DG1-129 N2 / F-DG1-213 D2)",
+      `process._debugProcess(process.pid);`,
+      /non-allow-listed process\._debugProcess member/,
+      "missed",
+    ],
+    [
+      "DD3 process._kill",
+      `(process as any)._kill(process.pid, 10);`,
+      /non-allow-listed process\._kill member/,
+      "missed",
+    ],
+    [
+      "DD4 F-DG1-213 D1 full route as module source",
+      `process._debugProcess(process.pid);\nconst l = await (await fetch("http://127.0.0.1:9229/json/list")).json();\nconst ws = new WebSocket(l[0].webSocketDebuggerUrl);\nws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1" } }));`,
+      /non-allow-listed process\._debugProcess member/,
+      "missed",
+    ],
+    ["DD5 process.execve", `process.execve("/bin/sh", ["sh"]);`, /non-allow-listed process\.execve member/, "caught"],
+    ["DD6 process.binding", `(process as any).binding("fs");`, /non-allow-listed process\.binding member/, "caught"],
+    [
+      "DD7 process.dlopen",
+      `process.dlopen({ exports: {} } as any, "/tmp/x.node");`,
+      /process\.dlopen member/,
+      "caught",
+    ],
+    ["DD8 process.abort", `process.abort();`, /non-allow-listed process\.abort member/, "missed"],
+    [
+      "DD9 optional-chained process?.kill",
+      `process?.kill(process.pid, "SIGUSR1");`,
+      /non-allow-listed process\.kill member/,
+      "missed",
+    ],
+    [
+      "DD10 node:inspector",
+      `import { Session } from "node:inspector";`,
+      /imports non-allow-listed node built-in node:inspector/,
+      "caught",
+    ],
+    [
+      "DD11 node:inspector/promises",
+      `import { Session } from "node:inspector/promises";`,
+      /non-allow-listed node built-in node:inspector\/promises/,
+      "caught",
+    ],
+    [
+      "DD12 node:sqlite",
+      `import { DatabaseSync } from "node:sqlite";`,
+      /imports non-allow-listed node built-in node:sqlite/,
+      "caught",
+    ],
+    [
+      "DD13 node:test",
+      `import { run } from "node:test";`,
+      /imports non-allow-listed node built-in node:test/,
+      "caught",
+    ],
+    ["DD14 node:vm", `import vm from "node:vm";`, /imports non-allow-listed node built-in node:vm/, "caught"],
+    [
+      "DD15 node:worker_threads",
+      `import { Worker } from "node:worker_threads";`,
+      /imports non-allow-listed node built-in node:worker_threads/,
+      "caught",
+    ],
+    ["DD16 node:wasi", `import { WASI } from "node:wasi";`, /non-allow-listed node built-in node:wasi/, "missed"],
+    ["DD17 node:v8", `import v8 from "node:v8";`, /non-allow-listed node built-in node:v8/, "missed"],
+    ["DD18 node:http", `import { request } from "node:http";`, /non-allow-listed node built-in node:http/, "missed"],
+    ["DD19 node:net", `import { connect } from "node:net";`, /non-allow-listed node built-in node:net/, "missed"],
+    [
+      "DD20 a built-in a later Node version might add",
+      `const x = await import("node:some-future-builtin");`,
+      /non-allow-listed node built-in node:some-future-builtin/,
+      "missed",
+    ],
+  ])("%s is a violation (default-deny; round-8 lint: $3)", (_case, source, message, _before) => {
+    const v = planted("transformations", source);
+    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
+    expect(v.join("\n")).toMatch(message);
+  });
+
+  it("default-deny keeps the allow-listed built-ins and process members clean (D-055 positive controls)", () => {
+    const allowed = [
+      `import { randomUUID } from "node:crypto";`,
+      `import { readFileSync } from "node:fs";`,
+      `import { readFile } from "node:fs/promises";`,
+      `import { join } from "node:path";`,
+      `import { pathToFileURL } from "node:url";`,
+      `import { EOL } from "node:os";`,
+      `import { inspect } from "node:util";`,
+      `const e = process.env.X;`,
+      `const argv = process.argv;`,
+      `process.once("SIGTERM", () => process.exit(0));`,
+      `if (!e) process.exit(1);`,
+      `export const id = randomUUID() + readFileSync(join("a", "b"), "utf8") + pathToFileURL("/x").href;`,
+    ].join("\n");
+    expect(planted("transformations", allowed)).toEqual([]);
+  });
+
   it("allowed forms stay clean (public index of a declared dependency, shared packages, own files)", () => {
     const clean = [
       `import { authorize } from "../access/index.ts";`,
@@ -390,7 +505,7 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       `export { x } from "./routes.ts";`,
       // F-DG1-117 rules must not flag ordinary code: member reads of process, look-alike property names, types.
       `const tz = process.env.TZ;`,
-      `const n = (process as NodeJS.Process).pid;`,
+      `const n = (process as NodeJS.Process).env.TZ;`,
       `const o = { process: 1, env: 2 };\nconst e = o.process + o.env;`,
       `let t: typeof process.env | undefined;`,
       `class K { constructor() {} }\nconst k = new K();`,
@@ -436,6 +551,13 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(bareAllowed("@mth/web")).toBe(false);
     expect(bareAllowed("fastify")).toBe(true);
     expect(bareAllowed("node:module")).toBe(false);
+    // D-055 default-deny: allow-listed node: built-ins pass, everything else (incl. unknown future ones) does not.
+    expect(bareAllowed("node:crypto")).toBe(true);
+    expect(bareAllowed("node:fs/promises")).toBe(true);
+    expect(bareAllowed("node:inspector")).toBe(false);
+    expect(bareAllowed("node:http")).toBe(false);
+    expect(bareAllowed("node:some-future-builtin")).toBe(false);
+    expect(bareAllowed("fs")).toBe(false);
   });
 });
 
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 3b08d75..e1e8ce8 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -4,12 +4,12 @@
 // It walks the TypeScript AST of each file (F-DG1-109: `ts.preProcessFile` saw only literal specifiers) and reports:
 //  - every static import / export-from / `import x = require()` / type-only import specifier, and every
 //    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
-//  - a computed `import(expr)` / `require(expr)` (the target cannot be checked), and any import of the built-ins that
-//    hand out a loader or evaluate code (`module`, `vm`, `worker_threads`, `inspector`, `repl`, `child_process`,
-//    `cluster`, `process`, `sqlite`, `test`; with or without `node:`). F-DG1-125: importing `process` /
-//    `node:process` is itself banned (an imported binding aliases the process object past rule 3; the global is a Node
-//    global, no module imports it). F-DG1-127: `sqlite` / `node:sqlite` (`loadExtension` loads a native shared
-//    object). F-DG1-128: `test` / `node:test` (`run({ files, isolation: "none" })` imports a computed path in-process).
+//  - a computed `import(expr)` / `require(expr)` (the target cannot be checked);
+//  - DEFAULT-DENY for Node built-ins (D-055; F-DG1-129/213, F-DG1-010): a `node:` specifier is allowed only when it
+//    is in SAFE_NODE_BUILTINS (the small set module source legitimately uses); every other built-in - module, vm,
+//    worker_threads, inspector, repl, child_process, cluster, process, sqlite, test, wasi, v8, net, http, ... and any
+//    built-in a later Node version adds - is a violation. A bare built-in name without `node:` (`"fs"`) is not a
+//    dependency of @mth/api and stays a violation as before.
 //
 // F-DG1-124 - BLANKET BAN of the dynamic-code-loading primitives in module source. F-DG1-117 and F-DG1-121 matched
 // ever more spellings of the same thing (`.constructor()`, aliased `.constructor`, destructured `constructor`, ...)
@@ -30,31 +30,26 @@
 //     constructed key can spell any banned name, so the key itself is the violation. Dictionary lookups use a `Map`
 //     (a Map returns only what was put in it and never reaches the prototype chain).
 //  3. RUNTIME ROOTS `process`, `globalThis`, `global`: used other than as `root.member` (aliased, passed,
-//     destructured), indexed at all (`process["x"]`), `globalThis.<root|primitive>`, and the native loaders
-//     `process.binding` / `process._linkedBinding` / `process.dlopen`, and the exec method `process.execve`
-//     (F-DG1-128: replaces the process with an arbitrary executable, the child_process/cluster class); the CommonJS
-//     free variable `module` as a value.
+//     destructured), indexed at all (`process["x"]`), `globalThis.<root|primitive>`; the CommonJS free variable
+//     `module` as a value; and DEFAULT-DENY for `process.<member>` (D-055): only the members in SAFE_PROCESS_MEMBERS
+//     are allowed. Everything else - kill, _kill, _debugProcess (both start the in-process V8 inspector, F-DG1-129 /
+//     F-DG1-213), execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, reallyExit, ... and any member a
+//     later Node version adds - is a violation.
 //     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
-//     a named `{ dlopen }` import) is closed by the specifier check instead, which bans `process`/`node:process`.
+//     a named `{ dlopen }` import) is closed by the specifier check instead (`node:process` is not allow-listed).
 //  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
-// Nothing is executed. Residual limits (stated and ACCEPTED, not closable statically):
-//  (a) a string computed at RUNTIME and handed to third-party code that itself reads `input[key]` (e.g. a schema
-//      library given `Object.fromEntries([[k, ...]])`) is data flow the lint cannot follow; rules 1-2 remove every
-//      syntactic route inside module source.
-//  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (write a file,
-//      e.g. with `node:fs`, then `import("./local.mjs")`): the specifier is a legal own-module path and the bytes
-//      exist only at runtime, so the lint never sees them. `node:fs` is deliberately NOT banned (tests read files and
-//      a module may legitimately read files; a write-API-only ban would be brittle).
-//  (c) the loader/eval denylist is ENUMERATED (rule-1 primitives, rule-3 roots and loaders, LOADER_BUILTINS). For
-//      the PINNED Node version (22.x) the concrete loader/exec built-ins and `process.*` methods are now enumerated
-//      exhaustively, as validated by the round-7 code-security sweep of `builtinModules` + `process.*` (F-DG1-128):
-//      built-ins module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test; and
-//      process.binding, _linkedBinding, dlopen, execve (closed as found: `process.dlopen` F-DG1-125, `node:sqlite`
-//      loadExtension F-DG1-127, `node:test` run / `process.execve` F-DG1-128). Residual (c) is therefore narrowed to
-//      genuinely FUTURE/UNKNOWN built-ins or `process.*` methods of a later Node version, and `WebAssembly` /
-//      `node:wasi` instantiation (a wasm exec, not a JS-module loader). A later hardening could switch module-source
-//      `node:` imports to a default-deny allow-list (module source uses only node:crypto/fs/path/url); that is
-//      deferred (bigger blast radius, not P1).
+// Both built-in checks are allow-lists, not enumerations of known-bad routes, so they do not depend on the Node
+// version the lint runs on (production targets Node 24, the supported floor is Node 22.18+): a new built-in or
+// `process` member is denied until someone deliberately reviews it and adds it here. Nothing is executed.
+// Residual limits (stated and ACCEPTED, not closable statically):
+//  (a) runtime DATA FLOW: a string computed at runtime and handed to third-party code that itself reads
+//      `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`); rules 1-2 remove every syntactic
+//      route inside module source.
+//  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (an allowed
+//      built-in such as `node:fs` writes a file, then `import("./local.mjs")`): the specifier is a legal own-module
+//      path and the bytes exist only at runtime, so the lint never sees them. Irreducible for a static lint;
+//      `node:fs` stays allowed (a module may legitimately read files; a write-API-only ban would be brittle).
+//  (c) `WebAssembly` global instantiation (a wasm exec, not a JS-module loader).
 // Rationale: this is static defence-in-depth for the ADR-0002 module boundaries, enforced against human-reviewed code
 // that runs with a read-only production source tree; it is NOT a runtime security boundary.
 import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
@@ -72,30 +67,14 @@ const apiPkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as
 const THIRD_PARTY = new Set(Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/")));
 const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);
 /**
- * Built-ins that hand out an unchecked loader or evaluate code; a module never needs them. F-DG1-125: `process` too -
- * an imported process object (default, namespace or named `{ dlopen }`/`{ binding }`) is a local binding that rule 3's
- * `process.<loader>` check cannot see, so the import itself is the violation. The global `process` stays under rule 3.
- * F-DG1-127: `sqlite` too - `new DatabaseSync(p, { allowExtension: true }).loadExtension(so)` loads a native shared
- * object (the `process.dlopen` class); a module never needs SQLite (persistence is `@mth/db`/PostgreSQL, ADR-0003).
- * F-DG1-128: `test` too - `run({ files: [<computed path>], isolation: "none" })` loads and runs a file named by a
- * runtime-computed path in the SAME process (a computed import without code generation). No runtime module uses
- * `node:test` (tests use vitest).
+ * D-055 DEFAULT-DENY allow-list of `node:` built-ins (without the prefix) that module source may import. Seeded from
+ * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. None of
+ * them loads, evaluates or executes code, opens a debugger, or loads native objects. NEVER add a code-loading, exec,
+ * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
+ * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
+ * and are now denied by default. Network I/O belongs to the composition root, not module source.
  */
-const LOADER_BUILTINS = new Set(
-  [
-    "module",
-    "vm",
-    "worker_threads",
-    "inspector",
-    "inspector/promises",
-    "repl",
-    "child_process",
-    "cluster",
-    "process",
-    "sqlite",
-    "test",
-  ].flatMap((b) => [b, `node:${b}`]),
-);
+const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
 /** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
 const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
   ...["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "constructor"].map(
@@ -116,10 +95,12 @@ const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
 /** Global objects through which the runtime (and its loaders) can be reached. */
 const RUNTIME_ROOTS = new Set(["process", "globalThis", "global"]);
 /**
- * Native-code loaders and the exec method on `process` (rule 3). F-DG1-128: `execve` replaces the process with an
- * arbitrary executable (the class of the banned `child_process` / `cluster`).
+ * D-055 DEFAULT-DENY allow-list of members of the global `process` that module source may use (rule 3): reading the
+ * environment and arguments, and the lifecycle calls exit/once. NEVER add kill, _kill, _debugProcess, _debugEnd,
+ * execve, binding, _linkedBinding, dlopen, getBuiltinModule, abort, reallyExit, setSourceMapsEnabled, ... (signal /
+ * debugger / exec / native-loader routes, F-DG1-125/128/129/213).
  */
-const PROCESS_LOADERS = new Set(["binding", "_linkedBinding", "dlopen", "execve"]);
+const SAFE_PROCESS_MEMBERS: ReadonlySet<string> = new Set(["env", "exit", "argv", "once"]);
 /** Binary operators whose result is always a number/bigint, so the key can never spell a property name. */
 const NUMERIC_OPERATORS = new Set([
   ts.SyntaxKind.MinusToken,
@@ -146,8 +127,7 @@ export function walk(dir: string): string[] {
 }
 
 export function bareAllowed(spec: string): boolean {
-  if (LOADER_BUILTINS.has(spec)) return false;
-  if (spec.startsWith("node:")) return true;
+  if (spec.startsWith("node:")) return SAFE_NODE_BUILTINS.has(spec.slice("node:".length));
   if (SHARED_ALLOWED.has(spec)) return true;
   const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
   return THIRD_PARTY.has(pkg);
@@ -333,8 +313,8 @@ export function scanSource(fileName: string, source: string): ScanResult {
         const name = node.name.text;
         if ((root === "globalThis" || root === "global") && (RUNTIME_ROOTS.has(name) || name === "module"))
           evasions.push(`${root}.${name} (${at(node)})`);
-        if (root === "process" && PROCESS_LOADERS.has(name))
-          evasions.push(`module loader via process.${name} (${at(node)})`);
+        if (root === "process" && !SAFE_PROCESS_MEMBERS.has(name))
+          evasions.push(`non-allow-listed process.${name} member (${at(node)})`);
       }
       if (ts.isIdentifier(node) && isValueReference(node)) {
         if (node.text === "module") evasions.push(`module used as a value (${at(node)})`);
@@ -405,7 +385,11 @@ export function fileViolations(mod: ApiModule, file: string, source: string): st
       else if (rest.join("/") !== "index.ts")
         violations.push(`${where}: imports ${spec}; only ${targetMod}/index.ts is public`);
     } else if (!bareAllowed(spec) && !(spec === "vitest" && isTest)) {
-      violations.push(`${where}: imports package ${spec}`);
+      violations.push(
+        spec.startsWith("node:")
+          ? `${where}: imports non-allow-listed node built-in ${spec}`
+          : `${where}: imports package ${spec}`,
+      );
     }
   }
   return violations;
```
