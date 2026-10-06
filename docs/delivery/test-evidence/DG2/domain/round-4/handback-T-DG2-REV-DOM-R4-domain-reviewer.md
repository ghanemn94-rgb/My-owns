# Handback: T-DG2-REV-DOM-R4 (domain-reviewer, DG2 round 4)

The assigned path `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R4-domain-reviewer.md` is outside the domain-reviewer write scope, and the write guard refused it. This copy is in my evidence directory instead, as in round 3. The orchestrator may copy it to the handback path.

**Verdict: PASS. No new findings** (findings: []; no findings sidecar, no verifications sidecar).

- Candidate: `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58` (521 files), recomputed in the repository and in a disposable clone.
- Source commit: `e37f6ea4`.
- Repository HEAD: `bb4dd9c9`. It differs only in delivery metadata.

## Changed files (review records and evidence only)
- `docs/delivery/reviews/DG2/round-4/domain-reviewer.json`: the review record. It validates against `review.schema.json` with `tools/gates/lib/schema.mjs` (0 errors), and all 60 evidence paths exist.
- `docs/delivery/reviews/DG2/round-4/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-4/**`:
  - logs;
  - scripts (`with-stack.sh`, `live-scenario.mjs`, `charter-blank-ui.mjs`, `dom-shots.mjs`);
  - screenshots (`screens/blank`, `screens/mode`, `screens/e2e/{en,ar}`).

## Checks actually run (all exit 0)
| Check | Node 24.21.0 | Node 22.22.2 |
|---|---|---|
| `pnpm -r typecheck` | exit 0 | exit 0 |
| `pnpm -r build` | exit 0 | exit 0 |
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm test` | 616/616 | 616/616 |
| `pnpm --filter @mth/design-tokens run check:contrast` | PASS | PASS |

The rest ran on Node 24:
- `validate.mjs --historical --stage DG1`: PASS.
- Integration on disposable PostgreSQL 16: 465/465.
- Playwright `p2-journeys` + `p2-blank-text`, EN and AR: 40/40.
- My charter blank and invisible-text UI check, EN and AR: 12/12.
- Live API scenario: 83/83. G1→G2→G3 demo decisions on synthetic data moved diagnose→define→design→mobilize.

## Key judgement (D-064)
- No playbook field legitimately accepts invisible-only text.
- Visible text, including Arabic RLM and emoji ZWJ sequences, is kept verbatim. `""` and `null` keep their meaning.
- The B0041 pre-check, G1 readiness and the B0037 thesis flag treat invisible-only values as absent, even when planted directly in the DB.
- The EN/AR inline guidance is clear.

## Known gaps
- These are environmental residuals, recorded as PASS on the offline surface: live registry (D-057), live CI (D-058) and Keycloak (D-049).
- Harness note: my first live run failed G2 because my own SQL plant broke the charter_version FK. That is not a product defect; the corrected re-run passes. Details are in `env.txt`.

## Merge instructions
None. Review artefacts only; no implementation files were touched.
