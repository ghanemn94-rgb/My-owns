# Handback: T-DG2-REV-DOM-R9 (domain-reviewer, DG2 round 9)

This file is here because the write guard refused the assigned path `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R9-domain-reviewer.md` as outside the domain-reviewer write scope. The round-8 handback had the same placement. The assignment's handback path contradicts the role's write scope; the orchestrator may copy this file there.

**Verdict: PASS. No new findings, and no findings sidecar.**

The candidate `sha256:45ebccc0…6294` (544 files, source 7854770e, freeze 041478cb) was verified in the repository and in a disposable clone.

## Changed files
I wrote review records and evidence only:
- `docs/delivery/reviews/DG2/round-9/domain-reviewer.json`: the review record.
- `docs/delivery/reviews/DG2/round-9/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-9/**`: logs, probe scripts, 10 cited screenshots and this handback.

## Behaviour verified
All 26 assigned requirements were verified live and statically. The D-069 media-type and alert changes leave intact:
- playbook fidelity;
- the gate logic;
- the bilingual behaviour (Arabic, emoji and RLM verbatim; localized refusals);
- the evidence upload and download round-trip.

## Checks actually run
All checks exited 0:
- On Node 22 and Node 24: typecheck, build, lint, test (718/718) and contrast.
- Live API: scenario 101/101, design registers 11/11, D-069 API 18/18, regressions 21+11+16.
- UI in EN and AR: D-069 8/8, charter blank 14/14, regressions 8+8, B0009 guidance.
- Static invariants.
- DG1 historical validation.

## Gaps
- **Probe error.** One probe attempt (r9-ui in stack-run-2) failed on my own selector. I fixed it and re-ran it in stack-run-3, recorded in env.txt.
- **Environmental residuals.** D-057, D-058 and D-049 were checked on their offline or config surface only.

## Merge instructions
None. The runner copies back the review files.
