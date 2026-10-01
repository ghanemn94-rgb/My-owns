# DG1 round 13: code-security-reviewer

**Verdict: PASS.** Candidate `sha256:00f1498cd5e9a166db501452f699a3270ffca82455593fe9c0ab84a83e01c80b`, freeze commit `08cbd12`, session `f45f1ee4`.

## Identity
- The real-repo HEAD at start was `ed2160d`, a child of `08cbd12` that adds only candidate-excluded metadata (assignments, manifest, `stages.json`).
- The recomputed ID is identical in the real repo and in a full clone at `08cbd12`.
- Source delta since the round-12 freeze: `architecture.testkit.ts` and `architecture.test.ts` only, plus the D-055 wording.
- See `00-candidate-identity.log`.

## F-DG1-134: CLOSED_VERIFIED
- **The fix:** `architecture.testkit.ts:176` (`CODE_FILE = /\.[cm]?[jt]sx?$/`) is used by `walk()` at `:185`. `:179` (`scriptKindOf`) is used by `scanSource` at `:307`. `:461` (`isTest = TEST_FILE.test(file)`).
- **Method:** my probe imports the fixed testkit and the round-12 testkit side by side. It plants files in the clone's real `transformations/` directory: `.mts .mjs .cts .cjs .js .jsx` and a nested `.mts`. Each one contains a `node:crypto` namespace import and a deep cross-module import.
- **Before the fix:** the round-12 testkit gives 0 violations for these files.
- **After the fix:** each file gets both the rule-5 violation and the deep-import violation.
- **TSX parsing:** a `.tsx` plant with `<a href="x">it's {require("y")}</a>` is parsed as TSX. The `require` is still reported, with no parse error.
- **Real module tree:** it contains no non-`.ts`/`.tsx` file and has 0 violations in every module.
- **Test runs:** `architecture.test.ts` passes 127/127. The unit suite passes 320/320 on Node 22 and on Node 24.

## New: F-DG1-135 (Low, non-mandatory)
`TEST_FILE = /\.test\.[cm]?[jt]sx?$/` (`:177`) grants test allowances to `*.test.mts` and similar files: imports of `modules.ts`, `architecture.testkit.ts` and `vitest` (`:471`, `:480`). Those files are not tests:
- `tsconfig.build.json:10` excludes only `*.test.ts`, `*.test.tsx` and `*.testkit.ts`.
- vitest only collects `*.test.ts`.

Reproduced on a clean build with a planted `kpi/zzgap.test.mts` that imports `../../modules.ts`:
- The lint reports 0 violations.
- The build exits 0 and emits `dist/modules/kpi/zzgap.test.mjs`.
- Importing it from `dist` at runtime works.
- vitest lists it 0 times.
- Control: the same content as `zzgap.mts` is flagged.

Impact is limited. The exemption covers only the declarative module map, the test-only lint and vitest, and rules 1–5 still apply. This is not a regression, because before the fix such files were not scanned at all. Fix options:
- narrow `TEST_FILE` to what the build excludes and vitest runs; or
- widen the build `exclude` to every `*.test.<ext>`.

Either way, pin the chosen invariant in `architecture.test.ts:763`.

## Checks
| Check | Result |
|---|---|
| typecheck, build, lint, openapi, no-cdn, format | PASS |
| Unit tests, Node 22 and Node 24 | 320/320 |
| Integration (disposable PostgreSQL 16.13, port 5491) | 200/200 ×2 on Node 22, plus 1 run on Node 24 |
| gates/agents tests | 105/105 |
| deploy script tests | 59/59 |
| install-sandbox suite | 13/14 |
| SBOM, DG0 historical, 3× ci.yml identical | PASS |

On the install-sandbox suite: AC-1 (effect) is **BLOCKED** because the registry is unreachable (ECONNREFUSED via the proxy). The real-repo frozen install through the sandboxed installer passed offline from a copy of the local store.

## Requirements
REQ-DLV-025, REQ-DLV-033, REQ-DLV-042, REQ-S16-001, REQ-S16-003, REQ-S16-004, REQ-S19-004 and REQ-S19-006 are all IMPLEMENTED with final_gate DG1, and all their evidence paths exist.

## Independence
I authored no implementation in scope. I did not open any other reviewer's round-13 record. The domain reviewer's auto-commit `ae769af` landed during my run; I checked only its file names.
