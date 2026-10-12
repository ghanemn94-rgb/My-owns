# DG4 round 5: code-security-reviewer narrative (T-DG4-REV-SEC-R5)

**Verdict: PASS.** Candidate `sha256:69b7412a0a360135863a80a5ee32ee947aff0d7f05615589cf6457e054cf0e86` (source `3e3a06e`, freeze `e29a735`). One new finding, **F-DG4-106: Low, not mandatory, not blocking.**

## Candidate and independence

- I recomputed the candidate ID in a complete clone and in the repository, at the start and at the end: 1472 files, the same ID each time.
- HEAD moved once during my run (`f53821b`). That commit holds only the domain reviewer's run and records. I have not read any other reviewer's round-5 record.
- Every execution ran in disposable clones under `$TMPDIR`, each with its own PostgreSQL cluster on ports 26331-26363. The one exception is a read-only `--configLoader runner` check in the confined tree.

## The repair (T-DG4-FE-R8): web only, no regression

`git diff ccc37c9..3e3a06e` changes 8 files under `apps/web`, and nothing under `apps/api`, `apps/worker`, `packages`, `docs/api`, `tools` or the lockfile.

**`valueRagLineValue`** (`ui.tsx`) maps each Value RAG line's status to what it shows:
- `not_applicable` → Not applicable, never Unknown and never a number;
- `unknown` → Unknown;
- `stale` → Stale;
- coloured statuses → their ratio, or Unknown when the ratio is null (never 0).

**`useOrgQuery`** narrows the unit's list by phase and status through `listTransformations`.
- That endpoint filters `t.current_phase` and `t.status` and excludes archived rows, the same as the dashboards' `readableTransformations` (`scope.ts:75-79`).
- The transformation chip intersects with the caller's full readable list; on error it falls back to the unit's first page, never to "all".
- The 50-id limit holds by construction (`useFilterState` slices `tr` to 50).
- An empty result sends no request (`none_matching`).
- No new import cycle.

## Server scope for client-built ids: new probe FS, 5/5

On the Executive Overview, Finance and adoption reads, with the business-unit, phase and status filters, for nine kinds of caller:

- **List to read:** each id the client's source list offers is accepted (200), and the rows stay within the list (63 combinations).
- **Forged lists:** any forged list (unreadable, other unit, other org, unknown, or mixed with readable ids) is 404, whatever the phase and status (120 requests).
- **No existence oracle:** an unreadable id and an unknown id get byte-identical 404 bodies.
- **Org-wide rows:** the rows equal the caller's readable set narrowed by phase and status. ADM-only and OUT get 404.

## Full review

**Prior probes.** All 14 of my probes from rounds 1-4 pass unchanged: sweep 766, idor 204, drill-scope 163, currency 151, approvals, SoD, Finance, gate commit-time, slice B, required members and outcome scope.

**Required checks.**
- Typecheck, build, lint, openapi (652 operations), no-cdn and format: all exit 0.
- Integration: 1975/1975 twice, with LANG unset (SQL_ASCII, Node 22) and with C.UTF-8 (UTF8, Node 24). This includes contract, media types, catalogue and the migrations.
- `validate --historical` DG3, DG2 and DG1, `--register DG4` and `--pipeline`: all PASS.

**Unchanged from round 4.**
- The commit-time scan is byte-identical: 232 routes, and the 33 residuals were read manually earlier.
- The module graph has no cycle, and `raid` never imports `governance`.
- The worker imports no API code, and every p4-pending list is empty.
- `Problem.params` is optional and additive.
- No float on money; migrations 0028-0061 are added only and contiguous.
- The exactly-once suites and the 8 parity tests pass in both runs.

## Unit runs and F-DG4-106

The full unit suite passed cleanly on both runtimes: Node 22 re-run 2 and Node 24 re-run, each 2915/2915, plus 259 passed with the 2 explained NOCODEGEN skips.

Three of five full runs under load (load average 12-17) exited 1. Each time the only failure was `session-bound.test.tsx` › Y1c, plus one `architecture.test.ts` 30 s timeout in the first Node 22 run, which passed alone in 17.8 s.

- **What Y1c asserts:** exactly 2 `GET /me` after a create.
- **Why it fails under load:** the product's identity re-check (`client.ts:232`, `SESSION_RECHECK_MS = 2000`, D-077) correctly sends a third `/me` before any page GET that goes out more than 2 s after the last one.
- **Deterministic reproduction:** holding the `/summary`, `/audit` or POST answer for 2.2 s makes Y1c fail with 3. Holding the detail GET, the decisions GET or `/me` leaves it at 2.

This is a test-determinism defect in a required check, not a product defect. The same failure is disclosed in D-118 and in the round-4 domain review. Owner: frontend-ux-engineer.

## Residuals

These are noted, and PASS on their offline surface: the live registry (D-057), live CI (D-058) and Keycloak (D-049).
