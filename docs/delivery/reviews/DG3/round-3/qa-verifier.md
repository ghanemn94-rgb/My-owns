# DG3 round 3: qa-verifier (rerun R3B), narrative

**Verdict: PASS.** Candidate `sha256:f2b4c77a026c6825d323cdc89782d63410ec9ead05666e06d90a4d51988d1d1d` (source `ce988e20`, 757 files). No new findings. F-DG3-180 is verified CLOSED (`qa-verifier.verifications.json`).

Everything ran in one disposable, complete clone under `$TMPDIR`, which was removed at the end. The candidate ID recomputes identical at the start, in the clone, and at `--ref HEAD` at the end. I did not read any other reviewer's round-3 record, nor the orphaned first round-3 qa run. Details and every non-zero exit are in `docs/delivery/test-evidence/DG3/qa/round-3/RUN-NOTES.md`.

## F-DG3-180 (inherited-approval badge overflow)

- **My round-2 probe `F180`**, unchanged, passes in chromium-en and chromium-ar under both locale settings. All 7 of 7 badges are inside their card or field; in round 2, 7 of 7 (en) and 4 of 7 (ar) were outside.
- **The new probe `F180b`** adds the widths and states that neither F180 nor the product spec covered. It measures all 5 badge states on the Gates list and the G1 view, at 320, 390, 768, 900, 901, 1024, 1280, 1366 and 1920 px, and at 200% text at 1280 and 390 px.
  - In every row the badge is inside its box, wraps, is not clipped and overlaps nothing.
  - Every other status chip still has `nowrap`, so the fix is scoped to the badge.
  - In 70 of 77 rows per run, the clause "(does not approve this gate)" is also fully inside the viewport, with no horizontal scroll.
- **The 7 failing rows** are the single state 390 px + 200% text.
  - The pre-existing gate grid (`minmax(18rem, 1fr)`, unchanged since DG2) makes each card 576 px wide, so the page scrolls horizontally. The badge and its clause stay inside the card, and the clause is reachable by scrolling.
  - That state is about 195 CSS px of effective width, below WCAG 1.4.10's 320 px reflow requirement, and 1.4.4 allows horizontal scrolling.
  - I record it as an observation about the grid, not as a residual of F-DG3-180. It is why `F180b` exits non-zero; the failure is disclosed and explained.

## T-DG3-KBE-E (formula guard), from the acceptance side

- **The new static rules pass on the shipped code** (`pnpm lint`, max-warnings 0).
- **A throwaway probe file with 15 forbidden forms** is refused (25 errors).
- **The run-time layer works.** I injected a key assembled at run time, which the static rules cannot see by design.
  - Lint and a normal test process both pass with it.
  - `unit-formula-nocodegen` fails 25 tests with EvalError, and `pnpm test` exits 1.
  - Mixing that project with others is refused at startup.
- **`pnpm test` runs both invocations**: 1587 tests, then 190 tests from the no-codegen invocation.
- **The formula acceptance is unchanged**: 3.30 shows 57.5; 100000 SAR (twice); 151852.11 SAR; the period mismatch and undefined variable are refused.

## Full regression

| Area | Result |
|---|---|
| Static (typecheck, build, lint, openapi 270 ops, no-cdn, format, contrast) | all exit 0 |
| Unit: Node 22 and Node 24, locale unset and C.UTF-8 | 1587 + 190 tests |
| Integration, twice | 793/793 each; 27 migrations; pending lists empty |
| e2e product journeys + A20, per setting | 182/182 (round 2: 172, plus the new inherited-approval spec 5 per project) |
| e2e QA literal acceptance checks | 163 per project per setting, 0 failed |
| Axe | 1392 product page analyses with 0 violations; 32 QA axe checks with 0 failures |
| AUD | read-only throughout |
| Validators (register, pipeline, historical DG2 and DG1) | all PASS |

**Disclosed unit flake.** Once, under host load (~8 on 4 vCPU), the DG2 test `session-identity.test.tsx` F-DG2-500 (en) timed out on `findByText`. That run showed user B's own page, and A's data was absent. The rerun and 8 isolated repeats were all green, so I classify it as timing, not a defect.

**Residuals (not BLOCKED):** live registry, live CI and Keycloak, as listed in the assignment.

All data is synthetic. Product gates G1–G6 are business approvals inside the product; none of them implies an engineering gate DG0–DG7.
