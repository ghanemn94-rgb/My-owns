# DG2 round 5: domain review (T-DG2-REV-DOM-R5)

**Verdict: PASS. No new findings.** I checked the candidate `sha256:2f81c60ab1347986b3a2c31f8cd7642e0f8e4c0b6de59f1636f05268f3558c46` (526 files, source 96a3c293). I had no open finding to verify, so there is no verifications sidecar.

## What changed since round 4 and why it is still faithful
D-065 changed three things. I checked whether each one still respects the playbook and both languages.

- **Visible-content rule (F-DG2-180).** The rule is now `[^\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}⠀]`.
  - **Still counts as content:** Arabic letters, harakat and shadda (even alone), tatweel, Arabic-Indic and extended digits, ﷼, the Saudi Riyal sign U+20C1, SAR amounts, ٪, emoji with VS16, ZWNJ inside a word, dashes and bullets. Results were identical on Node 22 and Node 24 (`predicate-table.log`).
  - **Refused live with 400 `validation.blank`, version unchanged:** VS16 only, VS16 with CGJ, U+0001, a lone surrogate, Mongolian FVS, a tag character, a Khmer inherent vowel, and RLM+LRM+ALM.
  - **In the UI (EN LTR and AR RTL):** both invisible classes show the localized inline message, and no request is sent.
- **Arabic with directional marks.**
  - Seven charter fields and the change summary, written in Arabic with leading and trailing RLM, ALM and bidi isolates, were stored code point for code point, and B0041 passes.
  - An Arabic outcome, an archive reason, a North Star, a T04 title, a T03 current state, a pain point and a workshop item were also stored verbatim.
- **UTF8 database.**
  - `mth-db migrate` refuses a SQL_ASCII database with exit 1 and creates zero tables.
  - On UTF8, a 200-character Arabic name (401 bytes) is accepted and a 201-character one is refused. `char_length` counts code points (23 characters against 46 octets).
- **OIDC display name.** This affects only identity presentation, not the methodology.

## Source fidelity (full re-review)
These checks ran against the live API and the rendered screens:
- **Verbatim playbook text:** B0009 modes (EN and AR screens), B0018 roles, B0023 gate names, B0029 workstreams, B0039-B0043 scope checks, B0056 design questions and B0062 canvas prompts.
- **Gates:** G2 and G3 before G1, and G3 before G2, are refused with 422. G1, G2 and G3 were decided by a separate demo Sponsor, and the phase advanced Diagnose → Define → Design → Mobilize. G4-G6 stayed draft.
- **Charter:** the 14 B0035 fields and their versions, the 3-5 top-outcome warning, and the four-part B0037 thesis, flagged incomplete when a part is blank or invisible.
- **Define:** exactly one current North Star; the good outcome test fails "Launch new app"; zero guardrails block G2.
- **Registers:**
  - T01 has the six dimensions and H/M/L confidence.
  - T02 requires a target date.
  - T03 refuses a row without a dimension and keeps all 6 columns.
  - T04 generates D-01, D-02… with status Open, options A/B/C and all 7 columns.
- **Design:** the capability heatmap links to a T03 gap with a sourcing need. A journey's cycle time is a decimal, and pain points link to T01. A workshop item converts to T04 (refused without an owner). The per-dimension view returns the seven elements.

## Invariants
- The brand is provisional (Provisional / مؤقت) and nothing claims PMI or certification; the about text disclaims both.
- Money is `numeric(20,4)`.
- An unquantified value pool has a null amount, not 0.
- Product gates are G1-G6 only and never touch DG0-DG7.

## Checks
- **Both Node versions:** typecheck, build, lint, unit tests (640/640) and contrast all exit 0. My first Node 24 loop exited 127 because pnpm was missing from PATH; that was my harness error, and the re-run passed.
- **Live runs:** the live scenario passed 99/99, the design registers 11/11 and the EN/AR UI 14/14.
- **Environmental residuals:** D-057 (registry), D-058 (CI) and D-049 (Keycloak) are recorded as PASS on the offline/config surface.

## Observation (not a finding)
The inline blank message reads "Enter some text; spaces alone are not a value." It is also shown for invisible-only input. That is still correct and localized, though the wording names only spaces.
