# Handback T-DG1-BE5: backend round-4 repairs (backend-workflow-engineer)

- **Stage:** P1 / gate DG1, round-4 repair. **Assignment:** `docs/delivery/assignments/DG1/round-4/T-DG1-BE5.md` (sha256 `2d59291956d3a8df277ac2b5489a8c1f012afdcc24ba58605fd9899cabbdad72`, verified).
- **Invocation:** run `DG1-T-DG1-BE5-backend-workflow-engineer-20261001T100859Z-b78b195a`, session `b78b195a-3a7d-412e-8604-eb38c57b480c`.
- **Base revision:** `c6cd4111cce837b817a76726f8d13bf30f0d6bf6` (≥ `96e75cc`, so it includes the orchestrator's `singleFork` serialization). Worktree `/home/user/mth-wt-be5`, branch `dg1r4-be5`. Run offline, with no `pnpm install`.
- **Findings addressed:** F-DG1-009 (Medium) and F-DG1-121 (Low). Both are owned by backend-workflow-engineer. I do not close either one. Verification belongs to a non-author reviewer.
- No migrations were added and no API endpoints changed. These are test-infrastructure and test-lint changes only.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/test/global-setup.ts` | `dropScratchDatabase` now waits (bounded, default 10 s, polling `pg_stat_activity`) until the database has **no** client before `DROP … WITH (FORCE)`. A connection still open after the timeout raises the new `ScratchDatabaseInUse`, which names it by `application_name (state)`, and the database is **not** force-dropped. The function also refuses a name that is not a plain identifier. The global teardown of the run database uses the same function. |
| `apps/api/test/support/harness.ts` | The `startApi()` owner pool (raw `pg.Pool`, the pool that surfaced the 57P01 in the F-DG1-115 suite) gets an `error` listener and the `application_name` `api-test-owner`. The harness's other pool already had a listener through `createPool`. |
| `apps/worker/test/support.ts` | Drops its local `waitForNoConnections` (F-DG1-110). The same guarantee now lives in the shared `dropScratchDatabase`, so worker behaviour is unchanged, including leak-naming. |
| `packages/db/test/integration/scratch-drop.test.ts` (new) | F-DG1-009 regression test. (1) 40 rounds × 8 clients: `pool.end()` then an immediate drop, with an `error` **spy** on the pool, expecting no 57P01. (2) A still-connected client is not terminated: the drop refuses with `ScratchDatabaseInUse` naming `leaky-test`, the database still exists, the client still answers, and after `end()` the drop succeeds. (3) A non-identifier name is refused. |
| `apps/api/src/architecture.testkit.ts` | F-DG1-121: reports any value use of a `.constructor` member, not only as a call/new callee. It also reports a `constructor` key in a destructuring binding or assignment pattern (identifier, shorthand, string or computed key) and the string `"constructor"` used as a value (e.g. `Reflect.get(fn, "constructor")`). The check stays purely static (TypeScript AST, nothing executed). |
| `apps/api/src/architecture.test.ts` | Eight planted cases N1–N8 (the four round-3 code-security plants verbatim in form, plus generator/shorthand, assignment-pattern string key, computed binding key and `Reflect.get` variants). It also adds three clean cases: a class constructor with parameter properties, a plain object literal `{ constructor: "Cls" }` that is not a destructuring target, and an interface member `constructor: string`. |
| `docs/delivery/handbacks/DG1/round-4/T-DG1-BE5-evidence/*` | Raw outputs (ANSI-stripped) of the runs below, plus `pgrun.sh`, the disposable-cluster runner. This follows the round-3 `T-DG1-BE4-evidence` precedent. It is outside the code write list in the assignment, so I am flagging it here in case the orchestrator prefers to move it. |

## 2. Behaviour delivered

### F-DG1-009: a forced drop can no longer surface as an uncaught 57P01 (REQ-S19-004)

**Root cause (confirmed in the installed sources, not guessed).** In `pg-pool@3.14.0`, `end()` → `_pulseQueue()` removes the idle clients and calls `_endCallback()` as soon as `_clients` is empty. `_remove()` only *asks* each client to `end()`; it does not wait for the socket to close, and it leaves the pool's `idleListener` attached. So `await pool.end()` / `await db.destroy()` resolves while the server may still have the backends. The teardown's `DROP DATABASE … WITH (FORCE)` then terminates them. The server sends `FATAL 57P01` to a client with no active query, and `pg` `Client._handleErrorMessage` → `_handleErrorEvent` → `emit('error')`. The idle listener re-emits that as a **pool** `error` event, which is uncaught when the pool has no listener. The `startApi()` owner pool (`new pg.Pool`, used by `access-derived-race.test.ts`) had none.

**Fix.** There are two layers:
1. `dropScratchDatabase` drops only after `pg_stat_activity` shows no other backend on the database. Then `WITH (FORCE)` has nobody to terminate. A real leak fails loudly with a named `ScratchDatabaseInUse` instead of being terminated into an unhandled error elsewhere. Every caller benefits: the F-DG1-115 race suite, oidc, migrate, bootstrap, worker, the qa a13 suite (which calls the shared helper), and the global teardown.
2. Defence in depth: the harness owner pool has an `error` listener.

The a12 false red half of the finding was addressed by the orchestrator's `poolOptions.forks.singleFork` (96e75cc). I did not change `vitest.config.ts`. The runs below show a12 green in 5/5 runs and serial execution: summed test time stays below wall time in every run (for example, run 1 has tests 24.05 s within a 28.70 s duration), whereas the round-3 run 2 had 24.4 s of tests in 17.0 s.

**Fail-before / pass-after** (`scratch-drop.test.ts`, test 1, on a fresh cluster per run, port 5483/5484):
- **Before:** I put back the HEAD `global-setup.ts` temporarily, adding only a stub `ScratchDatabaseInUse` export so the import resolves, and restored the fix afterwards. The result was **3/3 runs FAIL**, each with `AssertionError: expected [ …(4) ] to deeply equal []`. The received errors were `"57P01 terminating connection due to administrator command"`, which is the reported error, captured by the spy. Evidence: `f009-fail-before-{1,2,3}.out.txt`.
  - Honest note: a first attempt at 20 rounds × 4 clients passed once on the old helper (the race is probabilistic). An earlier 20×4 probe hit 2 of 20. That attempt is why the test uses 40 × 8; at that size it failed 3/3 before the fix.
- **After:** the full file passed 3/3 (`Tests 3 passed (3)`, `EXIT=0`). Evidence: `f009-pass-after-{1,2,3}.out.txt`.

**Repeated full integration runs.** Each run used a fresh disposable PostgreSQL 16.13 cluster (initdb under `$TMPDIR`, user namespace, port **5481**, removed afterwards) on the final tree. The command was `PORT=5481 bash pgrun.sh <tree> --reporter=verbose`.

| Run | Result | Exit | Real 57P01 / unhandled lines* | a12 (14) | F-DG1-115 race (4) | Duration (tests) |
|---|---|---|---|---|---|---|
| 1 | 19 files, 200/200 passed | 0 | 0 | 14 ✓ | 4 ✓ | 28.70 s (24.05 s) |
| 2 | 200/200 | 0 | 0 | 14 ✓ | 4 ✓ | 31.69 s (26.52 s) |
| 3 | 200/200 | 0 | 0 | 14 ✓ | 4 ✓ | 28.12 s (23.58 s) |
| 4 | 200/200 | 0 | 0 | 14 ✓ | 4 ✓ | 27.07 s (22.37 s) |
| 5 | 200/200 | 0 | 0 | 14 ✓ | 4 ✓ | 28.89 s (24.31 s) |

\* `grep -iE '57P01|administrator command|unhandled|uncaught'`, excluding the regression test's own title ("…raises no 57P01…"), which is the only match. The suite count went from 197 to 200 because of the three new scratch-drop tests. Evidence: `integration-run{1..5}.out.txt`.

### F-DG1-121: lint catches the AsyncFunction/Function constructor via an aliased `.constructor` (REQ-S16-003)

New violation messages:
- `code evaluation via .constructor (aliased)`: any `.constructor` property access that is not a direct call. A direct call keeps `.constructor()`.
- `code evaluation via a destructured constructor`: `const { constructor: F } = fn`, `const { constructor } = fn`, `const { ["constructor"]: H } = fn`, `({ "constructor": G } = fn)`, `for ({ constructor } of xs)`.
- `code evaluation via the "constructor" key as a value`: `Reflect.get(fn, "constructor")`, `Object.getOwnPropertyDescriptor(p, "constructor")`.

The existing `x["constructor"]` rule is unchanged.

**Planted cases** (`architecture.test.ts`, "the checker itself catches planted violations"):

| Case | Source (planted in module `transformations`) |
|---|---|
| N1 | `const C = (async () => {}).constructor as any; await C("s", "return import(s)")("../access/policy.ts");` |
| N2 | `const { constructor: F } = (async () => {}) as any; await F(...)(...)` |
| N3 | `Reflect.construct((async () => {}).constructor, ["s", "return import(s)"])` |
| N4 | `const AF = Object.getPrototypeOf(async function () {}).constructor; await AF(...)(...)` |
| N5 | `const { constructor } = function* () {} as any; constructor("return import(...)")().next();` |
| N6 | `let G: any; ({ "constructor": G } = async function* () {});` |
| N7 | `const { ["constructor"]: H } = (() => 0) as any;` |
| N8 | `const C = Reflect.get(async () => {}, "constructor");` |

- **Fail-before:** I temporarily replaced the testkit with the HEAD (round-3) `architecture.testkit.ts` and ran `pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts`. Exit 1, `Tests 8 failed | 46 passed (54)`, and the failures are exactly N1–N8. Evidence: `f121-fail-before.out.txt`.
- **Pass-after:** with the new testkit, the same command gave exit 0 and `Tests 54 passed (54)`. The clean-forms test stays green, so there are no false positives on class constructors, plain object literals or type members. Evidence: `f121-pass-after.out.txt`.

## 3. Checks actually run (offline, worktree, Node via `pnpm exec`)

| Command | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 (re-run after the final formatting: exit 0) |
| `pnpm -r build` | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 (re-run after the final formatting: exit 0) |
| `pnpm exec prettier --check <changed files>` | "All matched files use Prettier code style!" (the new test file was formatted with `prettier --write` first) |
| `pnpm test` (unit-node + unit-web) | exit 0, `Test Files 21 passed (21)`, `Tests 243 passed (243)` (`unit.out.txt`) |
| Full integration project × 5, fresh cluster each, port 5481 | 5/5 exit 0, 200/200 each, no 57P01 (table above) |
| F-DG1-009 fail-before × 3 / pass-after × 3 | 3/3 fail before (57P01 captured), 3/3 pass after |
| F-DG1-121 fail-before / pass-after | 8 failed (N1–N8) before; 54/54 after |

Tail of `integration-run3.out.txt`:
```
 Test Files  19 passed (19)
      Tests  200 passed (200)
   Duration  28.12s (transform 709ms, setup 0ms, collect 3.57s, tests 23.58s, environment 0ms, prepare 65ms)
EXIT=0
```

## 4. Known gaps, observations, not done

- **Static-lint limit (unchanged in kind).** A key built at runtime on an arbitrary, non-runtime-root object, such as `fn["constr" + "uctor"]`, cannot be resolved statically. The lint flags computed members only on `process`/`globalThis`/`global`. Closing that would mean flagging every computed member access in module code. I did not do that; it would be a policy decision for the architect or reviewer. Data flow through third-party code is not followed either, as was already documented.
- **Leak handling is deliberately strict.** A test that leaves a connection open on a scratch database now fails its teardown with `ScratchDatabaseInUse`, after 10 s, naming the connection. Before, its connection was force-terminated. No current suite triggers this in 5 full runs.
- **Fix surface not touched.** I did not change `vitest.config.ts` (the orchestrator's `singleFork` part 1). I did not touch `tests/qa/**` either (qa-authored; a13 benefits through the shared helper).
- Nothing is BLOCKED.

## 5. Merge instructions

- **Not committed.** `git commit` failed: `Unable to create '/home/user/My-owns/.git/worktrees/mth-wt-be5/index.lock': Read-only file system`, because git metadata is sandbox-protected. All changes are uncommitted in worktree `/home/user/mth-wt-be5` (branch `dg1r4-be5`, base `c6cd411`): 5 modified files plus the new `packages/db/test/integration/scratch-drop.test.ts` and `docs/delivery/handbacks/DG1/round-4/`. The orchestrator needs to commit them.
- No migrations, no dependency or lockfile changes, no runtime code changes. Only test infrastructure (`packages/db/test`, `apps/api/test/support`, `apps/worker/test`) and the test-only lint (`architecture.testkit.ts` is excluded from the build).
- Conflicts are possible only if another round-4 task edits `packages/db/test/global-setup.ts`, `apps/api/test/support/harness.ts` or `apps/api/src/architecture*.ts`.
- To reproduce: `PORT=<free port> bash docs/delivery/handbacks/DG1/round-4/T-DG1-BE5-evidence/pgrun.sh "$PWD" --reporter=verbose` (needs `/usr/lib/postgresql/16/bin` and `unshare --user`).
