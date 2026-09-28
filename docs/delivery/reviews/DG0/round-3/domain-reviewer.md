# DG0 round 3: domain review

- **Candidate:** `sha256:31fd0843977d30afd4459591abdfd730c5c994440030816188227d9f6ec4cbf9`, commit `540b3c6`. The candidate ID was recomputed in a clean worktree. HEAD `4af07b0` is a metadata-only freeze commit.
- **Verdict:** PASS.

## Checks

The checks are in `domain-reviewer.json`, C00–C13. The scripts and logs are in `docs/delivery/test-evidence/DG0/domain/round-3/`.

- **Extraction.** I parsed the docx independently: all 1002 paragraph and cell text units, including the page footer, appear in `playbook.md`. The 49 tables are well formed, and `check_extraction.sh` passes.
- **Coverage.** `source-coverage.csv` (165 rows) and `master-prompt-coverage.csv` (423 rows) agree with the register in both directions, with 0 problems. The non-requirement rationales are true.
- **Templates.** All T01–T16 columns and every source value list appear verbatim in the field inventory. The register quotes them or seeds them by explicit reference.
- **First-class deliverables.** All are fully present: charter 14 fields, thesis, 5 scope checks, outcome hierarchy, TOM 10 dimensions and canvas, workshop, business case 10 sections, OS layers, lifecycle, 7 adoption indicators, 90-day plan, Day-90 test, 25 questions and 4 bands, roaming example and traceability, modes, phases, G1–G6, roles.
- **Operating logic.** The register states each semantic correctly:
  - RAG comes from the trajectory;
  - the four statuses are separate;
  - forecast is never validated;
  - Finance validation is exclusive while the Business Owner stays accountable;
  - a shared benefit counts once, and allocation is ≤100% with the unallocated share shown;
  - gates are explicit snapshot approvals;
  - DG and G gates are separate.
- **Master-prompt sample.** I checked 80 blocks across all 29 sections, including table rows and headings; all are correct. The §21 staging holds.
- **Provenance honesty.** There is no claim of official PMI status or Mobily brand compliance. `#0078FF` is provisional.

## Earlier findings

- **F-DG0-006:** CLOSED_VERIFIED. On 83860be the provenance checker reports 115 problems, including those on PB-068 and PB-088. On the candidate it reports 0, and I read both rows directly.
- **F-DG0-007:** CLOSED_VERIFIED. `agent-protocol.md` line 10 now states that G6 never implies DG7.

## New finding

- **F-DG0-008 (Low, accepted as an observation).** Three REQ-PB rows file content under Interpretations that their own cited M blocks state:
  - PB-091 (M0288);
  - PB-050 (M0135 and M0178);
  - PB-078 (M0150).

  These are labelling errors only. The substance is correct and cited, and nothing is invented. The AN-08 checker's R3 rule only detects Interpretations clauses that literally mention the master prompt, so it misses these.
