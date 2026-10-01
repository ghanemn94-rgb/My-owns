# DG1 round 12: code-security-reviewer narrative

- **Candidate:** `sha256:619d74ffa4e668933960fc14aa5d8c4c31850a2772972bceb647561be2efdfac` (391 files). Freeze commit `987ae02`.
- **Task:** `T-DG1-REV-SEC-R12`. Run `DG1-T-DG1-REV-SEC-R12-code-security-reviewer-20261001T160109Z-400a7bd7`.
- **Verdict:** **PASS**.
- **Findings:** F-DG1-132 and F-DG1-133 are verified CLOSED_VERIFIED. One new finding: **F-DG1-134 (Low, non-mandatory, pre-existing)**.

## Candidate identity
At start, HEAD was `e77be1a`, not the freeze commit `987ae02`. `e77be1a` is a direct child of the freeze commit and adds only candidate-excluded metadata: the round-12 assignments, the manifest and `stages.json`.

The ID recomputes to `619d74ff…fdfac` in the real repo and in a full disposable clone at `987ae02`. Candidate identity is the content hash, so I proceeded, as in round 11. During my run, HEAD moved to `163d0ca`, the domain reviewer's auto-commit. I checked only its file names, and the ID is unchanged.

The source delta since round 11 is exactly `apps/api/src/architecture.testkit.ts` and `architecture.test.ts` (fix `792973b`).

## F-DG1-132: the node:crypto enumeration route is closed
Rule 5 is defined by these parts of `architecture.testkit.ts`:
- `NAMESPACE_RESTRICTED_BUILTINS` at :121;
- `restricted()` and `bindsDefault()` at :299-309;
- their use in `collect()` at :311-355.

Rule 5 flags every way of binding the module object. Specifiers are compared as literal text, and string-literal or template-literal specifiers resolve through `literalText`. Export names go through `.text`, which unescapes Unicode escapes and covers string-literal export names.

My probe plants 25 must-flag sources, and **all 25 are flagged**:
- the 7 assignment forms;
- the enumeration plants E1–E5;
- 11 adversarial variants:
  - `{ "default" as c }`, in both import and export form;
  - `default`;
  - `` import(`node:crypto`) ``;
  - bare `crypto`;
  - `export { default } from`;
  - `export * as default`;
  - `import().then`;
  - import attributes;
  - `import type * as` (flagged, which is harmless);
  - a computed `import()`, flagged as an evasion;
- 2 rule-1 controls: `{ setEngine }` and `{ setEngine as s }`.

All 4 positive controls stay clean: named crypto imports, the `request.cookies` Map idiom, `Object.entries(someObj)`, and `import * as path`.

The real tree has zero violations. It has 41 files; 5 of them import `node:crypto`, all through named imports. `architecture.test.ts` passes 122/122 on Node 22.22.2 and on Node 24.21.0.

I also searched at runtime, to depth 3, from:
- every named export of the allow-listed built-ins, on Node 22 and Node 24;
- the 14 allow-listed third-party dependencies.

The only way to reach `setEngine` is to spell its name, which rule 1 bans. No named export exposes the crypto module object.

## F-DG1-133: header honesty
The phrases "not closable statically" and "would break … identity/routes.ts, access/rules.ts" are gone. Rule 5 is documented at :45-52. Residual (a), at :71-81, now covers only plain objects and third-party data flow, which matches what I measured.

`architecture.test.ts:614` still names those two files, but only as the plain-object idiom that stays allowed. That is accurate.

One minor wording note: "all 41 module files use named crypto imports" really means that none of the 41 files binds the namespace. Only 5 of them import `node:crypto` at all.

## New finding F-DG1-134 (Low, non-mandatory)
`walk()` (`architecture.testkit.ts:167-172`) scans only `/\.(ts|tsx)$/` files. I planted `modules/transformations/zzx.mts` and imported it from a `.ts` file. It contains `import * as c from "node:crypto"`, a `Map(Object.entries(c)).get("set".concat("Engine"))` lookup, and a deep import of `../access/policy.ts`. Results:
- **`moduleViolations` = []**, and `architecture.test.ts` stays 122/122.
- The same source under a `.ts` name gives 2 violations (control).
- typecheck, build and eslint all exit 0, because of NodeNext with `allowImportingTsExtensions` and `rewriteRelativeImportExtensions`.
- `dist` contains `zzx.mjs`, and loading it yields `setEngine`.

A `.mjs` file with a `.d.mts` declaration is also unscanned, but tsc doesn't copy it into `dist`.

This gap predates round 12: the extension filter dates to `8332624`. Today's tree has no such files. I rated it Low and non-mandatory, consistent with this lint's earlier boundary-bypass findings (F-DG1-109 and the rest). The lint is defence-in-depth over human-reviewed code, and exploiting the gap needs a reviewed commit with an unusual file extension.

**Suggested fix:** scan `/\.[cm]?[jt]sx?$/` under `modules/`, or treat any other file in a module directory as a violation. Add a planted-`.mts` self-check case.

## Checks
All checks ran in a disposable clone with an offline frozen install from a copied local store.

| Check | Result |
|---|---|
| typecheck, build, lint, openapi:lint, no-cdn, format:check | exit 0 |
| Unit tests | 315/315 on Node 22 and on Node 24 |
| Integration (PostgreSQL 16.13 on port 5491) | 200/200 in two runs on Node 22, and 200/200 on Node 24 |
| Gates and agents tests | 105/105 |
| Deploy script tests | 59/59 |
| install-sandbox suite | 13/14 |
| SBOM check | OK |
| DG0 historical validation | PASS |
| Three `ci.yml` copies | byte-identical; `check-ci-needs` OK |

**BLOCKED:** AC-1 (effect) and a real-repo registry install need registry metadata, and the sandbox has no registry network (ECONNREFUSED). This was expected, and the check is recorded as BLOCKED.

The first suite run against the read-only shared store failed its setup steps (8/14). That was the environment, not the product, and the rerun with a writable store copy is the 13/14 above.

## Requirements
I checked REQ-DLV-025, REQ-DLV-033, REQ-DLV-042, REQ-S16-001, REQ-S16-003, REQ-S16-004, REQ-S19-004 and REQ-S19-006. All 8 are IMPLEMENTED with every evidence file present, and this round's own runs back them. F-DG1-134 is a Low note against REQ-S16-003. It does not stop the dependency lint from failing on interface-bypass imports in the real `.ts` tree.

## Cleanup
I removed the clone, the store copy and all scratch. Nothing is listening on port 5491, the candidate source is untouched, and the ID is unchanged.
