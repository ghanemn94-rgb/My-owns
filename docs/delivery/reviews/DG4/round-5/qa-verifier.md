# qa-verifier: DG4 review round 5 (T-DG4-REV-QA-R5)

**Verdict: PASS**, on candidate `sha256:69b7412a0a360135863a80a5ee32ee947aff0d7f05615589cf6457e054cf0e86` (1472 files, source `3e3a06e`), confirmed on a complete clone at the start and at the end.

- **My round-4 findings both verify CLOSED** (`qa-verifier.verifications.json`).
- **One new non-blocking finding:** F-DG4-145 (Low).
- **Evidence:** everything is under `docs/delivery/test-evidence/DG4/qa/round-5/`. `RUN-NOTES.md` explains every non-zero exit.
- **My probes:** they live outside the candidate, in `docs/delivery/test-evidence/DG4/qa/tests/round-5/e2e/`.

## F-DG4-143: verified CLOSED

I re-ran my round-4 world as the read-only auditor. It holds a SAR avoided cost planned only in 2099, beside margin and revenue uplift planned in 2026-H1. I ran it on T10 and the Executive Overview, in EN and AR, with the locale unset and with C.UTF-8.

- **The non-cash SAR line** reads "Not applicable (n/a) — Not applicable: nothing is planned to date". It has `data-value-state="not_applicable"`, no number and no green. It never reads Unknown.
- **The real unknown line.** I added a world with a planned avoided cost that has a KPI value and no amount. The API sends `unknown / benefit.value_amount_missing`, and the screen reads "Unknown — Unknown: a value amount is missing", never n/a, 0 or green.
- **The other lines and the area.** The valued lines read "100 %". The area is Red, because red outranks unknown under ADR-0037 §3.
- **The round-4 checks** of Portfolio, drill-down and outcomes still hold.
- **Accessibility and layout:** axe reports no serious or critical issue, and there is no overflow at 390 px or at 200 % text.

## F-DG4-144: verified CLOSED

**My round-4 probe, unchanged,** now passes in EN and AR in both locale settings. **My new probe** uses a business unit of its own with 54 transformations: 3 enter at Design and 2 are active. It tries each remedy the note names, through the UI chips, on all three dashboards that share `useOrgQuery`:

| Remedy | Result |
|---|---|
| Phase = Design | Requests exactly the 3 Design ids. |
| Status = active | Requests exactly the 2 active ids. |
| A narrowing that matches nothing | Shows the new `none_matching` note and sends nothing. |
| Phase = Diagnose (51 remain) | Still shows `too_many`, so the limit is not bypassed. |
| The transformation chip, with the 54th transformation by code | Requests exactly that id. |
| Another unit's transformation under this unit's chip | Shows `none_matching`; that transformation is never requested. |
| The transformation's own dashboard | Renders. |

- There are 77 checks per language in each of the 4 language × locale runs, and 0 failed.
- The server filters `current_phase` and `status` and excludes archived transformations, as the dashboard scope does.

## The full review

- **Static:** 7/7 exit 0.
- **Integration** (61 migrations, `contract.test.ts` included): 208 files / 1975 tests, twice. All 47 `p4-pending` arrays are empty.
- **`tests/qa` alone:** 15 files / 172 tests.
- **REQ-DLV-036:** A04, A09, A10 and A11 pass with 85 tests in integration, plus the A04, A08 and A09 e2e specs in both projects.
- **Validator:** 5/5 PASS.
- **Trace:** 137/137 rows covered. The partial disclosures are unchanged and acceptable.
- **The repair diff** is web-only. Nothing in it is weakened. p4-dashboards test 3 now passes in full runs, and my round-4 API probe still passes 5/5.

## Every non-pass, explained

**e2e.** Both full runs completed and counted all 364 tests each.

- Locale unset: 5 failures. C.UTF-8: 1 failure.
- Every one is a 30 s test timeout at load averages of 9–19 while three reviews ran together (D-111/112/115).
- Every failing spec passes alone in both locale settings, 74/74 each.

**Unit.**

- `pnpm test` failed in all four runs at load 13–15, on one DG2 test: `session-bound.test.tsx` Y1c (en).
- **Mechanism.** The test counts `GET /me` with real timers. The product correctly revalidates `/me` after its 2 s window, so under contention the third request is right.
- **Reproduction.** I forced CPU contention on the file alone: it failed 2/2 on this candidate and 2/2 on the round-4 source.
- **Lower load.** All four `pnpm test` runs pass at load 1.5–5: 2915 tests, plus 259 passed and 2 skipped by design.
- This is a pre-existing test-determinism defect, not a regression and not a product defect. I raised it as **F-DG4-145 (Low)**.

**My own sweep.**

- Revision 1 recorded one failing check twice with C.UTF-8: `S2-lead-/dashboards/rag-policy-390px`.
- A 24-attempt diagnostic shows the page always renders its h1 together with the no-permission state.
- My helper's `h1.or(denied)` then matched two elements, a Playwright strict-mode error, so the defect was in my probe.
- Revision 2 fixes only that, and passes with 0 failed checks in both locale settings.

## Boundaries

- All data is synthetic.
- No product gate (G1–G6) was decided, and product G6 never implies DG7.
- The environmental residuals (live registry D-057, live CI D-058, Keycloak D-049) remain as assigned, recorded as PASS on the offline surface.
