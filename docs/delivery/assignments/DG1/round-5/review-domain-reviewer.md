# DG1 round-5: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R5`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- Re-confirm NO regression from BE's module-source refactors (F-DG1-124): the transformation close rule (422/G6), the scoped-access rules, the identity routes and the cursor/pagination still behave correctly on the running shell and in the register's terms. (The product behaviour must be unchanged; only a lint and a few equivalent refactors changed.)
- Re-confirm the round-4 domain closures hold on this candidate: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-5/`.
