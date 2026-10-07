# Handback: T-DG2-REV-DOM-R14 (domain-reviewer, DG2 round 14)

**Path note.** The assignment names `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R14-domain-reviewer.md`. The write guard refuses that path for domain-reviewer ("outside role write scope"), as it did in rounds 12 and 13, so the handback is here in my evidence directory. The assignment and the write scopes still contradict each other.

**Verdict: PASS.** No new findings. F-DG2-480 is CLOSED_VERIFIED.

The candidate is `sha256:9f3ca298…b684e` (560 files). The source is ea9051b2 and the freeze commit d99de987. DG1 historical: PASS.

## Changed files (review outputs only)

- `docs/delivery/reviews/DG2/round-14/domain-reviewer.json`: the record. It is schema-valid (ajv 2020), and all 109 evidence entries exist.
- `docs/delivery/reviews/DG2/round-14/domain-reviewer.verifications.json`: F-DG2-480 → PASS / CLOSED_VERIFIED.
- `docs/delivery/reviews/DG2/round-14/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-14/**`: logs, probes (`r14-session-end-ui.mjs`, `r14-language-ui.mjs`, `runp.sh`), stack scripts, `env.txt`, the cited screens and this handback.

No implementation file was touched. There is no findings sidecar.

## Behaviour verified

- **F-DG2-480.** Five triggers plus the refused upload, in EN and AR, with raised and with default rate limits:
  - other-tab sign-out, revocation, idle expiry, absolute expiry and logout by API;
  - each lands once on sign-in with the localized message, with 1 `/me`, 0 × 429 and no stale shell;
  - a second context signs in, and signing in again returns the user to their page.
- **FE11/FE12.** Verified in EN and AR, including the header at 320, 768 and 1280 px.
- **The 26 requirements.** Faithful to the playbook, statically and live.

## Checks run (Node 22.22.2 and 24.21.0)

typecheck, build, lint, test (848/848) and contrast all exit 0 on both versions. All final live probe runs exit 0. Every non-zero attempt is explained in `env.txt`; all were mistakes in my own probes.

## Known gaps

- OIDC/Keycloak sign-in was not exercised live. These are residuals, not gate checks: D-049, D-057 and D-058.
- The journey-steps language switch was dispatched rather than clicked, because the header is inert behind the modal. That is expected modal behaviour.
- HEAD moved during my run, to the orchestrator's code-security evidence commit 64e2082. The candidate ID is unchanged, and I did not read that record.

## Merge instructions

None.
