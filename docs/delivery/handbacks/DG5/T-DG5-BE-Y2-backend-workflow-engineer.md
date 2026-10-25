# Handback T-DG5-BE-Y2 (backend-workflow-engineer): DG5 round-3 repair, F-DG5-102 and F-DG5-145

- **Stage:** DG5, FIXING after review round 3 (candidate `sha256:fc93b239…`, D-174).
- **Invocation:** `DG5-T-DG5-BE-Y2-backend-workflow-engineer-20261019T044558Z-143b05c2`, session `143b05c2-1afb-4b4b-9d70-389c73fb648f`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-Y2.md`; its sha256 `b7930f9c…fd3209` matched before I started.
- **Working tree:** `/home/user/wt/dg5-be-y2`, branch `dg5/be-y2`, starting at `HEAD` `24a803d30c7d92d26ccac428b4c215ec3468caa2` with a clean tree (only untracked sandbox dotfiles, which I did not touch).
- **Time:** start `2026-10-19T04:46:18Z`, end `2026-10-19T05:22:42Z` (about 36 minutes; handback written after that).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0, both at the start and at the end.
- **Changes are uncommitted**, for the orchestrator to integrate.

## 1. Changed files

| File                                   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/architecture.testkit.ts` | Rule 4 (`syntaxErrors`) no longer lets `ts.transpileModule` transform and print the file. An `EMPTY_EMIT` `before` transformer gives the emitter an empty tree. The parse, program and diagnostics are still TypeScript's own. `syntaxErrors` is exported for the guard test only. The `AST_TEST_TIMEOUT_MS` comment now records why that shared budget is unchanged.                                                                                                                                   |
| `apps/api/src/architecture.test.ts`    | The full-tree walk 'every import respects dependsOn, public surfaces and allowed packages' gets its own budget, `FULL_MODULE_WALK_TIMEOUT_MS = 150_000`, with a comment citing F-DG2-143, F-DG5-102/145 and D-174 and the measurements. A new guard test checks that rule 4 reports exactly what a full `ts.transpileModule` reports. **No existing test, assertion or control changed:** the diff of this file adds lines only, apart from the one argument that is now the new budget constant. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-Y2-evidence/*.log`, this handback | Evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

No other file is touched. That includes BE-Y1's `packages/db/src/demo/**` and the demo tests, and FE-Y1's `apps/web/**`.

## 2. The finding: F-DG5-102 and F-DG5-145 (one defect, REQ-S16-001)

### Cause

The full-tree test lints all 448 API module files (5.79 MB), and each file is processed twice:

1. `scanSource` parses it (as TS, or TSX for `.jsx`/`.tsx`, target `Latest`) and applies rules 1, 2, 3 and 5 and the specifier checks.
2. `syntaxErrors` (rule 4) calls `ts.transpileModule`. That re-parses the file the way the compiler would (script kind from the extension, target `LatestStandard`, module detection) and collects the syntactic and options diagnostics.
   - It then **emits JavaScript**: the TypeScript transforms plus printing the whole file.
   - The output text was always discarded.

Profile outside Vitest, 448 files (`profile-and-differential.log`):

| Step                                       | Node 24.21.0  | Node 22.22.2  |
| ------------------------------------------ | ------------- | ------------- |
| `scanSource`, all files                    | 847–1516 ms   | 891–1173 ms   |
| full `ts.transpileModule` (before)         | 3044–3793 ms  | 3262–3981 ms  |
| `syntaxErrors` with `EMPTY_EMIT` (after)   | 1820–1925 ms  | 2003–2169 ms  |
| the walk + read                            | 4 + 21 ms     | 6 + 16 ms     |

The emit was about a third of the whole walk. The 30 s budget dates from F-DG2-143, when the tree took about 1.5 s alone. The tree has since grown, so under the review load (load 14–29 on 4 CPUs) the test took 30–67 s and timed out with no assertion failing.

### What I checked and did not change (no rule weakened)

- **The filesystem walk** runs once per module directory. No file is read twice in the full-walk test, and no file is linted by two modules. It costs about 25 ms, so it is not worth touching. `statSync` follows symlinks, while `readdir` with `withFileTypes` would not, so changing it could also change which files are walked.
- **The two parses stay two.** They use different parameters by design, so sharing one `SourceFile` would change a rule's meaning:
  - Rules 1, 2, 3 and 5 deliberately parse `.js`/`.mjs`/`.cjs` as TS and `.jsx` as TSX (F-DG1-134), with target `Latest`.
  - Rule 4 must see the file the way the compiler does: script kind from the extension, so a type annotation in a `.js` file is a syntax error; transpile's own target; and module detection. The guard test pins this with the `.js` and `.ts` pair.
- **I rejected a faster alternative.** I prototyped a one-file program with options captured from `transpileModule`, which skips `program.emit` and its `markLinkedReferences` pass. It cut rule 4 to 0.94–1.30 s, also with 0 differences. But it re-implements TypeScript's internal `transpileWorker` set-up, so a TypeScript upgrade could change its meaning silently. The `EMPTY_EMIT` approach keeps calling `ts.transpileModule` unchanged.

### The fix

1. **`apps/api/src/architecture.testkit.ts:551-562`.** `EMPTY_EMIT` is a `ts.TransformerFactory` that returns `factory.updateSourceFile(sf, [])`. `syntaxErrors` passes it as `transformers: { before: [EMPTY_EMIT] }` to the same `ts.transpileModule` call (same source, `fileName`, `reportDiagnostics` and `compilerOptions`). Why no diagnostic changes (TypeScript 6.0.2 `transpileWorker` and `emitFiles`; comment at `:537-549`):
   - The options are built, the file is parsed, and `getSyntacticDiagnostics` and `getOptionsDiagnostics` are collected, all **before** `program.emit` and on the original source file. A custom `before` transformer runs only inside the emit.
   - A non-declaration emit adds diagnostics only from a failing `writeFile` (impossible with transpile's in-memory host), a build-info file (none without incremental/composite), or the declaration emit (transpile turns it off).
   - `noEmitOnError` stays unset (its `transpileOptionValue` is `undefined`), so no pre-emit diagnostic is folded in.
   - The declaration-file branch (`declarationSyntaxErrors`) is unchanged.
2. **`apps/api/src/architecture.test.ts:64-65` and `:201-215`.** The full-walk test's own budget is `FULL_MODULE_WALK_TIMEOUT_MS = 150_000`, more than 2x the 67.0 s loaded worst case (F-DG5-145, `02-unit-node22-cutf8-rerun.log`), whatever the speed-up. The comment cites F-DG2-143, F-DG5-102/145 and D-174, with the measurements. The assertion (`toEqual([])` over every module's violations) is unchanged.
3. **`AST_TEST_TIMEOUT_MS` stays 30 s** (`architecture.testkit.ts:112-119`). Its five module-owned users take 0.3–1.9 s alone on both Node versions (`before-module-boundary-tests-alone.log`), well under a third of 30 s, so per the assignment none is changed:

   | Test                                                           | Node 24 | Node 22 |
   | -------------------------------------------------------------- | ------- | ------- |
   | reporting 'its declared boundary holds, and a planted bypass…' | 1792 ms | 1833 ms |
   | methodology 'its declared boundary holds…'                     | 1235 ms | 1536 ms |
   | workflows 'its declared boundary holds…'                       | 1820 ms | 1398 ms |
   | kpi 'its declared boundary holds, and a planted bypass…'       | 1938 ms | 1373 ms |
   | evidence 'its declared boundary holds'                         | 485 ms  | 335 ms  |

   The `package dependency direction` block also keeps its 30 s budget. It is not the reported test.

### Regression test, and its failing-before and passing-after output

- **The load timeout is not reproduced.** The assignment forbids recreating review load (D-164). The evidence is instead:
  1. the before and after durations alone, in the next table;
  2. the 150 s budget against the 67.0 s worst loaded case: 2.24x headroom, before counting the speed-up;
  3. the existing controls passing unchanged.
- **New guard test** `architecture.test.ts:1078-1134`, 'rule 4 reports exactly the diagnostics of a full ts.transpileModule, for every extension (F-DG5-102/145)'. It covers 10 sources × 8 extensions (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`):
  - valid sources, syntax errors (including P20's parser-recovery case), JSX, a type annotation (an error only in JS-kind files), top-level await with no import or export (module detection), a regex `v` flag and an octal literal (target-dependent), an unterminated template, and an enum with a parameter property;
  - plus every module's real `index.ts`.

  It asserts equality with a plain full `ts.transpileModule`. It also asserts that it is not vacuous: errors appear in more than 10 cases, and a type annotation is an error in `zz.js` and not in `zz.ts`.
  - **Before:** the test cannot exist on the old tree, because `syntaxErrors` was not exported.
  - **After:** it passes (353–682 ms in the after-runs).
- **Mutation check of the guard** (`guard-mutation-check.log`; the testkit was backed up and restored byte for byte, `cmp` OK):
  - **Mutation B** (rule 4 reads a TS-kind parse instead of transpile's): `× … rule 4 reports exactly …`, `AssertionError: .js: import { x } from "./a.ts"`, exit 1. **Caught.**
  - **Mutation A2** (target ES5): fails with `+ "unparseable source: Option 'target=ES5' is deprecated …"`, exit 1. **Caught**, so the options diagnostics are compared.
  - **Mutation A** (target ES2015) **survives** (exit 0). Disclosed: in TypeScript 6.0 no *syntactic* diagnostic of this corpus depends on the target. The target-gated checks, such as regex flags, are checker diagnostics, which rule 4 never read, before or after. So it is an equivalent mutant for rule 4 on this corpus. That is not a proof for every possible source; the wider differential below is the stronger evidence.
- **Wider differential** (`profile-and-differential.log`): every one of the 448 module files, in four variants (as-is, cut in half, trailing `)}{`, an injected `(`) × six extension forms. That is 10,752 cases, 8,888 of them with syntax errors, and **0 differences** between the old full `transpileModule` and the new `syntaxErrors`, on both Node 24 and Node 22.
- **Existing negative and positive controls:** all 139 pre-existing tests in `architecture.test.ts` pass unchanged after the change (140/140 including the guard). Among them are the planted violations A–P20 and the evasion, allow-list, `.d.ts`, `.mts`/`.jsx` (F-DG1-134), F-DG1-217/218 and rule-5 controls. They were not edited: `git diff apps/api/src/architecture.test.ts` changes no existing test line except the budget argument of the full-walk test.

### Measurements: 'every import respects …' alone

Command: `npx vitest run --project unit-node apps/api/src/architecture.test.ts --reporter=verbose`, one run at a time. Load average at the start of each run is in brackets.

| Node    | Before (3 runs)                                                                       | After (3 runs)                                                                         |
| ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 24.21.0 | 7723 ms [2.26], 8378 ms [2.78], 8096 ms [3.28]; mean 8066 ms; 139/139, exit 0 each      | 5726 ms [3.74], 6007 ms [3.98], 6005 ms [3.62]; mean 5913 ms; 140/140, exit 0 each      |
| 22.22.2 | 10292 ms [3.50], 8895 ms [5.07], 8891 ms [5.76]; mean 9359 ms; 139/139, exit 0 each     | 5991 ms [3.54], 7099 ms [3.99], 7098 ms [4.93]; mean 6729 ms; 140/140, exit 0 each      |

That is −27% on Node 24 and −28% on Node 22 at comparable load. The concurrent tasks BE-Y1 and FE-Y1 were running on the same machine throughout, so no run is fully unloaded.

Logs: `before-architecture-alone-node{24,22}-run{1,2,3}.log`, `after-architecture-alone-node{24,22}-run{1,2,3}.log`.

### Measurements: the whole `unit-node` project

| Run                                                        | Files   | Tests     | Duration | 'every import …' inside it | Exit |
| ---------------------------------------------------------- | ------- | --------- | -------- | -------------------------- | ---- |
| before, Node 24, locale unset (load 5.84 → 9.14)           | 144/144 | 2340/2340 | 115.26 s | 13636 ms                   | 0    |
| after, Node 24, locale unset (load 6.40 → 9.11)            | 144/144 | 2341/2341 | 117.50 s | 8569 ms                    | 0    |
| after, Node 24, `C.UTF-8` (load 9.11 → 7.75)               | 144/144 | 2341/2341 | 105.38 s | 7853 ms                    | 0    |
| after, Node 22, locale unset (load 7.75 → 8.25)            | 144/144 | 2341/2341 | 115.33 s | 10917 ms                   | 0    |
| after, Node 22, `C.UTF-8` (load 8.25 → 6.98)               | 144/144 | 2341/2341 | 106.68 s | 8671 ms                    | 0    |

- The project's wall time is not materially changed. It is dominated by other suites and by machine load, and this test runs in parallel with them. The +1 test is the new guard.
- Every run had one `stderr |` block, from `apps/api/src/modules/admin/branding.test.ts`. It was present before and after, it is unrelated to this change, and no test failed.
- No run contains 'timed out' or a vitest RPC timeout.

Logs: `before-unit-node-node24-unset.log`, `after-unit-node-node{24,22}-{unset,cutf8}.log`.

## 3. Checks actually run

All were run once each, one at a time, with Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.

| Check                                                                                       | Result                                                                                                                                       | Log                          |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `node tools/gates/validate.mjs --historical --stage DG4`, at start and at end                 | `PASS gate DG4 (historical)`, exit 0, both times                                                                                               | (console)                    |
| `pnpm -r typecheck`                                                                         | exit 0                                                                                                                                       | `checks-typecheck.log`       |
| `pnpm -r build`                                                                             | exit 0; no testkit in `apps/api/dist`                                                                                                        | `checks-build.log`           |
| `pnpm lint` (`eslint . --max-warnings=0`)                                                   | exit 0                                                                                                                                       | `checks-lint.log`            |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0, 'All matched files use Prettier code style!'. Run before this handback was written, and again after (see §7).                          | (console)                    |
| `pnpm openapi:lint`                                                                         | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations`, exit 0                                                                          | `checks-openapi-lint.log`    |
| `unit-node` × {Node 24, Node 22} × {locale unset, `C.UTF-8`}                                  | 2341/2341 each, exit 0 each (table above)                                                                                                    | `after-unit-node-*.log`      |
| `architecture.test.ts` alone, 3× on each Node version, before and after                        | all exit 0 (table above)                                                                                                                     | `*-architecture-alone-*.log` |
| The five module-owned boundary tests alone, on Node 24 and Node 22                            | exit 0 each, 0.3–1.9 s                                                                                                                       | `before-module-boundary-tests-alone.log` |
| Guard mutation check                                                                        | B and A2 caught (exit 1); A survives (equivalent mutant, disclosed above)                                                                     | `guard-mutation-check.log`   |
| Profile and rule-4 differential, Node 24 and Node 22                                          | 10,752 cases, 0 differences, exit 0                                                                                                           | `profile-and-differential.log` |

**Not run, D-164:** repository-wide `pnpm test` (`unit-web` and `unit-formula-nocodegen` included), `pnpm test:integration`, and the full e2e suite. My change reaches only the `unit-node` project: two test-only files, excluded from the build. No integration path or e2e spec imports them.

Before the tests I removed the one empty `.cc-writes` directory in a source folder (`apps/api/.claude/.cc-writes`, plus its then-empty parent), using `rmdir`.

## 4. Contract, schema and dependency needs

None. No API operation, response shape, migration, schema or dependency changed, and no new dependency was added. `typescript` was already a devDependency of `@mth/api`.

## 5. ADR and data-dictionary statements made untrue or incomplete (for T-DG5-ARCH-R6)

- No ADR states the per-test budget of the full module walk, or that rule 4 emits JavaScript. I found no statement that is now untrue. My search: `grep -rn "transpileModule\|AST_TEST_TIMEOUT\|30 s budget\|30_000" docs/architecture` gave no hit about this test.
- **Optional completeness note** for whoever documents ADR-0002's enforcement:
  - the full-tree boundary test has its own 150 s budget (D-174);
  - rule 4 takes `ts.transpileModule`'s diagnostics without printing its output.
- The data dictionary is not affected.

## 6. User-facing texts

None changed, and none made untrue. The change is test-only, with no en or ar string involved.

## 7. What remains

- **For the orchestrator:**
  - integrate the two files;
  - run the repository-wide `pnpm test`, `pnpm test:integration` and e2e once on the merged tree (not run here, D-164).
- **For the round-4 reviewers (code-security F-DG5-102, qa F-DG5-145):** the loaded behaviour, under the review load, can only be verified by them.
- **Not mine:** the D-174 `demo.test.ts` teardown budget belongs to T-DG5-BE-Y1. Its assignment carries it, and the demo tests are outside my ownership.
- **Formatting of this handback:** I formatted it with `npx prettier --write` and then re-ran the whole-tree check (`git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`), with this handback and the evidence directory present. Every batch printed 'All matched files use Prettier code style!' and xargs exited 0. Nothing remains beyond the orchestrator and reviewer steps above.
