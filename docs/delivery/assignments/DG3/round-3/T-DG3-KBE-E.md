# Assignment T-DG3-KBE-E: repair F-DG3-100 (second pass): a spelling-independent guard for the formula engine (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 2 reviewed), repair before review round 3.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-e`.
  - Its `HEAD` is the round-2 candidate `58ef3f47` (source `f49ca16`) plus the round-2 review records, which are not candidate content.
  - `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** T-DG3-FE-G runs alongside you in its own worktree.
  - It owns `apps/web/**`.
  - You own:
    - `eslint.config.js`, the formula-engine block(s) only;
    - `packages/shared/src/formula/**`, tests and test helpers only. The engine sources may change only if a new lint rule forces a mechanical change, and their behaviour must not change;
    - `vitest.config.ts`;
    - `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6;
    - one appended item in `docs/architecture/p3-work-split.md` §9.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 60 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`, and Node 22.22.2 at `/opt/node22/bin`. Run offline.
  - **Your harness ports, if you need any, are 23100–23149 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The finding and the round-2 verification

**F-DG3-100 (Low, REQ-PB-056)** stays OPEN. The code-security reviewer's round-2 verification FAILED it. Read it in full in `docs/delivery/reviews/DG3/round-2/code-security-reviewer.verifications.json`, with its probes and logs in `docs/delivery/test-evidence/DG3/code-security/round-2/`:
- `probes/guard-bypass-probe.mjs` and its log;
- `probes/residual-runtime.mjs` and its log;
- `residual-runtime-disallow-codegen.log`.

Your T-DG3-KBE-D repair, merged in `011654d`, refuses the five spelled round-1 forms. Both guards are still **denylists keyed on spellings**, though, and the reviewer found these forms that pass eslint and the scan:
- `globalThis['ev'+'al']` (O2), which only the scan catches;
- N1–N11:
  - a `'constructor'` key held in a variable;
  - `'con' + 'structor'`;
  - `getOwnPropertyDescriptor(…, 'constructor')`;
  - computed destructuring;
  - the AsyncFunction constructor reached through a prototype;
  - a tagged template;
  - `global[…]` and `self[…]`;
  - `process.getBuiltinModule('node:vm')`;
  - static imports of `node:inspector` and `node:repl`.

Nine of these return 42 for `'6*7'` on Node 22 and Node 24. ADR-0024 §6 "Extended guard" claims more than is enforced.

A static denylist cannot be complete for JavaScript, because a key can be assembled at run time. The repair therefore adds a guard that **does not depend on spelling**, closes the module-loading class with an **allowlist**, and makes ADR-0024 §6 say exactly what is enforced.

## The repair

1. **The run-time guard, which is the core of the fix.**
   - Run the formula engine's whole test corpus in a Node process started with `--disallow-code-generation-from-strings`. That corpus is `formula.test.ts`, `fuzz.test.ts`, and anything else under `packages/shared/src/formula/**`.
   - Under that flag, `eval` and every `Function`, `AsyncFunction` or `GeneratorFunction` construction from a string throws `EvalError`, however the constructor was reached.
   - **Prefer** a dedicated vitest project (for example `unit-formula-nocodegen`, using the `forks` pool with `execArgv: ["--disallow-code-generation-from-strings"]`) that is part of `pnpm test`, so every contributor, CI and every reviewer runs it.
   - If vitest's own runtime cannot run under the flag, use a plain `node --disallow-code-generation-from-strings --test` runner over the built `@mth/shared` engine, wired into `pnpm test`. Explain why you chose it.
   - Add a **canary test** in that project. It asserts that, in that process:
     - `new Function("return 1")` throws `EvalError`;
     - `eval("1")` throws `EvalError`;
     - the AsyncFunction constructor reached through `Object.getPrototypeOf(async () => {}).constructor` throws `EvalError`.

     The canary proves the flag is active, so the guard cannot silently disappear.
   - The engine's existing tests must pass unchanged in this project, as well as in the normal one.
2. **Module loading: an allowlist, not a denylist.**
   - For the engine sources (non-test files under `packages/shared/src/formula/**`), `no-restricted-imports` must allow only relative imports and `decimal.js`, plus any workspace import the engine already uses (list them). Everything else is refused, including `node:*`. Use patterns with negation, or an equivalent.
   - Refuse the globals `process`, `global`, `globalThis`, `self` and `window` in the engine sources, unless the engine uses one. If it does, explain why and refuse its dangerous members instead.
   - The test files may keep the access they need, such as the tripwire's `globalThis.Function`, in a separate block, with the existing justified disables.
3. **Constructor keys, as defence in depth.** Refuse any string literal, template element or identifier equal to `constructor` in the engine sources (`Literal[value='constructor']`, `TemplateElement[value.cooked='constructor']`, and the existing `.constructor` rule).
4. **The scan.** Mirror items 2 and 3 in `fuzz.test.ts`'s `scanSource()`: non-allowlisted imports, those globals, and `constructor` literals. Extend the probe table with the reviewer's forms O2 and N1–N11.
5. **The record.** Rewrite ADR-0024 §6 "Extended guard" so it states exactly what each layer guarantees:
   - the static layer is a best-effort denylist for the common forms, plus the import allowlist;
   - the run-time layer means any engine path that generates code from a string fails the engine's tests;
   - the residual is that a path no test exercises is caught only by the static layer;
   - in production, the web's CSP (`script-src 'self'` with no `'unsafe-eval'`, set in `apps/api/src/server.ts`) refuses string code generation in the browser. Verify this claim before you write it.

   Add one item to `docs/architecture/p3-work-split.md` §9, under a new heading for the round-3 repair. The existing items end at 24.

## Proof (real output in the handback)

**Run the reviewer's probes as read-only evidence** in a disposable copy (`$TMPDIR`), never in your tree, and never edit the reviewer's files. For each form (the six round-1 forms O1–O6, and N1–N11), report which layer refuses it: lint, scan, run-time (`EvalError` in the no-codegen project), or none.

- **Expected:** every form is refused by at least one layer.
- N8 (`self`) is browser-only. Show that the static `self` ban covers it.
- If any form is refused by no layer, say so plainly. Do not hide it.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes on Node 24 and Node 22, with the locale unset and with `C.UTF-8`.
   - Report the counts, including the new project's.
   - The round-2 baseline is 1565 tests.
3. `npx eslint packages/shared/src/formula/` exits 0 on the shipped engine.
4. The per-form table above.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-E-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-E-evidence/`. Leave your changes uncommitted for the orchestrator to integrate.
