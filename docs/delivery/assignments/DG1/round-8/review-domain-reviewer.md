# DG1 round-8: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R8`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **No regression** from the round-8 repair: the only change is the test-only module lint (`architecture.testkit.ts`/`architecture.test.ts`, excluded from the build). **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the F-DG1-128 change does not over-reach: the lint bans only the `test`/`node:test` import specifier and the `process.execve` member (built-ins/methods no module needs); no legitimate module import is newly rejected (real module tree still passes). The exhaustive-enumeration claim (D-054) is an honest description of a defence-in-depth lint, not a user-facing change.
- Re-confirm the round-7 domain closures hold on this candidate: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-8/`.
