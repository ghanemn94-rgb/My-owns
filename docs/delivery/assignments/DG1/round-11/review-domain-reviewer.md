# DG1 round-11: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R11`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **F-DG1-011 (D-055 accuracy) resolved:** read D-055 in `docs/delivery/decisions.md` — it no longer claims the default-deny "closes the whole loader/exec class … prevents further adjacent-route findings"; it names the member-audit's runtime (Node 22.22.2) and records the Node 24.21.0 re-audit (production target) with identical results and evidence. Confirm the decision record is an accurate description of its evidence (the F-DG1-010/011 version-detached-claim pattern is resolved, not repeated).
- **No regression** from the round-11 repairs: F-DG1-214 is a web test-harness change (`apps/web/test/jsdom-native-abort-environment.ts` + config), F-DG1-132/215 is a test-only lint doc/self-check change, F-DG1-011 is decision-record text. **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Re-confirm the round-9/10 domain closures hold on this candidate: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210/131.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-11/`.
