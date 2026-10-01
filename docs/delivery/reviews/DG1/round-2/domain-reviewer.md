# DG1 round 2: domain-reviewer narrative

**Candidate:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d`. Source commit 485e91f; HEAD 309be8d (records only). The ID was recomputed in the repo and in a disposable clone, and both match.

**Verdict: PASS.** No new findings.

## Round-1 findings (verified on this candidate)

| Finding | Result | Basis |
|---|---|---|
| F-DG1-001 (Low): views missing from the ERD and data dictionary | CLOSED_VERIFIED | `erd.md:197-201` and the new data-dictionary section "Views (read models)". I checked the columns, types and the `mth_app` SELECT-only grant against a freshly migrated PG16 database, and the definitions against the SQL in 0001/0002. |
| F-DG1-002 (Low): clean-start migration count | CLOSED_VERIFIED | `clean-start.md:91` says "currently 9: `0001`–`0009`". The live migrate printed "applied 9 migration(s)", and the integration setup reported 9. |
| F-DG1-003 (Low): ambiguous REQ-S16-001 citation | CLOSED_VERIFIED | The note no longer cites round-scoped or dev-history evidence. I re-proved the claim live: the worker exits 0 on SIGTERM, and the API stays up with `/readyz` returning 200. |

## Round-2 product change: domain impact

- **BU cycle guard:** the API refuses a cycle with 422 `business_unit.cycle`, and the record and version stay unchanged. Migration 0009's trigger also refuses a direct `mth_app` UPDATE. The closure view has no self-cycles.
- **Destination authorization:** an ADM_TECH grant on BU Y alone can't move Y under X, under SYN-FIN, or to the top level (the organization). Each attempt returns 403 and is audited as `authorization.denied`. The same user can still rename Y. Once also granted X, the move succeeds. This matches ADR-0006: grants never apply across siblings.
- **Rate-limit keying:** legitimate users are served. Forged rotating cookies fall back to the IP bucket and get 429 as problem+json. Validated users on the same IP keep their own buckets, and `/readyz` is exempt.
- **UI:** the BU edit screen shows the refusal in English ("A business unit cannot be its own ancestor.") and in Arabic RTL ("لا يمكن أن تكون وحدة العمل أصلًا لنفسها."), and nothing is saved.

## No-regression checks

- Close rule: 422 under the G6 product gate; never DG7, never an "approval".
- Domain constants still match the playbook: phases B0021, modes B0009, product gates B0023, closure rule B0014.
- The following are unchanged and still work:
  - scoped access, CSRF, If-Match, cursor pagination and audit-on-success;
  - Asia/Riyadh and SAR defaults;
  - the provisional wordmark and tokens (`#0078FF` provisional);
  - bundled IBM Plex fonts, with zero external requests;
  - Arabic RTL by default, and English LTR.
- Nothing claims official PMI or Mobily status. Every grep match is a disclaimer.

## Checks

| Check | Result |
|---|---|
| typecheck, build, lint | PASS |
| Unit tests, Node 22.22.2 | 326/326 |
| Unit tests, Node 24.21.0 | 326/326 |
| Integration tests, PG 16.13 | 209/209 (7 new BU-guard tests) |
| Contrast | 50 AA pairs; 3 prohibited pairs fail as documented |
| no-CDN | PASS |
| OpenAPI | 33 operations, valid |
| Live probe | 49/49 |
| Rate-limit probe | 7/7 |
| Screens | AR and EN |

`deps:verify` needs npm registry access, which this sandbox doesn't have, so it was not run. It is not an assigned domain check and is logged as BLOCKED.

All data used was synthetic. This review grants no business, Finance or IT approval.
