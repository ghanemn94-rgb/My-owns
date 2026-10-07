# Handback: T-DG2-REV-DOM-R15 (domain-reviewer, DG2 round 15)

The assignment asks for this handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R15-domain-reviewer.md`. The write guard refused that path ("outside role write scope"), so I put it here, as in round 14. The orchestrator may copy it.

- **Candidate:** `sha256:3f01c61090435f114b52150d1ab73818839530ede08a4c07d04936175f7fe8f9`, 561 files. I recomputed it in the repo and in a disposable clone, before and after my runs. Source `ed80b234`; freeze `9236a9f`. DG1 historical: PASS.
- **Verdict: PASS.** No new findings, so there is no findings sidecar. There was nothing to verify, so there is no verifications sidecar.

## Files written
- `docs/delivery/reviews/DG2/round-15/domain-reviewer.json` is the review record. It validates against `review.schema.json` (`tools/gates/lib/schema.mjs` returns []).
- `docs/delivery/reviews/DG2/round-15/domain-reviewer.md` is the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-15/` holds the logs, the probes, the 22 cited screens and `env.txt`. The new probe is `r15-identity-ui.mjs`; its attempts 1–4 are kept with their logs.

## Checks actually run
All runs used a disposable clone on Node 22.22.2 and 24.21.0.
- Typecheck, build, lint, test (866/866) and contrast: exit 0 on both Node versions.
- Static source fidelity: 24/24.
- 5 disposable stacks (PG 16 + API on :55025/:3925):
  - API probes, live-scenario included: 101/101, with G1, G2 and G3 decisions observed.
  - UI probes in EN and AR.
  - Withdrawal and shutdown probes.
  - The FE13 identity probe: 13/13 with raised and with default limits.
  - The session-end and language probes: 4/4, 31/31 and 20/20.
- Every non-zero exit in my evidence is explained in `env.txt` and in the record. Those are r15 attempts 1–4 (probe mistakes), the wrappers that carried them, and the intended UTF8 fail-closed probe.

## Observation (not a finding)
`GET /me` has a 60 s `staleTime`. When the identity changes in another tab, tab 1 can show the previous person's name over refetched data for up to 60 s. No record of the previous person is shown to the new one. Details are in the narrative.

## Known gaps
Not exercised live: the registry (D-057), CI (D-058) and Keycloak/OIDC (D-049). I recorded these as configuration-surface PASS with the residuals named, as the assignment instructs.

The disposable clone, the store copy and the scratch screenshots were removed.
