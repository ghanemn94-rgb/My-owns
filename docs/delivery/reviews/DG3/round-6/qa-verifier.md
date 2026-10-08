# DG3 round 6: qa-verifier narrative

- **Candidate:** `sha256:7049d793cd20ed7718e84ff4aa3bf940f99b5e2507e964660ef3b3545c1f3c96` (757 files), source `c40232b`.
- **Verdict:** **PASS**.
- **New findings:** none.

## Candidate and independence

I recomputed the candidate ID in the repo at the start (HEAD 36411df) and at the end (HEAD 00cb9fa, `--ref HEAD` and `--ref c40232b`), and in two complete disposable clones of c40232b. It was identical every time. HEAD moved during the run with 0 files outside `docs/delivery/`.

I authored no product code. I did not read any other reviewer's round-6 record or evidence.

## The round-6 repair (T-DG3-KBE-H), from the acceptance side

- **No engine source changed.** The diff of the formula sources and `value.ts` since round 5 is 0 lines. `apps/web`, `packages/db` and the ERD have no diff either.
- **The new lint and scan rules refuse what they claim to refuse.** I appended 14 round-6 forms in my own spellings to both `parse.ts` and `value.ts`. Lint flags every form line (14/14), and the source scan fails.
  - Generators: declaration, method, class method, expression, and a generator whose finally returns plus `return()`.
  - `then`/`catch`/`finally` as a destructured name, a string key, a template, a private name, a thenable method and a key.
  - `fromAsync` (member and string key) and `Symbol.asyncIterator`.
- **The round-5 forms are still refused.** All 17 (W1/W2/W4/W5, R1–R13) are still refused, with 17/17 flagged.
- **No false positive.** The allowed rethrow shape and a plain `try/finally` are not flagged.
- **The run-time layer is unchanged.** An exercised code generation in each of the 4 catch sites still fails the no-codegen invocation with EvalError (73/24/4/103 failures, identical to round 5). The normal process passes each one.
- **`formatDecimal` still returns null for every invalid stored value** (Amount renders null as Unknown), and formats valid decimals.
- **The formula API keeps its 422 behaviour.** A9-R4 passes: invalid formulas get 422 (never 500 or `internal`), and a valid formula gets 200.
- **The formula acceptance is unchanged.** It holds exactly: 100000 SAR for 0.10→0.12; 0.02×100000×50 = 100000; the cost example 151852.11; and monthly ARPU × annual population is refused.
- **`pnpm test` runs both invocations.** Each runs 1651 tests, then 256 + 2 skipped (+37 and +36/+1 versus round 5, all in `fuzz.test.ts`). The 2 skips are the two ESLint tests, which run in invocation 1.
- **ADR-0024 §6 and the domain sentences.** They were narrowed in wording only. The semantics I test are unchanged: fractions, decimal-only evaluation, a single rounding, `too_deep`, and `kind_mismatch`.

## Full regression

| Area | Result |
|---|---|
| Static | `typecheck`, `build`, `lint`, `openapi:lint` (270 operations), `no-cdn`, `format:check` and `contrast` all exit 0. |
| Unit | Node 22 and 24, each with locale unset and with C.UTF-8: all green, after one rerun of Node 24 unset (below). |
| Integration, twice | Fresh PostgreSQL 16 each time, 27 migrations. 56 files and 793 tests pass in both runs. Every `p3-pending-*` list is empty, and the contract test covers every live operation. |
| e2e, twice | Locale unset and C.UTF-8, chromium-en and chromium-ar, `--workers=1`. 216 passed and 2 failed each time. Per-spec counts are identical to round 5. My 166 recorded checks per project pass, 0 failed. |
| Axe | 0 violations of any impact across the product summaries. My 32 axe checks pass. |
| AUD read-only | 17/17 checks per project pass. |
| Requirements | All 32 requirements trace to passing checks in both languages and both settings (`04-requirement-trace.txt`). |
| F-DG3-180 | Holds. F180 shows 7 of 7 badges inside, in both projects and both settings. |
| Validators | `--register DG3`, `--pipeline`, `--historical --stage DG2` and `--historical --stage DG1` pass, both at the start and at the end. |

## Disclosed failures

1. **One unit-web test failed under host load.** The run was Node 24 with locale unset, and the load average was about 13–14 on 4 vCPU. The test is `session-identity.test.tsx` "signing out here clears everything…": `findByText` timed out at 5.8 s, and no data leaked.
   - The file is unchanged since DG2.
   - The rerun of the same configuration is green on both invocations, and the file alone passes 8 of 8 repeats.
   - It is the same load flake I disclosed in round 3. It is not a finding.
2. **F180b fails as designed** (line 1813), in both projects and both settings: 7 of 77 rows, all at 390 px + 200% text.
   - The pre-existing gate grid makes the document 505 or 633 px wide. Each badge stays inside its card, unclipped and without overlap.
   - This is identical to rounds 3–5: an observation, not a finding.
3. **The probes exit non-zero by design**, as described above.
   - One M3 placement slip in my own probe was corrected and is disclosed in RUN-NOTES.

## Observation, not a finding

The G4 refusal's `g4.finance_validation` message repeats "Finance validation" once per unvalidated item. It is unchanged since round 5, and the acceptance text holds.

## Environmental residuals (offline and configuration surface only)

- **Live registry** (D-057): not reachable here. The offline frozen-lockfile install is my evidence.
- **Live CI** (D-058): not run. The same commands ran locally.
- **Keycloak** (D-049): not available. The tests use dev auth and the in-process test IdP.

Full details are in `docs/delivery/test-evidence/DG3/qa/round-6/RUN-NOTES.md`.
