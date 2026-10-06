# Handback — T-DG2-REV-DOM-R7 (domain-reviewer, DG2 round 7)

The assignment asked for this handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R7-domain-reviewer.md`. The write guard refused that path as outside the domain-reviewer's write scope, so it is written here in the evidence directory, as in round 6.

- **Verdict:** PASS. No new findings and no sidecars (there was no open finding to verify).
- **Candidate:** `sha256:ede1a9362bb276ce620e440bf9f6a599f6695d395b8e495eaefec30107b016de` (532 files) was recomputed in the repository and in the disposable clone, before and after the runs. Source is 90439483 and the freeze commit is 36524e54. `validate.mjs --historical --stage DG1` passes.

## Changed files
- `docs/delivery/reviews/DG2/round-7/domain-reviewer.json`: the review record.
- `docs/delivery/reviews/DG2/round-7/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-7/**`: logs, scripts and 8 cited screenshots.

## Checks actually run
| Check | Environment | Result |
|---|---|---|
| `pnpm -r typecheck` | Node 22 and 24 | exit 0 |
| `pnpm -r build` | Node 22 and 24 | exit 0 |
| `pnpm lint` | Node 22 and 24 | exit 0 |
| `pnpm test` | Node 22 and 24 | 673/673, exit 0 |
| Contrast check | Node 22 and 24 | exit 0 |
| Live scenario | disposable PG16 + API, synthetic data | 101/101 |
| Design registers | same stack | 11/11 |
| D-067 API probes | same stack | 11/11 |
| D-066 regression probes | same stack | API 16/16, UI 8/8 |
| UI lone-surrogate probe | Chromium, AR/EN | 8/8 |
| UI blank-value probe | Chromium, AR/EN | 14/14 |
| Mode-guidance screens | Chromium, AR/EN | exit 0 |

The live scenario walked Diagnose→Define→Design with G1, G2 and G3 demo approvals in sequence.

## Known gaps
- Environmental residuals: D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) were checked on their offline or config surface only.
- Playwright `fill()` cannot deliver a lone surrogate to the page, so the UI probe sets it in-page. This is a harness limitation and is documented.

## Merge instructions
None. These are review records and evidence only.
