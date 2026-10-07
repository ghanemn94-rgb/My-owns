# DG2 round 15: domain-reviewer narrative

**Candidate** `sha256:3f01c61090435f114b52150d1ab73818839530ede08a4c07d04936175f7fe8f9` (561 files, source `ed80b234`, freeze `9236a9f`). **Verdict: PASS. No new findings.**

All data is synthetic. The G1, G2 and G3 decisions I made are demo decisions; they approve nothing real and are unrelated to DG0–DG7.

## What changed since round 14
The manifest delta is the FE13 web session files (`client.ts`, `queries.ts`, `App.tsx`, `session.tsx`, a new unit test, the e2e spec) plus `decisions.md`. There is no API, DB, catalogue or i18n change.

FE13 makes two changes:
- The API client's session-end transition now calls a reset hook registered once per `QueryClient`. The cache is therefore cleared whatever page is mounted.
- A `/me` answer with another organization, user or session (identified by its CSRF token) purges every query except `/me`. The signed-in subtree is keyed by the person.

## User outcome of FE13, in a real browser (EN ltr, AR rtl)
I used my own probe, `r15-identity-ui.mjs`.

- **S1, the F-DG2-500 path.**
  - A opens `/login?returnTo=%2Fmy-work`. The wordmark pushes an in-document `/login` entry. A signs in and sees their A-only transformation.
  - A's session ends outside the page. Back returns to the in-document `/login` entry (0 document loads), and its `/me` re-probe gets the 401.
  - B signs in with the form in the same tab. B's list requests are delayed 3 s.
  - Result, in EN and AR, with raised and with default limits: A's record and A's name appear in **0** samples on My work and on Transformations. B's name is shown, with the correct direction.
- **S2, identity changed in another tab.** Once tab 1 re-asks `/me`, B's name is shown and A's record and name are gone. They are never shown together.

**Observation (not raised as a finding).** `useMeQuery` uses a 60 s `staleTime`; other queries use 15 s.
- Suppose another tab signs A out and signs B in, and tab 1 is refocused between about 15 s and 60 s after its last `/me`. Tab 1 then refetches the stale lists under B's cookie, so A's record disappears. But it keeps showing A's name in the header until `/me` itself is stale (attempt 4 log: `tab1MeAfterRefocus=0`).
- No record of A's is shown to B. The stale label is A's own name, in a tab A left open, for at most 60 s, and it corrects itself.
- D-075 promises the purge only when `/me` returns another identity, which is what I observed. I leave the timing to the code-security reviewer's judgement.

My earlier attempts at this probe failed for reasons in the probe, not the product. Each attempt is kept with its log, and each is explained in `env.txt` and in check DOM-R15-11.

## Full re-review (26 requirements)
- **Static source fidelity: 24/24.** Rows extracted from `playbook.md` match the product verbatim: B0009 modes, B0018 roles, B0023 gates, B0039–B0043 scope checks, B0062 canvas cells, B0029 workstreams, B0056 dimensions, the 14 B0035 fields and the B0037 thesis connectors.
- **Live API (stack-run-1).** live-scenario 101/101, design-registers 11/11 and 8 regression probes all pass.
  - Gates advance sequentially and answer 422 when out of sequence. Gate names follow B0023.
  - Exactly one North Star is current.
  - The 3–5 top-outcome warning and the good-outcome test work.
  - G2 is blocked with zero guardrails.
  - The charter's thesis and scope checks work.
  - Arabic text with RLM marks is stored verbatim, and invisible-only values are refused.
  - An unquantified value pool keeps a null amount, never 0.
- **UI in EN/AR (stack-run-2/3).** I checked sign-in, sign-out (localized), the evidence upload (byte-identical download), the withdrawn-access refusal, the charter refusals, the mode guidance, the Team, Design and Gates screens, and the shutdown with no partial file.
- **Session-ended message and language notice (round-14 probes).** Both pass with raised and with default limits: 1 `/me` request, no 429 and one navigation per trigger.
- **Invariants.**
  - The wordmark and `#0078FF` are provisional.
  - There is no PMI or Mobily certification claim.
  - EN/AR key parity holds.
  - There are no float columns.
  - Product gates are G1–G6 only and are never tied to DG0–DG7.
- **Repository checks.** Typecheck, build, lint, test (866/866) and contrast exit 0 on Node 22.22.2 and 24.21.0.

## Residuals (not gate checks)
The live registry (D-057), live CI (D-058) and Keycloak/OIDC (D-049) were checked on their offline and configuration surface only.
