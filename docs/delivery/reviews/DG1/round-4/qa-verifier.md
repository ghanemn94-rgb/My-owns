# DG1 round 4: qa-verifier narrative

**Candidate:** `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827` (395 files). The source commit is `642e6bf`. The repository HEAD moved from `91936e6` to `9997fe3` during the run, but only through freeze metadata and the other reviewers' auto-committed run evidence, all of it meta-excluded. I recomputed the candidate ID at the start and at the end, on the working tree and in a clone at `642e6bf`, and it matched every time.

**Verdict: PASS.** No new findings. My earlier findings F-DG1-230, 231 and 232 stay CLOSED_VERIFIED, as the assignment states.

## What changed and how I checked it

Since round 3 (`40dbd24`), the only product delta is F-DG1-147:
- `apps/web/tsconfig.e2e.json` is new.
- The `typecheck` script in `apps/web/package.json` now runs `tsc -p tsconfig.json && tsc -p tsconfig.e2e.json`.

I didn't stop at confirming that `pnpm -r typecheck` is green. I also added a negative test (`09-e2e-typecheck-negative.sh`), which works like this:
- I injected a TS2322 error into `apps/web/e2e/journeys.spec.ts` and, separately, into the root `playwright.config.ts`.
- Each mutation makes the typecheck fail with exit 2 and names the error location. This holds both through the package script and through `pnpm -r typecheck`.
- After each mutation was reverted, the control went green again.
- CI's verify job runs `pnpm typecheck` (`ci.yml` line 64), so the new check also runs in CI.

The QA-authored root `e2e/*.spec.ts` files are outside this tsconfig's scope by design. An ad-hoc tsc of them exits 0. This is informational only.

## Regression sweep (all PASS)

| Area | Result |
|---|---|
| Install | Offline frozen install: exit 0 |
| Build and static | Build, lint, prettier, OpenAPI lint (33 ops) and no-CDN all pass |
| Unit tests | 326/326 on Node 22.22.2 and on Node 24.21.0 |
| Integration (disposable PostgreSQL 16.13, run twice) | 209/209 each time. Both runs applied 9 migrations; bu-hierarchy-guard 7/7; contract 9/9 including getBrandingTokens |
| DB probe | Idempotent migrate; append-only audit for all three roles; BU cycle and depth-11 inserts refused |
| A12/A13/A14 | 24/24 |
| E2E journeys | 18/18 (9 EN plus 9 AR), `--workers=1`, no skips or flaky tests |
| QA acceptance stack | 22/22, including the A20 shell and token specs |
| A20 | Token propagation passes (#6B1D5C rendered) |
| A18 | Clean start at `642e6bf` with an offline install passes, including 503 on an unmigrated database and restart |
| Gate validators | `--register DG1`, `--pipeline` and `--reconcile` all PASS |
| A24 offline surface (REQ-DLV-025) | CI copies identical; needs graph correct; 46/46 script tests; 3 negative mutations rejected; a tampered gate record makes the pipeline fail |
| REQ-DLV-042 | 13/14 offline. AC-1 (effect) fails only because the registry can't be reached (ECONNREFUSED through the proxy), which is the D-057 residual |
| Static requirement checks | Identical to round 3 (tokens, wordmark, fonts, modules, PostgreSQL only, ERD, OpenAPI) |
| Contrast and fonts | Contrast passes (50 pairs); the OFL fonts are bundled |
| Earlier black-box and worker-stop probes | PASS |

## Residuals (not BLOCKED gate checks, per assignment and D-057/D-058)

- **Live GitHub Actions run (A24, D-058):** not run, because there is no CI runner in the sandbox. The offline surface ran and passed.
- **Live-registry install effect (AC-1 effect, D-057):** not run, because no registry is reachable. The other 13 offline checks ran and passed.
- **Informational:** `pnpm deps:verify` needs `npm view` against the live registry. It hung, and I terminated it. It is not an assigned check (REQ-S16-009 is outside this assignment) and is recorded in `08-deps-verify.log`.

## Process notes

- I made two setup mistakes and recorded both:
  - The first A24 attempt is VOID because I hadn't copied the per-workspace `node_modules` (log `22a-…VOID…`).
  - A `pkill -f` pattern matched my own shell, which ended that command. No candidate state was affected.
- All execution happened in disposable clones under `$TMPDIR`, which I removed afterwards.
- No secrets appear in the evidence; I scanned for credential patterns.
- All demonstration data is synthetic (`seed-dev` users).
