# DG1 round 1: domain review (clean re-gate)

- **Candidate:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` (391 files; HEAD 2c22c27, source_commit 37ec374). Recomputed in the repository and in a disposable clone, and it matched.
- **Run:** `DG1-T-DG1-REV-DOM-R1-domain-reviewer-20261001T201758Z-9ed0992f`
- **Verdict:** **PASS**, with three Low, non-mandatory findings.

## What I exercised
- **Builds and tests:**
  - typecheck, build and lint all exit 0;
  - unit tests 325/325 on Node 22.22.2 and on Node 24.21.0;
  - integration 200/200 on a fresh PostgreSQL 16 database: 8 migrations applied, and the contract suite covers all 33 operations;
  - contrast check, no-cdn check and OpenAPI lint all pass.
- **Live stack** (API and worker as separate processes, synthetic users), 34/34 probe assertions:
  - **Close rule:** the product-gate G6 close rule refuses draft, active and on_hold → closed with 422, and the record and its version stay unchanged. The refusal is atomic with other field edits and writes no audit event. Its text names G6 (Sustain) and never DG7 or any approval. The edit form doesn't offer "closed" at all.
  - **Defaults:** Asia/Riyadh and SAR by default, and both are configurable per record. End-to-End starts in Diagnose; Modular enters at the selected phase and requires one (B0009).
  - **Concurrency and CSRF:** If-Match is required (428) and stale versions are rejected (409). A mutation without CSRF is rejected (403).
  - **Scoped access:**
    - an out-of-scope read by a TL returns 404, and the TL's list is filtered in SQL;
    - access and technical admins see no business records;
    - the auditor has read access only;
    - a user with no roles sees an empty list.
  - **Cursor pagination:** a complete, ordered walk works. A cursor bound to one filter or sort is rejected under another (400), and a tampered cursor or an over-limit page size is rejected (400).
  - **Branding:** returns the seven tokens with `provenance: provisional`.
  - **Worker:** consumed all 7 outbox events. After SIGTERM it exited 0, and the API stayed alive with `/readyz` returning 200 (REQ-S16-001).
- **Rendered screens** (Chromium, AR and EN):
  - Arabic RTL by default and English LTR by preference.
  - A provisional text wordmark and badge with a disclaimer, and no logo image.
  - Unbuilt modules are badged Planned/مخطط.
  - The bundled IBM Plex fonts are loaded, and no request leaves localhost.
  - The i18n keys are at parity (460, no mismatches). The About text disclaims official PMI status and certification in both languages.

## Findings (all Low, `mandatory_violation: false`)
| ID | Requirement | Issue |
|---|---|---|
| F-DG1-001 | REQ-S19-004 | The views `actor_display`, `business_unit_closure` and `scope_node` are missing from erd.md and data-dictionary.md. |
| F-DG1-002 | REQ-S19-004 | Line 91 of `docs/operations/clean-start.md` says 6 migrations, but the candidate applies 8. |
| F-DG1-003 | REQ-S16-001 | The register note cites a domain round-1 evidence path that wasn't in the frozen candidate. The file exists only on `dg1-dev-history-d1cb245`, and this round reuses the same path. This round's evidence confirms the claim. |

## Notes
- The assignment describes workflows/kpi/reporting as "declared-but-reserved (D-047)". The candidate follows **D-048**, which supersedes D-047 part 1: they are P1 scaffolds with their own suites and `routes: []`. That is consistent with the register, so it isn't a defect.
- Environment:
  - `pnpm install --offline` could not run because the offline store lacks tarballs, so I copied the repository's installed `node_modules` into the clone instead. The lockfile is identical.
  - `pnpm deps:verify` (not assigned) hung offline and was terminated. It is not reported as PASS.
- No real business, Finance or IT approval was granted or implied. All data is synthetic.
