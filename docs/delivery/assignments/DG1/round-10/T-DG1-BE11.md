# Assignment T-DG1-BE11: F-DG1-130 — a native-loader MEMBER of an allow-listed built-in (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-10 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`.
- Fix **only** F-DG1-130 (full text in `docs/delivery/findings.json`). Edit **only**:
  - `apps/api/src/architecture.testkit.ts`
  - `apps/api/src/architecture.test.ts`
  No module source, other product code, `tools/**`, `docs/source/**`, reviews or gate records. Handback under `docs/delivery/handbacks/**`.

## The finding (F-DG1-130, Low, REQ-S16-003)
The round-9 default-deny redesign allow-lists safe `node:` built-ins, but it guards the SPECIFIER, not the MEMBERS of an allowed module. `node:crypto` is allow-listed (modules use `randomUUID` etc.), yet `crypto.setEngine(<path>)` `dlopen()`s an arbitrary shared object (its ELF constructor runs before the call throws) — the `process.dlopen` / `node:sqlite` loadExtension class. `import { setEngine } from "node:crypto"; setEngine(p)` and the namespace form both pass the lint with **0 violations**, so the header's claim that no allow-listed built-in "loads native objects" is false on Node 22. Low/non-mandatory (static defence-in-depth lint, no module uses setEngine).

## Required fix
1. **Ban `setEngine`** by adding it to `BANNED_PRIMITIVES` (rule 1) with the kind label `"native loader"`. Rule 1 then flags `crypto.setEngine` (the member name), the namespace form `c.setEngine`, a destructured `{ setEngine }`, and the `"setEngine"` string/computed-key forms — every syntactic route, like the existing `constructor`/`require` entries. No module defines or uses a `setEngine` identifier (grep to confirm), so there is no legitimate-use cost.
2. **Exhaustively audit the 7 allow-listed built-ins' members** for any other load/eval/exec/native-load capability and record the result in the testkit header. Enumerate the members of `node:{crypto, fs, fs/promises, os, path, url, util}` and classify: the only genuine native/loader/exec member is `crypto.setEngine` (now banned); `os.loadavg` is system-load numbers, NOT a loader; `fs` write-then-`import()` is already residual (b); none of fs/promises/os/path/url/util exposes a code loader. State this audit in the header so the "allow-listed built-ins expose no native loader" claim is **true and evidenced** (— except the documented residual (b)). Include the audit command/output in the handback.
3. **Correct the header claim**: where it says the allow-listed built-ins do not "load native objects", make it accurate — they expose no native/loader/exec member EXCEPT `crypto.setEngine`, which rule 1 now bans; the residuals stay (a) data-flow, (b) `node:fs` code-gen+import, (c) `WebAssembly`.
4. **Self-check:** add to the F-DG1-124 `it.each` table (4th column `"missed"`): `S1 crypto.setEngine` → source `import { setEngine } from "node:crypto";\nsetEngine("/tmp/x.so");` → `/native loader via .setEngine|setEngine/` (match the actual rule-1 message for a member — check `occurrence()` output, likely `native loader via .setEngine()` or `.setEngine (aliased)`); and a namespace form `import * as c from "node:crypto";\nc.setEngine("/tmp/x.so");`. Keep the round-9 default-deny controls (node:crypto import ALLOWED as a positive control — importing crypto is fine; only setEngine is banned).

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — whole suite green incl. S1 and the real-module-tree check (`moduleViolations` zero). Show S1 before (0 violations) vs after (violation). Confirm `import { randomUUID } from "node:crypto"` is STILL allowed (positive control) — only `setEngine` is banned.
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files; `pnpm test` (full unit suite green — no legit `setEngine` identifier anywhere).
- The member audit of the 7 allow-listed built-ins (command + output) proving `crypto.setEngine` is the only native loader.

## Handback
`docs/delivery/handbacks/DG1/round-10/T-DG1-BE11-backend-workflow-engineer.md` — the exact diff and rationale, the member-audit output, the S1 before/after, module tree + full unit suite, typecheck/lint/prettier.
