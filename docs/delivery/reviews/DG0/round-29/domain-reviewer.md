# DG0 round 29: domain review (domain-reviewer)

- **Candidate:** `sha256:84130c624e877424eed6deb91d086249bc1330bda34ff109b0183102533751bd`, source commit `1e4c022`. Live HEAD `ffa3fae` is a metadata-only commit after the freeze. The candidate ID was recomputed live and at the ref, and both clones are complete.
- **Verdict:** PASS, with one new Low finding (F-DG0-015).
- **Independence:** I authored none of the reviewed scope, and I read no other round-29 record.

## What changed since round 28
The only candidate changes are the D-045 validator check (`rules.mjs` +11), two tests (+36) and the D-045 row in `decisions.md`. The P0 specification (`docs/source`, `docs/analysis`, the register, the requirements spec, `CLAUDE.md`, `.claude/agents`) has a 0-line diff. I re-ran every specification check anyway, independently.

## Specification (checks 02–09, 15, 16)
| Area | Result |
|---|---|
| Extraction | Verbatim-complete: 1001/1001 docx paragraphs and cells, 49 tables, footer found, docx SHA matches; `check_extraction.sh` PASS. |
| B coverage | 165/165 blocks dispositioned (129/29/7) with 0 mapping problems. 93 REQ-PB rows, all SOURCE, all citing B blocks. |
| Templates | T01–T16 columns are verbatim in the field inventory and the register. T05 'Field/Fill-in' is a layout header. Value lists, weights, wave seeds, T11 SLAs and T10 RAG are all present. |
| Deliverables | All substance is present. The non-verbatim residue is formatting only; see the manual notes in `05-…out`. |
| Provenance | No positive official-PMI, certified or official-Mobily claim. `#0078FF` is always provisional. |
| Operating logic | Each rule has concrete acceptance: RAG from trajectory, the four separate states, forecast ≠ validated, Finance validation, BO accountability, shared benefit counted once with allocation ≤100% and unallocated shown, evidence-snapshot gates, DG≠G, ADM not an approver, Unknown instead of zero. |
| M coverage | 423/423 blocks with 0 mapping problems. I judged 78 sampled blocks from 23 sections, including table rows. |
| Staging | 0 problems; §21 alignment holds. |
| REQ-DLV-001/002/020/032 | Acceptance met. |
| Glossary, journeys, permissions | Complete and consistent. |

## D-045 (checks 10–14)
- **Tests:** the gate suite passes 66/66, and gate plus agent suites pass 105/105. In a mutation run with the check removed, the D-045 test fails because the validator reports no error at all. With the check restored, the test passes.
- **Real-history forge:** a synthetic gate in a disposable clone shows 0 'object, not a commit' errors at baseline. Forging round 28's `source_commit` as an annotated tag makes the validator report the D-045 error, plus a manifest mismatch.
- **Census:** 28 round `source_commit` values are commits, and round 18 is absent. So 27 were present before round 29, as D-045 says. All 120 `fix_revision` values are commits. 103 `head_commit_at_start` values are commits, and 3 are absent (the round-18 runs). The repository has no tags.
- **Wording:** D-045 is delivery tooling only. It correctly presents itself as the fourth and last commit-id field, completing D-044's class, and not as a business requirement. Its '105 pass' and census claims are accurate. The 'fourth and last' claim also holds: the manifest `source_commit` is covered transitively, and the review record's own `source_commit` is not a gate dependency.

## Findings
- **F-DG0-015 (Low, non-mandatory, owner: delivery-orchestrator).** The D-045 heading says the round-28 reviewers were "all three reviewers PASS; each raised one Low". But the round-28 domain record has `findings: []`, and the same row's context column correctly says "domain PASS with no findings". This is a wording contradiction in an engineering record, with no business or provenance impact. I concur with accepting it as an observation (see `domain-reviewer.verifications.json`), pending the release-auditor. If the wording is corrected instead, I will re-verify it as CLOSED_VERIFIED.

## Earlier findings
My F-DG0-013/014 were already CLOSED_VERIFIED. F-DG0-171 and F-DG0-251 belong to code-security and qa, so I did not verify them. I only corroborated the fix behaviour above.
