# DG0 round 28: domain-reviewer narrative

- **Candidate:** `sha256:1af91e8f620aec37c560b7adae0b74c8644a5983bb15d02044f312407e05571b`
  - Source commit: `331407e9b6711abbc01f7ee0456e4fa92ff65cda`.
  - Live HEAD is `57d7a53`, a metadata-only freeze commit.
- **Verdict:** PASS.
- **New findings:** none.

## Scope
The candidate differs from round 27 only in three files:
- `tools/gates/lib/rules.mjs` (D-044 object-type checks);
- `tools/gates/tests/validator.test.mjs`;
- `docs/delivery/decisions.md` (the D-044 row).

No file changed under `docs/source`, `docs/analysis`, the register, `requirements-spec.md`, `CLAUDE.md` or `.claude/agents`. I still re-ran every domain check against the frozen content.

## What I checked (details and commands are in the JSON record)
1. **Extraction fidelity** (independent tag-strip of `word/document.xml`).
   - All 1001 non-empty paragraphs and cells (49 tables) plus the footer are found in `playbook.md`.
   - The reverse token check shows no invented text.
   - `check_extraction.sh` passes.
2. **Coverage.**
   - All 165 B blocks and all 423 M blocks are dispositioned, with 0 mapping problems.
   - Non-requirement dispositions are sensible (cover, version stamp, reference URLs, extension advice).
3. **Templates T01–T16.**
   - All columns are verbatim in the field inventory and the register.
   - Value lists, the T07 wave seeds, the T11 rows and SLAs, the T10 RAG per area and the T12 RACI grid are identical to the source.
4. **First-class deliverables.** All are present: charter (14 fields), thesis, 5 scope checks, outcome hierarchy, 10 TOM dimensions and canvas, 90–120 min workshop, 10 business-case sections, OS layers, benefits lifecycle, 7 adoption indicators, 90-day plan, Day-90 test, 25 questions and 4 bands, roaming example with its 3 traceability rows, modes, phases and G1–G6, and the minimum governance roles.
5. **No invented source requirements; provenance honest.**
   - SOURCE rows are all REQ-PB rows citing B blocks, and `check_pb_provenance` reports 0 problems.
   - Every "official/certified" mention is negated.
   - `#0078FF` is labelled provisional.
6. **Operating logic.** Each rule is specified with testable acceptance:
   - RAG comes from the trajectory, not task completion.
   - Delivery, adoption, validated value and closure are four independent states.
   - Forecast value never counts as validated.
   - Only Finance validates, and the Business Owner stays accountable.
   - A shared benefit is counted once, and allocations above 100% are rejected with the unallocated share shown.
   - Gates are approvals tied to an evidence snapshot.
   - DG0–DG7 are kept separate from G1–G6.
   - A technical administrator is not a business approver.
7. **Master-prompt sample.**
   - I sampled 78 blocks with seed 28 across the preamble and §0–§21, including table rows. The block list is in the record.
   - Every sampled mapping was judged correct.
8. **Staging.**
   - There are 0 problems across 412 rows, and the stages follow §21.
   - The 19 DG0-final rows are the delivery rows plus A24/A25.
9. **Glossary, journeys and permissions.**
   - The Arabic terms are sensible and flagged as proposals.
   - The journeys cover every phase and gate plus modular entry, KPI update, Finance validation, committee workflow, BAU handover and admin publishing.
   - The permissions matrix agrees with the RACI and T11, and ADM never approves or validates.
10. **D-044.**
    - The shipped test passes, and so does my own probe with an annotated-tag `head_commit_at_start`.
    - The mutation check (the pre-D-044 `rules.mjs` from 49b5ad7) makes both tag tests fail.
    - Real-repo census: 118/118 `fix_revision` values are commit objects.
    - A scratch-gate dry run in a disposable clone walks every real closure and shows 0 tag, anchor or closure errors. The only problems are the expected gate-round blockers.
11. **D-039 wording.**
    - `450c756` and `cb76260` are absent both in the live repo and in a `--no-local` clone.
    - The D-038 correction is in place.
    - No commit-id field names a pruned object. The pruned IDs appear only in the narrative text of closed findings, which is consistent with D-039's evident meaning.
    - D-039 and D-044 make no business or provenance claims.
12. **Pre-freeze.** `tools/gates/prefreeze.sh DG0` passed 11/11 in a fresh `--no-local` clone.

## Notes (not findings)
- `review-common.md` says "Review round: `23`". The record path and all other references say round 28, so I used `round: 28`. This is a copy slip in assignment metadata, which is excluded from the candidate.
- F-DG0-250 was reported by qa, so I did not write a verification for it. My checks (C10/C11) independently support it.
- F-DG0-147/149 are still awaiting the auditor's concurrence (outside my scope).
- I granted no business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing here implies DG7.
