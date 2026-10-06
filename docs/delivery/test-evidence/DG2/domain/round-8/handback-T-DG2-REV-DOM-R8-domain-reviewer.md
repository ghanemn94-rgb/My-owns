# Handback: T-DG2-REV-DOM-R8 (domain-reviewer, DG2 round 8)

The assignment asked for this handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R8-domain-reviewer.md`. The write guard refused that path because it is outside the domain-reviewer's write scope, so it is here in the evidence directory, as in rounds 6 and 7.

- **Verdict:** PASS. No new findings and no sidecars (there was no open finding to verify).
- **Candidate:** `sha256:9331e9d13e0ffa55f35ebc25ecdf9b60e159876dc2470fe56e9241a40fea124f` (539 files), recomputed in the repository and in the disposable clone. Source is cf3446e4 and the freeze commit is 4053630c. `validate.mjs --historical --stage DG1` passes.

## Changed files
- `docs/delivery/reviews/DG2/round-8/domain-reviewer.json`: the review record. It validates against `review.schema.json`.
- `docs/delivery/reviews/DG2/round-8/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-8/**`: logs, scripts and 6 cited screenshots.

## Checks actually run
| Check | Environment | Result |
|---|---|---|
| `pnpm -r typecheck` | Node 22 and 24 | exit 0 |
| `pnpm -r build` | Node 22 and 24 | exit 0 |
| `pnpm lint` | Node 22 and 24 | exit 0 |
| `pnpm test` | Node 22 and 24 | 691/691, exit 0 |
| Contrast check | Node 22 and 24 | exit 0 |
| Live scenario | disposable PG16 + API, synthetic data | 101/101 |
| Design registers | same stack | 11/11 |
| D-068 API probes | same stack | 21/21 |
| D-067 API regression | same stack | 11/11 |
| D-066 API regression | same stack | 16/16 |
| UI regressions | Chromium, AR/EN | 8/8 and 8/8 |
| UI blank-value probe | Chromium, AR/EN | 14/14 |
| Mode-guidance screens | Chromium, AR/EN | exit 0 |

The live scenario walked Diagnose→Define→Design with G1, G2 and G3 demo approvals in sequence.

## Known gaps
- Environmental residuals: D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) were checked on their offline or config surface only.
- The handback path in the assignment is outside the domain-reviewer's write scope (see above).

## Merge instructions
None. These are review records and evidence only.
