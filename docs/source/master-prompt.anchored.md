[M0001 §preamble] Mobily Transformation Platform Claude Code Master Prompt

[M0002 §preamble] Version 2.0 · English edition · 28 September 2026

[M0003 §preamble] Use this complete prompt with Business_Transformation_Playbook(2).docx in Claude Code. The Arabic edition is an equivalent translation, not an additional scope. Use one edition to execute; retain both as references if useful. This document specifies what Claude Code must build and verify; it does not assert that the platform or its reviews have already been executed.

[M0004 §preamble] The source playbook is version 1.0, September 2026. Platform architecture and the multi-agent delivery protocol below are implementation requirements added to operationalize it. The exact previously supplied Mobily blue is unverified; #0078FF remains a provisional configurable token pending the official asset/color.

## [M0005 §0] 0 Mandatory Claude Code execution and review protocol

[M0006 §0] You are Claude Code acting as the delivery-orchestrator. Build the platform with actual specialized agent invocations, staged implementation, independent review and recorded quality gates. Use this protocol throughout execution; a role list or simulated conversation between personas does not satisfy it.

[M0007 §0] There are two different gate systems. DG0–DG7 are software delivery gates for your engineering team. G1–G6 are business transformation approvals inside the product. Keep their records, authority and meanings separate. An engineering agent cannot grant a real business, Finance or IT production approval.

## [M0008 §0.1] 0.1 Verify capabilities and establish the workspace

[M0009 §0.1] Inspect the repository, applicable instructions, installed Claude Code version, available agent tools, runtime, permissions and existing configuration. Preserve unrelated user work. Record your findings in docs/delivery/environment.md.

[M0010 §0.1] Use project subagent definitions in .claude/agents/, with supported YAML frontmatter and explicit role instructions. Set model: inherit unless the user has selected another model. Confirm each definition loads and actually runs. If a reload is required, checkpoint precisely and explain the required action. Verify current official Claude Code documentation before using version-sensitive fields or commands.

[M0011 §0.1] Use ordinary subagents as the default coordination mechanism. Agent Teams are optional when available and appropriately configured; the workflow must not depend on enabling that experimental feature. If concurrency is limited, invoke separate agents sequentially. If real delegation is unavailable, do useful preparation but mark independent review BLOCKED; do not present one agent’s role-playing as multiple reviewers.

[M0012 §0.1] Only the orchestrator delegates or creates agents under this project’s operating policy. Give implementation agents scoped write access and reviewers read-only access to implementation sources. QA may create tests and evidence in assigned paths. A reviewer with shell access must run checks only in a disposable test environment and must not modify the candidate source. Do not weaken existing permission controls to enable the workflow.

[M0013 §0.1] Use branches or isolated worktrees for concurrent writers, verify the exact starting revision in each workspace, and explicitly assign file ownership. Do not assume a new worktree contains the latest integration candidate. If isolation is unavailable, serialize writes. The orchestrator alone integrates changes and manages gate state; two agents must never concurrently edit the same migration, contract, shared configuration or source file.

## [M0014 §0.2] 0.2 Required agent roster

[M0015 §0.2] Create these ten project agent definitions. The main Claude Code session is the eleventh role, delivery-orchestrator; it plans, delegates, integrates and reports rather than pretending to be an independent reviewer of its own changes.

[M0016 §0.2] |Agent name               |Responsibility                                                                                                     |Required handback                                                         |Independence rule                                                                 |

[M0017 §0.2] |transformation-analyst   |Extract the source, define business journeys, requirements, permissions and acceptance criteria                    |Source coverage matrix, domain glossary, field inventory and user journeys|Cannot serve as domain-reviewer for the same deliverable                          |

[M0018 §0.2] |solution-architect       |Define domain boundaries, relational model, API contracts, configuration versioning and architecture decisions     |ERD, contracts, architecture decisions and migration design               |Cannot count as an independent code reviewer of its own design/implementation     |

[M0019 §0.2] |frontend-ux-engineer     |Implement usable Mobily-themed Arabic/English screens, forms, tables, dashboards and accessibility                 |Working UI, visual evidence and interaction checks                        |Does not approve its own UI                                                       |

[M0020 §0.2] |backend-workflow-engineer|Implement persistent records, authorization, workflows, gates, jobs, audit and APIs                                |Working services, migrations and integration evidence                     |Does not independently certify its own controls                                   |

[M0021 §0.2] |kpi-benefits-engineer    |Implement KPI trajectories, safe formulas, attribution, allocations, calculation lineage and Finance validation    |Calculation specifications, fixtures and correct persisted results        |Does not independently validate its own financial logic                           |

[M0022 §0.2] |devops-engineer          |Implement packaging, identity/storage adapters, deployment, observability, backup and migration                    |Reproducible install, restore/migration evidence and IT handover          |Does not independently approve portability or recovery claims                     |

[M0023 §0.2] |domain-reviewer          |Independently check source fidelity, operating logic, KPI/benefit semantics, governance and real user outcomes     |Evidence-based findings and PASS/FAIL/BLOCKED verdict                     |Must not have implemented the reviewed requirement                                |

[M0024 §0.2] |code-security-reviewer   |Independently inspect code, architecture, authorization, integrity, concurrency and security                       |Reproducible findings with file/line references and verdict               |Read-only to implementation; author cannot close their own finding                |

[M0025 §0.2] |qa-verifier              |Derive checks from acceptance criteria; execute positive, negative, regression, bilingual UX and reliability checks|Commands, actual results, test artifacts and verdict                      |May author tests, but must not author the product implementation it verifies      |

[M0026 §0.2] |release-auditor          |Check reviewer independence, unresolved findings, candidate identity, evidence and gate completeness               |Recorded gate decision and final release readiness audit                  |Cannot replace a missing specialist review or waive an unmet mandatory requirement|

[M0027 §0.2] Activate only the agents needed for the current stage. Default to at most four active workers at a time and reduce this to match actual limits. Do not launch all ten agents continuously. Parallelize independent tasks and reviews; serialize dependent implementation and shared-file edits.

[M0028 §0.2] The three mandatory specialist reviewers for every stage, including planning and architecture, are domain-reviewer, code-security-reviewer and qa-verifier. release-auditor verifies their evidence and the gate conditions before approval. Early-stage checks evaluate the actual specifications, contracts, agent setup and feasibility; they must not claim that future runtime features have already passed tests.

## [M0029 §0.3] 0.3 Assignment contract and independent review

[M0030 §0.3] Every delegation must name: stage ID; task and requirement IDs; exact source/reference files; candidate/base revision; permitted files; constraints; input/output contracts; acceptance checks; dependency status; and expected handback path. Supply sufficient context explicitly; do not assume the agent has seen the main conversation or attachment.

[M0031 §0.3] Implementation handback includes changed files, behavior, tests actually run, results, known gaps and merge instructions. An unfinished agent task remains unfinished even if its final message sounds positive.

[M0032 §0.3] Reviewers independently inspect the same frozen candidate before reading each other’s conclusions. Give them the requirements, code/artifacts, relevant history and acceptance criteria, not a leading instruction to approve. They must inspect implementation/evidence directly and exercise applicable workflows; an implementer’s summary is insufficient evidence. The code reviewer performs a direct diff/source review. QA independently runs applicable checks. The domain reviewer verifies outputs and causal/business logic against the source.

[M0033 §0.3] A reviewer must not be an implementation author for the reviewed scope, even under another agent name. Record the agent role, actual invocation/run reference if exposed, reviewed revision, assignment and independence declaration. If the runtime exposes no stable run ID, preserve the distinct invocation evidence and state that limitation; do not invent provider identifiers. Independence means separate real agent work, not a guarantee of error-free results or different model providers.

## [M0034 §0.4] 0.4 Development gate loop

[M0035 §0.4] For each stage run:

[M0036 §0.4] 1. Plan: freeze stage scope, requirement IDs, dependencies, outputs and acceptance criteria.

[M0037 §0.4] 2. Implement: assign scoped tasks, build complete vertical behavior and run developer checks.

[M0038 §0.4] 3. Integrate: merge into one candidate, resolve conflicts, run relevant integration/smoke checks and freeze the candidate.

[M0039 §0.4] 4. Review: invoke all three independent reviewers against that candidate. For visible changes, review rendered screens in Arabic and English as well as code.

[M0040 §0.4] 5. Record findings: assign stable IDs, severity, affected requirement, reproduction, expected/actual behavior, evidence, owner and disposition.

[M0041 §0.4] 6. Repair: route each valid finding to an implementer. Keep the stage in FIXING.

[M0042 §0.4] 7. Reverify: the originating reviewer or another qualified non-author independently verifies the fix; QA runs affected tests and relevant regression checks. Refresh all three reviewers’ verdicts for the final candidate.

[M0043 §0.4] 8. Audit and approve: release-auditor checks the evidence and conditions below, then records APPROVED or BLOCKED. The orchestrator reports the result and starts the next stage only after APPROVED.

[M0044 §0.4] Gate states are PLANNED → BUILDING → REVIEWING → FIXING → VERIFYING → APPROVED; a failure or external dependency can set BLOCKED. A stage with no findings may go from REVIEWING to VERIFYING. No time limit, majority vote, high average score or implementer’s confidence can turn FAIL/BLOCKED into approval.

[M0045 §0.4] A development gate passes only when:

[M0046 §0.4] • Every requirement assigned to that stage is implemented or, for specification stages, concretely specified and verified as required by its acceptance criteria.

[M0047 §0.4] • All three independent reviewer verdicts are PASS on the same final candidate and the release-auditor records PASS.

[M0048 §0.4] • Required checks actually ran and passed; missing tools, absent credentials or unexecuted tests are explicitly BLOCKED, never “assumed passed.”

[M0049 §0.4] • There are zero unresolved Critical or High defects and zero findings of any severity that violate a mandatory requirement, data integrity, calculation accuracy, access control or deployment portability.

[M0050 §0.4] • Any remaining optional cosmetic observation is explicitly agreed by the relevant reviewer and auditor, with rationale and an owner. It cannot conceal required scope or a failed acceptance criterion.

[M0051 §0.4] • Findings, fixes, verification and requirements coverage are linked to preserved evidence.

[M0052 §0.4] Use Critical for exploitable severe security/data loss or fundamentally invalid financial results; High for broken required workflows or major integrity failures; Medium for material limited-scope defects; Low for optional polish. Severity labels cannot override the mandatory-requirement rule.

[M0053 §0.4] If reviewers disagree, reproduce the disputed behavior and obtain a targeted fresh independent review. A majority cannot overrule an unresolved demonstrated defect. After repeated unsuccessful repair cycles, perform root-cause analysis and revise the approach; after three unproductive cycles, record a blocker and a concrete recovery plan rather than looping indefinitely or lowering the gate. Continue only permissible current-stage work until the blocker is resolved.

## [M0054 §0.5] 0.5 Evidence and mechanical enforcement

[M0055 §0.5] Maintain these repository artifacts, using machine-readable JSON/CSV/YAML where appropriate:

[M0056 §0.5] • CLAUDE.md: concise project rules, source locations, approved decisions, stage protocol and links to detail.

[M0057 §0.5] • .claude/agents/*.md: the ten agent definitions, with precise scopes and handback contracts.

[M0058 §0.5] • docs/delivery/requirements.csv: source-to-feature-to-test coverage, stage ownership and status.

[M0059 §0.5] • docs/delivery/stages.json: stage state, dependencies, candidate identity and gate evidence references.

[M0060 §0.5] • docs/delivery/decisions.md: architecture/business assumptions and approved engineering decisions.

[M0061 §0.5] • docs/delivery/findings.json: all findings and their repair/verification history.

[M0062 §0.5] • docs/delivery/reviews/DGx/: individual review records and supporting references.

[M0063 §0.5] • docs/delivery/gates/DGx.json: audited gate decision.

[M0064 §0.5] • docs/delivery/progress.md: current checkpoint, next action and unresolved blockers.

[M0065 §0.5] • docs/delivery/test-evidence/: commands, results, screenshots, logs and environment details with secrets removed.

[M0066 §0.5] Define the candidate ID as a deterministic content hash of a manifest covering the stage’s deliverable sources, tests, fixtures, dependencies and relevant configuration; also record the source commit as a traceability pointer. A commit hash alone is not the approval identity because evidence-only commits must not invalidate the reviewed payload. Review metadata, generated logs and gate files must be excluded from that manifest so writing a review does not invalidate itself. Include specification documents when they are the stage deliverable. A change to candidate inputs before its gate closes invalidates applicable sign-offs and requires renewed verification. Later planned stage changes create a new candidate and preserve earlier approvals as historical evidence; rerun affected regression checks. If a change breaks an earlier approved contract or requirement, explicitly reopen the affected scope and obtain new independent sign-offs rather than erasing history.

[M0067 §0.5] Create a gate-validation script and CI job that check schema validity, required reviewer identities and independence declarations, candidate matching, evidence-file existence, completed requirement IDs, test outcomes and unresolved blocking findings. The script must exit nonzero on a failed gate and prevent the automated delivery pipeline from advancing. Keep the gate rules under review; an implementer may not weaken them to pass. Before launching implementation in P1–P7, run the validator against the preceding approved gate. On resumption, reconcile recorded gate state with the reviewed payload and actual repository changes before assigning write tasks.

[M0068 §0.5] The validator checks recorded evidence consistency; it cannot prove by itself that an agent invocation happened or that conclusions are true. Preserve actual invocation outputs and let the independent auditor verify them. Missing provenance is not a reason to fabricate it.

[M0069 §0.5] Each review record must include stage_id, candidate_id, reviewer_role, invocation_reference, implementation_author, requirements_checked, checks_run, findings, verdict, evidence_paths and reviewed_at. Each check records its command/procedure, environment, expected result, actual result and exit status where applicable. Each finding records its ID, requirement, severity, reproduction, owner, fix revision and independent verification. Do not write a blanket PASS without inspectable evidence.

## [M0070 §0.6] 0.6 Autonomy continuity and user reporting

[M0071 §0.6] Technical stage approvals are delegated to the review process above. Do not stop after every successful stage to ask the user “continue?” Continue automatically through DG0–DG7 within the existing authorization. Real company business approvals, production access, release authorization and irreversible actions follow the user’s/company’s actual authority; agent gate approval cannot grant them.

[M0072 §0.6] At each gate send a short update: stage and candidate; capabilities demonstrated; reviewers and verdicts; findings fixed; remaining blockers; and next stage. Do not expose raw internal reasoning or inflate confidence. Report measurable evidence.

[M0073 §0.6] If the session or budget ends, save the latest candidate, stage state, unfinished agent tasks, findings and exact next steps. On resumption, reconcile the repository and durable records, check whether earlier reviews still match the current candidate, and recreate unavailable agent sessions as needed. Never treat a remembered verbal approval as sufficient. Product data and delivery evidence must not depend on transient agent memory.

[M0074 §0.6] Neither the number of agents nor their agreement guarantees correctness. The quality mechanism is independent inspection, executed tests, traceability, repair and reproducible evidence. Preserve this distinction in status and final delivery.

## [M0075 §1] 1 Role and deliverable

[M0076 §1] Build a complete, working, enterprise Business Transformation management platform for Mobily. Act as a senior product architect, transformation operating model designer, UX designer and full-stack engineer. Deliver executable software, its complete source code, a persistent database, documentation and a tested self-hosting package.

[M0077 §1] Working product name: Mobily Transformation Hub. Make the name configurable.

[M0078 §1] The attached Business_Transformation_Playbook(2).docx is the authoritative methodology source. Convert its entire operating system into connected, editable, executable workflows: input → procedure → validation → approval where required → output → performance and benefits monitoring → correction → sustainment.

[M0079 §1] Users must be able to perform the complete transformation management lifecycle inside the application. Reading the methodology, capturing data, conducting workshops, updating KPIs, managing initiatives, reviewing evidence, making decisions, obtaining approvals, generating reports and maintaining BAU performance must all have native application workflows. Exports and integrations are optional channels; routine work must not depend on manually maintaining spreadsheets, presentation decks or external approval emails.

[M0080 §1] The application coordinates business change; it must not imply that a customer system, network upgrade, procurement transaction or other external operational change has happened merely because a task was marked complete. Capture verified evidence or receive a confirmed integration result.

[M0081 §1] The final delivery must include a clean source repository and a complete deployment package that Mobily IT can take over and host on its own infrastructure without depending on the original AI builder, a personal account or a mandatory external SaaS backend.

## [M0082 §2] 2 Source fidelity and completion rules

[M0083 §2] Read the entire source, including tables, numbered templates, unnumbered deliverables, examples, checklists and references. Preserve the two usage modes, six phases, six gates, sixteen numbered templates, ten TOM dimensions, governance cadence, benefits lifecycle, 90-day launch plan, roaming example and 25-question health check.

[M0084 §2] Create a requirements traceability register before implementation. For every source item record its source heading/template, requirement ID, input fields, procedure, output, owner, permissions, automation, screen/API, and acceptance test. Classify each requirement as:

[M0085 §2] • Source requirement — grounded in the attached playbook.

[M0086 §2] • User requirement — full in-platform operation, easy configuration, Mobily identity and transferable self-hosting.

[M0087 §2] • Engineering extension — added to make the platform reliable, usable or deployable.

[M0088 §2] Publish this register in the administrator area and include it in the handover. Link source text to its operational forms. Implement each item, rather than merely adding it to a backlog. Clearly identify any incomplete or externally blocked item with the exact missing dependency. Do not label planned features as delivered.

[M0089 §2] The source describes a practical synthesis inspired by PMI, Brightline and benefits realization concepts. Its six-phase model, ten-dimension TOM, gates and templates include custom content. Preserve this distinction; do not claim that the application or entire methodology is an official PMI standard or certified product.

[M0090 §2] All required controls must work against persisted server-side data. Demonstration data must be explicitly marked and isolated from production. A navigation shell, static dashboard, clickable mockup or browser-local data store does not meet completion criteria.

## [M0091 §3] 3 Business model and navigation

[M0092 §3] Support multiple transformations, business units, portfolios, workstreams, initiatives and ongoing business performance areas. Transformations may be time-bounded; performance areas and BAU ownership can continue indefinitely. Initiative delivery, business adoption, validated value and transformation closure must have separate statuses.

[M0093 §3] Support these source modes:

[M0094 §3] 1. End-to-End: guided progression through Diagnose, Define, Design, Mobilize, Transform and Realize. Let teams prepare drafts at any time, but enforce required gate approvals before authorized execution or scaling.

[M0095 §3] 2. Modular: enter an existing transformation at a selected phase or create a standalone TOM, business case or benefits register. Capture inherited evidence, baseline and approvals, complete minimum mandatory fields, and reconnect the module to outcomes and benefits. Flag missing links; never silently fabricate approvals or bypass controls.

[M0096 §3] Use shared canonical records to maintain this traceability:

[M0097 §3] Diagnosed issue → target-state gap → initiative → deliverable → capability change → KPI movement → benefit.

[M0098 §3] Support many-to-many relationships with explicit contribution and allocation rules. Every node is clickable, and each change can show downstream impact. Add a traceability view and an orphan report for missing links.

[M0099 §3] Primary navigation:

[M0100 §3] • My Work: assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines.

[M0101 §3] • Executive Overview: outcomes, value, critical initiatives, adoption, blockers and decisions.

[M0102 §3] • Transformations: portfolio and individual transformation workspaces.

[M0103 §3] • Playbook and Procedures: searchable source, guidance and executable procedures.

[M0104 §3] • Strategy and KPIs: outcome trees, definitions, targets, actuals and performance reviews.

[M0105 §3] • Target Operating Model: canvas, gaps, capabilities, processes and design decisions.

[M0106 §3] • Initiatives and Roadmaps: cases, prioritization, waves, resources, milestones and dependencies.

[M0107 §3] • Governance: forums, meetings, decision rights, RACI, approvals and stage gates.

[M0108 §3] • Risks and Actions: integrated RAID, corrective actions and escalations.

[M0109 §3] • Benefits and Finance: formulas, realization, validation and forecasts.

[M0110 §3] • Change and Adoption: stakeholders, interventions and adoption indicators.

[M0111 §3] • Evidence and Reports: native deliverables, attachments, snapshots and generated packs.

[M0112 §3] • BAU and Improvement: handovers, controls, lessons and improvement backlog.

[M0113 §3] • Administration: methodology, forms, workflows, automation, organization, access and branding.

[M0114 §3] Within a transformation, show its phase, gate readiness, North Star, owners, outcome health, benefits, key decisions and next required actions. Provide contextual navigation into its related records without re-entering the transformation ID.

## [M0115 §4] 4 Phase workflows and stage gates

[M0116 §4] Each phase needs guided inputs, procedural steps, required evidence, named owners, completion rules, outputs and a review queue. Gates are explicit approval records tied to a versioned evidence snapshot; they must not be inferred solely from task completion.

[M0117 §4] |Phase and gate                 |Inputs and native procedure                                                                                                                                                                                                                                                   |Required outputs and decision evidence                                                                                                                                                                        |

[M0118 §4] |1 Diagnose — G1 Case for Change|Register scope and sponsor; assess business/financial performance, customer experience, processes/operations, organization/governance, technology/data and capabilities; collect baseline evidence; distinguish symptoms from root causes; identify value pools and confidence|Current-state diagnostic, trusted baseline, root causes, quantified or explicitly unquantified value pools, case for change and initial charter. Decision: agree on the problem/opportunity and value at stake|

[M0119 §4] |2 Define — G2 Direction        |Refine the North Star; build the outcome hierarchy; define 3–5 business outcomes, owners, KPIs, targets, target dates, leading indicators and strategic guardrails                                                                                                            |North Star, outcome/KPI tree, KPI dictionary, target trajectory and guardrails. Decision: outcomes are specific enough to steer choices                                                                       |

[M0120 §4] |3 Design — G3 Target State     |Facilitate the ten-dimension TOM; compare current and target states; map future journeys and capabilities; resolve design options and ownership                                                                                                                               |TOM canvas, gap matrix, capability gaps, future journeys/processes and design decisions. Decision: the required operating changes are clear                                                                   |

[M0121 §4] |4 Mobilize — G4 Mobilization   |Convert gaps into initiatives; prepare cases and benefit logic; score and prioritize; sequence waves and dependencies; confirm owners, funding and capacity                                                                                                                   |Initiative cards, business cases, prioritization, roadmap, benefit plan and executable resource commitments. Decision: portfolio is executable and value-backed                                               |

[M0122 §4] |5 Transform — G5 Scale         |Operate workstreams and forums; deliver pilots; track milestones, outcomes and adoption; manage RAID, dependencies, decisions and corrective actions                                                                                                                          |Performance/pilot evidence, adoption results, resolved material risks or approved dispositions and decision log. Decision: results justify the proposed scope of scale                                        |

[M0123 §4] |6 Realize — G6 Sustain         |Measure and validate benefits; correct gaps; transfer ownership and controls; establish sustained monitoring and improvement                                                                                                                                                  |Benefit evidence, accepted BAU handover, ownership, controls and continuous-improvement backlog. Decision: value is embedded in BAU                                                                           |

[M0124 §4] Gate submissions must show: criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision and rationale. Support Draft, Submitted, Under Review, Changes Requested, Approved, Rejected and Deferred. Conditional approval is a configurable extension that records permitted scope, conditions, owners and deadlines; it cannot authorize unrestricted scaling.

[M0125 §4] Missing mandatory evidence blocks submission unless a specifically authorized exception is recorded. Waivers require reason, scope, approver, expiry and compensating action. Material changes to approved scope, baseline, target, TOM, cost or benefit logic trigger an impact assessment and the appropriate reapproval. Preserve the original approval and evidence snapshot.

## [M0126 §5] 5 Complete native forms and templates

[M0127 §5] Implement every numbered template as a native structured form/register. Preserve all source columns below; extensions may add fields without deleting their meaning. Include inline help, validation, draft saving, version history, comments, attachments, permissions, bulk editing where suitable and export.

[M0128 §5] |ID |Source template                   |Minimum fields or content                                                                                                                                                                                                              |

[M0129 §5] |T01|Current-State Diagnostic          |Dimension, current state, evidence/baseline, root cause, impact, confidence H/M/L. Seed Financial, Customer, Process, People/Org, Technology and Data                                                                                  |

[M0130 §5] |T02|Outcome and KPI Tree              |Outcome, KPI, baseline, target, target date, owner, leading indicator; hierarchical links from North Star to outcomes, KPIs, targets and initiative contributions                                                                      |

[M0131 §5] |T03|TOM Gap Matrix                    |TOM dimension, current state, target state, gap, design decision, owner                                                                                                                                                                |

[M0132 §5] |T04|Design Decision Log               |ID, decision required, options, recommendation, decision owner, due date, status                                                                                                                                                       |

[M0133 §5] |T05|Initiative Card                   |Initiative name, executive owner, workstream lead, problem/gap addressed, objective, scope in/out, key deliverables, outcome/KPI contribution, financial benefit, customer benefit, dependencies, risks, milestones, required decisions|

[M0134 §5] |T06|Prioritization Scorecard          |Initiative; 1–5 scores for strategic fit, financial value, customer impact, feasibility and time-to-value; weights and weighted result                                                                                                 |

[M0135 §5] |T07|Wave Roadmap                      |Wave, purpose, typical horizon, entry criteria, exit evidence; linked initiatives, dates and milestones                                                                                                                                |

[M0136 §5] |T08|Dependency Map                    |Dependency, from, to, type, needed-by date, owner, status/mitigation. Support Decision, Tech, Data, Vendor and configurable types                                                                                                      |

[M0137 §5] |T09|Benefit Formula                   |Benefit, baseline driver, change assumption, formula, ramp, confidence H/M/L                                                                                                                                                           |

[M0138 §5] |T10|Executive Transformation Dashboard|Outcomes; value; portfolio; dependencies; decisions; people/adoption, with the source-specific RAG logic described below                                                                                                               |

[M0139 §5] |T11|Decision Rights Matrix            |Decision, Recommend, Approve, Consult, Inform, SLA                                                                                                                                                                                     |

[M0140 §5] |T12|RACI                              |Deliverable, Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance, Tech/Data; assignments using R/A/C/I including allowed A/R combinations                                                                           |

[M0141 §5] |T13|Stakeholder and Adoption Plan     |Stakeholder/group, impact H/M/L, current stance Support/Neutral/Resist, required behavior, intervention, owner, adoption KPI                                                                                                           |

[M0142 §5] |T14|Benefits Register                 |ID, benefit, type, baseline, target, value SAR, realized, owner, evidence, status                                                                                                                                                      |

[M0143 §5] |T15|RAID                              |ID, type Risk/Assumption/Issue/Dependency, description, impact, probability where applicable, owner, due date, mitigation/action, status                                                                                               |

[M0144 §5] |T16|Executive Decision Log            |ID, decision, why now, options, recommendation, owner, decision date, impact if delayed, outcome                                                                                                                                       |

[M0145 §5] Implement these additional source deliverables as first-class native records:

[M0146 §5] Transformation Charter. Transformation name, executive sponsor, transformation lead, case for change, North Star, scope in/out, baseline date, target horizon, top 3–5 outcomes, strategic guardrails, governance forum, decision rights and success definition. Include the transformation thesis: “If we change [capabilities/journeys/operating model], then [customer/operational outcomes] will improve, creating [financial/strategic benefits], because [evidence/causal logic].” Include the five scope sanity checks from the source: outcome linkage, diagnosed problem/opportunity linkage, explicit exclusions, measurable baseline and visible executive decisions.

[M0147 §5] Target Operating Model Canvas. Preserve all ten dimensions: Customer and Value Proposition; Products and Services; Journeys and Processes; Organization; Governance and Decision Rights; People and Capabilities; Technology; Data and Analytics; Partners and Sourcing; Performance Management. Provide current/target design, linked gaps, owner, evidence, dependencies and decisions for each. Include a facilitated 90–120-minute workshop mode with agenda, contributions and unresolved-item conversion into decisions/actions. Provide editable capability heatmaps and journey/process maps with steps, actors, handoffs, systems, controls and pain points. Do not confuse a list of projects with the target operating model.

[M0148 §5] Transformation Business Case. Strategic rationale, baseline, value pools, interventions, investment, benefits, timing, risks/sensitivities, ownership and decision ask. Investment covers capex, opex, internal FTE, vendor cost and opportunity cost with classifications that prevent duplicate treatment. Benefits cover revenue, cost reduction, cost avoidance, working capital and strategic/non-financial outcomes. Support the transformation case and lighter initiative cases, linked rather than copied.

[M0149 §5] Native operating records added for execution. Structured evidence, baseline registry, value-pool register, resource/capacity plan, funding approvals, process/procedure definitions, change requests, meeting records, corrective plans, lessons learned, BAU handover and controls. Mark these as extensions where the source does not supply a full template.

[M0150 §5] Design decisions and executive decisions should use a shared decision model with appropriate views. Likewise, the dependency map and RAID dependency entries should refer to the same canonical dependency record. Avoid duplicate registers that drift.

## [M0151 §6] 6 Procedures and configurable methodology

[M0152 §6] The playbook must be both readable and executable. A procedure definition must contain purpose, trigger, scope, prerequisites, inputs and input schema, ordered/conditional/parallel steps, responsible roles, SLA, validation rules, approval path, escalation path, expected outputs, completion conditions, exceptions and version/effective date.

[M0153 §6] Each launched procedure creates a persistent procedure instance showing current step, assignee, due date, missing inputs, completed evidence and next action. Its outputs must be real linked records or generated deliverables. Include configurable procedures for new transformation intake, baseline validation, KPI submission, TOM approval, initiative prioritization, gate review, scope/target change, benefit validation, executive escalation and BAU handover.

[M0154 §6] Provide an administrator Playbook Studio that can edit methodology text, phases, gates, mandatory artifacts, checklists, templates, fields, labels, help text, validation, formulas, routing, approvers, reminders, escalation rules, dashboards and reporting layouts through the UI. Include field types for text, rich text, number, currency, percentage, date, reference, attachment, lookup, choice and calculated value. Protect stable system identifiers and core data invariants.

[M0155 §6] Publishing a configuration follows Draft → Preview/Test → Review where configured → Publish. Show a side-by-side diff, affected records and compatibility checks. Keep published versions immutable. Existing transformations remain pinned to their methodology and form versions until a deliberate migration is approved. Migration must explain default mappings, new required fields, invalidated calculations and necessary reapprovals. Do not silently rewrite historical records. Rollback means restoring a prior configuration version through an audited change; it does not erase subsequent business transactions.

[M0156 §6] Administrator-editable configuration is distinct from ordinary operational editing. Owners update their assigned data; methodology admins publish shared rules; only authorized business approvers approve policy or financial changes. Display the appropriate capabilities per role.

## [M0157 §7] 7 KPI engine and change propagation

[M0158 §7] Provide a KPI dictionary with name, description, business purpose, owner, steward, unit, frequency, polarity, numerator/denominator, calculation, baseline and baseline date, target and target date, phased trajectory, source, aggregation rule, data-quality rule, reporting period, approval policy and leading/lagging classification.

[M0159 §7] Support higher-is-better, lower-is-better, acceptable-band and binary milestone measures. Store actuals by KPI, scope and reporting period. Distinguish period from cumulative values and percentage changes from percentage-point changes. Use explicit handling for missing values, zero denominators, negative baselines and incomparable periods. Missing or stale data must show Unknown/Stale, not green or zero.

[M0160 §7] RAG must use the approved expected trajectory and configurable thresholds. Always show actual, expected-to-date, final target, variance, trend, data freshness and rule explanation. Never derive outcome RAG from project task completion. A manual RAG override requires an authorized user, reason, evidence, expiry and audit entry while preserving the calculated status.

[M0161 §7] Define aggregations explicitly: sum eligible flows, last value for stocks, weighted ratios where appropriate, or an approved custom formula. Do not average percentages or mix units by default. Preserve currency and period. Formula dependencies must reject circular references and invalid units.

[M0162 §7] KPI submissions follow configurable draft/review/accept or direct-accept routes. An accepted actual triggers server-side validation, recalculation of dependent metrics and benefits, dashboard refresh, deviation evaluation and an audit event. If Finance validation is required, new benefit values remain pending rather than automatically becoming validated realized value.

[M0163 §7] Changing a KPI definition, baseline or target creates a versioned change request with reason and impact preview. Show affected outcomes, benefits, gates, reports and formulas. Approved changes take effect prospectively by default. A retrospective restatement requires explicit period selection, authority and a retained reconciliation. Previously issued reports remain unchanged and can be reissued as a new version.

[M0164 §7] Design the routine update interaction to be quick: open KPI → select period → enter/import actual and evidence → submit. Let users see which downstream views changed and whether any review is pending.

## [M0165 §8] 8 Benefits and financial validation

[M0166 §8] Implement the source benefits lifecycle: Identify → Plan → Enable → Measure → Correct → Sustain. Track planned, forecast, measured, submitted-for-validation, validated, rejected and sustained values separately. A delivered capability is an enabler, not proof of realized value.

[M0167 §8] Each benefit needs a unique ID, type, accountable business owner, Finance validator where applicable, baseline/counterfactual, formula, driver units, target, timing, one-off/recurring classification, currency, measurement source, evidence, confidence, assumptions, contribution links and financial-statement mapping or agreed non-financial KPI.

[M0168 §8] Provide a safe formula builder using a restricted expression language and typed variables. Never evaluate arbitrary user-supplied code. Preview examples, units and edge cases before publication. Version formulas and preserve the calculation lineage: input actuals, source versions, assumptions, rates, period and formula version.

[M0169 §8] Seed the two source examples as illustrative calculations:

[M0170 §8] • Revenue uplift = change in attach rate × eligible customers × ARPU for the stated period. Store attach rate as a fraction; a rise from 10% to 12% is 0.02, or 2 percentage points. ARPU, customer population and ramp periods must align.

[M0171 §8] • Cost reduction = eligible volume × reduction in unit cost for the same period, with a validated comparison basis.

[M0172 §8] Keep revenue uplift separate from profit or margin benefit. Keep avoided cost separate from cash savings. Do not monetize CX or other non-financial benefits without an approved valuation method. Show gross benefits, implementation cost and net value separately; do not automatically subtract the same cost at both initiative and transformation level.

[M0173 §8] Prevent double counting using a canonical benefit register, parent/child relationships, shared-benefit groups and contribution allocations. Portfolio aggregation counts a shared benefit once. Allocation totals must not exceed 100%; less than 100% must show an unallocated share. Warn about overlapping populations, periods and drivers, but require Finance to resolve economic overlaps that rules cannot determine.

[M0174 §8] Finance validation must include baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions. Measure-only submissions do not increase the validated total until approved. Corrections create amendments/reversals linked to the original record. Support base/upside/downside scenarios without mixing scenarios into reported actuals. Any optional NPV, ROI or payback metric requires explicitly defined methodology, timing and discount-rate assumptions; it is an extension, not a prescribed source requirement.

## [M0175 §9] 9 Portfolio prioritization and execution

[M0176 §9] Seed the source scorecard weights: strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%. Use a 1–5 scale; weighted score = sum(score × weight), producing a 1–5 result. If showing a 0–100 view, label and document the conversion. Weights must total 100%. Missing scores mean incomplete, not zero. Make scoring rubrics and approved weights configurable and versioned. Allow risk/compliance criteria to replace part of the weighting as the source permits.

[M0177 §9] Separate proposed rankings, approved portfolio selection and funding approval. Provide value/feasibility comparison, filters, ranked tables, dependency-aware sequencing and capacity conflict indicators. Explain ranking changes and overrides.

[M0178 §9] Seed these source roadmap waves as overlapping planning horizons, not rigid deadlines:

[M0179 §9] |Wave           |Purpose                               |Typical horizon|Entry                  |Exit evidence                               |

[M0180 §9] |Wave 0 Mobilize|Baseline, governance, design decisions|0–6 weeks      |Sponsor and charter    |Approved case, owners, gates                |

[M0181 §9] |Wave 1 Prove   |Quick wins, pilots, de-risking        |1–3 months     |Prioritized initiatives|Measured pilot results                      |

[M0182 §9] |Wave 2 Scale   |Scale validated changes               |3–9 months     |Evidence and capacity  |Adoption and KPI movement                   |

[M0183 §9] |Wave 3 Embed   |BAU integration and optimization      |6–18 months    |Stable solution        |Sustained benefits and transferred ownership|

[M0184 §9] Provide a roadmap timeline, initiative table and work board using the same data. Track approved vs forecast milestone dates, deliverable acceptance, budget/actual/forecast, role-based capacity, FTE demand, dependencies and decisions. Detect dependency cycles and schedule conflicts. Critical-path claims must come from defined scheduling logic, not cosmetic highlighting. Record material rebaselines through change control.

[M0185 §9] Owners submit concise structured updates covering achievements, next steps, milestones, outcomes, adoption, risks, dependencies and asks. Generate executive views directly from these updates and canonical metrics. Do not require owners to recreate the same update in a slide deck.

## [M0186 §10] 10 Governance and decisions

[M0187 §10] Implement role and record-level access for the source roles: Executive Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance/Value Office and Transformation Office. Add KPI/Data Steward, Tech/Data contributor, committee member/secretary, read-only auditor and system administrator as implementation roles.

[M0188 §10] Access is scoped by organization, business unit, transformation and sensitive record where needed. Job title alone must not grant access across all transformations. Technical administrators do not automatically become business approvers. Enforce permissions on the server for records, files, APIs, exports, search and AI retrieval.

[M0189 §10] Seed the source governance cadence:

[M0190 §10] |Forum                |Cadence                    |Required purpose and output                                                                |

[M0191 §10] |Executive SteerCo    |Monthly                    |Outcomes, major trade-offs, funding and escalations; decisions, unblockers and benefit view|

[M0192 §10] |Transformation Review|Every two weeks            |Portfolio health, dependencies, risks and decisions; integrated status and decision log    |

[M0193 §10] |Workstream Review    |Weekly                     |Delivery, issues and actions; milestones, actions and RAID                                 |

[M0194 §10] |Rapid Response/Sprint|Daily or 2–3 times per week|High-priority cross-functional issue; test, evidence and recommendation                    |

[M0195 §10] |Value Review         |Monthly                    |Realized benefits vs plan; Finance validation, forecast and corrective action              |

[M0196 §10] Make recurrence, participants, cut-off dates and agenda rules configurable. Use Asia/Riyadh for the default business calendar, with configurable workweek, holidays and working-day SLAs. Do not hardcode public holidays or use elapsed calendar days when working days are specified.

[M0197 §10] Seed T11 decision rights:

[M0198 §10] |Decision             |Recommend                      |Approve       |Consult                    |Inform               |SLA                         |

[M0199 §10] |Business scope change|Transformation Lead            |Sponsor       |Business Owners and Finance|Workstreams          |5 working days              |

[M0200 §10] |Funding reallocation |Transformation Lead and Finance|SteerCo       |Initiative Owners          |PMO                  |Next SteerCo or urgent route|

[M0201 §10] |Target-state design  |Design Owner                   |Business Owner|Tech, Ops, CX and Finance  |Transformation Office|10 working days             |

[M0202 §10] |Go-live/scale        |Initiative Owner               |Business Owner|Risk, Tech and CX          |SteerCo              |Per release plan            |

[M0203 §10] Preserve the source RACI as a configurable starting point:

[M0204 §10] |Deliverable        |Sponsor|Transformation Lead|Business Owner|Workstream Lead|Finance|Tech/Data|

[M0205 §10] |Charter            |A      |R                  |C             |I              |C      |I        |

[M0206 §10] |TOM                |C      |R                  |A             |C              |C      |C        |

[M0207 §10] |Business Case      |A      |R                  |C             |C              |R      |C        |

[M0208 §10] |Initiative Delivery|I      |C                  |A             |R              |C      |C        |

[M0209 §10] |Benefits Validation|I      |C                  |A             |C              |R      |I        |

[M0210 §10] |BAU Handover       |I      |C                  |A/R           |R              |C      |C        |

[M0211 §10] Map roles to named people or governed groups. Require one accountable assignment per deliverable unless a documented governance rule permits otherwise. Finance validates benefits even where the Business Owner remains accountable. Support authorized delegation with effective dates, absence handling and preserved audit identity; delegation must not create approval loops.

[M0212 §10] Provide an in-app committee workflow: draft agenda → gather linked decision briefs → review materials → record attendance/quorum where configured → record decisions → approve/publish minutes → assign actions → monitor closure. Executive asks require decision, why now, options, recommendation, delay impact, decision owner and required date. Read-only presentation mode and printable packs must use the same underlying records.

[M0213 §10] Approvals need assignee, request version, due date, rationale, comments and decision timestamp. Support sequential or parallel approval rules and separation of duties. A requester cannot approve their own request when the configured policy prohibits it. Reject stale approvals if the submitted record version changed. Distinguish approval, rejection, request changes and deferral. A timer may escalate an overdue approval; it must never approve it automatically.

## [M0214 §11] 11 People adoption and sustained performance

[M0215 §11] Implement stakeholder groups, influence/impact, stance, required behavior, intervention plans, champions, communication/training actions and evidence of proficiency. Provide short native feedback/assessment forms so observations can be collected and reviewed in the platform.

[M0216 §11] Seed all source adoption indicators: usage/activation; new-process compliance; cycle-time shift; training completion plus observed proficiency; decision turnaround; percentage of transactions using the new journey; exception/workaround rate. Distinguish training attendance from successful adoption. Track actuals against adoption trajectories and create corrective interventions when gaps appear.

[M0217 §11] Support continuous performance management after project delivery and after transformation closure. BAU handover must include accepted business owner and KPI owner, operating procedures, controls, evidence, capability readiness, unresolved accepted risks, benefit monitoring cadence, data access and improvement backlog. Capture receiving-owner acceptance.

[M0218 §11] A transformation cannot be marked successful solely because initiatives are complete. Show delivery complete, value validation pending, and BAU accepted as separate states. For benefits with a longer realization period, allow a documented transition decision with residual benefit ownership and scheduled monitoring; do not label forecast future value as already sustained.

[M0219 §11] Create periodic control checks, review tasks, lessons and continuous-improvement items. Reopening a deteriorating performance area must preserve earlier closure and handover history.

## [M0220 §12] 12 Automation engine

[M0221 §12] Implement server-side event and schedule-driven automation with trigger, conditions, actions, scope, owner, effective version and execution history. Administrators need a readable rule builder, dry-run preview, enable/disable, retry and failure queue. Actions must respect the initiating/system service identity and the applicable permissions.

[M0222 §12] Required starter automations:

[M0223 §12] |Trigger                                     |Required action                                                                                         |

[M0224 §12] |New transformation created                  |Instantiate selected methodology, forms, phase checklist, role-assignment tasks and optional 90-day plan|

[M0225 §12] |Reporting period opens or update is due     |Create owner tasks and in-app reminders with direct links                                               |

[M0226 §12] |Accepted KPI actual changes                 |Recalculate dependent values and RAG; refresh live views; flag benefit validation where needed          |

[M0227 §12] |KPI deviates from trajectory                |Create or update a corrective-action case using the configured severity and persistence rule            |

[M0228 §12] |Mandatory gate evidence is missing          |Display missing requirements and block unauthorized submission                                          |

[M0229 §12] |Valid gate submission                       |Route the exact evidence snapshot to the required approvers                                             |

[M0230 §12] |Gate is approved                            |Enable the authorized next phase/scope and create its tasks                                             |

[M0231 §12] |Decision SLA expires                        |Escalate to the next configured authority and show delay impact                                         |

[M0232 §12] |Critical dependency slips                   |Notify affected owners and recompute forecast impacts using defined scheduling logic                    |

[M0233 §12] |Blocker remains red across configured cycles|Require a named executive decision, owner and deadline; avoid duplicating an existing open ask          |

[M0234 §12] |Benefit evidence submitted                  |Route to the Finance/value validation queue                                                             |

[M0235 §12] |Meeting cut-off reached                     |Generate a draft agenda and pack from current data with a review step before publication                |

[M0236 §12] |Adoption or control check fails             |Create recovery action and assign owner and follow-up date                                              |

[M0237 §12] |BAU handover accepted                       |Transfer routine ownership and activate recurring performance/control reviews                           |

[M0238 §12] |Methodology or formula revision is proposed |Show impact, run validation and route the change for the configured review                              |

[M0239 §12] |Connector/job fails or data becomes stale   |Create a visible operational exception; retain last known values with freshness labels                  |

[M0240 §12] Use durable background jobs, idempotency keys, bounded retries with backoff, transaction-safe event/outbox handling and an operational failure queue. Prevent duplicate reminders, actions and approvals after retries or restarts. Store scheduled runs and execution outcomes in the database. Expose last success, next run, failures and repair actions to authorized administrators.

[M0241 §12] Notification channels must include an in-app inbox. Optional email or enterprise messaging channels are adapters and require IT configuration; lack of those channels cannot break workflows. Deep links must enforce access. Separate business-day timing, quiet hours, digest preferences and urgent escalation policy.

[M0242 §12] Automatic preparation, routing, calculation and reminders are mandatory. Human business judgment, investment decisions, gate approvals and Finance attestations remain accountable human actions within the platform.

## [M0243 §13] 13 Dashboards reports and evidence

[M0244 §13] Provide executive, transformation, workstream, Finance, adoption and personal work dashboards. Filters include organization, transformation, owner, period, phase and status. Every headline number must drill into its contributing records, period, calculation and evidence; distinguish zero, unknown and not applicable.

[M0245 §13] Implement the six source dashboard areas with their distinct status logic:

[M0246 §13] |Area               |Required presentation                                       |Status basis                                    |

[M0247 §13] |Outcomes           |Baseline, actual, target, trajectory and trend              |Expected outcome trajectory                     |

[M0248 §13] |Value              |Planned, forecast and validated realized benefit; investment|Validated benefit gap                           |

[M0249 §13] |Portfolio          |High-value/critical initiatives and delivery outlook        |Milestone and outcome risk                      |

[M0250 §13] |Dependencies       |Cross-functional blockers and affected scope                |Needed-by date and supported critical-path logic|

[M0251 §13] |Decisions          |Ask, owner, deadline and delay impact                       |Overdue executive decisions are red             |

[M0252 §13] |People and adoption|Usage, behavior and capability indicators                   |Adoption trajectory                             |

[M0253 §13] Generate charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard and handover outputs inside the application. Include native reading/presentation views and actual export functions for relevant PDF, DOCX, XLSX, PPTX and CSV outputs. A report export must contain the selected records, not a generic placeholder. Spreadsheet exports must neutralize formula injection in user text while preserving deliberately authored numeric formulas where applicable.

[M0254 §13] Reporting snapshots must retain as-of time, reporting period, source record revisions, methodology version, calculation versions and approval state. Live reports may refresh; issued snapshots remain immutable. Label provisional/unvalidated values clearly and preserve bilingual layout in exports.

[M0255 §13] Provide a secure evidence repository with record linkage, evidence type, source, owner, observation period, upload date, version, checksum and review status. Support native evidence notes and common documents/images, with file-type/size controls and safe preview/download. A filename or inaccessible external link is not verified evidence. Preserve evidence access after ownership transfer and apply the same authorization to downloads and previews as to the parent record.

## [M0256 §14] 14 Launch plan and health check

[M0257 §14] Seed the source 90-day launch plan relative to an adjustable start date:

[M0258 §14] • Days 0–30 Diagnose and align: confirm sponsor, baseline, stakeholder interviews, journeys/processes, value pools and initial governance. Outputs: charter v0.9, diagnostic, baseline, issue tree and governance.

[M0259 §14] • Days 31–60 Define and design: agree North Star/outcomes, KPI tree, TOM, design decisions, initiatives and sized benefits. Outputs: North Star, KPI tree, TOM, initiative backlog and initial business case.

[M0260 §14] • Days 61–90 Mobilize and prove: prioritize, assign owners, sequence roadmap, launch authorized Wave 1 pilots, and establish benefits register and executive dashboard. Outputs: roadmap, initiative cards, dashboard, benefits register and pilot evidence.

[M0261 §14] Convert this into editable scheduled tasks with owners, dependencies and required outputs. Preserve the Day-90 leadership test: shared case/North Star; initiative-to-gap/outcome traceability; clear decision rights; Finance agreement on baseline/formulas; pilot evidence; and visible executive support needed this month.

[M0262 §14] Implement all 25 source health-check questions with response, evidence, owner, assessment date and action. Seed a simple Yes=1/No=0 scoring method as an explicit implementation assumption because the source provides checkboxes and a total but no partial-credit method. Unanswered items make the assessment incomplete. If partial credit or N/A is introduced later, use a separately versioned scoring scheme and do not silently reuse the original interpretation bands.

[M0263 §14] 1. Is there a quantified case for change?

[M0264 §14] 2. Is the baseline trusted by Finance?

[M0265 §14] 3. Is there one clear North Star?

[M0266 §14] 4. Are 3–5 business outcomes measurable?

[M0267 §14] 5. Are outcomes owned by business leaders?

[M0268 §14] 6. Is the customer perspective explicit?

[M0269 §14] 7. Have root causes been separated from symptoms?

[M0270 §14] 8. Is there a defined Target Operating Model?

[M0271 §14] 9. Are decision rights explicit?

[M0272 §14] 10. Are capability gaps visible?

[M0273 §14] 11. Can every initiative be traced to a TOM gap?

[M0274 §14] 12. Can every initiative be traced to an outcome?

[M0275 §14] 13. Are benefits quantified without double counting?

[M0276 §14] 14. Are dependencies integrated across workstreams?

[M0277 §14] 15. Is sequencing based on value and feasibility?

[M0278 §14] 16. Do executive forums make decisions rather than review slides?

[M0279 §14] 17. Are overdue decisions visible?

[M0280 §14] 18. Are workstreams empowered within clear boundaries?

[M0281 §14] 19. Are adoption metrics tracked?

[M0282 §14] 20. Are frontline/business teams involved in design?

[M0283 §14] 21. Are benefits validated with evidence?

[M0284 §14] 22. Is BAU ownership defined before closure?

[M0285 §14] 23. Is a continuous-improvement backlog retained?

[M0286 §14] 24. Are lessons reused across transformations?

[M0287 §14] 25. Can leadership state what support the transformation needs now?

[M0288 §14] Preserve the source score bands: 21–25 strong discipline with focus on value acceleration/improvement; 16–20 solid foundation with structural gaps to address before scaling; 10–15 material execution risk; 0–9 disconnected-project risk requiring an outcome/operating-model reset. Require the top three improvement actions and track reassessments over time.

## [M0289 §15] 15 Mobily visual identity and user experience

[M0290 §15] Create a polished enterprise workspace with a clear information hierarchy, compact useful data views, generous reading space and restrained animation. Use predominantly white/light surfaces with blue navigation, selected states and a restrained blue-gradient executive header. Use consistent iconography and meaningful charts. Show decisions, outcomes and next actions prominently.

[M0291 §15] Load user-provided official Mobily assets and color values when available. No verified exact previously supplied blue is available in this specification. Use the following provisional design tokens only, not a claim of official brand compliance:

[M0292 §15] |Token         |Initial value|Purpose                                       |

[M0293 §15] |brand.primary |#0078FF      |Primary accents and selected elements         |

[M0294 §15] |brand.deep    |#003B73      |Stronger blue surfaces and text where suitable|

[M0295 §15] |surface.page  |#F5F8FC      |Page background                               |

[M0296 §15] |surface.card  |#FFFFFF      |Content surfaces                              |

[M0297 §15] |text.primary  |#142438      |Main text                                     |

[M0298 §15] |text.secondary|#526174      |Secondary text                                |

[M0299 §15] |border.default|#DCE5EF      |Dividers and field boundaries                 |

[M0300 §15] Validate contrast for every text/background combination. Derive an accessible action-button shade rather than assuming the provisional bright blue works with small white text. Status colors must be separate semantic tokens and always accompanied by labels/icons. Avoid using blue to imply a favorable business status.

[M0301 §15] Provide a Branding Settings screen for logo, approved primary/secondary colors, fonts, name and report header/footer. Changing a token updates all screens and generated output templates. Use supplied licensed fonts or locally bundled open-license Arabic/Latin fonts. Do not depend on public font CDNs. If the official logo is missing, use a clearly provisional text wordmark instead of inventing a logo.

[M0302 §15] Provide full Arabic RTL and English LTR with a persistent language switch. Keep technical identifiers, formulas and numbers readable within Arabic layouts. Default timezone is Asia/Riyadh and currency SAR, both configurable. Store timestamps consistently and distinguish observation period, business date and event timestamp. All key workflows, errors, validation and exports must support both languages.

[M0303 §15] Provide responsive desktop/tablet and mobile-friendly review, approval and KPI-update flows. Include global search with permission filtering, saved views, filter chips, breadcrumbs, bulk updates, inline editing, draft recovery, record comparison and contextual help. Clearly distinguish saved draft from submitted/approved data. Handle empty, loading, error, stale, conflict and no-permission states.

[M0304 §15] Support keyboard navigation, visible focus, labeled controls, screen-reader names, adequate contrast and non-color status cues. Tables need sorting, filtering, pagination and column selection. Explain business calculations in plain language. Keep infrastructure and software implementation details in administrator screens and documentation.

## [M0305 §16] 16 Portable architecture and data model

[M0306 §16] Use a maintainable modular monolith with a separate background worker before considering distributed microservices. Prefer the following portable baseline unless an existing approved repository or documented IT constraint requires an equivalent:

[M0307 §16] • A TypeScript web frontend using React or an equivalent maintainable open-source UI stack.

[M0308 §16] • A TypeScript server/API with explicit modules for identity/access, transformation records, workflows, formulas, reporting and administration.

[M0309 §16] • PostgreSQL for relational records, configuration, reporting snapshots and durable workflow state.

[M0310 §16] • A durable worker/scheduler backed by the database; add a separate queue service only if justified and included in the self-hosted package.

[M0311 §16] • An evidence-storage adapter with a private filesystem option and an optional IT-approved object-store adapter.

[M0312 §16] • Standards-based enterprise identity integration through OIDC, using the corporate identity provider. Where SAML is required, provide a documented compatible broker/adapter. A self-hosted identity provider such as Keycloak can be used for a portable integration test.

[M0313 §16] • Docker container images and Compose configuration for reproducible installation and testing. Provide deployment configuration for the actual IT orchestration target when known; do not present a local Compose demonstration as proof of high-availability production readiness.

[M0314 §16] Verify current official documentation, support windows, licenses and security maintenance before selecting exact dependency versions. Pin compatible versions and lockfiles. Keep mandatory services runnable within company-controlled infrastructure. Third-party licenses remain applicable; include a license inventory and flag any procurement requirement.

[M0315 §16] Use typed relational tables for core entities and validated metadata/JSON structures for extensible custom fields and versioned forms. Avoid a single unvalidated JSON blob as the entire database.

[M0316 §16] Minimum domain entities:

[M0317 §16] • Organization, BusinessUnit, User, Group, Role, Permission, ScopedAssignment and Delegation.

[M0318 §16] • Transformation, PerformanceArea, Charter, MethodologyVersion, Phase, GateDefinition, GateInstance and GateDecision.

[M0319 §16] • DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome and StrategicGuardrail.

[M0320 §16] • KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun and DataQualityFinding.

[M0321 §16] • TOMDimension, TOMCanvas, Capability, Gap, Journey, Process, ProcedureDefinition and ProcedureInstance.

[M0322 §16] • Initiative, Deliverable, Milestone, RoadmapWave, Dependency, ResourceDemand, Capacity and FundingDecision.

[M0323 §16] • BusinessCase, Scenario, Benefit, BenefitAllocation, BenefitFormulaVersion, BenefitMeasurement and FinanceValidation.

[M0324 §16] • Risk, Assumption, Issue, Action, Decision, ChangeRequest and Approval.

[M0325 §16] • Forum, Meeting, AgendaItem, Attendance, Minutes and MeetingActionLink.

[M0326 §16] • StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord and AdoptionMetricLink.

[M0327 §16] • BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment.

[M0328 §16] • FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot and AuditEvent.

[M0329 §16] Use canonical reference links, uniqueness constraints, required ownership and explicit status transitions. Protect finalized records and evidence from destructive deletion. Define retention and archival policies; soft deletion is not a substitute for an approved retention policy. Preserve financial precision with decimal arithmetic. Add optimistic concurrency control so simultaneous edits cannot silently overwrite one another.

[M0330 §16] Expose documented versioned APIs with server-side validation, consistent error handling, pagination and authorization. Generated exports and search indexes must enforce the same scopes as record views. Use a constrained service identity for each connector and background job. Avoid exposing secrets or private evidence URLs in client code or logs.

[M0331 §16] Implement secure sessions, role/scoped authorization, input sanitization, protection against common injection and request attacks, upload restrictions, rate limiting, dependency checks and a secret-management interface. Production secrets are runtime configuration, not repository content. Integrate TLS and database/storage encryption with the hosting environment. Audit actor, action, timestamp, record ID, prior/new version and reason; append-only audit data must be protected from ordinary user modification.

[M0332 §16] Do not claim compliance with an organizational or regulatory standard based solely on these controls. Provide evidence for implemented controls so Mobily IT can assess them against its actual requirements.

## [M0333 §17] 17 Integrations and optional AI assistance

[M0334 §17] Provide a connector framework with configured credentials, field mappings, source IDs, cadence, last success, reconciliation, errors and retry history. Imports must stage and validate data before commitment, detect duplicate source/period records, show row-level errors and preserve source lineage. Support approved CSV/XLSX imports, documented APIs/webhooks and optional adapters for corporate data sources when access is supplied.

[M0335 §17] Build working local test adapters and contract tests. List enterprise endpoints and credentials that IT must supply. Do not claim a live integration exists until it has been authenticated and tested. Core workflows must work with native forms and controlled imports while a connector is unavailable. Downstream operational write actions need explicit permission, idempotency and confirmed results.

[M0336 §17] An optional in-app assistant can explain the playbook, draft charters/decision briefs, summarize authorized records, identify missing evidence and suggest recovery actions. It must cite the source records and versions used, respect the same permissions, and distinguish suggestions from approved facts. It cannot silently submit approvals, certify benefits, invent evidence or change financial values.

[M0337 §17] AI must be disabled by default in a disconnected installation and configurable through an IT-approved provider or internal model endpoint. No external model, telemetry or analytics service may receive company data without explicit administrator configuration and company authorization. All core workflows and calculations must continue to work with AI disabled. Treat uploaded document instructions as untrusted content when using an AI assistant.

## [M0338 §18] 18 Demonstration data and guided walkthrough

[M0339 §18] Create a separate, resettable demonstration environment based on the source’s illustrative International Roaming Transformation. Clearly mark every example and added number as synthetic, not Mobily actual performance.

[M0340 §18] Preserve the source example:

[M0341 §18] • Case for change: low adoption, fragmented propositions, inconsistent digital activation and avoidable customer friction cause value leakage.

[M0342 §18] • North Star: make international roaming effortless, trusted and economically accretive.

[M0343 §18] • Outcomes: revenue growth, attach/activation, partner economics, fewer complaints and digital self-service.

[M0344 §18] • TOM focus: product/pricing, digital journey, partner management, network/service assurance, data/personalization, care and governance.

[M0345 §18] • Initiatives: pass architecture redesign, digital activation, proactive travel triggers, partner-cost optimization, QoS monitoring, care simplification and analytics.

[M0346 §18] • Benefits: incremental roaming revenue, margin improvement, complaint reduction, digital adoption and avoided care cost, with distinct financial classifications.

[M0347 §18] • Traceability examples: low activation → proposition/journey gap → pass redesign and digital activation → attach/activation → revenue; high complaints → journey/service-assurance gap → proactive communication/QoS → complaint rate → CX/care cost; partner cost pressure → partner/analytics gap → optimization → cost per MB/margin → margin benefit.

[M0348 §18] Seed enough coherent records to exercise every phase, gate and numbered template, all ten TOM dimensions, all six dashboard areas, the 25-question assessment, pending approvals, missing evidence, a stale KPI, an overdue decision, a shared benefit, an adoption gap and a BAU handover. Link the examples rather than creating unrelated sample cards. Keep an empty production initialization path that excludes demo records and demo credentials.

[M0349 §18] Include a guided walkthrough: create transformation → diagnose and agree baseline → define outcomes/KPIs → design TOM → prioritize initiatives and approve mobilization → update delivery/adoption → submit KPI actual → validate benefit → resolve executive decision → generate report → accept BAU handover → continue performance monitoring.

## [M0350 §19] 19 IT handover and migration package

[M0351 §19] Deliver a complete source repository plus a portable archive, with clear separation of application code, infrastructure, documentation and demo data. Include:

[M0352 §19] 1. Frontend, backend, worker, shared schemas, calculation engine, report templates, local assets and all build configuration.

[M0353 §19] 2. Dependency manifests, lockfiles, license/SBOM inventory, build scripts, container definitions and a complete service/dependency list.

[M0354 §19] 3. Database schema, migrations, data dictionary, ER diagram, validation rules, indexes and safe production initialization.

[M0355 §19] 4. Versioned API/OpenAPI specification, authentication setup and connector contracts.

[M0356 §19] 5. Workflow, methodology, forms, branding and automation configuration export/import with schema versions.

[M0357 §19] 6. Environment variable template without secrets, identity-provider configuration instructions, storage setup, SMTP/notification settings and optional AI configuration.

[M0358 §19] 7. Reproducible local/clean-VM startup command, health checks and readiness verification. Document any prerequisite image/package preparation for restricted networks.

[M0359 §19] 8. Production deployment guide, domains/TLS, corporate SSO mapping, service accounts, secrets, network boundaries, logging and monitoring setup.

[M0360 §19] 9. Backup/restore procedures covering database, evidence bytes, configuration, audit and reporting snapshots; retention, restore drills and recovery objectives to be agreed with IT.

[M0361 §19] 10. Versioned upgrades, migration dry-runs, maintenance windows and rollback/recovery procedures. Do not assume every schema migration is reversibly down-migratable; explain backup-based recovery when needed.

[M0362 §19] 11. Data migration tools with mapping, validation, reconciliation, attachment manifests and checksum/record-count checks.

[M0363 §19] 12. User/admin guides, role matrix, automation operations guide, test evidence, known limitations, release notes and the source-requirements coverage register.

[M0364 §19] Exportability includes all business records, relationships, audit history, approvals, evidence files, configuration, formulas and report snapshots. A source ZIP or CSV-only export is insufficient by itself. Use a versioned migration manifest that preserves IDs and attachment links. Export portable business users/role mappings without improperly transferring corporate passwords; rebind corporate identity subjects under IT control.

[M0365 §19] Demonstrate transfer into a clean company-like environment with a different base URL and fresh database/storage. Restore the data, verify relational links and evidence access, rebind identity, run key workflows and compare record counts/checksums. Restart all services and verify that records, jobs and approvals persist. Test runtime operation with outbound public internet disabled; explicitly document any enabled enterprise dependency. Supply images or an approved artifact mirror plan where building also needs to occur in a restricted network.

[M0366 §19] Do not make any required runtime service depend on a builder-hosted database, proprietary workflow service, external storage URL, public CDN, original workspace identifier or personal API key. If the build environment imposes such a dependency, isolate it behind an adapter and demonstrate the portable implementation before claiming handover completion.

## [M0367 §20] 20 Acceptance tests and measurable definition of done

[M0368 §20] Deliver executable tests and concise evidence, not just a checklist. At minimum prove:

[M0369 §20] |ID |Acceptance scenario           |Pass condition                                                                                                                                                                                                                                                                                         |

[M0370 §20] |A01|Source coverage               |Six phases, six gates, T01–T16, charter, TOM canvas, business case, launch plan, health check and example mapped to working features                                                                                                                                                                   |

[M0371 §20] |A02|Complete lifecycle            |Authorized users complete the guided end-to-end scenario using only native application workflows                                                                                                                                                                                                       |

[M0372 §20] |A03|Modular entry                 |Existing transformation enters at Design with inherited evidence; missing baseline/outcome links are flagged and cannot silently pass gates                                                                                                                                                            |

[M0373 §20] |A04|KPI propagation               |Submit a period actual; validate and accept it; linked dashboards/RAG/calculations update once; benefit needing Finance review remains pending                                                                                                                                                         |

[M0374 §20] |A05|Calculation correctness       |Automated tests cover higher/lower/band measures, stale/missing values, zero denominator, percentage points, periods and currency/decimal precision                                                                                                                                                    |

[M0375 §20] |A06|Configuration change          |Admin adds a field, changes a form rule and updates a workflow using the UI; a new published version works without application-code changes                                                                                                                                                            |

[M0376 §20] |A07|Historical integrity          |Target/formula changes show impact and reapproval; previous period reports and approved snapshots remain intact                                                                                                                                                                                        |

[M0377 §20] |A08|Gate controls                 |Missing evidence blocks submission; unauthorized approval and stale-version approval are rejected by the API                                                                                                                                                                                           |

[M0378 §20] |A09|Decision escalation           |A working-day SLA expiration produces the correct escalation and linked executive ask without duplicate actions                                                                                                                                                                                        |

[M0379 §20] |A10|Benefit integrity             |A shared benefit rolls up once; 110% allocation is rejected; unvalidated or forecast value cannot appear as validated actual                                                                                                                                                                           |

[M0380 §20] |A11|Adoption and sustainment      |Poor adoption triggers intervention; delivery completion alone does not close value realization; accepted handover creates recurring BAU tasks                                                                                                                                                         |

[M0381 §20] |A12|Permissions                   |Cross-transformation unauthorized reads/writes, exports, search results, evidence URLs and AI retrieval are denied                                                                                                                                                                                     |

[M0382 §20] |A13|Durable automation            |Retried events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable                                                                                                                                                         |

[M0383 §20] |A14|Concurrent editing            |Conflicting updates show a recoverable conflict rather than silently overwriting accepted changes                                                                                                                                                                                                      |

[M0384 §20] |A15|Reporting                     |Executive pack and relevant PDF/DOCX/XLSX/PPTX outputs contain current selected data, correct provenance and readable Arabic/English layout                                                                                                                                                            |

[M0385 §20] |A16|Health and launch             |All 25 questions and four source score bands work; incomplete assessments are labeled; launch tasks are generated from the chosen start date                                                                                                                                                           |

[M0386 §20] |A17|Import and integration        |Invalid rows are isolated, duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error                                                                                                                                                                  |

[M0387 §20] |A18|Independent deployment        |Clean environment starts successfully, restored records/files/configuration work and workflows run without the original builder or mandatory public SaaS                                                                                                                                               |

[M0388 §20] |A19|Backup and recovery           |Restore drill recovers database, evidence, audit, snapshots and job state with documented checks and timings                                                                                                                                                                                           |

[M0389 §20] |A20|UX and branding               |Arabic RTL/English LTR, keyboard flows and mobile review work; changing the primary brand token updates screens and output templates                                                                                                                                                                   |

[M0390 §20] |A21|No-AI operation               |Core lifecycle, approvals, calculations and reports still work with AI and external notification channels disabled                                                                                                                                                                                     |

[M0391 §20] |A22|Operational readiness         |Health checks, logs, error alerts, admin job visibility and production/demo separation are demonstrated                                                                                                                                                                                                |

[M0392 §20] |A23|Real independent stage reviews|Each DG gate includes separate actual domain, code/security and QA review evidence plus an independent release audit; implementers cannot approve their own work                                                                                                                                       |

[M0393 §20] |A24|Enforced advancement          |Gate validator rejects missing reviewers, failed checks, unresolved blocking findings and incomplete requirements; the pipeline cannot advance a failed gate                                                                                                                                           |

[M0394 §20] |A25|Candidate integrity           |A source/test/configuration change invalidates mismatched approval; review metadata does not recursively invalidate its own candidate                                                                                                                                                                  |

[M0395 §20] |A26|Repair and re-review          |Introduce a known defect in a controlled test branch; independent reviewers identify it, the implementer fixes it, and independent rechecks/regression tests prove closure                                                                                                                             |

[M0396 §20] |A27|Reliable resumption           |Resume from a checkpoint; reconstruct current stage/tasks/evidence, reject stale reviews and continue without inventing approvals or requiring routine user confirmation                                                                                                                               |

[M0397 §20] |A28|Final package integrity       |After the DG7 candidate review, seal the handover with all eight gate records, agent definitions, requirement coverage and findings; verify package integrity and keep these records distinct from product gates G1–G6. This post-approval sealing check must pass before delivery is declared complete|

[M0398 §20] Use a documented realistic load dataset. As provisional test targets, exercise 50 transformations, 1,000 initiatives, 10,000 KPI-period actuals, 100,000 audit events and 100 concurrent signed-in users. Aim for p95 ordinary reads/updates within 2 seconds and key dashboards within 4 seconds on specified infrastructure; define the tested workload and report actual results. Long exports run asynchronously with visible progress. These are proposed engineering targets, not verified Mobily capacity requirements. Agree final production scale, availability and recovery objectives with IT.

[M0399 §20] Use unit tests for formulas and state rules, integration tests for persistence/authorization/jobs, end-to-end tests for business journeys, and visual checks for both languages and report outputs. Passing a build alone is not acceptance. If a test cannot run, report the exact reason and remaining verification; never fabricate a pass.

## [M0400 §21] 21 Ordered implementation stages and release behavior

[M0401 §21] Use these eight software delivery stages in order. Each ends with the full DG review/repair/verification protocol in section 0. Reviewers are mandatory at every stage, even when a specific row highlights a specialist concern. Do not implement a later stage before the preceding gate is approved; read-only dependency discovery is allowed. Requirements span multiple stages where needed, but the requirement register must assign the exact increment and final completion gate.

[M0402 §21] |Stage and gate                               |Implementation owners                                                                         |Concrete outputs                                                                                                                                                                                 |Evidence required before approval                                                                                                                                                                                                        |

[M0403 §21] |P0 Discovery and execution setup — DG0       |transformation-analyst; orchestrator                                                          |Full source extraction, field/template inventory, glossary, requirement IDs, user journeys, stage plan, agent definitions, gate schema/validator and assumptions                                 |All source items accounted for; ten definitions validated and required stage agents actually invoked; review protocol and gate validator reject missing/invalid evidence; no invented source requirements                                |

[M0404 §21] |P1 Architecture and working foundation — DG1 |solution-architect; frontend-ux-engineer; backend-workflow-engineer; devops-engineer          |Architecture decisions, ERD/API contracts, repo/build/CI, database migrations, authentication/scoped access, bilingual shell, design tokens, persisted transformation creation and audit baseline|Clean startup; real create/read/update and authorization checks; agreed data/contracts; Arabic/English screen review; migration and baseline audit checks                                                                                |

[M0405 §21] |P2 Diagnose define and design — DG2          |transformation-analyst; frontend-ux-engineer; backend-workflow-engineer; kpi-benefits-engineer|Charter, diagnostic, baseline, value pools, outcome/KPI definitions, TOM canvas/gaps, capabilities/journeys, design decisions, T01–T04 and business gates G1–G3                                  |Source fields and scope preserved; records trace correctly; missing evidence/invalid approval blocked; history retained; real end-to-end phase procedures                                                                                |

[M0406 §21] |P3 Mobilization and portfolio — DG3          |backend-workflow-engineer; frontend-ux-engineer; kpi-benefits-engineer                        |Initiative cards, business cases, formula foundations, prioritization, waves, resources, funding, dependencies, T05–T09 and business gate G4                                                     |Weighted scores verified; invalid weights/cycles/capacity conflicts handled; initiative-to-gap/outcome links; executable approval flow and tested financial inputs                                                                       |

[M0407 §21] |P4 Execution value and sustainment — DG4     |backend-workflow-engineer; kpi-benefits-engineer; frontend-ux-engineer                        |Full KPI/benefit engines, T10–T16, forums/decisions/RACI/RAID, adoption, corrective actions, core scheduled jobs, BAU handover, continuous improvement and G5–G6                                 |KPI-to-benefit-to-dashboard scenario; Finance validation; double-counting prevention; recurrence and escalation; adoption/BAU acceptance and ownership continuity                                                                        |

[M0408 §21] |P5 Configuration automation and outputs — DG5|backend-workflow-engineer; frontend-ux-engineer; kpi-benefits-engineer                        |Complete Playbook Studio, native procedure/form builders, version migration, full rule builder, report/export formats, 90-day launch plan, 25-question health check and source-grounded demo     |Admin changes without routine code edits; draft/publish/migration/reapproval behavior; durable rule retries; report snapshots and bilingual export inspection; all required starter automations                                          |

[M0409 §21] |P6 Integration and system hardening — DG6    |devops-engineer; backend-workflow-engineer; frontend-ux-engineer                              |Controlled imports, connector contracts/test adapters, identity/storage integration, optional AI adapter, security/performance/accessibility refinements and operational monitoring              |Applicable A01–A22 checks; authorization boundary tests; malformed/duplicate input; concurrency/failure recovery; realistic load; complete lifecycle with external AI disabled; honest live-integration status                           |

[M0410 §21] |P7 Independent transfer and release — DG7    |devops-engineer; orchestrator                                                                 |Complete source/archive, clean deployment, migrated data/files/configuration, restore drill, guides, traceability and final IT handover                                                          |A01–A27 and all product requirements verified; clean-environment/outbound-internet-disabled runtime demonstration; independent final domain/code/QA reviews and release audit, followed by A28 package sealing and integrity verification|

[M0411 §21] For DG7, avoid a self-referential approval package: first review and approve the frozen application/handover payload, excluding review and gate metadata from its hash; then append the resulting DG7 gate record to the release evidence envelope and run A28 to validate the sealed package. A28 is a post-approval packaging check, not a prerequisite that requires DG7 to already exist before DG7 can be approved. Do not declare final delivery complete until sealing and integrity verification pass. A sealing failure blocks delivery; a payload change requires new candidate reviews. Preserve the payload hash and separately record the final archive checksum.

[M0412 §21] Source methodology phases are not software delivery stages. In particular, product gate G6 does not imply engineering release DG7 has passed, and a demo Sponsor approval does not approve a real Mobily transformation.

[M0413 §21] Require usable integrated increments rather than isolated screen collections. Maintain bilingual behavior, authorization, persistence, evidence and audit throughout implementation. Add applicable tests as each capability is built. A dependency genuinely discovered later must update the plan and reopen affected earlier gates rather than hiding regressions or quietly changing approved contracts.

[M0414 §21] Preserve the full platform scope. The stage plan is a sequencing mechanism, not permission to call the first vertical slice the finished product. At final delivery provide the working application/preview, source repository/archive, exact setup instructions, secure administrator bootstrap, IT handover, requirement coverage, test evidence, all eight gate reports and the remaining external configuration dependencies. Mark any unmet mandatory acceptance criterion as a release blocker. Keep credentials out of the text and repository.

[M0415 §21] Begin now with P0. Read the source, establish real agents, create the delivery records, run independent reviews, fix findings and achieve DG0 before continuing. Continue automatically stage by stage under section 0 until the complete deliverable is verified or a precise external blocker prevents progress.

[M0416 §21] The completion standard is: users can operate the playbook from inputs to sustained outcomes inside the platform; administrators can evolve its methodology without routine code edits; IT can independently deploy and maintain the entire system; and each software delivery stage has reproducible independent review and test evidence.

[M0417 §21] Official technical references

[M0418 §21] Use these primary references to verify installed-version behavior. Business methodology comes from the attached source; the delivery rules and agent roles above are our project requirements.

[M0419 §21] • Claude Code subagents — project definitions, supported configuration and actual delegation.

[M0420 §21] • Claude Code Agent Teams — optional team mode and its current limitations.

[M0421 §21] • Docker Compose application model — portable services and persistent resources.

[M0422 §21] • PostgreSQL backup and restore — database recovery approaches.

[M0423 §21] • Keycloak application security overview — enterprise identity protocols.

