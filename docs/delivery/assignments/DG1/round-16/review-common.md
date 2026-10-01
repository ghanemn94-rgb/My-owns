# DG1 round-16 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-15 all-PASS, which raised two Low findings. Both are now fixed (one root cause). Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:56f3eb885c6cf3db406e280d232e48ebcefddad173107a744bb9b8ca74fc2b4c`
- **source_commit:** `13418b8db10aa045c466a1c9d2d06dc03f92cedd` is the pre-freeze base; the freeze commit that adds the manifest and these assignments is candidate-excluded metadata only — the recomputed id is identical. Verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone. 391 files.
- **manifest:** `docs/delivery/candidates/DG1/56f3eb885c6cf3db.manifest.json`.

## What changed since round 15 (both findings now `FIXED_PENDING_VERIFICATION`)
Round 15 closed F-DG1-136 and F-DG1-217 and raised two Low findings with a **single root cause**, both fixed in this candidate:
- **F-DG1-137 / F-DG1-218 (Low, REQ-S16-003):** the round-15 F-DG1-217 repair routed declaration files around `ts.transpileModule` with a hand-rolled regex `DECLARATION_FILE = /\.d\.[cm]?ts$/`, which matched only `*.d.ts`/`*.d.mts`/`*.d.cts`. TypeScript (≥ 5.0, `allowArbitraryExtensions`) also treats `<name>.d.<ext>.ts` (e.g. `styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts`) as a declaration file; `walk()` collects these via `CODE_FILE` (they end in `.ts`), they failed the narrow regex, reached `ts.transpileModule`, and threw the same internal `Debug Failure. Output generation failed` with no file name. Fail-closed (the throw reddens `architecture.test.ts`), latent (0 such files in-tree), but a crash rather than a named diagnostic.
  - **Fix:** `apps/api/src/architecture.testkit.ts` replaces the regex with `isDeclarationFileName()`, which reads TypeScript's **public** `SourceFile.isDeclarationFile` (set by the parser from the file name alone — the same classification the `@internal` `ts.isDeclarationFileName` uses, but via public API that typechecks). The `syntaxErrors()` branch now sends every name TS classifies as a declaration file to the existing no-emit `declarationSyntaxErrors()`; none reaches `ts.transpileModule`. `apps/api/src/architecture.test.ts` adds two self-checks pinning the classification (positive and negative forms) and a planted-`styles.d.css.ts` walk end-to-end.
  - **Scope:** test-only; only `architecture.testkit.ts` and `architecture.test.ts` changed. No product/runtime code, no API, no data model, no config, no i18n.

A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED; where a check runs on Node 24, run both). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement this repair. Write `docs/delivery/reviews/DG1/round-16/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-16/`. PASS only if the fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
