# DG2 round 16: domain-reviewer narrative (T-DG2-REV-DOM-R16)

**Verdict: PASS** on candidate `sha256:0cab0a8c37924ead608f23b37be51336504ada1c95c928a4f80e2a93d2a4bb70` (562 files, source `e3b2375a`, frozen at `f4242ae`). New finding: **F-DG2-570 (Low, non-mandatory)**. No Critical, High or mandatory issue is open in my scope.

All data is synthetic. The G1/G2/G3 decisions I observed are demo decisions in a disposable stack: they approve nothing real and have nothing to do with DG0–DG7.

## Source fidelity (full re-review)
I re-read the playbook blocks for this scope and compared them with the catalogue, seeds and UI, both statically and on a live stack:

| Area | Source blocks | Result |
|---|---|---|
| Modes | B0009 | End-to-End and Modular guidance is verbatim. Modular needs an entry phase, and only two modes exist. |
| Governance roles | B0018 | Six roles, with verbatim accountabilities, on the Team screen and in the seeds. |
| Product gates | B0023 | G1–G6 names, questions and evidence are verbatim. G1→G2→G3 are strictly sequential (422 `gate.out_of_sequence`), and each approval advances the phase by one. |
| Diagnose | B0029, B0031 | Six workstreams with verbatim key questions. T01 has six dimensions and H/M/L confidence. |
| Charter | B0035, B0037 | The 14 fields are present. The four-part thesis is composed, and it is flagged incomplete when any part is blank or invisible-only. |
| Scope sanity checks | B0039–B0043 | All five, in order. An empty or invisible-only Out of scope fails the check. |
| Define | B0048–B0051 | Exactly one current North Star. The 3–5 top-outcome warning works. 'Launch new app' fails the good-outcome test, and G2 lists it. Zero guardrails blocks G2. |
| Design | B0056–B0065 | 10 TOM dimensions with verbatim design questions. The 10 canvas cells use B0062 prompts. T03 gaps require a dimension. T04 decisions use the seven columns. The capability heatmap links to gaps. Journeys keep a decimal cycle time. Unresolved workshop items convert to an owned T04 decision. The per-dimension view works. |

Invariants:
- The brand is provisional, and the only official/certified wording in the UI is a negation.
- Arabic is RTL and English is LTR.
- There are no float columns.
- Unknown is never shown as 0 (canvas, overview); an unquantified value pool is labelled with a null amount.
- Only G1–G6 exist as product gates, and DG mentions in the source are comments that state the separation.

## FE14 / D-076: user outcome
- **Refocus path (my round-15 observation X6): fixed.** Tab 1 regains focus 16 s after its last `/me`, when page data is stale and `/me` is still fresh. `/me` is now the first request (+6–10 ms). From the second 100 ms sample on, the header shows B, and A's record never appears next to B's name. Same result in EN and AR, with raised and with default rate limits.
- **My round-15 probe** (r15-identity-ui): 13/13 under both limit settings.
- **Edit and archive** (new probe):
  - A same-identity save still navigates to the detail page.
  - An invisible-only archive reason is refused with the localized message, and nothing is sent.
  - Archiving with an Arabic + RLM reason works and stores the reason verbatim.
- **Unchanged and still working:** sign-in, sign-out, the session-ended message for every trigger, the language notice, and the Team, Evidence and Design screens. Evidence upload and download are byte-identical.

## F-DG2-570 (Low)
**Trigger.** The user returns to tab 1 *within* the 15 s fresh window after the user changed in another tab. Nothing is stale, so FE14 asks no `/me`, which is consistent with its design.

**What the user then sees.**
- Opening their own record shows "Not found" under their own name.
- 16 s later, Transformations shows B's empty list under A's name, with A's "create your first" text and create button.
- No `/me` is asked until a later refocus finds `/me` stale (60 s).

**Why Low.**
- There is no disclosure and the server stays authoritative.
- It is the navigation variant of X6.
- No assigned requirement is affected.

**Suggested direction (not prescriptive).** Revalidate `/me` when a page query returns 401/403/404, or before any page refetch, as the refocus path already does.

## Evidence honesty
- **r16-identity-ui attempt 1: exit 1.** My own assertion was wrong: the first sample is A's own screen, taken before `/me` answered. The attempt is kept as `r16-identity-ui-attempt1.*`, and it is the only cause of stack-run-4's EXIT=1.
- **r16-identity-nav: exit 1, by design.** It is the reproduction for F-DG2-570, and it is the only cause of stack-run-7's EXIT=1.
- **UTF8-PROBE `exit=1` lines:** the intended D-065 refusal.
- **Warnings:** Fastify FSTDEP022 and the Vite chunk-size advisory. Neither is an error.
- **Contrast "fails" lines:** the documented prohibited pairs.

Details are in `docs/delivery/test-evidence/DG2/domain/round-16/env.txt`.

## Residuals (not gate checks)
Live registry (D-057), live CI (D-058) and Keycloak/OIDC (D-049) were checked on the offline and config surface only.
