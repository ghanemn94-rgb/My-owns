# DG1 round 15: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:76d8b3049d22d414a4c036bd3dd1af6e0c3609baedb096e2d2ecf4180bf07846`, freeze commit `f27b5a6f`. Invocation `DG1-T-DG1-REV-QA-R15-qa-verifier-20261001T173655Z-44d2422f`.

All code ran in a disposable full clone under `$TMPDIR`, which I removed afterwards. The candidate tree is untouched. Evidence is in `docs/delivery/test-evidence/DG1/qa/round-15/`. I added two new review-time probes under `docs/delivery/test-evidence/DG1/qa/tests/`; they are not part of the candidate.

## Findings verified

| Finding | Result | Basis |
|---|---|---|
| F-DG1-136 (Low) | CLOSED_VERIFIED | The `hookTimeout: 30_000` setting provably applies: a probe with a 12 s `afterAll` passes, and a control with that line removed fails with `Hook timed out in 10000ms`. Integration ran 200/200 in 4 runs (Node 22 x2, Node 24, Node 22 under CPU contention), with 0 hook timeouts and 0 57P01. |
| F-DG1-217 (Low) | CLOSED_VERIFIED | `.d.ts`/`.d.mts`/`.d.cts` (and the r14 name `zz.test.d.ts`) are walked and linted without throwing. Deep, type-query and child_process imports are flagged, and syntax errors give a named `unparseable source`. The change is test-only: the testkit is excluded from the build. `architecture.test.ts` passes 130/130 on Node 22 and 24. |

Re-confirmed, without re-closing: **F-DG1-009** (no 57P01 in 4 server logs), **F-DG1-210** (Lead create → Edit/Archive/audit trail with no reload, EN+AR, on both runtimes), **F-DG1-214** (unit-web 110/110 on Node 24).

## New finding

- **F-DG1-218 (Low, non-mandatory, REQ-S16-003; proposed number).** This is a residual of F-DG1-217. Arbitrary-extension declaration files such as `zz.d.css.ts` and `zz.d.json.ts` still make `moduleViolations()` throw `Debug Failure. Output generation failed`, because `DECLARATION_FILE = /\.d\.[cm]?ts$/` doesn't match them. The lint fails closed, and the real tree has no such file. Suggested fix: route every name TypeScript treats as a declaration file to `declarationSyntaxErrors()`, and add a self-check for it.

## Regression sweep (all green)

- typecheck, build, lint, OpenAPI lint (33 ops), no-CDN, format, contrast (50 pass / 3 prohibited fail as documented).
- Unit tests: 323/323 on both Node 22 and Node 24.
- Migrations 0001–0008 apply on a fresh database. The audit trigger rejects UPDATE/DELETE/TRUNCATE.
- Contract tests pass, including `getBrandingTokens`.
- e2e: 22/22 EN+AR on both runtimes, with 0 axe violations.
- Acceptance suites: A12 14/14, A13 5/5, A14 5/5, A18 clean start PASS, A20 4/4.
- Validators: `--register`, `--pipeline` and `--reconcile` all PASS.
- All 12 requirements are IMPLEMENTED, with every evidence path present.

## Not performed / limitations

- **Live installer registry fetch (REQ-DLV-042 AC-1 effect): BLOCKED** in this sandbox (no registry network). I didn't attempt it this round. The requirement rests on the orchestrator-run acceptance log (14/14), which is unchanged since round 14.
- Under Node 24, Playwright reports different spec line numbers. This is a source-mapping artefact also seen in round 14; the tree was unchanged.
- HEAD moved mid-run (c7edc14 → 5d5e8a2) because of the domain-reviewer's auto-commit. The candidate ID was unchanged, and I didn't read that record.
