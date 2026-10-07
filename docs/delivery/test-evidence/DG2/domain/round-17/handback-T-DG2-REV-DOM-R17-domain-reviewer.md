# Handback: T-DG2-REV-DOM-R17 (domain-reviewer, DG2 round 17)

**Path note.** The assignment names `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R17-domain-reviewer.md`, but the write guard refuses that path for domain-reviewer ("outside role write scope"). This handback is therefore in my evidence directory, as in rounds 15 and 16. The assignment and the write scope still contradict each other; please reconcile them.

Two smaller assignment discrepancies:
- The assignment places `r16-identity-nav.mjs` under `round-17/`, but it lived in `round-16/`. I copied it there unchanged (same sha `ace1063d…`).
- Round-16's `probe-sha256.txt` recorded the hash of `r16-identity-ui-attempt1.mjs` under the fixed probe's name. Details are in `env.txt`.

## Summary
- **Candidate:** `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750` (564 files).
  - Recomputed on the repo and on a disposable clone, before and after the runs.
  - Source `805da3e2`, frozen at `23edabf`.
  - DG1 historical validator: PASS.
- **Verdict:** PASS. No new findings.
- **F-DG2-570 (mine, Low): PASS → CLOSED_VERIFIED** (`domain-reviewer.verifications.json`).
  - My round-16 reproduction `r16-identity-nav` now passes 5/5 in EN and AR, with raised and with default limits. In-app navigation asks `/me` before page data, and the header, permissions and data belong to B.
- **D-077 residual: challenged and accepted.**
  - My new probe `r17-identity-residual` reproduces it exactly. A non-navigation filter GET sent inside the 2 s window is fetched under B's cookie while A's header is still shown.
  - The next uncached GET after the window asks `/me` first and switches to B. A navigation inside the window switches at once.
  - It is bounded and discloses nothing: the data belongs to the current cookie holder, who signed in from the same browser, and writes carry A's CSRF token.

## Files written (review records and evidence only)
- `docs/delivery/reviews/DG2/round-17/domain-reviewer.json`: the review record.
- `docs/delivery/reviews/DG2/round-17/domain-reviewer.verifications.json`: the F-DG2-570 verification.
- `docs/delivery/test-evidence/DG2/domain/round-17/**`:
  - logs, scripts and the cited screens;
  - `env.txt`, which explains every non-zero exit;
  - new probes `r17-identity-residual.mjs` (plus attempts 1 and 2) and the diagnostic `r16-identity-ui-diag.mjs`.

## Checks actually run (all on the frozen candidate in a disposable clone)
| Check | Result |
|---|---|
| Typecheck, build, lint, test and contrast on Node 22.22.2 and 24.21.0 | Each exit 0. Tests: 50 files, 926/926. Contrast: 50 pairs pass; the 3 prohibited pairs fail as documented. |
| Source fidelity | 24/24 |
| Live API scenario | 101/101. G1→G2→G3 sequential (demo decisions, synthetic data); out-of-sequence attempts 422. Arabic + RLM accepted verbatim. Invisible-only values refused. |
| API delta and regression probes | 8/8 probes pass; design-registers 11/11 |
| UI in EN and AR: sign-in, charter, evidence, Team, journey steps, Design, Gates, walk | All pass. Evidence download byte-identical (300281 bytes, same sha). |
| Create, edit and archive (UI) | 7/7 |
| Access withdrawn; shutdown | 5/5; 2/2 |
| Session end and language notice | r13 4/4, r14 31/31 (raised and default limits); language 20/20 |
| Identity probes | r15 13/13; r16 5/5; r16-identity-nav 5/5; r17-identity-residual 5/5 (raised and default limits) |
| Invariants, UTF8 fail-closed, environmental residuals | Pass (residuals D-057, D-058 and D-049 checked offline only) |

**Non-zero exits.** All are explained in `env.txt`:
- r17-identity-residual attempts 1 and 2 failed on mistakes in my probe.
- In stack-run-7 (default limits), r16-identity-ui ran right after probes that had used up the 20/min auth budget. LoginPage's dev-login availability probe then got 429 and hid the dev-only sign-in form.
  - The diagnostic run (stack-run-8) confirmed this cause.
  - Run first (stack-run-9), the probe passes 5/5.
  - This is pre-existing dev-mode behaviour, not an FE15 or domain defect.

## Known gaps / not done
- Live registry, live CI and Keycloak/OIDC sign-in were not exercised live (D-057, D-058, D-049).
- I did not read any other reviewer's round-17 record.

## Merge instructions
None. The runner copies back the review files. The disposable clone, the store copy and all scratch were removed.
