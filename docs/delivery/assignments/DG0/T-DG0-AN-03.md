# Assignment T-DG0-AN-03: master prompt preamble, §0 and §14–§21 into requirements (transformation-analyst)

- **Stage:** P0 / DG0 (BUILDING). **Base revision:** `__BASE__` on `claude/mobily-transformation-platform-kwcc4i`. Verify it with `git rev-parse HEAD`.
- **Requirement IDs you create:** `REQ-DLV-###` (preamble and §0: the delivery protocol) and `REQ-S14-###` … `REQ-S21-###`. You own only these areas.
- **Dependencies:** AN-01 is complete (`docs/analysis/parts/req-pb.csv`, IDs `REQ-PB-###`). AN-02 runs in parallel with you and covers §1–§13 (areas S01–S13). Don't create IDs in those areas.

## Sources
- `docs/source/master-prompt.anchored.md`. Your blocks are **M0001–M0074** (preamble and §0) and **M0256–M0423** (§14–§21), including every table row.
- `docs/source/playbook.md` (for grounding), `docs/delivery/requirements-spec.md` (format; the status is never `VERIFIED`), `docs/delivery/agent-protocol.md`, `CLAUDE.md`.
- Existing P0 implementation, so you can describe the DLV requirements accurately: `.claude/agents/`, `tools/agents/`, `tools/gates/` (validator, schemas, tests), `.github/workflows/delivery-gates.yml`, `docs/delivery/{environment,agents,decisions,progress}.md`, `docs/delivery/stages.json`, `docs/delivery/findings.json`.

## Permitted outputs (write guard enforced)
- `docs/analysis/parts/req-dlv-s14-s21.csv`: new register rows.
- `docs/analysis/parts/mp-coverage-p0-s14-s21.csv`: exactly one row per block in M0001–M0074 and M0256–M0423 (242 rows).
- `docs/analysis/parts/ref-additions-an03.csv` (`req_id,add_refs`): M anchors to append to existing `REQ-PB-###` rows that your blocks restate. Examples are the §14 health-check questions and bands, the 90-day plan, and the §18 roaming example.
- `docs/analysis/acceptance-map.md`: for each of A01–A28, the requirement IDs it proves, the test level (unit/integration/e2e/visual/ops drill), the stage in which the executable test is first delivered, and the gate at which it must pass.
- `docs/analysis/stage-plan.md`: for each stage P0–P7, the scope (requirement areas and IDs, or ID ranges), the implementation owners (per §21), the concrete outputs, the evidence required before approval, the dependencies, and the parallelization and serialization plan (≤4 active workers; shared files such as migrations, contracts and shared config are serialized).
- The handback, `docs/delivery/handbacks/DG0/T-DG0-AN-03-transformation-analyst.md`.

## Rules specific to your blocks
- **DLV requirements (§0) are ENGINEERING class.** Set the final gate as follows:
  - Items fully delivered by the P0 setup get `final_gate DG0` and `increments P0`, and are `IMPLEMENTED` when the P0 artefact already exists. The `evidence` column names the implementing file paths or tests, which must exist. Such items include:
    - the agent definitions;
    - the runner and invocation evidence;
    - the write guard;
    - the register and coverage;
    - the stages, findings, decisions and progress records;
    - the gate validator and its CI job;
    - the candidate-hash definition;
    - the environment record.
  - Otherwise use `SPECIFIED`.
  - Protocol obligations that recur at every gate (independent reviews, the repair loop, gate audit, reporting) get `increments P0;P1;…;P7` and `final_gate DG7`.
  - A28 sealing is final gate DG7.
- **§20 acceptance rows (A01–A28):** create requirements for the executable acceptance tests (`REQ-S20-###`), each naming the scenario and its pass condition verbatim. Set `final_gate` to the stage where the capability completes. Put A01–A22 at their product stage or at DG6/DG7 per §21, and A23–A28 per §21 (A28 is DG7 post-approval sealing).
- **§21 stage table rows:** map each to DLV requirements for that stage's concrete outputs and evidence obligations.
- **§19 handover items 1–12:** separate requirements at DG7, or earlier where §21 places them (for example the API spec at DG1 with a final DG7 package).
- **§14 health check and launch plan:** the questions, bands and 90-day content are SOURCE (REQ-PB), so add M refs through ref-additions. The Yes=1/No=0 scoring, "incomplete if unanswered" and the separately versioned scheme are USER requirements labelled `implementation-assumption` (decision D-010).
- **§15 brand tokens:** each token is part of a USER requirement, together with contrast validation, the provisional labelling, the no-CDN fonts rule and the branding settings screen.
- **§16 entities:** one requirement per entity group, listing every entity named.
- **§20 performance targets:** capture them as ENGINEERING requirements marked "provisional engineering targets, not verified Mobily capacity requirements".
- Every block gets a disposition (REQUIREMENT / CONTEXT / NON-REQUIREMENT, with a rationale where applicable). Header rows are CONTEXT. The references list at the end (M0417+) is CONTEXT or NON-REQUIREMENT.
- Acceptance: at least one A01–A28 per row. Fill every column except `template_id`, `evidence` and `notes`. Keep CSV fields on one line and quote them per RFC 4180.

## Self-check before handback (run and paste the output)
1. Coverage has exactly the 242 IDs listed. Every REQUIREMENT req_id exists (in yours or in `req-pb.csv`) and cites the block.
2. Every A01–A28 is referenced by ≥1 of your rows.
3. Every `IMPLEMENTED` row's evidence paths exist (`os.path.exists`).
4. Row counts per area, class and final_gate.

## Handback path
`docs/delivery/handbacks/DG0/T-DG0-AN-03-transformation-analyst.md`
