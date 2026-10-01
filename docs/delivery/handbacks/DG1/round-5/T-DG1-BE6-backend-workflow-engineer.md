# Handback T-DG1-BE6: module-lint dynamic-loader ban (F-DG1-124)

- **Agent:** backend-workflow-engineer. **Stage:** P1 / DG1, round-5 repair.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE6-backend-workflow-engineer-20261001T110142Z-e7c752b2","session_id":"e7c752b2-8bb0-46d6-a630-ba73f54070b0"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-5/T-DG1-BE6.md`, sha256 `705e8ef5…eff254` (verified before starting).
- **Base revision:** `e080c0deea90b94dd088ee1c80251c7ab64d0a80` (HEAD at start). Dedicated worktree, offline, no `pnpm install`.
- **Not committed.** The changes are in the working tree for the orchestrator to integrate.
- **Out-of-`apps/api` writes:** only this handback and its sibling evidence directory, `T-DG1-BE6-evidence/` (same pattern as `T-DG1-DEVOPS-evidence`).
- No migrations and no API endpoints were added or changed. There are no business approvals (G1–G6) involved, and nothing here bears on DG7.

## Approach: a blanket ban instead of pattern matching

The lint in rounds 117 → 121 → 124 recognised *spellings* of the same bypass. A constructed key such as `f["constr"+"uctor"]` can spell any of them, so pattern matching cannot converge. Instead, `apps/api/src/architecture.testkit.ts` (`scanSource` / `fileViolations`) now bans the **building blocks** in module source. Every route to a dynamic-code primitive must use at least one of them.

1. **Banned names in every syntactic form outside type positions.** Forms covered: identifier, `.member`, `["key"]`, any string literal (module specifiers excepted), object or destructuring key, and import/export name.
   - **Code evaluation:** `eval`, `Function`, `AsyncFunction`, `GeneratorFunction`, `AsyncGeneratorFunction`, `constructor`
   - **Module loaders:** `require`, `createRequire`, `getBuiltinModule`, `mainModule`, `_load`
   - **Reflection:** `Reflect`, `getPrototypeOf`, `__proto__`, `getOwnPropertyDescriptor(s)`, `getOwnPropertyNames`, `__lookupGetter__`, `__lookupSetter__`. These read a property by a runtime name, or expose the prototype and non-enumerable keys where `constructor` lives.
   - Exceptions: a class's own `constructor() {}` (it has no name node) and type space (interfaces, type aliases, type nodes) stay legal. A class `extends` expression is treated as a value.
2. **Uncheckable keys.** Any computed member `x[k]` or computed property name `{[k]: v}` / `{[k]: v} = x` is a violation unless its key is one of:
   - a string or number literal (its text is then checked by rule 1), or
   - numeric by construction (`a.length - 1`, `-i`, `i++`, `* / % ** & | ^ << >> >>>`).

   Only parentheses are looked through, because a type assertion can lie about a key's value. This rule closes constructed keys outright: `+`, `.concat`, `.join`, template substitutions and variables.
3. **Runtime roots.**
   - Kept: `process`/`globalThis`/`global` used other than as `root.member`; any indexing of them; `globalThis.<root>`.
   - New: `process.binding`, `process._linkedBinding` and `process.dlopen`, and the CommonJS free variable `module` as a value.
4. **Fail closed.** A module file with a syntax error is a violation (`syntaxErrors()`, using syntactic diagnostics only). I found this one while writing plants: in `(async () => {} as any)[k]`, the parser's error recovery reread `[k]` as a binding pattern, and the old and new rules both saw nothing (plant P20).
5. **Kept unchanged:** the literal-import boundary checks, computed `import()`/`require()`, and the loader built-ins. Those built-ins are now `module`, `vm`, `worker_threads`, plus new `inspector` (+`/promises`), `repl`, `child_process` and `cluster`, each with or without `node:`.

**Residual limit (not closable by a static lint):** a string computed **at runtime** can be handed to third-party code that itself does `input[key]`, for example a schema library given `Object.fromEntries([[k, …]])`. That is data flow, which the lint cannot follow. The rules above remove every *syntactic* route inside module source. This is stated in the lint header. I am not claiming completeness beyond it.

## Real module tree: what the new lint tripped on (surfaced, then fixed)

I ran the new lint on `apps/api/src/modules/**` before touching any module code. It flagged 6 legitimate sites and nothing else. `items[items.length - 1]` in `platform/cursor.ts` is numeric, so it passes.

| Site | What | Fix (behaviour-preserving) |
|---|---|---|
| `access/rules.ts:49` | `PERMISSIONS[permission]` | module-level `Map(Object.entries(PERMISSIONS))` lookup |
| `identity/routes.ts:104`, `:256` | `request.cookies[cookieName]`, `request.cookies[loginCookie]` | `cookieValue()` helper: `new Map(Object.entries(request.cookies)).get(name)` (own entries only; names are server constants) |
| `platform/cursor.ts:17` | `(value as Record)[k]` in `canonical()` | `Object.entries(...).sort(([a],[b]) => a<b?-1:a>b?1:0)`: same UTF-16 code-unit order as `Object.keys().sort()`, so cursor hashes are unchanged |
| `transformations/routes.ts:72` | `TRANSFORMATION_STATUS_TRANSITIONS[from]` | `STATUS_TRANSITIONS` Map; `?.includes(to) ?? false` |
| `transformations/routes.ts:93` | `SORTS[query.sort]` | `SORTS` is a `Map<string, SortSpec>`; a missing entry throws (unreachable, because `listQuery` enumerates the same six keys) |
| `kpi/kpi.test.ts:55` | the string literal `"createRequire"` in a self-check assertion | `toMatch(/createRequire/)`. The rule bans that exact string even in tests; it was harmless here, and I'm reporting it rather than exempting tests |

After these fixes the real tree has **zero** findings (`architecture.test.ts` › "every import respects dependsOn…" plus the kpi, reporting and workflows boundary tests).

## Planted cases (`architecture.test.ts`, new `it.each` P1–P20)

The "Round-4 lint" column is **measured, not asserted**. I ran the *new* test file against the round-4 testkit (`git show HEAD:apps/api/src/architecture.testkit.ts`, through temporary copies that were deleted afterwards) and logged `fileViolations(...).length` for each plant. The results are in `T-DG1-BE6-evidence/round4-lint-violation-counts.tsv` and `round4-lint-vs-new-plants.log`.

| # | Plant | Round-4 lint (violations) | New lint |
|---|---|---|---|
| P1 | `(f as any)["constr" + "uctor"]` | **0 — missed** | non-literal key ✓ |
| P2 | `Reflect.get(fn, "constructor")` | 1 — caught (a prior form; F-DG1-121 N8) | `reflection via Reflect` ✓ |
| P3 | `Reflect.get(fn, "constr".concat("uctor"))` | **0 — missed** | ✓ |
| P4 | key in a variable (`["constr","uctor"].join("")`) | **0** | ✓ |
| P5 | template-literal key | **0** | ✓ |
| P6 | optional-chain `?.["constr"+"uctor"]` | **0** | ✓ |
| P7 | `const { [k]: C } = fn` | **0** | computed property name ✓ |
| P8 | `Object.values(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(async()=>{})))[0].value` (never spells `constructor`; checked in node that it yields `AsyncFunction`) | **0** | ✓ |
| P9 | `getOwnPropertyNames(proto)[0]` then `proto[k]` | **0** | ✓ |
| P10 | `.__proto__` | **0** | ✓ |
| P11 | `pick(lib, "createRequire")` | **0** | ✓ |
| P12 | `process.binding("fs")` | **0** | ✓ |
| P13 / P14 | `node:inspector`, `node:child_process` | **0** | ✓ |
| P15 | `o.eval(...)` (an allowed form in round 4) | **0** | ✓ |
| P16 | `shape({ constructor: 1 }).parse(proto)`: a key fed to a keyed reader (an allowed form in round 4) | **0** | ✓ |
| P20 | syntax error hides the key (fail closed) | **0** | ✓ |
| P17 | `module.constructor` | 1 — caught | ✓ |
| P18 | aliased `.constructor` (F-DG1-121 N1) | 1 — caught | ✓ |
| P19 | `new Function(...)` (F-DG1-117 M) | 1 — caught | ✓ |

16 plants are missed by the round-4 lint (0 violations) and caught by the new one. 4 plants (P2, P17–P19) are prior forms the round-4 lint already caught. They are regression guards, so they cannot "fail before". Note that P2, `Reflect.get(fn,"constructor")`, as named in the assignment, was **already caught** in round 4. Its constructed-key variant P3 was not.

**Changes to existing tests (in the open):**
- All old plants (A–N8) are still detected.
- 5 regexes were updated to the uniform new messages: D3, L, L3, M4 and N6. For example, `createRequire .* bypasses` became `module loader via \.createRequire\(\) .* bypasses`. Each still asserts the specific detection.
- Two old "allowed" forms are now **violations by design**, because the ban is blanket: `{ eval: 2, Function: 3 }` / `o.eval`, and `{ constructor: "Cls" }`. They moved to P15 and P16.
- New clean cases cover:
  - type-space uses (`interface I { constructor; eval(); require }`, `typeof Reflect`, `"constructor"` literal type);
  - numeric and literal keys (`xs[xs.length - 1]`, `xs[0]`, `{a:1}["a"]`);
  - `Map.get`;
  - `{ module: "kpi" }.module`.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Rewrote the lint: blanket ban (rules 1–4 above), new header, `BANNED_PRIMITIVES` / `PROCESS_LOADERS` / `NUMERIC_OPERATORS`, `isStaticKey`, `isTypeSpace`, `occurrence`, `syntaxErrors`. Removed the F-DG1-121 pattern helpers (`isConstructorKey`, `inAssignmentPattern`) |
| `apps/api/src/architecture.test.ts` | Header and describe title; P1–P20 table; 5 updated regexes; clean set revised |
| `apps/api/src/modules/access/rules.ts` | Permission-category lookup through a `Map` |
| `apps/api/src/modules/identity/routes.ts` | `cookieValue()` helper replaces two computed cookie reads |
| `apps/api/src/modules/platform/cursor.ts` | `canonical()` uses `Object.entries` (same order and output) |
| `apps/api/src/modules/transformations/routes.ts` | Status transitions and `SORTS` through a `Map` |
| `apps/api/src/modules/kpi/kpi.test.ts` | Assertion uses a regex instead of the banned string literal |

## Checks actually run (worktree, Node v22.22.2, offline, final tree)

| Command | Result | Evidence |
|---|---|---|
| `pnpm -r typecheck` | 7 of 8 projects Done, `EXIT=0` | `T-DG1-BE6-evidence/typecheck.log` |
| `pnpm lint` (`eslint . --max-warnings=0`) | `EXIT=0` | `lint.log` |
| `npx prettier --check apps/api/src` | All matched files use Prettier code style | (console) |
| `pnpm test` (unit-node + unit-web) | **Test Files 21 passed (21), Tests 267 passed (267), `EXIT=0`**; `architecture.test.ts (74 tests)` ✓, `kpi.test.ts (5 tests)` ✓ | `test.log` |
| `pnpm test:integration` (not required by the assignment; run because 4 runtime files changed) | **Test Files 19 passed (19), Tests 200 passed (200), `EXIT=0`** | `test-integration.log` |
| Fail-before: new `architecture.test.ts` against the round-4 testkit | `Tests 23 failed \| 51 passed (74)`; per-plant counts as in the table above | `round4-lint-vs-new-plants.log`, `round4-lint-violation-counts.tsv` |

**Integration environment:**
- Database: a disposable PostgreSQL 16.13 cluster, created by `initdb` under the run's `$TMPDIR` inside a user namespace (`unshare -U --map-user=1000`).
- Connection: TCP only on `127.0.0.1:5491` with `unix_socket_directories=''`, because the sandbox refuses Unix sockets. `TEST_DATABASE_ADMIN_URL=postgresql://postgres@127.0.0.1:5491/postgres`.
- The cluster was started and stopped within the same command.
- The first attempt failed with `ECONNREFUSED` (and the resulting "No test files found") because the server did not outlive the previous shell call. That was not a test result. The rerun above is the result.

The rewritten paths are covered by existing suites:
- sort: `transformations.test.ts`, `contract.test.ts`
- cookies: `identity.test.ts`, `oidc.test.ts`
- permission category: `access/rules.test.ts`
- cursor: `platform.test.ts`
- transitions: `transitions.test.ts` plus integration

## Known gaps / not done

- The residual third-party data-flow limit described above. It is inherent to static analysis and documented in the lint header.
- I did not add new tests specifically for the 4 runtime refactors. They are covered by the existing unit and integration suites listed above, which pass unchanged.
- Rule 2 is deliberately strict. Future module code that needs a runtime-keyed lookup must use a `Map` (or an `Object.entries` scan), not `obj[key]`. This is a new convention, stated in the lint header. Reviewers may want it recorded as a decision.

## Merge instructions

- No migrations and no dependency changes. Apply the 7 `apps/api/**` files together: the testkit, the test and the module refactors are interdependent, because the real-tree check fails if the lint lands without the refactors.
- Expect conflicts only if another round-5 task edits `architecture.test.ts` / `architecture.testkit.ts` or the 5 touched module files.
