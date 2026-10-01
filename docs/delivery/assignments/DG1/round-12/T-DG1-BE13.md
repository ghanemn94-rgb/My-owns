# Assignment T-DG1-BE13: F-DG1-133 / F-DG1-132 — close the node:crypto namespace-enumeration route (backend-workflow-engineer)

- **Stage:** P1 / gate DG1 (round-12 repair). **Base:** current `HEAD`. `node_modules` present; run **offline**; no `pnpm install`. A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.
- Fix **only** F-DG1-133 and F-DG1-132 (same route; full text in `docs/delivery/findings.json`). Edit **only** `apps/api/src/architecture.testkit.ts` and `apps/api/src/architecture.test.ts`. Handback under `docs/delivery/handbacks/**`.

## The finding
The round-9 default-deny allow-lists guard which built-in MODULES a module may import, and rule 1 bans `setEngine` by spelled name — but `crypto.setEngine` is still reachable by **enumerating** the `node:crypto` namespace binding (`import * as c from "node:crypto"; Object.entries(c)/Object.values(c)/new Map(Object.entries(c)).get(key)` with a runtime-built key). F-DG1-132 raised it; F-DG1-133 shows the residual-(a) justification is inaccurate: it calls the route "not closable statically" and cites `identity/routes.ts`/`access/rules.ts` `new Map(Object.entries(x)).get(name)` as "would break", but those enumerate **plain objects** (request.cookies, PERMISSIONS), not a module namespace. **All 41 module files import `node:crypto` through named imports only**, so a narrow static rule closes the route without breaking any module code. **Decision: close it.**

## Required fix
1. **Named-imports-only for allow-listed built-ins that carry a banned member.** Add a set, e.g. `const NAMESPACE_RESTRICTED_BUILTINS = new Set(["crypto", "node:crypto"])` (an allow-listed built-in with ≥1 rule-1-banned member — today only `node:crypto`, because of `setEngine`). In the import/export handling (`collect`/`scanSource`/`fileViolations`), flag as a violation any import of such a specifier that binds the **namespace or default** (not purely named):
   - `import * as c from "node:crypto"` (NamespaceImport)
   - `import c from "node:crypto"` (default binding)
   - `import c, { x } from "node:crypto"` (the default part)
   - `export * from "node:crypto"` and `export * as c from "node:crypto"`
   - `import c = require("node:crypto")` (ImportEqualsDeclaration)
   - a dynamic `import("node:crypto")` / `require("node:crypto")` with the **literal** specifier (it yields the namespace; `require` is already rule-1-banned, but handle the `import()` literal)
   Named imports (`import { randomUUID, createHash } from "node:crypto"`) stay **allowed** (and `import { setEngine }` stays a rule-1 violation). Violation message e.g. `imports the ${spec} namespace/default binding; only named imports are allowed (it carries a rule-1-banned member)`.
2. **Correct the header + the F-DG1-132 self-check comment:** the `node:crypto` namespace-enumeration route to `setEngine` is now **CLOSED** (named-imports-only). Remove the inaccurate "not closable statically" wording for this route and the `identity/routes.ts`/`access/rules.ts` citation. Residual (a) reverts to genuine runtime data-flow over **plain objects / third-party readers** (no allow-listed module namespace exposes a loader member any more, since the one such module — `node:crypto`/`setEngine` — can no longer be namespace-bound). Keep residuals (b) node:fs code-gen+import and (c) WebAssembly.
3. **Self-checks (architecture.test.ts):** replace the round-10/11 "enumeration is residual (a), not a violation" `it` with checks that the enumeration setup is now a **violation**: `import * as c from "node:crypto"` (and the default/export-star/dynamic-import-literal forms) are each flagged; the former E1–E5 plants (which all begin by binding the namespace) are now caught at the import. Keep: named `node:crypto` imports + `randomUUID`/`createHash` allowed (positive control); spelled `setEngine` forms still banned; `Object.entries(x)`/`Map` over a **plain object** is still allowed (so legit `new Map(Object.entries(request.cookies)).get(name)` is not flagged — add a positive control for that).

## Self-verification (real output, paste into the handback)
- `pnpm vitest run apps/api/src/architecture.test.ts` — green incl. the new namespace-import violations, the plain-object positive control, and the real module tree (`moduleViolations` zero — confirm no real module uses a non-named `node:crypto` import).
- `pnpm -r typecheck`; `pnpm lint`; `pnpm exec prettier --check` the two files; `pnpm test` (Node 22) and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (Node 24) — both green (302).
- `grep -rnE "import \\* as|import [A-Za-z]+ from \"node:crypto\"|export \\* from \"node:crypto\"|import\\(\"node:crypto\"\\)" apps/api/src/modules` — no non-named crypto import in module source.

## Handback
`docs/delivery/handbacks/DG1/round-12/T-DG1-BE13-backend-workflow-engineer.md` — the exact diff and rationale, and the real vitest output (Node 22 + 24) + the grep.
