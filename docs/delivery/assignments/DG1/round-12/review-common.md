# DG1 round-12 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-11 all-PASS, which raised one Low finding. It, and the round-11 accepted observation, are now resolved by one change. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:619d74ffa4e668933960fc14aa5d8c4c31850a2772972bceb647561be2efdfac`
- **source_commit:** `987ae029473f62c21e449e63178dedbe32201151` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow). 391 files.
- **manifest:** `docs/delivery/candidates/DG1/619d74ffa4e66893.manifest.json`.

## What changed since round 11 (F-DG1-132 and F-DG1-133 now `FIXED_PENDING_VERIFICATION`)
The module lint (`apps/api/src/architecture.testkit.ts`) adds **rule 5**: an allow-listed built-in that carries a rule-1-banned member (`NAMESPACE_RESTRICTED_BUILTINS` = `node:crypto`, because of `setEngine`) may be imported through **NAMED imports only**. It flags the namespace/default binding in every form — `import * as c`, default `import c`, `import { default as c }`, `export *` / `export * as` / `export { default } from`, `import c = require()`, and a literal-specifier `import("node:crypto")` / `require("node:crypto")`. Without a namespace/default binding the crypto module object never becomes an enumerable value, so reaching `crypto.setEngine` by `Object.entries(c)`/`Object.values(c)`/`new Map(Object.entries(c)).get(runtimeKey)` is now a **violation at the import** — the F-DG1-132 enumeration route is **closed**, not accepted. Named imports (`import { randomUUID, createHash }`) stay allowed; `import { setEngine }` stays a rule-1 violation. The header's residual (a) is corrected to genuine **plain-object / third-party** data-flow (legit `new Map(Object.entries(request.cookies)).get(name)` stays allowed); the inaccurate "not closable statically" wording and the `identity/routes.ts`/`access/rules.ts` citation are removed (F-DG1-133). All 41 module files import `node:crypto` via named imports, so nothing breaks.

A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED; where a check runs on Node 24, run both Node 22 and Node 24). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-12/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-12/`. PASS only if the fixes verify, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
