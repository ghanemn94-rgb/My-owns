# DG1 round 9: domain-reviewer narrative

- **Candidate:** `sha256:05915c32b3f5c5b2a9e14324a70fbf5cd16e76a48bc3235d6cc30b290591babd`
- **Freeze commit:** `273d21f`. HEAD `07f1a54` adds only candidate-excluded metadata.
- **Run:** `DG1-T-DG1-REV-DOM-R9-domain-reviewer-20261001T140343Z-d1b0e9b3`

**Verdict: PASS.** No new findings.

## F-DG1-010 (mine, round 8): verified CLOSED_VERIFIED

**The defect.** In round 8 the testkit header and D-054 said the loader/exec enumeration was "exhaustive for the pinned Node version (22.x)". The repository pins Node 24, so the claim named the wrong runtime.

**The fix (D-055) removes the claim rather than rewording it.** Both checks in `architecture.testkit.ts` are now default-deny allow-lists:
- `bareAllowed` accepts a `node:` specifier only if it is in `SAFE_NODE_BUILTINS` (crypto, fs, fs/promises, os, path, url, util).
- Rule 3 rejects any `process.<member>` that is not in `SAFE_PROCESS_MEMBERS` (env, exit, argv, once).

Whatever a Node version adds is therefore denied by default. My negative control `node:some-future-builtin` confirms it.

**What the header says now.** It names a version only as context: "production targets Node 24, the supported floor is Node 22.18+". That matches `.nvmrc`, `engines`, the Dockerfile and ADR-0001. D-054 stays in the append-only decision log as a superseded row.

**Limitation.** This sandbox has no Node 24 and no network, so I did not run the lint on Node 24. The fixed claim is structural and no longer depends on the runtime version, so this does not block verification.

## No regression

- **Scope of change.** Since the round-8 candidate, the only product-tree change is the two build-excluded test files (`tsconfig.build.json` excludes `*.testkit.ts`, and no `dist/architecture*` file is produced). The API contract, data model, i18n catalogues, design tokens and the register are byte-identical.
- **Unit and architecture suites.** Unit: 294/294. Architecture: 101/101.
- **My over-reach probe: 4/4.**
  - The real module tree has zero violations.
  - An AST inventory written separately from the testkit's scanner finds only `node:crypto`, `node:path`, `node:fs` and `node:url` in module source, and no `process` member at all.
  - Legitimate patterns are allowed: crypto, fs/promises, url+path, util+os, `process.env`/`argv`/`once`/`exit`, and decimal.js.
  - The loader/debug/exec/network routes are denied: `process.kill`/`_debugProcess`/`getBuiltinModule`/`execve`/`dlopen`, and `node:inspector`/`wasi`/`v8`/`net`/`http`/`test/reporters`/`sqlite`.
- **Integration: 200/200, run twice on fresh PostgreSQL 16 clusters.** Both runs had zero 57P01 errors and left no databases behind. Covered:
  - closure refused with 422 citing G6;
  - access scope;
  - OIDC and sessions;
  - cursor pagination.
- **Live AR/EN shell: 108/108 checks.** Covered:
  - closure 422/G6 with no side effects;
  - provisional tokens;
  - RTL/LTR rendering;
  - "closed" not offered in the edit form, with a G6 hint;
  - glossary terms;
  - localized audit trail;
  - the F-DG1-210 create flow with no reload;
  - pagination over six sorts, with tampered cursors refused;
  - identity and logout.
- **Screens I inspected.** `ar-02-edit-no-closed.png` and `en-03-detail-audit.png`. Both show the provisional wordmark, "Planned" markers on unbuilt areas, and Unknown instead of zero or green.

## Requirements and earlier closures

- **Register.** The 8 assigned DG1-final rows and all 12 DG1-final rows are IMPLEMENTED with every cited evidence file present. The 29 REQ-PB/§15/§16 rows that have a P1 increment and a later final gate are still SPECIFIED, so nothing over-claims.
- **Round-8 domain closures.** F-DG1-001/002/003/004/005/006/105/007/008/207/009/210 all re-verify on this candidate.

## Observation (not a finding)

Default-deny also rejects harmless members such as `process.pid`, and built-ins such as `node:events`. No module uses them today. D-055's reopen criterion already covers this: a member or built-in is reviewed and then added deliberately.

## Not in my scope

F-DG1-129 and F-DG1-213 belong to code-security and qa. My negative controls are consistent with their fix, but I wrote no verification entry for them.

I grant no business, Finance or IT approval. Product gate G6 is not engineering gate DG7.
