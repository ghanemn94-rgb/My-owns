# DG5 gate review: domain-reviewer (round 1, corrected clean re-gate)

Task ID: `T-DG5-REV-DOM-R5`. You are the independent domain reviewer of the frozen **DG5** candidate (P5 "Configuration automation and outputs"). You did not implement any DG5 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:ff3bc2c42889d232a84658da7ff850117a8c0c1ba1de6b4c8e32bcc30dae1008`. Verify it with `node tools/gates/candidate.mjs --stage DG5` (2203 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG5/ff3bc2c42889d232.manifest.json`.
- **source_commit:** `2fe8f853e54ef7ab7b88527f11633c0c3542edd6` (record this full 40-character id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26400–26499.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG4, DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG4` must pass, and so must `--historical --stage DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p5-plan.md` and `docs/architecture/p5-work-split.md`;
  - `docs/architecture/adr/ADR-0039` … `ADR-0050`, with their dated amendments (T-DG5-ARCH-R1 to R6), which win where they differ from the original text; the DG1–DG4 ADRs they extend;
  - `docs/delivery/decisions.md` D-141 to D-190 (the build and repair waves: D-155 to D-183; the first re-gate: D-184 to D-189; this corrected re-gate: D-190);
  - the P5 implementer handbacks in `docs/delivery/handbacks/DG5/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-{A,C,D,B,E,F,E2,F2}-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG5/orchestrator-D-*/` and the merged-tree verification named in D-182 (`orchestrator-D-182/verify-ab2-45287b4/`, including `repro-health.log`).
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 78 rows with `final_gate` = DG5). Test them literally. The DG5 rows are IMPLEMENTED with evidence (`validate.mjs --register DG5` PASS). Their `notes` disclose every clause covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The demo database:** `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165). The production-initialized stack is `apps/web/e2e/support/with-stack.sh`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## Corrected clean re-gate: what this round is (read D-184 and D-190 first)

- DG5 is re-gated a second time on the clean base `601d7d2` (D-190), because the first re-gate branch lost the base's implementer run records (a write-once breach) and changed `decisions.md` after a freeze. The product is carried unchanged from the first re-gate branch's head `5a7c1890635fdbd75b0bf81d0afc4896042f0e99` (outside `docs/delivery` the tree is byte-identical); it contains every fix of that branch's rounds 1–3.
- **That history is context, not a record on this branch.** Read it with `git show 5a7c189:<path>` (e.g. `docs/delivery/reviews/DG5/round-1/`, `docs/delivery/findings.json`): its findings F-DG5-100 to 144 were fixed and verified there; F-DG5-145 and 146 (e2e timing defects) were accepted there as observations with a DG6 carry-forward. You review this candidate yourself and cite only evidence you produce now; if you judge any of those (or anything else) a defect, raise it in your own id range.
- **There are no open findings on this branch.** Run your full review of this candidate. Write no verifications file.

## Your focus: source fidelity and operating logic

Check the P5 implementation against the playbook (`docs/source/playbook.md`) and the master prompt (`docs/source/master-prompt-v2.0.md`). Cite blocks as B0xxx and M0xxx. Work in **EN and AR**, through the real UI and API, on both the production-initialized and the demo-initialized stacks. Confirm, at least, each of the following.

### Playbook reader, provenance and navigation

- **Provenance.** B0004 verbatim on the reader, the About page and every report and export footer, in every format. No claim of official PMI status or certification anywhere. Custom extensions are badged in the reader and the Studio (B0157–B0162). The Realize phase is labelled as aligned with PMI BRM logic without claiming standard status (B0124).
- **The four guiding questions.** B0016 verbatim. Each deliverable carries one question, in the reader and in every form header.
- **Element sets.** Two modes, six phases, six gates, sixteen templates, ten TOM dimensions, 25 health questions and the rest of REQ-S02-001's counts. Removing a template in a draft fails the check and blocks publish.
- **Navigation.** The fourteen areas, server-side hiding (D-163 a: the Transformation Office sees Administration for the Studio review; a technical administrator without `transformation.read` sees three areas). Judge whether this reading of REQ-S03-007 is sound.
- **Branding.** The product name is configurable and the default is 'Mobily Transformation Hub'. `#0078FF` stays provisional, with a provisional wordmark. The navigation colour follows `brand.primary` as a contrast-checked shade (D-163).

### Playbook Studio and configuration

- **The publish pipeline.** Draft → Preview/Test → Review where configured → Publish, with a side-by-side diff. A published version is immutable. Rollback restores through an audited change and erases no business record. Stable identifiers and source columns are protected.
- **Pins and migrations.** Existing transformations stay pinned until an approved migration. A change that needs a gate re-approval names it (G2 in A06).
- **Scoring defaults.** 30/20/20/15/15 with a new Feasibility rubric reach only new transformations; 95 % is refused (REQ-PB-093).
- **Separation.** A methodology admin cannot approve a business decision. An owner cannot use the Studio.

### Forms, procedures and approvals

- **The form framework.** Inline help, validation, drafts, history, comments, attachments, export, recoverable conflict, on every native form. Extension fields are entered and shown everywhere (QA-A F-2, FE-C2, FE-C3, FE-D3). The eleven field types; `12 %` stores `0.12`; currency is decimal SAR.
- **Procedures.** The ten seeded procedures launch and complete, by the roles the source names. Judge the decisions:
  - `procedures` v2 assigns `baseline_validation.record_baseline` to TL (REQ-PB-027; D-165);
  - Rule A: the intake adopts the transformation it produced, and its adopted steps act in that transformation (D-166, D-167).
- **Approval routes.** Sequential and parallel routes, configured in the Studio (QA-A F-3). Conditional approval records permitted scope, conditions, owners and deadlines.

### Automation and starters

- **The rule engine.** The readable builder, a dry run that writes nothing, enable/disable, retry and the failure queue. Human-only actions (approve gate, Finance attestation and the like) are refused as rule actions (REQ-S12-026).
- **The starters.** All sixteen run on their triggers. In particular:
  - the new-transformation instantiation;
  - the dependency slip (REQ-S12-012: Rule B, D-166, a defined forward pass over planned starts; judge whether it meets M0232's "recompute forecast impacts using defined scheduling logic");
  - the meeting cut-off pack;
  - the methodology or formula revision impact.
- **Timing.** Business-day timing, quiet hours, digests and urgent escalation are separate policies.

### KPI, formulas, outputs and history

- **KPI changes.** Prospective by default. A retrospective restatement needs explicit periods and authority, and offers reissue of the issued reports it affects.
- **Formula preview and the NPV/ROI/payback extension.** Off by default, with its methodology stated when on (REQ-S08-019).
- **Reports and exports.** The ten outputs from records. PDF, DOCX, XLSX, PPTX and CSV in en and ar, RTL and LTR. Formula injection neutralized, while system SUM totals stay formulas only where the source screen shows a total (D-163). Provisional values labelled. Snapshots retain as-of time, period, source revisions, methodology and calculation versions (QA-B P-1).
- **Owner updates, presentation and the evidence register.** The executive pack uses the submitted text and the canonical metrics with no manual editing. Presentation follows live records, and an issued pack stays the snapshot.

### Launch, Day-90 and the health check

- **The 90-day plan.** Dated from a start date, with editable tasks, owners and dependencies. The Day-90 leadership test, verbatim.
- **The 25-question health check.** Yes = 1, No = 0; incomplete with no band; the four bands; the top-3 actions; a separately versioned scheme for N/A.

### The demonstration environment

- **Isolation.** A separately initialized demo database; production initialization holds no demo record or user; demo seeding is refused in production.
- **The roaming example.** Seeded verbatim (B0143–B0147), with the three chains reading as B0147 writes them (REQ-PB-090, D-168).
- **Labels.** Every demo screen, record, form header and export shows "Illustrative example — synthetic" / its Arabic. Every demo G-approval shows "Synthetic demonstration - approves nothing real".
- **The guided walkthrough.** Twelve steps, performed natively by the demo role users (REQ-S18-004).
- **Judge D-165:** demo users sign in on a dev-mode demo database only.

### Decisions and accepted observations to judge

- D-163 (a) navigation;
- D-164 (a) to (k);
- D-165's accepted observations (QA-F P-1, P-2, P-3; QA-E O-3; QA-B O-1, O-2);
- D-166 Rules A and B;
- D-167's clarification;
- D-168's roaming wording point.

For each, say whether you accept it, or raise a finding.

### What to put where

- **Evidence:** under `docs/delivery/test-evidence/DG5/domain/round-1/`, with EN and AR screenshots for every UI claim.
- **Run and record:** `node tools/gates/validate.mjs --register DG5` and `--historical --stage DG4`.

## Requirements to check (record EXACTLY these, 78)

`REQ-PB-001`, `REQ-PB-002`, `REQ-PB-011`, `REQ-PB-077`, `REQ-PB-086`, `REQ-PB-087`, `REQ-PB-088`, `REQ-PB-089`, `REQ-PB-090`, `REQ-PB-091`, `REQ-PB-092`, `REQ-PB-093`, `REQ-DLV-037`, `REQ-S01-002`, `REQ-S01-003`, `REQ-S01-004`, `REQ-S02-001`, `REQ-S02-004`, `REQ-S03-007`, `REQ-S03-010`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S08-019`, `REQ-S09-011`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-018`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-004`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-008`, `REQ-S13-009`, `REQ-S13-010`, `REQ-S14-001`, `REQ-S14-002`, `REQ-S14-003`, `REQ-S14-004`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S18-003`, `REQ-S18-004`, `REQ-S20-002`, `REQ-S20-006`, `REQ-S20-007`, `REQ-S20-015`, `REQ-S20-016`, `REQ-S21-001`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak and a real demo IdP: D-049; the demo deployment's IdP is a devops item (ADR-0050 §1); the dev-mode binding of D-165 is the test path.
- AI and external notification adapters: none ships in P5 (D-142 Q11); A21's "disabled" is the shipped configuration (D-165).

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG5/round-1/domain-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG5/round-1/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`, `round: 1`, `stage_id: DG5`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG4/round-10/domain-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG5-120 to F-DG5-139**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG5/round-1/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG5");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("domain-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG5/round-1/domain-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
