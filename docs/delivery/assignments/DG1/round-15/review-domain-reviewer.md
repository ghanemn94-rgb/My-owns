# DG1 round-15: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R15`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **No regression** from the round-15 repairs: the changes are a test-harness config (`vitest.config.ts` integration `hookTimeout`) and the test-only module lint's declaration-file handling (`architecture.testkit.ts`/`architecture.test.ts`). **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the F-DG1-217 fix keeps `.d.ts` files scanned (no boundary-coverage gap) and the F-DG1-136 fix only raises a test-hook budget (no product effect).
- Re-confirm the round-13/14 domain closures hold: F-DG1-001..011, 105, 131, 132, 133, 134, 135, 207, 209, 210, 216 (as applicable).
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-15/`.
