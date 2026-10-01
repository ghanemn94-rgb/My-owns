# DG1 round-9: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R9`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **F-DG1-010 (version-naming) resolved:** the module-lint header no longer claims "exhaustive for the pinned Node 22/24" — the lint is now DEFAULT-DENY and therefore version-independent (D-055). Confirm the header/decision no longer names a wrong or specific Node version as the basis of an exhaustiveness claim; the production Node 24 target vs Node 22 floor is no longer a correctness dependency.
- **No regression** from the redesign: the only change is the test-only module lint (`architecture.testkit.ts`/`architecture.test.ts`, excluded from the build). **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the default-deny allow-lists do not over-reach: no legitimate module import or `process` use is newly rejected (the real module tree still passes; the full unit suite is green). The change strengthens a defence-in-depth lint (ADR-0002), not a user-facing behaviour.
- Re-confirm the round-8 domain closures hold on this candidate: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-9/`.
