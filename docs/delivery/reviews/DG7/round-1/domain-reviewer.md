# DG7 round 1: domain-reviewer narrative (T-DG7-REV-DOM-RG1)

Candidate `sha256:9822d8fe947b572d30a24e1f59798587edd610a0c8b8f81a21eaceeb3233a744` (source `ddf42ccd2`, HEAD `2561ce969` = freeze metadata only). Verdict: **FAIL** on one Medium record finding. The product itself is sound.

## Findings

| ID | Severity | Requirement | Summary |
| --- | --- | --- | --- |
| F-DG7-1001 | Medium (not mandatory) | REQ-DLV-011 | The clean re-gate's single-commit history loses the 2026-11-14 bytes of `T-DG7-ARCH-R6.md`, so the frozen candidate's protocol audit reports an undisclosed DG7 `assignment-sha-mismatch`. `known-limitations.md` says all 25 DG7 C2 hits are disclosed, and the REQ-DLV-011 notes still say 27. D-281 also dropped the A26 reviewer runs that the A26 report cites (they are sound at `1612f85fc`). |
| F-DG7-1002 | Low (not mandatory) | REQ-S02-005 | ADR-0071 §5 is not amended for the release-notes generator's extra input and section (D-280). Proposed for acceptance as an observation (context: the old branch's F-DG7-973). |

## Contradictions in the assignment (reported, not guessed)

1. **Finding id range vs schema.** The assignment allocates `F-DG7-1001…1009` and forbids any other id. `tools/gates/schemas/findings.schema.json` requires `^F-DG[0-7]-[0-9]{3}$`, and `tools/gates/import-findings.mjs` validates sidecars against it. My sidecar therefore uses the assigned ids, but it does not pass that schema check. The orchestrator needs to resolve the allocation (for example by re-issuing the findings under three-digit ids in the next round, or by a recorded decision).
2. **`round: 7`.** The assignment asks for it, but the record directory and the `stages.json` round entry are round 1, and the validator requires `rec.round` to equal the directory round. The record uses `round: 1`.
3. **Template path.** `docs/delivery/reviews/DG5/round-7/domain-reviewer.json` does not exist. I mirrored `docs/delivery/reviews/DG6/round-7/domain-reviewer.json`.

## What I ran

See `checks_run` in `domain-reviewer.json`. Evidence is under `docs/delivery/test-evidence/DG7/domain/round-1/`. I did not re-run the container host half (no Docker daemon). My check on it reviews the logs and does not claim the run as mine.
