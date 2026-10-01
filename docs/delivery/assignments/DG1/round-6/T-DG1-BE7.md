# Assignment T-DG1-BE7: F-DG1-125 module-lint native-loader import bypass (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-6 repair). **Base:** current `HEAD` of this working tree. `node_modules` is present; run **offline**; do **not** run `pnpm install`.
- Fix **only** F-DG1-125 (full text in `docs/delivery/findings.json`). Edit **only** these two files:
  - `apps/api/src/architecture.testkit.ts`
  - `apps/api/src/architecture.test.ts`
  Do **not** touch any module source, any other product code, `tools/**`, `docs/source/**`, reviews or gate records. You may write your handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-125, Low, REQ-S16-003)
The module lint's rule 3 flags the native loaders `process.binding` / `process._linkedBinding` / `process.dlopen` only when the member's root is the **literal global identifier** `process` (via `rootName`, which recognises `process`/`globalThis`/`global`). An **import of `node:process`** aliases the process object to a local binding that `rootName` does not recognise, so all three native loaders are reachable from module source with **zero violations**:
- `import proc from "node:process"; proc.dlopen(...)` — 0 violations (X6)
- `import proc from "node:process"; (proc as any).binding("fs")` — 0 violations (X7)
- `import { dlopen } from "node:process"; dlopen(...)` — 0 violations (X8)
The testkit header claims rules 1–2 "remove every syntactic route inside module source", so this is a real gap in a stated guarantee (defence-in-depth lint, ADR-0002), though Low: the real module tree contains no such import and these primitives are not JS-module loaders.

## Required fix (surgical)
In `architecture.testkit.ts`, add the process module specifier to `LOADER_BUILTINS` so `bareAllowed()` returns `false` for it and **any import of process in module source becomes a specifier violation** (`imports package node:process` / `imports package process`). Add **both** spellings: `"process"` and `"node:process"`. This closes the default, namespace **and** named import routes at once (every one needs `import … from "node:process"|"process"`). `process` is a Node global — no module needs to import it (a repo-wide grep finds zero imports), so this has no legitimate-use cost.
- Keep rule 3 (`PROCESS_LOADERS`, the `root === "process"` member checks) **unchanged** — it still covers the global-identifier form (self-check P12) and the runtime-root-as-value checks.
- Update the lint's header doc (the `LOADER_BUILTINS` comment and rule 3's description around lines 50–55 / 29–31) to state that importing `process`/`node:process` is itself banned (the global object remains covered by rule 3), so the stated guarantee matches the code.

## Required self-check additions (in `architecture.test.ts`)
Add X6–X8 to the self-check table (the F-DG1-124 `it.each` block is fine; a 4th "missed/caught" column, use `"missed"`), each asserted a violation:
- `X6 node:process default import .dlopen` → source `import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");` → `/imports package node:process/`
- `X7 node:process default import .binding` → source `import proc from "node:process";\nconst fs = (proc as any).binding("fs");` → `/imports package node:process/`
- `X8 node:process named import dlopen` → source `import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");` → `/imports package node:process/`
Keep P12 (`(process as any).binding("fs")` → `module loader via process.binding`) as a regression guard for the global form.

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — the **whole** architecture suite is green, including the self-check table (X6–X8 and P12) **and** the real-module-tree check (`moduleViolations` zero for every module). If a tool/DB is missing, that is BLOCKED (but this suite needs neither).
- `pnpm --filter @mth/api run typecheck` (or the repo typecheck) — no type break from the edited files.
- `grep -rn "node:process\|from \"process\"" apps packages` — still **no** import of process in source (so the real tree stays green).

## Handback
`docs/delivery/handbacks/DG1/round-6/T-DG1-BE7-backend-workflow-engineer.md` — the exact diff of the two files and why, plus the real vitest output (self-check incl. X6–X8 + module-tree) and the typecheck output.
