# DG1 round-16: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R16`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **No regression** from the round-16 repair: the change is the test-only module lint's declaration-file classification (`architecture.testkit.ts` / `architecture.test.ts`). **No product/runtime behaviour, no API contract, no data model, no i18n string, no config changed** (`vitest.config.ts` is NOT touched this round). Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the F-DG1-137/218 fix keeps declaration files **scanned** (no boundary-coverage gap): a `.d.ts` / `.d.<ext>.ts` with a deep cross-module type import is still flagged. The classification now follows TypeScript's own `SourceFile.isDeclarationFile`, not a hand-rolled regex, so `allowArbitraryExtensions` forms (`styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts`) no longer crash the lint.
- Re-confirm the round-13/14/15 domain closures hold: F-DG1-001..011, 105, 131, 132, 133, 134, 135, 136, 207, 209, 210, 216, 217 (as applicable).
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-16/`.
