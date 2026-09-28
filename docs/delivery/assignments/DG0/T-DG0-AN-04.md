# Assignment T-DG0-AN-04: integrate the register and coverage, run a consistency pass (transformation-analyst)

- **Stage:** P0 / DG0 (BUILDING). **Base revision:** `c07065ea5700357ae04e0bbd0157a3df007a887b`. HEAD may be ahead by metadata-only commits under `docs/delivery/assignments/**`.
- **Dependencies:** AN-01, AN-02 and AN-03 are complete. Their part files are in `docs/analysis/parts/` and their handbacks are in `docs/delivery/handbacks/DG0/`.

## Steps
1. Run `python3 tools/source/merge_register.py`. It writes `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv` from the parts. If it fails, fix the **part files** (you own them) and re-run. Never hand-edit the merged outputs.
2. Run `node tools/gates/validate.mjs --register DG0`, which applies every register and coverage rule in `docs/delivery/requirements-spec.md`. Fix every reported problem in the part files, then re-merge, until it prints `PASS`.
3. **Cross-part consistency pass.** Fix these in the part files:
   - **Duplicates:** two requirements from different parts that specify the same capability (for example, global search in §3 and §15, audit in §10 and §16, or exports in §13 and §19). Consolidate them into one row that carries all the `source_ref` anchors, delete the redundant row, and remap its coverage rows. IDs are not yet stable, so deleting is allowed before the DG0 freeze. Leave gaps in numbering rather than renumbering.
   - **Conflicting `final_gate`/`increments`** for dependent requirements: a prerequisite must not complete after something that depends on it.
   - **Contradictory semantics** between SOURCE rows and USER/ENGINEERING rows. The playbook wins for SOURCE content, and the master prompt wins for platform behaviour. Record each resolution in `notes`.
   - **Acceptance coverage:** A01–A28 are each referenced, and every scenario's pass condition is concrete.
   - The `DLV` rows marked `IMPLEMENTED` have evidence paths that exist and actually implement them.
4. Update `docs/analysis/stage-plan.md` and `docs/analysis/acceptance-map.md` if consolidation changed any IDs.
5. Write `docs/analysis/README.md`, an index of the analysis artefacts with their counts: rows by class, area and final gate; coverage dispositions; A-scenario coverage.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback.

## Handback
`docs/delivery/handbacks/DG0/T-DG0-AN-04-transformation-analyst.md`. Include:
- the final `validate.mjs --register DG0` output;
- the list of consolidated or deleted IDs, with the reason for each;
- the counts.

## Carried-over items from the AN-02 and AN-03 handbacks (mandatory)
- **AN-03 gap 1:** after the merge, set `REQ-DLV-020` and `REQ-DLV-032` (in `parts/req-dlv-s14-s21.csv`) to `IMPLEMENTED`, with their evidence paths, but only when every evidence file exists. Re-merge afterwards.
- **AN-03 gap 2:** add the S01–S13 IDs to `docs/analysis/acceptance-map.md` ("proves" lists) and to `docs/analysis/stage-plan.md` (per-stage scope).
- **AN-02 gap 1:** check whether any S01–S13 row should be SOURCE rather than USER or ENGINEERING. Prefer keeping them USER/ENGINEERING with `notes` naming the related REQ-PB. Only change a row's class if it is substantially playbook-grounded, and in that case add B anchors and update `source-coverage.csv` consistently.
