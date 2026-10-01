# DG1 round 6: qa-verifier narrative

**Verdict: PASS**
- **Candidate:** `sha256:a7b46fbc29db6bb855495593e43f2e859305dea9d6c403fe86f73619d9fb210d`
- **Freeze commit:** `0026a7b`
- **Run:** `DG1-T-DG1-REV-QA-R6-qa-verifier-20261001T121845Z-cc2703da`

## Candidate identity
- HEAD at start was `f03a9fa`, the child of the freeze commit. Its changes are metadata only: assignments, the manifest and `stages.json`.
- `candidate.mjs` gives the same ID for the working tree, for `--diff` (matches=true) and for `--ref 0026a7b`.
- HEAD later moved to `1f680fa` through the other reviewers' auto-committed records. I didn't open those records, and the candidate ID is unchanged.

## What I ran (disposable clones under `$TMPDIR`, offline)
| Area | Result |
|---|---|
| typecheck, build, lint, openapi:lint (33 ops), no-cdn, format, contrast | 7/7 exit 0 |
| `pnpm test` | 270/270 (`architecture.test.ts` 77/77) |
| Integration on disposable PG 16.13, port 5492 | 2 runs, each 200/200, exit 0. 8 migrations. Contract test includes getBrandingTokens. **No 57P01** in either server log (F-DG1-009 holds) |
| Audit trigger probe | UPDATE, DELETE and TRUNCATE rejected for superuser and owner. App role denied. Row count unchanged |
| Playwright EN+AR, port 5493 | 22/22, including F-DG1-210 in both locales. My independent r4 F-DG1-210 spec: 2/2, no document reload |
| A12 / A13 / A14 | 14/14, 5/5, 5/5 in both runs |
| A18 clean start | PASS |
| A20 token propagation | PASS, EN and AR |
| Validators (`--register DG1`, `--pipeline`, `--reconcile`) and `check-ci-needs` | All PASS |
| `deps:verify` (not assigned) | **BLOCKED**: needs registry network |

## F-DG1-125: verified (CLOSED_VERIFIED)
- X6–X8 pass on the candidate. They fail on the pre-fix testkit, which shows the self-checks detect the defect.
- A real planted module file that imports `node:process` turns the module-tree check red.
- My 12-case probe catches every other route: namespace import, bare `process`, `require`, dynamic `import()`, re-export, TS import-equals, side-effect import and `_linkedBinding`. The global forms are still caught by rule 3, and a benign control stays clean.
- The change is test-only. Only the testkit and its test changed under `apps/`, and the testkit is imported only by `*.test.ts` files.
- Cosmetic: the X6–X8 titles say "round-4 lint", though these forms were missed by the round-5 lint.

## F-DG1-126: verified (CLOSED_VERIFIED)
- The frozen suite gives 13 PASS, including AC-10.
- AC-1 (effect) as written is BLOCKED only by registry access. Its offline equivalent passes, and it exercises the new pnpm-ls path for a single-package root.
- AC-10 fails on the pre-fix installer.
- AC-10 asserts only the root as a positive destination, so I wrote my own member probe. It passes 5/5:
  - a non-root member gets node_modules;
  - a `!`-excluded package and a publicHoistPattern directory get nothing;
  - a member name with `]` and `"` works, and so does a nested member;
  - an out-of-root `packages:` pattern is refused and the install fails closed.
- Observations, not findings:
  - an array the parser cannot JSON-parse is skipped rather than failing the install;
  - an out-of-tree `file:` dependency would make installs fail closed.
  - Neither applies to the committed tree.

## New finding
**F-DG1-212 (Low, non-mandatory, REQ-DLV-042).** REQ-DLV-042 cites `docs/delivery/test-evidence/DG1/orchestrator/install-sandbox-acceptance.log`, which is still the 13-case run of the pre-fix installer (regenerated 11:02Z, before `3037ce2` at 12:07Z). It has no AC-10. D-052 and the F-DG1-126 fix summary claim "14/14", but no such log is persisted in the repository. This is the F-DG1-211 defect class again: the evidence record is stale, while the behaviour verifies. Suggested repair: regenerate the log from the frozen 14-case suite where registry access exists, and keep the register citation pointing at it.

## Not checked / BLOCKED
- `deps:verify`: no registry network.
- AC-1 (effect) as written: no registry network. The offline equivalent passed.
