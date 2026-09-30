# DG0 round 26: domain-reviewer narrative

**Verdict: PASS. No findings.** The candidate is `sha256:7ac7119044c899d4fa7363cb43d209173095d06b37eed75697532b092b7236df` at commit `7edacdc`. Main HEAD is `2f480e4`, which is the frozen commit plus one metadata-only freeze commit. The ID was recomputed in both main and a fresh `--no-local` clone, and the clone is complete (`shallow=false`).

## Scope of change
Since the round-25 baseline, the only candidate-scope changes are `tools/gates/lib/rules.mjs`, `tools/gates/tests/validator.test.mjs` and `docs/delivery/decisions.md` (D-042). None of the product specification artefacts changed. I still re-ran every source-fidelity check on the frozen tree.

## What I checked independently
- **Extraction.** I tag-stripped the docx myself. All 1001 paragraphs, 49 tables and 239 rows are in `playbook.md` (0 missing), and `check_extraction.sh` passes.
- **Coverage.** B0001–B0165 each appear exactly once and in order (129 REQUIREMENT, 29 CONTEXT, 7 NON-REQUIREMENT), and the mapping is bidirectionally consistent. SOURCE rows are only REQ-PB rows, and each cites existing blocks. The non-requirement blocks carry no methodology substance.
- **Templates and deliverables.**
  - All 118 T01–T16 columns and charter fields are preserved, along with the value lists.
  - The T07 exit criteria, T10 per-area RAG texts and T09 formulas are verbatim in `field-inventory.md`.
  - Every non-template table cell is verbatim.
  - The 33 callouts and principles that are not verbatim are implemented in substance as testable rules.
- **Operating logic.**
  - RAG comes from the trajectory, never from task completion.
  - Delivery, adoption, validated value and closure are four separate statuses.
  - Forecast never counts as validated.
  - Validation is Finance-only.
  - A shared benefit is counted once; allocation above 100% is rejected and the remainder shown as unallocated.
  - Gates are decided against evidence snapshots.
  - G6 never implies DG7, and technical admins are never gate approvers.
- **Provenance.** Every PMI mention is "inspired by" or a disclaimer, and every `#0078FF` mention is provisional or unverified.
- **Master prompt.** I drew a fresh seeded sample of 77 blocks (seed 20261030) across all 23 section keys, including table rows. It showed 0 bad mappings.
- **Stage plan.** `final_gate`/`increments` are consistent across all 412 rows. The four assigned DLV rows are concrete, DG0-final and match §21 P0.
- **D-042.**
  - Anchor 1 is now unconditional, and the code matches the comment.
  - The named test passes, and the gate suite passes 63/63.
  - `prefreeze.sh DG0` passes 11/11 in a fresh `--no-local` clone.
  - The real-repo dry-run shows 0 errors in every closure-anchor bucket, including the new D-042 bucket. The remaining errors are all round-completion items.
- **D-042 and D-039 claims.**
  - Round 18 is the only round with an absent `source_commit`. Its closures (F-DG0-150/151 and 236/237) were re-verified in rounds 22 and 19, so D-042's claim holds.
  - `450c756` and `cb76260` are absent in every clone.
  - The D-038 "uniformly absent" wording is gone.
  - Neither decision makes any domain or provenance claim.

## Notes for the orchestrator (assignment text, not the candidate)
- `review-common.md` still says "Review round: `23`", but the paths, the title and `stages.json` all say round 26. I used `round: 26`.
- My role assignment still asks me to verify the round-22 F-DG0-013 and the D-039 wording, which is carried over from an earlier round; F-DG0-013 is already CLOSED_VERIFIED. I re-checked it anyway, and it is still accurate (DOM26-13).
- For future rounds: D-042's phrase "round 18 … has none — its closures were re-verified" reads as slightly self-contradictory, because round 18's sidecars do contain closure entries. It is correct in effect, since the latest entries are in retained rounds. This is not a finding.
