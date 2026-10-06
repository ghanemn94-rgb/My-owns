# DG2 round 8: domain-reviewer narrative

**Verdict: PASS.** No new findings, no sidecars (there was no open finding to verify).

- **Candidate:** `sha256:9331e9d13e0ffa55f35ebc25ecdf9b60e159876dc2470fe56e9241a40fea124f` (539 files), recomputed in the repository and in the disposable clone.
- **Source:** cf3446e4. The freeze commit is 4053630c. `validate.mjs --historical --stage DG1` passes.

## What changed since round 7 (D-068) and its domain effect
- **Strict UTF-8 request decoding.** Bodies and query strings are now decoded strictly. This is a transport-layer change. The diff touches no i18n file, seed, methodology catalogue or migration.
- **Verbatim text is unaffected.** I sent raw UTF-8 bytes of Arabic text with emoji, RLM/LRM and ZWJ, both with Content-Length and chunked. The text is stored code point for code point (63/63), and a leading BOM is accepted.
- **Bad bytes are refused.** I tested 0xFF, a truncated Arabic lead byte, a CESU-8 surrogate and an overlong `/`. Each gives the declared 400 `validation.json` problem and stores nothing. The AR and EN messages exist.
- **Arabic search still works.** I sent queries the way the web client builds them (`+` as a space, `%2B` as a literal plus, a leading RLM). They return 200 and find the Arabic-named transformation. An undecodable component gives 400 `validation.format` at `/query/q`, with a localized message.
- **429 declared on every operation.** This is contract-only. `rate_limited` has EN and AR messages.
- **Harness changes.** No product effect.

## Full re-review (all 26 requirements)
- **Live scenario: 101/101.** I walked Diagnose→Define→Design. The G1, G2 and G3 demo decisions advanced the phase to define, design and then mobilize, with out-of-sequence submissions refused (422). The gate names equal B0023.
- **Methodology content:**
  - the B0018 role texts;
  - the B0009 modes, with verbatim guidance in EN and the source text shown on the AR screen;
  - the 14 charter fields with versions;
  - the B0037 thesis, flagged incomplete for a blank or invisible part;
  - the five B0039–B0043 checks verbatim;
  - T01 with six dimensions;
  - the 10 TOM dimensions with B0056 questions;
  - the six B0029 workstreams;
  - the B0062 canvas;
  - exactly one current North Star;
  - the top-outcome warning;
  - the good-outcome test;
  - G2 blocked at zero guardrails;
  - G3 blocked without its outputs.
- **Design registers: 11/11.** Checked T03, T04, the heatmap link, the decimal journey cycle time, workshop conversion and the dimension view.
- **UI (Chromium) in AR (RTL) and EN (LTR):**
  - Arabic, emoji and RLM text is created verbatim;
  - invisible-only values show the localized inline message and nothing is sent;
  - lone-surrogate and NUL inputs are refused.
- **Invariants:**
  - `#0078FF` is provisional;
  - nothing claims PMI certification or official Mobily branding;
  - money is stored as `numeric`;
  - an unquantified value pool has a null amount, not 0;
  - only G1–G6 exist as product gates, and nothing touches DG0–DG7.
- **Checks:** typecheck, build, lint, test (691/691) and contrast all exit 0 on Node 22 and Node 24.

## Residuals
D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) were checked on their offline or config surface only, as directed.

## Note
My first offline install failed because I laid out the copied pnpm store without its `v10/` subdirectory. That was a mistake in my setup, not the product's; I corrected it and the install completed.

All data is synthetic, and every gate decision was a demo decision.
