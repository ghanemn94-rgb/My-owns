# qa-verifier: DG4 review round 6 (T-DG4-REV-QA-R6)

**Verdict: PASS** on candidate `sha256:f966fe5728e260b87544093d27faccb379195391894fafab6f567952f6bfe536` (1472 files, source `1e0dc5d`). I confirmed it on a complete clone at the start and at the end of the review.

- **My round-5 finding F-DG4-145 verifies CLOSED** (`qa-verifier.verifications.json`).
- **Three new findings,** all Low and non-blocking. They concern test determinism and coverage, not the product: F-DG4-146, F-DG4-147 and F-DG4-148.
- **Evidence:** `docs/delivery/test-evidence/DG4/qa/round-6/`. `RUN-NOTES.md` explains every non-zero exit.
- **My tests** are outside the candidate, in `docs/delivery/test-evidence/DG4/qa/tests/round-6/`.

## F-DG4-145: verified CLOSED

**The repair** is tests only. `session-bound`, `session-identity` and `session-generation` now control `Date.now`, so the 2 s identity-recheck window is crossed only where a test says so.

- No assertion is weakened.
- Y1c still requires exactly two `GET /me` after the create, and gains four new assertions.
- The new window case requires exactly one revalidation, sent first.

**Contention, repeated.**

- **Whole suite:** 8 full `pnpm test` runs on Node 22/24, with the locale unset and C.UTF-8. Four ran at load 20–30, and four with the load held at 13–15 (median 13.9). The session files pass 80/80 in every one. In round 5, every run at 13–15 failed on the Y1c count.
- **Pinned reproduction** (one CPU shared with 3 busy loops):
  - The pre-repair file still fails the count, 2/2.
  - The candidate never fails the count.
  - With only the Y1c cases, the candidate passes 2/2. The same file with its clock removed fails 2/2. So the clock is the fix.

**Mutants.** I broke the identity rules in `client.ts` one at a time.

| Mutant | What it breaks | Caught? |
|---|---|---|
| M1 | Window ignored | Killed |
| M2 | Window never crossed | Killed |
| M3 | No navigation confirmation | Killed |
| M5 | No generation check | Killed |
| M6/M6b | — | Equivalent (TanStack Query dedupes `/me`) |
| M4 | A page GET does not wait for the `/me` in flight | **Survives** all 1340 unit-web tests, before and after the repair: F-DG4-146 |

**On the real stack**, my new probe passes 14/14 checks per language in both locale settings.

- `GET /me` is sent first, and once, per navigation.
- No `/me` is sent while idle.
- After another sign-in in the same browser, the next page shows the new identity.

## New findings (all Low, non-mandatory, owner frontend-ux-engineer)

- **F-DG4-146.** No test pins "a page GET waits for the identity check in flight". My held-`/me` test passes on the candidate and kills M4, so it is a ready template for the fix.
- **F-DG4-147.** `session-end.spec.ts` "a 403 is not a session end" failed once (ar, locale unset): it expected 403 and got 200.
  - **Cause**, from the trace: the SPA's boot `GET /me` went out after `page.goto` returned and after the test's re-login. It therefore correctly adopted the new session's CSRF token.
  - **Elsewhere** it passes: in the C.UTF-8 full run, and solo in both projects.
- **F-DG4-148.** `pnpm test` is not reproducible at load ≥ 13.
  - Under contention, the first render of a page module misses unit-web's 5 s wait. This hits fe-e, prioritization, p2-blank-forms, raid and sustain, all in `en` first.
  - `architecture.test.ts` misses its 30 s timeout.
  - At load 3–9, all four runs pass.

## The full review

| Check | Result |
|---|---|
| Static | 7/7 exit 0. |
| Unit | `pnpm test` 4/4 EXIT 0 at load 3–9: 2917, plus 259 passed and 2 skipped by design. |
| Integration | 1975/1975, twice. 61 migrations (`0001`→`0061`; the assignment says `0060`, and the candidate ships `0061`). `contract.test.ts` 45/45. 0 p4-pending entries. |
| `tests/qa` alone | 172/172. |
| REQ-DLV-036 | 85/85: A04 12, A09 17, A10 16, A11 40. Plus the A04 and A08/A09 e2e specs in both projects. |
| e2e, locale unset | All 364 tests counted. 334 passed, 13 failed, 17 did not run. 12 of the failures are 30 s timeouts at load up to 30; the 13th is F-DG4-147. |
| e2e, C.UTF-8 | All 364 tests counted. 359 passed, 2 failed (both timeouts), 3 did not run. |
| e2e solo re-runs | Every failed spec passed alone in the same locale setting. "Define → G2" is a DG2 journey that runs 24–33 s against its 30 s limit (D-111/112/115). |
| My round-5 and round-4 probes (regression) | 546 + 77 checks per language, 0 failed, in both locale settings. They cover AUD read-only, 390 px, 200 % text and axe on the P4 screens. F-DG4-143/144 stay closed. |
| Validator | 5/5 PASS. |
| Trace | 137/137 rows covered with no unresolved failure. The partial disclosures are unchanged and acceptable. |

**My own probe defects, disclosed.** My session probe needed two revisions, and both earlier failures were defects in my probe:

- **Revision 1:** its second tab hit `/login` while signed in.
- **Revision 2:** under load, the navigation's requests were reported after my wait returned.

## Boundaries

- All data is synthetic.
- No product gate (G1–G6) was decided, and product G6 never implies DG7.
- The environmental residuals (live registry D-057, live CI D-058, Keycloak D-049) remain as assigned. They are recorded as PASS on the offline surface.
