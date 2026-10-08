# Assignment T-DG3-KBE-D: repair F-DG3-100: close the formula engine's "no dynamic code" guards (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (FIXING), repair before review round 2.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-d`, at the integrated `HEAD`, which is the round-1 candidate plus the review records. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** ARCH-05 runs alongside you. It owns the contract, `apps/api/src/modules/workflows/gates.ts`, `packages/shared/src/schemas/gate.ts` and the web Gates pages. Don't touch those.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 30–45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - **Your harness ports are 23150–23199 only, if you need any.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The finding

**F-DG3-100 (Low, REQ-PB-056, raised by code-security).** Read it in full: `docs/delivery/reviews/DG3/round-1/code-security-reviewer.findings.json`.

- **What is wrong.** The formula engine itself has no dynamic code. But its two guards, the ESLint override for `packages/shared/src/formula/**` in `eslint.config.js` and the `fuzz.test.ts` source scan, both **accept** forms that build and run code from a string:
  - `Reflect.construct(Function, [...])`;
  - `Reflect.apply(Function, null, [...])`;
  - an aliased `Function` (`const F = Function; F("…")`);
  - a computed `["constructor"]` member call (e.g. on a generator function's prototype);
  - `createRequire(import.meta.url)("vm")`, and `require(...)`.
- **What ADR-0024 §6 says.** The override "enforces" that nothing in the engine evaluates text, and the scan backs it up.

## The repair

1. **The ESLint override.** Extend the `packages/shared/src/formula/**` override block in `eslint.config.js` (your own block, and the only edit to that file) so that every form in the finding fails lint:
   - `no-restricted-globals` for `Function`, `eval` and `Reflect`, if the engine doesn't need `Reflect`; check this, and if it does, restrict only `Reflect.construct` and `Reflect.apply` with `Function`;
   - `no-restricted-syntax` selectors for an `Identifier[name='Function']` used as a value, for computed `MemberExpression` with the literal property `constructor`, and for `CallExpression` callee `createRequire` / `require`;
   - `no-restricted-imports` for `node:module` / `module`;
   - keep every existing rule, including the `parseFloat` ban the block repeats.
2. **The source scan** (`packages/shared/src/formula/fuzz.test.ts`). Extend its patterns to catch the same forms: `Reflect.construct`, `Reflect.apply`, a `Function` identifier outside comments, `["constructor"]`/`['constructor']`, `createRequire`, `require(` and `node:module`. Keep it free of false positives on the engine's real source.
3. **Proof.**
   - Write a lint probe: a temporary file under `packages/shared/src/formula/` containing **each** bypass form from the finding. Lint must fail on every one. Show the per-form errors, then delete the probe. Do the same for the scan, with an in-memory string the scan function is given, if it can be refactored to take one, or a temporary file.
   - The engine's real source still lints clean, and the full unit suite passes.
   - Keep the logs.
4. **Record.** Add one line to ADR-0024 §6 listing the extended guard, and one to `docs/architecture/p3-work-split.md` §9.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. The lint probe fails as intended on each form, and then is removed.
3. `pnpm test` passes with the locale unset and with `C.UTF-8`.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-D-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-D-evidence/`. State the fix for F-DG3-100 and how to verify it.
