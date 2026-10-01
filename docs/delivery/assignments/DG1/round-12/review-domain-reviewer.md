# DG1 round-12: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R12`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings / scope you verify
- **F-DG1-133 (documentation accuracy) resolved:** read the testkit header — it no longer calls the node:crypto enumeration route "not closable statically", no longer cites `identity/routes.ts`/`access/rules.ts` (which enumerate plain objects), and documents rule 5 closing the route. Confirm the residual (a) text is now an accurate description (plain-object/third-party data-flow only).
- **No regression** from the round-12 repair: the only change is the test-only module lint (`architecture.testkit.ts`/`architecture.test.ts`, excluded from the build). **No product/runtime behaviour, no API contract, no data model, no i18n string changed.** Confirm the transformation close rule (422/G6), scoped-access rules, identity routes and cursor/pagination still behave correctly in the register's terms and on the running shell.
- Confirm rule 5 does not over-reach: only `node:crypto` is namespace-restricted (it carries the banned `setEngine`); named crypto imports and all other allow-listed built-ins' namespace imports are unaffected; the real module tree passes; the full unit suite is green on Node 22 and Node 24.
- Re-confirm the round-10/11 domain closures hold: F-DG1-001/002/003/004/005/006/105/007/008/207/009/210/131/011.
- **Unchanged invariants:** provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-12/`.
