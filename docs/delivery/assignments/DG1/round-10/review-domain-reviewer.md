# DG1 round-10: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R10`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **F-DG1-131 (D-055 accuracy) resolved:** read D-055 in `docs/delivery/decisions.md` — it no longer claims the allow-lists equal actual/minimal usage; it states module source uses 4 of the 7 built-ins and the rest is reviewed safe headroom, and it describes the member-audit (F-DG1-130). Confirm the decision record is now an accurate description of the evidence.
- **No regression** from the round-10 repair: the only code change is the test-only module lint (`architecture.testkit.ts`/`architecture.test.ts`, excluded from the build); the rest is decision-record text. **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm the F-DG1-130 fix does not over-reach: banning `setEngine` and auditing members does not reject any legitimate module import/use (`node:crypto` + `randomUUID`/`createHash` stay allowed; the real module tree passes; the full unit suite is green).
- Re-confirm the round-9 domain closures hold on this candidate: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-10/`.
