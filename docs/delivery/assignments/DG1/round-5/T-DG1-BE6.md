# Assignment T-DG1-BE6: backend round-5 repair — module-lint dynamic-loader ban (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-5 repair). **Base revision:** current `HEAD` (≥ `e080c0d`). Dedicated git worktree; `node_modules` present; run **offline**; no `pnpm install`. Write ONLY `apps/api/**`.

## Finding

### F-DG1-124 (Low) — the module dependency-lint still misses an obfuscated dynamic loader
Follow-on to F-DG1-117/121: the lint in `apps/api/src/architecture.test.ts` catches literal `createRequire`, computed `import()/require()`, `new Function`, and an aliased function-`.constructor`, but is still evaded by a **constructed (non-literal) key**, e.g. `f["constr" + "uctor"]` or `Reflect.get(fn, "constr".concat("uctor"))`. Chasing each new spelling has not converged (117 → 121 → 124).

**Fix robustly, to end the cat-and-mouse:** rather than matching ever-more construction patterns, make the lint **statically ban the dynamic-code-loading primitives outright in module source** (`apps/api/src/modules/**`). Flag any occurrence (as an identifier/member/string used to reach these) of: `eval`, the `Function`/`AsyncFunction`/`GeneratorFunction` constructors, `require`, `createRequire`, `process.getBuiltinModule`, `module.constructor`, `.constructor` of a function, `import(` with a non-literal, `Reflect.get`/computed member used to reach `constructor`, and `globalThis`/`process` indexing used to reach them. P1 module code has no legitimate need for runtime code loading, so a blanket ban is correct and will not need another pattern added later. Keep the existing literal-import boundary checks. Allow the check to run on the real module tree with **zero** findings (confirm no legitimate code trips it; if something does, that itself is worth surfacing). Add planted cases covering `f["constr"+"uctor"]`, `Reflect.get(fn,"constructor")`, and at least one prior form, each failing on the old lint and passing on the new; keep `architecture.test.ts` green on the real tree.

## Self-verification (offline)
`pnpm -r typecheck`, `pnpm lint`, `pnpm test` (incl. architecture.test.ts) — green on the real tree; the planted cases fail-before/pass-after. Anything you cannot run is BLOCKED.

## Handback
`docs/delivery/handbacks/DG1/round-5/T-DG1-BE6-backend-workflow-engineer.md` — the approach, the planted cases, real output; changed files.
