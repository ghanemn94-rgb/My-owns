# DG3 round 7: qa-verifier narrative

**Verdict: PASS. No new findings.**

- **Candidate:** `sha256:f55095dbec364594d25a624261512239854f233d3ee0b5c8ecc210d1602bf6e0` (757 files, source `d3e6fe6`).
- **Record:** `qa-verifier.json`.
- **Evidence:** `docs/delivery/test-evidence/DG3/qa/round-7/`. `RUN-NOTES.md` there discloses every non-zero exit.

I formed this verdict without reading any other reviewer's round-7 record or evidence. I authored no product code; my only test is a rename-only copy of my round-6 spec, kept outside the candidate.

## Candidate

- **Same ID everywhere.** The candidate ID recomputes identically, with 757 files, in each of these places:
  - the repo working tree (HEAD `d22938f`);
  - `--ref d3e6fe6` and `--ref HEAD` at the end (HEAD `e8c188e`);
  - two complete, non-shallow clones at `d3e6fe6`.
- **HEAD moved only under `docs/delivery/`.** The new commits are the other reviewers' evidence commits.

## Round-7 repair (T-DG3-KBE-I, F-DG3-280), tested from the acceptance side

- **Scope.** The repair changes only `fuzz.test.ts`, ADR-0024 §6 and p3-work-split §9.
  - No engine source changed. Neither did `eslint.config.js`, the API, the web app, migrations or the ERD.
- **Row count.** A throwaway instrumentation shows that the lintText test now lints 99 of the 101 probe rows. The 2 "unbalanced" rows must be parse errors instead.
  - This matches the amended ADR sentence word for word, and so does the guard-rule list.
  - The documentation drift of F-DG3-280 is gone.
- **The test is not vacuous.** I weakened one guard selector at a time in a throwaway clone. Each change made the repaired test fail, naming a row that the selector covers:
  - **P1**, without `ForOfStatement[await=true]`: it fails at `for await`.
  - **P2**, without the `PrivateIdentifier` part: it fails at the new `#then` row.
  - **P3**, with the generator selector neutralised: it fails at G1.
  - **P4**, without the `Literal` part: it fails at `{ ["then"]: t }`.
  - The control passes before and after, and the tree is clean after each restore.
- **Regression of the round-6 probes:**
  - **Static:** lint refuses 14/14 round-6 forms and 17/17 round-5 forms, in both `parse.ts` and `value.ts`. Neither allowed shape is flagged, and the scan fails as it should. The per-line results are identical to round 6.
  - **Run-time:** with code generation disabled, mutations M1–M4 fail 73, 24, 4 and 103 tests with EvalError, identical to rounds 5 and 6. The normal process passes 280/280.
- **Unchanged formula behaviour:**
  - `formatDecimal` still returns null (shown as Unknown) for every invalid input.
  - The formula API keeps its 422 responses (A9-R4, 12/12).
  - The formula acceptance values are exact: 100000, 100000 and 151852.11 SAR. Monthly ARPU × annual population is refused.

## Full regression

| Area | Result |
|---|---|
| Static (7 commands) | All exit 0. OpenAPI has 270 operations; contrast passes 50 pairs, and the 3 prohibited pairs fail as documented. |
| `pnpm test`, Node 22/24 × locale unset/C.UTF-8 | All 4 configurations green on the first run. Invocation 1: 1654 passed. Invocation 2 (no-codegen): 259 passed + 2 skipped by design. The +3 tests versus round 6 are the repair's new tests. |
| Integration × 2 (fresh PostgreSQL 16) | 793/793 each time. 27 migrations; all pending lists empty; all 270 operations live. |
| e2e × 2 settings, chromium-en/ar, `--workers=1` | 216 passed, 2 failed (F180b, by design), 0 skipped, 0 flaky. Per-spec counts are identical to round 6. |
| axe | 0 violations of any impact on 1392 page analyses per setting; 32/32 QA axe checks pass. |
| AUD read-only | 17/17 AUD checks per project and setting. |
| Requirement trace | All 32 requirements have only passing checks, in en and ar, in both settings. |
| S16 entities | All 8 have a primary key and owner/status columns, and appear in the ERD; identical to round 6. |
| Validators | Register, pipeline, historical DG2 and historical DG1 all PASS, both at the start and at the end. |

## F-DG3-180 and the F180b observation

- **F180:** 7 of 7 badges are inside their gate card or field in every project and setting, so F-DG3-180 still holds.
- **F180b:** it fails only at the known state of 390 px with 200% text.
  - In all 7 rows of that state, the badge is inside its card, not clipped and not overlapping.
  - The pre-existing gate grid widens the document to 505 or 633 px.
  - This is the same observation as in rounds 3–6, and it is not a finding.

## Environmental residuals (PASS on the offline surface)

- **Live registry** (D-057): only the offline frozen-lockfile install was checked.
- **Live CI** (D-058): the CI commands ran locally instead.
- **Keycloak** (D-049): the e2e stack uses dev auth, and the integration tests use the in-process test IdP.
