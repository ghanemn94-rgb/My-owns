# Handback: T-DG0-AN-01, playbook source extraction (transformation-analyst)

- **Stage:** P0 / DG0 (BUILDING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG0-T-DG0-AN-01-transformation-analyst-20260928T114637Z","session_id":"0dacbd3c-040d-4c18-8060-0448cfdbfc10"}`
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-01.md`, sha256 `bd5fd9c2e46d63990b6dd213ae8cd45a653d6a97b7841bfb96fde1a081ac5e80`. Verified at start and at end.

## 0. Revision and workspace

- **At start:** `git rev-parse HEAD` = `b42a4aa3029437dcbbae8aab61c81a3def3e69c2`, the assignment base. I verified it before writing.
- **During the run**, the orchestrator committed `8825dca` ("P0: gate validator, candidate hashing, CI job, agent load verification, delivery records"). HEAD at the end is `8825dcad7e37ec314f55438ffeb9f71d48532a3e`.
  - I checked `git diff b42a4aa..HEAD -- docs/source docs/delivery/requirements-spec.md docs/delivery/agent-protocol.md CLAUDE.md`. The playbook, master prompt, protocol and CLAUDE.md did not change.
  - `requirements-spec.md` did change. `template_id` and `notes` became optional, and `VERIFIED` is no longer written into the register. My outputs conform to both the old and the new spec (status `SPECIFIED`, `evidence` empty).
- **Final state:** I wrote only under `docs/analysis/**` and this handback. `git status` shows no other change attributable to this task. The other untracked files (assignments AN-02/AN-03/reviews, `tools/gates/import-findings.mjs`, `tools/source/merge_register.py`, the `runs/` directory) are not mine.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/analysis/parts/req-pb.csv` | 92 SOURCE register rows `REQ-PB-001`…`REQ-PB-092`. Header and columns exactly as `requirements-spec.md`. All `SPECIFIED`, `evidence` empty. sha256 `4f34dd916b15b58dbf48b5c6161217564b343fb2e51a7ab34cc8319f46f7b894` |
| `docs/analysis/source-coverage.csv` | Exactly 165 rows B0001–B0165 (`block_id,disposition,req_ids,rationale`). sha256 `25a0ec142456d3d84ce9ddc0aca4cd5fdeed8622032e2460c26fd5fe27387f32` |
| `docs/analysis/glossary.md` | 120 domain terms with English term, proposed MSA Arabic term, definition and source block. sha256 `0e58a16939f16ee67fcce06e24852f89074319d592bdf6131824d60ff5815755` |
| `docs/analysis/field-inventory.md` | Every field of T01–T16 (verbatim source column names), the Charter, thesis, five scope checks, outcome hierarchy, the 10 TOM dimensions plus canvas prompts, business case sections, the operating-system layers, benefits lifecycle, 7 adoption indicators, 90-day plan, Day-90 test, roaming example plus traceability, the 25-question health check plus bands, the minimum governance roles, modes, and phases/gates. Each field has type, required, validation and notes. sha256 `8c2bad506860fb262f4fab482dfb8caf89be0d4fac23568d0a694a22358e9132` |
| `docs/delivery/handbacks/DG0/T-DG0-AN-01-transformation-analyst.md` | This handback |

I generated both CSVs with Python's `csv` module (RFC 4180, QUOTE_MINIMAL, CRLF, no newlines inside fields). The generator lived in my session scratchpad and is not part of the candidate. The CSVs are the deliverable.

## 2. Behaviour delivered (specification only: nothing is implemented)

These are requirement specifications. **No platform behaviour exists yet.** Every row is `SPECIFIED`.

### Counts

- **Register rows:** 92, all class SOURCE. There are no USER or ENGINEERING rows, as instructed. Those belong to AN-02/AN-03.
- **By final_gate:** DG2: 24 · DG3: 20 · DG4: 36 · DG5: 12. No DG0, DG1, DG6 or DG7.
  - DG1 foundation work appears as P1 increments inside REQ-PB-001/003/012/014/029.
- **Coverage dispositions (165 blocks):** REQUIREMENT 129 · CONTEXT 29 · NON-REQUIREMENT 7.
  - NON-REQUIREMENT covers B0001, B0002, B0003 (cover), B0005 (version stamp), B0163, B0164 (reference URLs) and B0165 ("how to extend" advice).
  - CONTEXT covers headings and labels such as "PHASE n" and "TEMPLATE". Each rationale names the covering REQ-PB IDs.
- **Labelling:**
  - 25 rows carry an explicit `interpretation — see master prompt §N` note: 004 005 006 007 008 009 011 015 024 031 035 036 045 048 049 057 061 063 066 067 068 073 078 082 091.
  - 5 rows label parts as a master-prompt `extension`: 025 027 028 059 083.
  - The remaining rows say "Source-grounded; no interpretation beyond the cited blocks."
- **Acceptance scenarios referenced by PB rows:** A01, A02, A03, A04, A05, A06, A08, A09, A10, A11, A12, A15, A16. Every row names at least one scenario plus a concrete pass condition.

### Requirement list

| req_id | title | source_ref | increments | final_gate |
|---|---|---|---|---|
| REQ-PB-001 | Label the methodology provenance honestly as a practical synthesis inspired by PMI/Brightline/BRM and never claim official PMI status | B0004, B0024, B0155, B0156 | P1, P5 | DG5 |
| REQ-PB-002 | Mark custom extensions of the playbook distinctly from PMI/Brightline-derived foundations | B0154, B0157, B0158, B0159, B0160, B0161, B0162 | P2, P5 | DG5 |
| REQ-PB-003 | Offer the two source usage modes End-to-End and Modular when creating or entering a transformation | B0007, B0008, B0009 | P1, P2 | DG2 |
| REQ-PB-004 | Enforce End-to-End sequencing: no initiative launch before North Star, outcomes and target state are clear | B0009 | P2, P3 | DG3 |
| REQ-PB-005 | Support Modular entry at a chosen phase or as a standalone TOM, business case or benefits register and flag missing links to outcomes and benefits | B0008, B0009 | P2, P3, P4 | DG4 |
| REQ-PB-006 | Apply 'Outcome before activity': initiatives cannot be submitted for prioritization without a linked measurable outcome | B0011 | P3 | DG3 |
| REQ-PB-007 | Apply 'Current state before solution': require a diagnostic covering economics, customer, operations, capability and technology before initiatives are prescribed | B0012 | P2, P3 | DG3 |
| REQ-PB-008 | Apply 'Operating model before execution': decision rights, ownership and cross-functional ways of working are explicit before execution | B0013 | P2, P4 | DG4 |
| REQ-PB-009 | Apply 'Benefits before closure': an initiative is complete only when value is realized and sustained, not when delivered | B0014 | P3, P4 | DG4 |
| REQ-PB-010 | Apply 'One source of truth': keep the charter, roadmap, initiative portfolio and benefits register linked as canonical records | B0015 | P2, P3, P4 | DG4 |
| REQ-PB-011 | Show the four guiding questions and tag each deliverable with the question it answers | B0016 | P2, P5 | DG5 |
| REQ-PB-012 | Seed the six minimum governance roles with their source accountabilities and assign them per transformation | B0017, B0018 | P1, P2 | DG2 |
| REQ-PB-013 | Restrict Finance / Value Office validation of baseline, benefit logic and value realization to the Finance role | B0018, B0084 | P2, P3, P4 | DG4 |
| REQ-PB-014 | Model the six phases with name, purpose, key outputs and phase objective | B0020, B0021, B0027, B0046, B0054, B0068, B0091, B0119 | P1, P2, P3, P4 | DG4 |
| REQ-PB-015 | Model the six stage gates G1-G6 as explicit approval records with decision question and evidence required | B0022, B0023, B0160 | P2, P3, P4 | DG4 |
| REQ-PB-016 | G1 Case for Change: require diagnostic, baseline, root causes and value pools as gate evidence | B0023 | P2 | DG2 |
| REQ-PB-017 | G2 Direction: require North Star, outcome tree, KPI definitions and guardrails as gate evidence | B0023 | P2 | DG2 |
| REQ-PB-018 | G3 Target State: require Target Operating Model, capability gaps and future journeys as gate evidence | B0023 | P2 | DG2 |
| REQ-PB-019 | G4 Mobilization: require initiative cards, business cases, roadmap, owners and capacity as gate evidence | B0023 | P3 | DG3 |
| REQ-PB-020 | G5 Scale: require performance evidence, adoption, risk closure and decision log as gate evidence | B0023 | P4 | DG4 |
| REQ-PB-021 | G6 Sustain: require benefits evidence, ownership transfer, controls and continuous improvement backlog as gate evidence | B0023 | P4 | DG4 |
| REQ-PB-022 | Enforce the Gate 1 rule: no list of projects proceeds until leadership agrees on problem, baseline and material value pools | B0032 | P2, P3 | DG3 |
| REQ-PB-023 | Organize the diagnostic into the six source workstreams with key questions and typical outputs | B0029 | P2 | DG2 |
| REQ-PB-024 | Provide an editable capability heatmap with build/buy/partner needs | B0029, B0021 | P2 | DG2 |
| REQ-PB-025 | Provide journey and process maps capturing pain points, cycle time and failure demand | B0029, B0021, B0056 | P2 | DG2 |
| REQ-PB-026 | Implement Template 1 Current-State Diagnostic as a native register | B0030, B0031 | P2 | DG2 |
| REQ-PB-027 | Record measurable baselines with metric, source and baseline date | B0023, B0031, B0035, B0042, B0085 | P2 | DG2 |
| REQ-PB-028 | Record value pools quantified by driver with upside and downside | B0021, B0023, B0029, B0032, B0085 | P2 | DG2 |
| REQ-PB-029 | Implement the Transformation Charter as a first-class record with all 14 source fields | B0034, B0035 | P1, P2 | DG2 |
| REQ-PB-030 | Capture the transformation thesis in its four-part causal sentence | B0036, B0037 | P2 | DG2 |
| REQ-PB-031 | Run the five scope sanity checks on the charter | B0038, B0039, B0040, B0041, B0042, B0043 | P2 | DG2 |
| REQ-PB-032 | Model the outcome hierarchy from North Star to strategic outcomes, KPIs, targets and initiative contribution | B0047, B0048 | P2, P3 | DG3 |
| REQ-PB-033 | Hold exactly one current North Star per transformation, stated as one concise sentence | B0035, B0048 | P2 | DG2 |
| REQ-PB-034 | Implement Template 2 Outcome & KPI Tree as a native register | B0049, B0050, B0048 | P2 | DG2 |
| REQ-PB-035 | Warn when the charter does not hold 3-5 top outcomes | B0035 | P2 | DG2 |
| REQ-PB-036 | Apply the good outcome test to every outcome | B0051 | P2 | DG2 |
| REQ-PB-037 | Record strategic guardrails as non-negotiables | B0035, B0021, B0023 | P2 | DG2 |
| REQ-PB-038 | Seed the 10 TOM dimensions with their design questions | B0055, B0056, B0159 | P2 | DG2 |
| REQ-PB-039 | Implement Template 3 TOM Gap Matrix as a native register | B0057, B0058 | P2 | DG2 |
| REQ-PB-040 | Keep the TOM distinct from the project portfolio | B0059 | P2, P3 | DG3 |
| REQ-PB-041 | Implement the Target Operating Model Canvas with the ten source boxes and prompts | B0061, B0062 | P2 | DG2 |
| REQ-PB-042 | Support the TOM canvas workshop and convert unresolved items into design decisions with owners | B0063 | P2 | DG2 |
| REQ-PB-043 | Implement Template 4 Design Decision Log as a native register | B0064, B0065 | P2 | DG2 |
| REQ-PB-044 | Maintain the traceability chain from diagnosed issue to benefit with a view and orphan report | B0069, B0070, B0162 | P2, P3, P4 | DG4 |
| REQ-PB-045 | Implement Template 5 Initiative Card as a native record | B0071, B0072 | P3 | DG3 |
| REQ-PB-046 | Require every initiative to be traced to a target-state gap and an outcome | B0072, B0070 | P3 | DG3 |
| REQ-PB-047 | Implement Template 6 Prioritization Scorecard as a native register | B0074, B0075, B0076 | P3 | DG3 |
| REQ-PB-048 | Apply T06 default weights 25/25/20/15/15 with a 1-5 scale and a calculated weighted score | B0076 | P3 | DG3 |
| REQ-PB-049 | Allow weights to be adjusted to context, including risk/compliance replacing part of the weighting | B0077 | P3, P5 | DG5 |
| REQ-PB-050 | Implement Template 7 Wave Roadmap with the four seeded source waves | B0078, B0079 | P3 | DG3 |
| REQ-PB-051 | Implement Template 8 Dependency Map as a native register | B0080, B0081 | P3 | DG3 |
| REQ-PB-052 | Support T08 dependency types Decision, Tech, Data and Vendor plus configurable types | B0081 | P3 | DG3 |
| REQ-PB-053 | Implement the Transformation Business Case with all ten source sections | B0083, B0085 | P3 | DG3 |
| REQ-PB-054 | Support a transformation-level business case with lighter linked initiative cases | B0084 | P3 | DG3 |
| REQ-PB-055 | Require Finance validation of baseline and benefit logic early, before G4, not after delivery | B0084, B0139 | P3 | DG3 |
| REQ-PB-056 | Implement Template 9 Benefit Formula as a native register | B0086, B0087 | P3 | DG3 |
| REQ-PB-057 | Seed the two source benefit formula examples | B0087 | P3 | DG3 |
| REQ-PB-058 | Prevent double counting: each benefit has a unique owner, baseline, formula and financial-statement or non-financial KPI link | B0088 | P3, P4 | DG4 |
| REQ-PB-059 | Record owners and capacity for mobilization | B0021, B0023, B0079 | P3 | DG3 |
| REQ-PB-060 | Seed the five transformation operating system layers with cadence, purpose, participants and outputs | B0092, B0093, B0161 | P4 | DG4 |
| REQ-PB-061 | Produce each forum's source outputs as native meeting records | B0093 | P4 | DG4 |
| REQ-PB-062 | Implement Template 10 Executive Transformation Dashboard with its six source areas | B0094, B0095 | P4 | DG4 |
| REQ-PB-063 | Apply the area-specific T10 RAG logic | B0095 | P4 | DG4 |
| REQ-PB-064 | Show a Decisions area Red when an executive decision is overdue | B0095 | P4 | DG4 |
| REQ-PB-065 | Implement Template 11 Decision Rights Matrix with the four seeded source rows | B0098, B0099 | P4 | DG4 |
| REQ-PB-066 | Compute T11 SLAs by type: working days, next forum or release plan | B0099 | P4 | DG4 |
| REQ-PB-067 | Implement Template 12 RACI with the six seeded deliverables and R/A/C/I values including A/R | B0100, B0101 | P4 | DG4 |
| REQ-PB-068 | Enforce the governance rule: escalate decisions, not status | B0102 | P4 | DG4 |
| REQ-PB-069 | Manage adoption as an outcome with measurable leading indicators, separate from delivery | B0105 | P4 | DG4 |
| REQ-PB-070 | Implement Template 13 Stakeholder & Adoption Plan as a native register | B0106, B0107 | P4 | DG4 |
| REQ-PB-071 | Seed the seven leading adoption indicators | B0108, B0109, B0110, B0111, B0112, B0113, B0114, B0115 | P4 | DG4 |
| REQ-PB-072 | Track training completion and observed proficiency separately | B0112 | P4 | DG4 |
| REQ-PB-073 | Apply the people-centered principle: record impacted-team involvement in design and champion constraints | B0116 | P2, P4 | DG4 |
| REQ-PB-074 | Implement the six-step benefits lifecycle Identify, Plan, Enable, Measure, Correct, Sustain | B0120, B0121 | P4 | DG4 |
| REQ-PB-075 | Implement Template 14 Benefits Register as a native register | B0122, B0123 | P4 | DG4 |
| REQ-PB-076 | Allow non-financial benefits with Value (SAR) n/a and Realized expressed as KPI actual | B0123 | P4 | DG4 |
| REQ-PB-077 | Label the Realize phase as aligned with PMI BRM logic without claiming PMI standard status | B0124 | P4, P5 | DG5 |
| REQ-PB-078 | Integrate RAID and decisions so dependencies and decisions are single canonical records | B0126 | P4 | DG4 |
| REQ-PB-079 | Implement Template 15 RAID as a native register | B0127, B0128 | P4 | DG4 |
| REQ-PB-080 | Set T15 Probability to n/a for Assumption, Issue and Dependency entries | B0128 | P4 | DG4 |
| REQ-PB-081 | Implement Template 16 Executive Decision Log as a native register | B0129, B0130 | P4 | DG4 |
| REQ-PB-082 | Apply the escalation principle: a blocker red for multiple cycles requires a named decision, owner and deadline | B0131 | P4 | DG4 |
| REQ-PB-083 | Hand over to BAU with ownership transfer, controls and control cadence | B0021, B0023, B0101, B0121 | P4 | DG4 |
| REQ-PB-084 | Maintain a continuous-improvement backlog | B0021, B0023 | P4 | DG4 |
| REQ-PB-085 | Create a recovery plan / corrective action when a benefit or KPI is off track | B0121, B0093 | P4 | DG4 |
| REQ-PB-086 | Seed the 90-day launch plan as scheduled tasks relative to a start date | B0133, B0134, B0161 | P5 | DG5 |
| REQ-PB-087 | Run the Day-90 leadership test | B0135, B0136, B0137, B0138, B0139, B0140, B0141 | P5 | DG5 |
| REQ-PB-088 | Seed the International Roaming worked example as clearly synthetic demo data | B0143, B0145, B0162 | P5 | DG5 |
| REQ-PB-089 | Label every example record as illustrative and replaceable by validated data | B0144 | P5 | DG5 |
| REQ-PB-090 | Seed the three illustrative traceability chains of the roaming example | B0146, B0147 | P5 | DG5 |
| REQ-PB-091 | Implement the 25-question Transformation Health Check with score and top 3 actions | B0149, B0150, B0161 | P5 | DG5 |
| REQ-PB-092 | Interpret the health-check score with the four source bands | B0151, B0152 | P5 | DG5 |

### Assignment rule → requirement mapping

| Assignment rule | Requirement |
|---|---|
| T06 weights | REQ-PB-048 |
| T10 area RAG | REQ-PB-063 |
| T08 dependency types | REQ-PB-052 |
| T15 probability n/a | REQ-PB-080 |
| "Red if executive decision overdue" | REQ-PB-064 |
| Escalation principle | REQ-PB-082 |
| Governance rule | REQ-PB-068 |
| Good outcome test | REQ-PB-036 |
| Gate 1 rule | REQ-PB-022 |
| No double counting | REQ-PB-058 |
| "A project portfolio is not a TOM" | REQ-PB-040 |
| Traceability chain | REQ-PB-044 |
| Design principles | REQ-PB-006..010 |
| Four questions | REQ-PB-011 |
| People-centred principle | REQ-PB-073 |
| PMI BRM connection | REQ-PB-077 |
| Provenance labelling (B0004, B0154–B0162) | REQ-PB-001 and REQ-PB-002 |

### Permissions and roles

Permissions use the source roles SP, TL, BO, WL, FIN and TO, plus the implementation roles KDS, TD, CM, SEC, AUD and ADM (master prompt §10). ADM is never given a business approval.

## 3. Checks actually run

Environment: Linux 6.18, Python 3 (system), Node v22.22.2, working tree `/home/user/My-owns` at HEAD `8825dca` with my untracked outputs.

### Check A: self-check script covering acceptance checks 1–4 plus register format

- **Command:** `python3 <scratchpad>/check.py` (full source reproduced in the appendix; run from the repo root).
- **Result:** exit status 0. Output:

```
PMI-phrase REQ-PB-001.title: ...d by PMI/Brightline/BRM and never claim official PMI status...
PMI-phrase REQ-PB-001.acceptance: ...and report templates finds no claim of 'official PMI standard'...
PMI-phrase REQ-PB-001.acceptance: ...s no claim of 'official PMI standard', 'PMI certified' or equiv...
PMI-phrase REQ-PB-002.acceptance: ...nd ar; no such element is labelled as a PMI standard...
PMI-phrase REQ-PB-077.title: ...ned with PMI BRM logic without claiming PMI standard status...
PMI-phrase glossary.md: official PMI
PMI-phrase field-inventory.md: official PMI
rows: 92
dispositions: {'NON-REQUIREMENT': 7, 'REQUIREMENT': 129, 'CONTEXT': 29}
final_gate: {'DG2': 24, 'DG3': 20, 'DG4': 36, 'DG5': 12}
templates: {'-': 43, 'T01': 1, 'CHARTER': 5, 'T02': 3, 'TOM-CANVAS': 3, 'T03': 1, 'T04': 1, 'T05': 2, 'T06': 3, 'T07': 1, 'T08': 2, 'BIZCASE': 3, 'T09': 2, 'T14': 3, 'T10': 3, 'T11': 2, 'T12': 1, 'T16': 3, 'T13': 1, 'T15': 2, 'LAUNCH90': 2, 'ROAMING-EX': 3, 'HEALTH25': 2}
acceptance ids used: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A08', 'A09', 'A10', 'A11', 'A12', 'A15', 'A16']
ERRORS: 0
```

The "PMI-phrase" lines are the script's check 4. It prints every match of `official PMI|PMI certified|PMI standard|certified product` for human inspection. All 7 matches are prohibitions, not claims:

- REQ-PB-001 title: "never claim official PMI status".
- REQ-PB-001 acceptance: a scan that must find *no* such claim.
- REQ-PB-002 acceptance: "no such element is labelled as a PMI standard".
- REQ-PB-077 title: "without claiming PMI standard status".
- The glossary and field inventory: "No term here implies / Nothing here claims official PMI status".

What the script verifies:

1. Coverage is exactly B0001..B0165, in order, with no duplicates.
2. Every REQUIREMENT row's `req_ids` exist and each cites that block; CONTEXT/NON-REQUIREMENT rows have a rationale and empty `req_ids`, and any REQ IDs named in a rationale exist. Every `req-pb.csv` row cites only existing B blocks (checked against `playbook.blocks.json`). In the reverse direction, every cited block's coverage row lists the requirement.
3. For T01–T16, CHARTER and BIZCASE, every source column appears as an exact `;`-separated entry of the template's "Implement …" row's `input_fields`, exists in `playbook.md`, and appears in `field-inventory.md`.
4. The PMI-phrase scan described above.

It also checks the register format:

- all 19 columns present, and non-empty except `template_id` and `evidence`;
- ID pattern;
- class is SOURCE and status is SPECIFIED;
- `increments` ⊂ P0–P7, and `final_gate` equals the highest increment;
- the `acceptance` IDs are within A01–A28;
- no newlines inside fields.

### Check B: parse with the project's own RFC 4180 parser

- **Command:** `node --input-type=module -e '<parseCsv over both files>'` using `tools/gates/lib/csv.mjs`.
- **Result:** exit 0.

```
docs/analysis/parts/req-pb.csv header cols: 19 rows: 92 ragged: 0
docs/analysis/source-coverage.csv header cols: 4 rows: 165 ragged: 0
```

### Check C: real gate validator, register mode, in a disposable copy

The candidate tree was not touched: `docs/delivery/requirements.csv` still does not exist in it.

- **Commands** (run in `<scratchpad>/vcopy`, a copy of `tools/`, `docs/`, `.claude/`):
  - `python3 tools/source/merge_register.py`, which gave `merged 92 requirements {'PB': 92}; 0 master-prompt coverage rows` (exit 0);
  - then `node tools/gates/validate.mjs --register DG0`.
- **Result:** exit 1, "FAIL register rules at DG0 (438 problems)". The failure is expected and fully accounted for:
  - 423 × `docs/analysis/master-prompt-coverage.csv: block M#### has no disposition`. The master-prompt matrix is AN-02/AN-03 scope and doesn't exist yet.
  - 15 × `acceptance scenario Axx is not referenced by any requirement`, for A07, A13, A14 and A17–A28. These are USER/ENGINEERING/delivery scenarios that AN-02/AN-03 rows are expected to reference.
  - **0 problems** mention any `REQ-PB` row, `source-coverage.csv` or any `B####` block. I checked this with `grep -E 'REQ-PB|source-coverage|B0[0-9]{3}'` over the output, which returned nothing.
- **Status:** the register-level DG0 check therefore cannot pass until AN-02/AN-03 are merged. It is not claimed as passed.

## 4. Known gaps, uncertainties and not done

1. **User journeys per role and a full role × record × action permissions matrix are not delivered as separate artefacts.** My agent definition lists them, but this assignment's permitted-file list doesn't include a path for them. Permissions are specified per requirement in the `permissions` column, and the roles table is in `field-inventory.md`. The orchestrator should assign a path (for example `docs/analysis/user-journeys.md` and `docs/analysis/permissions-matrix.md`) if they're needed for DG0.
2. **The Arabic glossary terms are proposals.** No official Mobily Arabic terminology was supplied, and a native Mobily language owner must review them before any release. A few terms have plausible alternatives:
   - Modular mode: "النمط المعياري"
   - Mobilize: "التعبئة"
   - Transform: "التحويل والتنفيذ"
3. **Only playbook blocks are cited in `source_ref`.** I cited no `M####` blocks, to avoid coupling my rows to the master-prompt matrix, which AN-02/AN-03 own. Master-prompt context is referenced by section (§N) in `notes`. If the orchestrator wants M anchors on PB rows, `merge_register.py` supports `ref-additions-*.csv`.
4. **Interpretations** (25 rows, listed above) are where I turned a source principle or a "should" into a testable platform control, or picked a value the source doesn't give. Examples:
   - default gate approver = Sponsor;
   - warn rather than block for 3–5 outcomes and for 3–7 deliverables;
   - the response scale for the scope sanity checks;
   - the RAG thresholds;
   - the escalation cycle count;
   - Yes=1/No=0 health scoring.
   
   Each is labelled. The domain reviewer should confirm that these are acceptable as SOURCE rows with interpretation notes, or whether any should move to USER/ENGINEERING.
5. **Arithmetic in the acceptance examples**, recomputed by hand. Reviewers may wish to recheck:
   - REQ-PB-048: scores 5,4,3,2,1 give 1.25+1.00+0.60+0.30+0.15 = 3.30.
   - REQ-PB-057: 0.02 × 100000 × 50 = 100000 SAR.
   - REQ-PB-086: a start of 2026-10-01 plus offsets 31–60 gives 2026-11-01..2026-11-30, reading "Days 0-30" as day offsets. That reading is an assumption.
6. **Borderline dispositions:**
   - B0002 (cover strapline) and B0003 (cover figures "6 PHASES | 15+ READY TEMPLATES | 1 OPERATING SYSTEM") are NON-REQUIREMENT, with their substance covered by REQ-PB-014 and the template rows.
   - B0005 (version stamp) is NON-REQUIREMENT as the assignment directs. Methodology version pinning is master prompt §6 scope.
7. **Gate DG0 is not approved.** This task produces analysis inputs only, and I do not review or approve my own work.

## 5. Merge instructions

- No migrations. The files are new, and I own the ID range `REQ-PB-001`–`REQ-PB-092` exclusively (the next free ID is `REQ-PB-093`).
- **Merge:** run `python3 tools/source/merge_register.py` after AN-02/AN-03 add their `docs/analysis/parts/req-*.csv` and `mp-coverage-*.csv`. PB rows sort first. The script fails on duplicate IDs, so no conflicts are expected.
- `docs/analysis/source-coverage.csv` is final as delivered. If AN-02/AN-03 rows should also cite B blocks, the coverage row for each such block must add their IDs, or the validator's bidirectional check will fail. Coordinate through the orchestrator rather than editing this file independently.
- **Row-number dependencies.** CONTEXT rationales and `field-inventory.md` refer to specific REQ-PB numbers, so renumbering would require regenerating both.

## Appendix: self-check script (`check.py`, run from any cwd; ROOT is absolute)

```python
import csv, re, json, collections, sys
ROOT = "/home/user/My-owns/"
HEADER = ["req_id","class","title","source_ref","source_heading","template_id","input_fields","procedure","output","owner_roles","permissions","automation","screen_api","acceptance","increments","final_gate","status","evidence","notes"]
errs = []
blocks = {b["id"] for b in json.load(open(ROOT + "docs/source/playbook.blocks.json"))}
with open(ROOT + "docs/analysis/parts/req-pb.csv", newline="", encoding="utf-8") as f:
    rd = csv.reader(f); hdr = next(rd); rows = [dict(zip(hdr, r)) for r in rd]
    if hdr != HEADER: errs.append("req header mismatch")
with open(ROOT + "docs/analysis/source-coverage.csv", newline="", encoding="utf-8") as f:
    rd = csv.reader(f); chdr = next(rd); cov = [dict(zip(chdr, r)) for r in rd]
    if chdr != ["block_id","disposition","req_ids","rationale"]: errs.append("coverage header mismatch")
req = {r["req_id"]: r for r in rows}
# register format
if len(req) != len(rows): errs.append("duplicate req_id")
for r in rows:
    if len(r) != 19: errs.append(f"{r.get('req_id')} wrong column count")
    if not re.fullmatch(r"REQ-PB-\d{3}", r["req_id"]): errs.append(f"bad id {r['req_id']}")
    for c in HEADER:
        if c not in ("evidence", "template_id") and not r[c].strip(): errs.append(f"{r['req_id']} empty {c}")
    if r["template_id"] not in ["", "CHARTER", "TOM-CANVAS", "BIZCASE", "LAUNCH90", "HEALTH25", "ROAMING-EX"] + [f"T{i:02d}" for i in range(1, 17)]: errs.append(f"{r['req_id']} bad template_id")
    if r["evidence"]: errs.append(f"{r['req_id']} evidence not empty")
    if r["class"] != "SOURCE" or r["status"] != "SPECIFIED": errs.append(f"{r['req_id']} class/status")
    if r["final_gate"] not in [f"DG{i}" for i in range(8)]: errs.append(f"{r['req_id']} final_gate")
    incs = r["increments"].split(";")
    if any(i not in [f"P{k}" for k in range(8)] for i in incs): errs.append(f"{r['req_id']} increments")
    if f"P{r['final_gate'][2]}" != max(incs): errs.append(f"{r['req_id']} final_gate {r['final_gate']} != last increment {max(incs)}")
    refs = r["source_ref"].split(";")
    if not refs or any(x not in blocks for x in refs): errs.append(f"{r['req_id']} bad source_ref {refs}")
    acc = re.findall(r"A(\d\d)", r["acceptance"].split(":")[0])
    if not acc or any(not 1 <= int(a) <= 28 for a in acc): errs.append(f"{r['req_id']} acceptance ids")
    if "\n" in "".join(r.values()) or "\r" in "".join(r.values()): errs.append(f"{r['req_id']} newline in field")
# check 1
ids = [c["block_id"] for c in cov]
if ids != [f"B{i:04d}" for i in range(1, 166)]: errs.append("coverage not exactly B0001..B0165 in order")
# check 2
for c in cov:
    d = c["disposition"]
    if d == "REQUIREMENT":
        for q in c["req_ids"].split(";"):
            if q not in req: errs.append(f"{c['block_id']} -> missing {q}")
            elif c["block_id"] not in req[q]["source_ref"].split(";"): errs.append(f"{c['block_id']} -> {q} doesn't cite it")
    elif d in ("CONTEXT", "NON-REQUIREMENT"):
        if not c["rationale"].strip() or c["req_ids"]: errs.append(f"{c['block_id']} {d} needs rationale/empty req_ids")
        for q in re.findall(r"REQ-PB-\d{3}", c["rationale"]):
            if q not in req: errs.append(f"{c['block_id']} rationale names missing {q}")
    else: errs.append(f"{c['block_id']} bad disposition {d}")
covmap = {c["block_id"]: c for c in cov}
for r in rows:
    for b in r["source_ref"].split(";"):
        if covmap[b]["disposition"] != "REQUIREMENT" or r["req_id"] not in covmap[b]["req_ids"].split(";"):
            errs.append(f"reverse: {r['req_id']} cites {b} but coverage row doesn't list it")
# check 3: template columns verbatim
T = {
 "T01": ["Dimension","Current state","Evidence / baseline","Root cause","Impact","Confidence"],
 "T02": ["Outcome","KPI","Baseline","Target","Target date","Owner","Leading indicator"],
 "T03": ["TOM dimension","Current state","Target state","Gap","Design decision","Owner"],
 "T04": ["ID","Decision required","Options","Recommendation","Decision owner","Due","Status"],
 "T05": ["Initiative name","Executive owner","Workstream lead","Problem / gap addressed","Objective","Scope","Key deliverables","Outcome/KPI contribution","Financial benefit","Customer benefit","Dependencies","Risks","Milestones","Required decisions"],
 "T06": ["Initiative","Strategic fit (25%)","Financial value (25%)","Customer impact (20%)","Feasibility (15%)","Time-to-value (15%)","Weighted score"],
 "T07": ["Wave","Purpose","Typical horizon","Entry criteria","Exit evidence"],
 "T08": ["Dependency","From","To","Type","Needed by","Owner","Status / mitigation"],
 "T09": ["Benefit","Baseline driver","Change assumption","Formula","Ramp","Confidence"],
 "T10": ["Area","What to show","RAG logic","Outcomes","Value","Portfolio","Dependencies","Decisions","People & adoption"],
 "T11": ["Decision","Recommend","Approve","Consult","Inform","SLA"],
 "T12": ["Deliverable","Sponsor","Transformation Lead","Business Owner","Workstream Lead","Finance","Tech/Data"],
 "T13": ["Stakeholder","Impact","Current stance","Required behavior","Intervention","Owner","Adoption KPI"],
 "T14": ["ID","Benefit","Type","Baseline","Target","Value (SAR)","Realized","Owner","Evidence","Status"],
 "T15": ["ID","Type","Description","Impact","Probability","Owner","Due","Mitigation / action","Status"],
 "T16": ["ID","Decision","Why now","Options","Rec.","Owner","Decision date","Impact if delayed","Outcome"],
 "CHARTER": ["Transformation name","Executive sponsor","Transformation lead","Case for change","North Star","In scope","Out of scope","Baseline date","Target horizon","Top 3-5 outcomes","Strategic guardrails","Governance forum","Decision rights","Success definition"],
 "BIZCASE": ["Strategic rationale","Baseline","Value pools","Interventions","Investment","Benefits","Timing","Risks & sensitivities","Ownership","Decision ask"],
}
# verbatim column headers extracted from the playbook itself, to guard against typos in T
pb = open(ROOT + "docs/source/playbook.md", encoding="utf-8").read()
fi = open(ROOT + "docs/analysis/field-inventory.md", encoding="utf-8").read()
for tid, cols in T.items():
    main = [r for r in rows if r["template_id"] == tid and r["title"].startswith("Implement")]
    if len(main) != 1: errs.append(f"{tid}: expected 1 main 'Implement' row, got {len(main)}"); continue
    fields = main[0]["input_fields"].split(";")
    for c in cols:
        if c not in fields: errs.append(f"{tid}: '{c}' not an exact input_fields entry of {main[0]['req_id']}")
        if f"| {c} |" not in pb and c not in pb: errs.append(f"{tid}: '{c}' not found in playbook")
        if c not in fi: errs.append(f"{tid}: '{c}' missing from field-inventory.md")
    if f"## {tid}" not in fi and tid not in ("CHARTER","BIZCASE"): errs.append(f"{tid} section missing in field-inventory")
for tid in [f"T{i:02d}" for i in range(1,17)]:
    for c in T[tid]:
        if f"| {c} |" not in pb and not pb.count(c): errs.append(f"{tid} {c} not verbatim in playbook")
# check 4: PMI claims
bad = re.compile(r"(official PMI|PMI[- ]certified|PMI standard|certified product)", re.I)
for r in rows:
    for k, v in r.items():
        for m in bad.finditer(v):
            ctx = v[max(0, m.start()-40): m.end()+10]
            print(f"PMI-phrase {r['req_id']}.{k}: ...{ctx}...")
for name in ["glossary.md", "field-inventory.md"]:
    for m in bad.finditer(open(ROOT + "docs/analysis/" + name, encoding="utf-8").read()):
        print(f"PMI-phrase {name}: {m.group(0)}")
# counts
print("rows:", len(rows))
print("dispositions:", dict(collections.Counter(c["disposition"] for c in cov)))
print("final_gate:", dict(sorted(collections.Counter(r["final_gate"] for r in rows).items())))
print("templates:", dict(collections.Counter(r["template_id"] or "-" for r in rows)))
print("acceptance ids used:", sorted({a for r in rows for a in re.findall(r"A\d\d", r["acceptance"].split(":")[0])}))
print("ERRORS:", len(errs)); [print(" ", e) for e in errs]
sys.exit(1 if errs else 0)
```
