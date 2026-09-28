# Assignment T-DG0-AN-09: repair round-3 register findings F-DG0-008 and F-DG0-209 (register part) (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING**. **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **F-DG0-008.** See `docs/delivery/findings.json` and `docs/delivery/reviews/DG0/round-3/domain-reviewer.findings.json`.
  - REQ-PB-091, REQ-PB-050 and REQ-PB-078 file content that the cited master-prompt blocks state under "Interpretations". Move each piece to "Master-prompt additions" with its anchor. Interpretations keep only readings that neither source states.
  - Then **re-check every PB row this way**, by comparing each Interpretations clause with the actual text of the M blocks in that row's `source_ref` (`docs/source/master-prompt.anchored.md`). Your script `docs/analysis/tools/check_pb_provenance.py` only catches literal citations. Extend it to flag an Interpretations clause that shares a substantial phrase with a cited M block. For example, flag it when the clause and the block share 4 or more content words in sequence after normalising case and punctuation. Then review each flagged row by hand. List every row you changed.
- **F-DG0-209 (register part).** The procedure text of REQ-DLV-022 describes each candidate line as `<file sha256>  <path>`. The implementation now uses the algorithm `mth-candidate-v2`, with lines `<sha256>  <git mode>  <path>`; see `tools/gates/lib/candidate.mjs` and decision D-005 in `docs/delivery/decisions.md`. Update the text, and check every other DLV row that describes the gate tooling against the current implementation:
  - `tools/gates/lib/*.mjs`
  - `tools/agents/run-agent.sh`
  - `tools/agents/guard-write.mjs`
  - decisions D-016 to D-021
  - evidence paths that moved: the candidate manifests now live at `docs/delivery/candidates/DG0/<id-prefix>.manifest.json`, and `docs/delivery/candidates/DG0.manifest.json` no longer exists.
- **Finally**, run each of these; all must pass:
  - `python3 tools/source/merge_register.py`
  - `python3 docs/analysis/tools/check_counts.py`
  - `python3 docs/analysis/tools/check_test_refs.py`
  - `python3 docs/analysis/tools/check_pb_provenance.py`
  - `node tools/gates/validate.mjs --register DG0`
- **Classifier outages:** see the "Infrastructure" section of `docs/delivery/agent-protocol.md`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-09-transformation-analyst.md`.
