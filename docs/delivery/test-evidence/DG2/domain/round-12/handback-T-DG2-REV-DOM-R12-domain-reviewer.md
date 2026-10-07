# Handback: T-DG2-REV-DOM-R12 (domain-reviewer, DG2 round 12)

**Assignment conflict.** The assignment names `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R12-domain-reviewer.md` as the handback path, but the write guard refuses it: "domain-reviewer may not write … (outside role write scope)". So this handback is in my evidence directory, as in round 11. The orchestrator may copy it to the named path.

- **Candidate:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8`. Source `8488e7a4`; I reviewed at freeze commit `744af0b2`.
- **Verdict: PASS.** No new findings, so there is no findings sidecar. There were no open findings to verify, so there is no verifications file.

## Changed files (review records and evidence only)
- `docs/delivery/reviews/DG2/round-12/domain-reviewer.json`: the review record, with 20 checks and 26 requirements.
- `docs/delivery/reviews/DG2/round-12/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-12/**`:
  - logs, probes and `env.txt`;
  - 16 cited screenshots;
  - new probes: `r12-delta-api.mjs`, `r12-team-ui.mjs` and `r12-journey-steps-ui.mjs`;
  - this handback.

## Checks actually run
All checks ran in a disposable clone, with an offline install.
- **Static checks and tests**, on Node 22.22.2 and Node 24.21.0:
  - `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint` and contrast all exit 0;
  - `pnpm test`: 43 files and 790/790 tests pass on both versions.
- **Four fresh disposable stacks** (PG16 :55022 and API :3922):
  - API: 217/217 assertions pass;
  - UI, in EN and AR: 82/82 assertions pass, plus the observational B0009 probe.
- **Candidate and DG1:** the candidate ID was recomputed in both trees, and `validate.mjs --historical --stage DG1` passes.
- **Disclosed and explained in the record:**
  - my first Node 24 pass exited 127 because pnpm was not on my PATH;
  - `r12-team-ui` attempt 1 counted Chromium's resource-load lines for by-design 401/400/404 answers;
  - `r12-journey-steps-ui` attempt 1 had a selector error in my probe.

## Known gaps
- The environmental residuals were not checked live and are not gate checks: live registry (D-057), live CI (D-058) and Keycloak (D-049).
- React development warnings are not visible in the production build that the stack serves. The StrictMode no-warning guarantee rests on the unit-web tests, which pass.

## Merge instructions
None. These are review-only artefacts.
