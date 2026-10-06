# DG2 round 7 — domain-reviewer narrative (T-DG2-REV-DOM-R7)

**Verdict: PASS. No new findings.** Candidate `sha256:ede1a9362bb276ce620e440bf9f6a599f6695d395b8e495eaefec30107b016de` (532 files, source 90439483, freeze commit 36524e54). DG1 historical validation passes.

## What changed since round 6 (D-067) and its domain impact
- `hasInvalidCharacter` now also refuses lone UTF-16 surrogates (`/\p{Cs}/u`, which matches only unpaired halves). Valid astral pairs (emoji, flags, skin-tone modifiers) and Arabic text with RLM/ALM are still stored verbatim, through both the API and the UI.
- `truncateText` cuts on code-point boundaries. In the gate engine it is used only for the decision-log `outcome_text` (8000) and the good-outcome warning message. In a live run, an emoji straddling the cut produced 7999 clean units with no U+FFFD. No criterion, sequencing rule or approver logic changed.
- Router-level and connection-level errors (malformed percent escapes, oversized URLs, timeouts) now answer the localized problem+json 400. The EN and AR messages exist for the new codes.
- No change to ADRs 0015-0020, `docs/source/**`, migrations, seeds, methodology modules, or any i18n file other than `problems.json`.

## Fidelity (full re-review, live on synthetic data)
- B0009 modes: the "how" text appears verbatim in EN and AR. B0018 roles are verbatim. B0023 gate names are correct, and G1→G2→G3 are sequential (out-of-sequence submissions return 422).
- The charter has its 14 fields, keeps versions, and warns when the thesis is incomplete (B0037). The five B0038-B0043 scope checks are verbatim, each with a pre-check hint only.
- Exactly one North Star is current. The 3-5 top-outcome warning, the good-outcome test and the guardrails (G2 blocked at zero) all behave correctly.
- T01 has 6 dimensions with H/M/L confidence. There are 6 B0029 workstreams, 10 B0056 TOM dimensions and 10 B0062 canvas prompts.
- T03 and T04 have their columns. The heatmap links to gaps and the journey map uses decimal cycle times. Workshop items convert to T04 only when they have an owner. The per-dimension view works.
- Invariants hold: the brand is provisional, there are no PMI or certification claims, AR is RTL and EN is LTR, money is numeric, Unknown never shows as 0, and unquantified value pools are labelled. Product gates are G1-G6 only and never touch DG0-DG7.

## Notes
- Harness limitation, not a product defect: Playwright `fill()` turns a lone surrogate into U+FFFD before the page sees it, so that value is visible and correctly accepted. The UI probe therefore sets the DOM value in-page (`r7-ui-fill-attempt.log` documents the first attempt).
- Environmental residuals, checked on their offline or config surface only: D-057 (live registry), D-058 (live CI), D-049 (Keycloak).
- All data is synthetic. The G1-G3 decisions here are demo decisions that approve nothing real.
