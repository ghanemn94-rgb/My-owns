# DG1 round-13: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R13`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **F-DG1-216 (D-055 accuracy) resolved:** read `docs/delivery/decisions.md` D-055 — it no longer calls the `node:crypto` namespace-enumeration route "residual (a)"; both mentions now say the route is CLOSED by rule 5 (named imports only), consistent with the testkit header. Confirm the decision record no longer contradicts the lint it documents.
- **No regression** from the round-13 repairs: the only code change is the test-only module lint `walk()` scope (`architecture.testkit.ts`/`architecture.test.ts`), the rest is decision-record text. **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the F-DG1-134 fix (broader walk) does not alter the verdict on the real module tree (0 non-ts/tsx module files; `moduleViolations` still zero; the architecture suite green).
- Re-confirm the round-11/12 domain closures hold: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210/131/011/132/133.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-13/`.
