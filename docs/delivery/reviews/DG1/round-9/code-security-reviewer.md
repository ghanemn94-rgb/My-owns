# DG1 round 9: code-security-reviewer

- **Candidate:** `sha256:05915c32b3f5c5b2a9e14324a70fbf5cd16e76a48bc3235d6cc30b290591babd`
- **Freeze commit:** `273d21f`. HEAD was `07f1a54` at start; the commits in between are metadata only. The ID was recomputed and is identical in the real repo and in a full disposable clone at both commits.
- **Invocation:** `DG1-T-DG1-REV-SEC-R9-code-security-reviewer-20261001T140344Z-ac7e08c7`
- **Verdict: PASS**, with two new Low, non-mandatory findings.

## Scope
The only source change since the round-8 import is `apps/api/src/architecture.testkit.ts` and `architecture.test.ts` (7525b11, T-DG1-BE10, D-055). The module lint's Node built-in and `process.*` checks moved from denylists to default-deny allow-lists:
- `SAFE_NODE_BUILTINS` = {crypto, fs, fs/promises, os, path, url, util}, at line 77. `bareAllowed` uses it at lines 129-130.
- `SAFE_PROCESS_MEMBERS` = {env, exit, argv, once}, at line 103. Rule 3 uses it at lines 316-317.

## Finding verification
| Finding | Result | Basis |
|---|---|---|
| F-DG1-129 | CLOSED_VERIFIED | `process.kill(pid,"SIGUSR1")`, `_debugProcess`, `process?.kill` and the alias, destructure and index variants are all violations. architecture.test.ts passes 101/101 and the real tree has 0 violations. |
| F-DG1-213 | CLOSED_VERIFIED | Same route, reached via qa. DD4's full inspector chain is denied, and so are `node:inspector` and `node:inspector/promises`. |
| F-DG1-010 | CLOSED_VERIFIED | No "exhaustive", "pinned Node" or per-version enumeration is left. The check is allow-list based and DD20 denies a future built-in. |

In a disposable clone, all 37 negative plants are violations: the 12 assigned routes plus 25 variants, including path tricks such as `node:fs/../vm`, type-only imports, `export *` and `import()`. All 11 positive controls produce no violation.

## New findings
- **F-DG1-130 (Low, non-mandatory, REQ-S16-003).** `import { setEngine } from "node:crypto"; setEngine(path)` in module source gives **0 violations**. At runtime on Node 22.22.2 it `dlopen()`s the shared object, and the library's constructor runs before the call throws `ERR_CRYPTO_ENGINE_UNKNOWN`. That is the `process.dlopen` / `node:sqlite loadExtension` class, reached through an allow-listed built-in. Two statements are therefore false: the testkit header's "none of them … loads native objects" and D-055's claim that the whole class is closed.
  - Suggested fix: add `setEngine` to `BANNED_PRIMITIVES` (rule 1 then catches it in every syntactic form, like `getBuiltinModule`), add a self-check row, and correct the header.
  - The header should also say that version-independence covers which built-in modules may be imported, not the members of allowed modules.
  - Evidence: `01-lint-probes.log`, `02-setengine-e2e.log`.
- **F-DG1-131 (Low, non-mandatory).** D-055 says the seven built-ins and four `process` members are exactly what module source uses. In fact module source imports only crypto, path, fs and url, and uses no `process` member at all.
  - The extra entries (fs/promises, os, util, env, exit, argv, once) add no capability I could find beyond residual (b).
  - So this is an accuracy and minimality issue, not an open route.

No regression: no legitimate module import or member is newly denied. The unit suite passes 294/294 and the real tree has 0 violations.

## Checks
All of the following passed, run in the disposable clone on Node v22.22.2:
- typecheck, build, lint, openapi:lint, no-cdn, format:check;
- unit suite, 294/294;
- integration on disposable PostgreSQL 16.13 (port 5491), twice, 200/200 each time;
- gate and agent tooling tests, 105/105;
- deploy script tests, 59/59;
- SBOM check;
- DG0 historical validation;
- the three ci.yml copies are identical, and check-ci-needs passes.

Two checks are **BLOCKED** by the environment:
- **Install sandbox, AC-1 effect.** AC-1 (sandbox) and AC-2 through AC-10 pass. The effect step needs `is-number` from the registry, which fails with ECONNREFUSED; round 8 had the same result.
- **Node 24 runtime probe.** No Node 24 binary is installed, so no runtime claim is made for Node 24.

## Requirements
All eight assigned requirements are complete. Each is IMPLEMENTED with final_gate DG1, and none of their 82 evidence paths is missing.
- REQ-DLV-025
- REQ-DLV-033
- REQ-DLV-042
- REQ-S16-001
- REQ-S16-003
- REQ-S16-004
- REQ-S19-004
- REQ-S19-006
