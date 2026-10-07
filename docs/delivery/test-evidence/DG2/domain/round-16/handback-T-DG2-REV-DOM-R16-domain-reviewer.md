# Handback: T-DG2-REV-DOM-R16 (domain-reviewer, DG2 round 16)

**Path note.** The assignment names `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R16-domain-reviewer.md`. The write guard refuses that path for domain-reviewer ("outside role write scope"), so this handback is in my evidence directory. That is the same as round 15. The assignment and the write scope contradict each other here; please reconcile them.

- **Candidate:** `sha256:0cab0a8c37924ead608f23b37be51336504ada1c95c928a4f80e2a93d2a4bb70` (562 files). Recomputed on the repo and on a disposable clone, before and after the runs. Source `e3b2375a`, frozen at `f4242ae`. DG1 historical validator: PASS.
- **Verdict:** PASS.
- **New finding:** F-DG2-570 (Low, non-mandatory, owner frontend-ux-engineer).
  - **Trigger.** The user changed in another tab, and the user returns to the tab within the 15 s fresh window. FE14 asks no `/me` here, which is consistent with its design.
  - **Effect.** Pages the user then opens are fetched under the new identity, but the header, permissions and empty-state text stay the previous user's. This lasts until a refocus finds `/me` stale (60 s).
  - **Impact.** No disclosure; the server stays authoritative.
- No open finding of mine needed verification, so no `.verifications.json` was written.

## Changed files (review records and evidence only)
- `docs/delivery/reviews/DG2/round-16/domain-reviewer.json`: the review record. It validates against review.schema.json (ajv 2020 with formats).
- `docs/delivery/reviews/DG2/round-16/domain-reviewer.findings.json`: F-DG2-570.
- `docs/delivery/reviews/DG2/round-16/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-16/**`:
  - logs, scripts and the cited screens;
  - new probes: `r16-identity-ui.mjs` (plus attempt 1), `r16-edit-archive-ui.mjs` and `r16-identity-nav.mjs`;
  - `env.txt`, which explains every non-zero exit.

## Checks actually run (all on the frozen candidate in a disposable clone)
| Check | Command / probe | Result |
|---|---|---|
| Typecheck, build, lint, test, contrast | `checks.sh`, Node 22.22.2 and 24.21.0 | Each exit 0. Tests: 49 files, 892/892. Contrast PASS (50 pairs; the 3 prohibited pairs fail as documented). |
| Source fidelity | `source-fidelity` | 24/24 |
| Live API scenario | `live-scenario` | 101/101. G1→G2→G3 approved in sequence; out-of-sequence attempts 422. Arabic + RLM accepted verbatim. 28 invisible-only values refused. |
| API delta and regression probes | 9 probes | All pass |
| UI walk and screens, EN and AR | `r13-ui`, `ui-upload-alert`, `charter-blank-ui`, `walk-ui`, `r12-team-ui`, `r12-journey-steps-ui`, `regress-d066-ui`, `regress-d067-ui` | All pass |
| Evidence upload and download | within `r13-ui` | Byte-identical: 300281 bytes, same sha |
| Edit and archive | `r16-edit-archive-ui` | 7/7 |
| Access withdrawn, shutdown | `r13-ui-withdrawn`, `r13-shutdown` | 5/5, 2/2 |
| Identity probes | `r15-identity-ui` (13/13); `r16-identity-ui` (5/5) | Pass with raised and with default limits. r16 attempt 1 exited 1 because of my own assertion mistake; details in `env.txt`. |
| Session end and language notice | `r13-session-end-ui` 4/4, `r14-session-end-ui` 31/31, `r14-language-ui` 20/20 | Pass. The two session-end probes also pass with default limits. |
| F-DG2-570 reproduction | `r16-identity-nav` | Exit 1 by design (4 FAIL lines) |
| Invariants, UTF8 fail-closed, environmental residuals | invariants script, stack logs | Pass |

## Known gaps / not done
- **Environmental residuals, checked offline only** (recorded as PASS on the offline/config surface, as instructed):
  - live registry (D-057);
  - live CI (D-058);
  - Keycloak/OIDC sign-in (D-049).
- I did not read any other reviewer's round-16 record.

## Merge instructions
None. The runner copies back the review files. The disposable clone, the store copy and all scratch were removed.
