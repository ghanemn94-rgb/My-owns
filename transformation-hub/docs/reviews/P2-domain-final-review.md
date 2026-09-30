# P2 independent domain FINAL review: fixes of the P2 domain re-review

| Item | Value |
|---|---|
| Reviewer | carveout-domain-analyst (REVIEW mode, separate context). This reviewer wrote the re-review (`P2-domain-rereview.md`) and did not implement any fix under review. |
| Revision reviewed | `8f8d72b03db1d539987517d67b2a063a104d4a67` (`8f8d72b`) on `claude/mobily-transformation-hub`, identical to `origin/claude/mobily-transformation-hub` when fetched on 2026-09-30. The review worktree was frozen on it; nothing was merged in. |
| Review branch | `worktree-agent-a27c6a8934b1911ce`. This review added only this report and three probe files: `apps/api/test/reviews/p2-domain-final.spec.ts`, `p2-domain-final-perimeter.spec.ts` and `p2-domain-final-readiness.spec.ts`. No application code, test kit, seed, template, governance document or register file was changed. |
| Date | 2026-09-30 |
| Input | `docs/reviews/P2-domain-rereview.md` (FAIL) and its "Fix status" section; `P2-qa-review.md` "Fix status" (QA-P2-01, O-1); `docs/architecture/module-guide.md` "Relying on a governance decision"; `docs/assumptions-and-open-questions.md` (A-40, A-49 to A-53, Q-40, Q-43); `docs/governance/authority-matrix.md` §3, `decision-workflow.md`, `business-gates.md` §4, `committee-charter-draft.md` §14; `docs/MASTER_PROMPT.md` §3, §4.2, §14. |
| **Verdict** | **PASS WITH CONDITIONS** for the P2 domain gate — see §8. The three High findings of the re-review (DOM-P2R-03, -04, -05) are fixed, and their probes pass. The review found **1 new High in P3 scope** (DOM-P2F-09, readiness module), **1 new Medium** (DOM-P2F-01) and **8 new Low** findings. No Critical or High finding is open in P2 scope. |

This review makes no legal, tax, zakat, accounting or regulatory determination. It does not set Mobily policy. Where a rule is
a governance choice (who closes a vote, how non-voters count, what a declared interest allows), the report says whether the
proposed default is conservative, and what the governance owner must confirm ("Assessment pending — governance owner").

---

## 1. Commands and real results

All commands ran from `transformation-hub/` in the review worktree at `8f8d72b`. The reviewer used only its own databases:
`hub_test_p2fr`, `hub_test_p2fr_boot`, `hub_test_p2fr_probe` and `hub_test_p2fr_e2e`. Docker was not started. No database or
process of another agent was touched. Logs are in the reviewer's own scratch directory (`…/scratchpad/p2fr/`).

### 1.1 Set-up

```
$ git rev-parse HEAD
8f8d72b03db1d539987517d67b2a063a104d4a67
$ pg_isready -h 127.0.0.1 -p 5432                → accepting connections (pg-start.sh not needed)
$ HUB_DATABASES="hub_test_p2fr hub_test_p2fr_boot" bash scripts/dev/pg-init-roles.sh
roles hub_owner/hub_app and databases ready: hub_test_p2fr hub_test_p2fr_boot
$ HUB_DATABASES="hub_test_p2fr_probe" bash scripts/dev/pg-init-roles.sh   (probe runs, parallel to the full suite)
$ HUB_DATABASES="hub_test_p2fr_e2e" bash scripts/dev/pg-init-roles.sh     (Playwright stack)
$ pnpm install --frozen-lockfile --prefer-offline   → Done, exit 0
$ pnpm build:packages                               → exit 0
```

### 1.2 Unit tests and lint

```
$ pnpm --filter @hub/domain --filter @hub/contracts run test          → EXIT 0
packages/domain test:     Test Files  19 passed (19)      Tests  407 passed (407)
packages/contracts test:  Test Files  2 passed (2)        Tests  100 passed (100)

$ pnpm --filter @hub/api run lint     # tsc --noEmit (incl. this review's probe files) + module boundaries → EXIT 0
module boundary check passed: 35 cross-module imports, 16 module edges, acyclic, only published surfaces

$ python3 scripts/requirements/apply_status.py --check  → status-evidence.yaml OK (263 entries)
```

### 1.3 Full API suite at `8f8d72b` (before this review's probes existed)

```
$ TEST_DATABASE_URL=postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_test_p2fr \
  TEST_DATABASE_MIGRATION_URL=postgres://hub_owner:hub_dev_only@127.0.0.1:5432/hub_test_p2fr \
  pnpm --filter @hub/api test --reporter=verbose
 Test Files  92 passed (92)
      Tests  802 passed | 4 expected fail (806)
   Duration  1270.62s
EXIT 0
```

The 4 expected failures are the open P4 domain-review probes declared with `it.fails`: DOM-P4-01 and DOM-P4-08
(`p4-domain-jv.spec.ts`), DOM-P4-06 and DOM-P4-07 (`p4-domain-finance.spec.ts`). They are outside P2. `p1/p1-closure-empty-db.spec.ts`
ran on `hub_test_p2fr_boot` (3/3).

P2-relevant files in that run (counts from the verbose log):

| File | Passed | Failed |
|---|---|---|
| `reviews/p2-domain-rereview.spec.ts` (the re-review probes, renamed "fixed, regression") | 11 | 0 |
| `reviews/p2-domain-rereview-perimeter.spec.ts` (DOM-P2R-05) | 1 | 0 |
| `reviews/p2-domain.spec.ts` (first review's probes) | 12 | 0 |
| `governance/p2r-voting-papers-subjects.spec.ts` (DOM-P2R-01, GOV-015, DOM-P2-14, DOM-P2R-03 paper subject) | 7 | 0 |
| `planning/p2r-decision-reliance.spec.ts` (DOM-P2R-02/-03/-04/-07, registry) | 9 | 0 |
| `gates/p2r-gate-decision-evidence.spec.ts` (O-1, DOM-P2R-04 on gates) | 2 | 0 |
| `reviews/p2-qa-adversarial.spec.ts` | 12 | 0 |
| `governance/p2-governance-authority.spec.ts` | 18 | 0 |
| `governance/decision-lifecycle.spec.ts` | 11 | 0 |
| `governance/at-04-decision-outside-delegation.spec.ts`, `at-05-quorum-recusal-self-approval.spec.ts` | 6, 9 | 0 |
| `gates/dom-p2-16-gate-roles.spec.ts`, `p2-gate-authority-reassessment.spec.ts`, `at-14-reassessment.spec.ts` | 11, 9, 4 | 0 |
| `planning/cross-project-and-prerequisites.spec.ts` | 10 | 0 |
| `carveout/setup-wizard.spec.ts` | 4 | 0 |
| `reviews/p2-sec-probes.spec.ts`, `reviews/p2-sec-access-matrix.spec.ts` | 12, 10 | 0 |

### 1.4 This review's probes

Three files, one gate-kit project each (`DFR-A`, `DFR-PV`, `DFR-TSA`). `RE …` re-verifies a fix. `OBSERVATION …` pins current
behaviour behind a rule that the governance owner must confirm. `DEFECT …` asserts the required behaviour of a new finding and
fails at `8f8d72b`. As in the P2 QA and P4 domain reviews, DEFECT probes are declared with `it.fails`, so the shared suite stays
green while the defect is open. `P2F_PROBE_PLAIN=1` runs them as plain tests.

Plain mode, on the probe database:

```
$ P2F_PROBE_PLAIN=1 TEST_DATABASE_URL=…/hub_test_p2fr_probe TEST_DATABASE_MIGRATION_URL=…/hub_test_p2fr_probe \
  npx vitest run test/reviews/p2-domain-final.spec.ts test/reviews/p2-domain-final-perimeter.spec.ts \
                 test/reviews/p2-domain-final-readiness.spec.ts --reporter=verbose
 Test Files  2 failed | 1 passed (3)
      Tests  5 failed | 9 passed (14)
   Duration  47.15s
```

The 5 failures are exactly the 5 DEFECT probes. Each failed at its final assertion. Every setup step before it passed through the
real API:

- `DEFECT DOM-P2F-01`: "recused chair closed the vote; outcome {"status":201,"body":{"status":"approved", … "explanation":"Simple
  majority of eligible votes (1 approve, 0 reject, 0 abstain of 1 eligible votes …). Within delegated authority."}} — expected 201
  not to be 201".
- `DEFECT DOM-P2F-02`: "approved on evidence verified by the external-approval recorder: link {"status":"active","reviewed_by":
  "7cfe1878…"}, recorder 7cfe1878… ; response {"status":"approved"} — expected 201 to be 422".
- `DEFECT DOM-P2F-03`: "vote 201; close audit notVoted [e6bb…, 3439…, 6d02…]; round-1 votes [3439…, 97af…]; outcome 201 {"status":
  "approved", … "2 approve … of 2 eligible votes"} — expected 201 to be 422". The member `3439…` is both in the chair's "not voted"
  list and among the counted votes.
- `DEFECT DOM-P2F-04`: "removed {"ok":true}; task start by the same person 201 {"status":"in_progress"} — expected 201 to be 403".
- `DEFECT DOM-P2F-09`: "second TSA approved on the same decision … TSAs [TSA-001 approved, decision 01a0f3b2-b6c9…; TSA-002 approved,
  decision 01a0f3b2-b6c9…]; registered uses 0 — expected 201 to be 422".

The first probe run (plain assertions, before the `it.fails` convention was adopted) gave `Tests 6 failed | 8 passed (14)`: the same
5 reproductions plus one authoring error in the perimeter probe (a wrong column name, `vote.cast_at`, in its last query; every
assertion before it had passed). The column was corrected to `created_at`, and the file then passed alone (`Tests 1 passed (1)`).

### 1.5 Full API suite with this review's probes (default mode)

```
$ TEST_DATABASE_URL=…/hub_test_p2fr TEST_DATABASE_MIGRATION_URL=…/hub_test_p2fr pnpm --filter @hub/api test --reporter=verbose
 Test Files  95 passed (95)
      Tests  811 passed | 9 expected fail (820)
   Duration  1115.56s
EXIT 0
```

820 = the 806 tests of §1.3 + this review's 14 probes. The 9 expected failures are the 4 P4 probes of §1.3 and this review's 5
DEFECT probes (DOM-P2F-01, -02, -03, -04, -09), which fail as reproduced in plain mode (§1.4). The other 9 probes (RE and
OBSERVATION) pass. `p1-closure-empty-db` ran on `hub_test_p2fr_boot` (3/3). Every pre-existing test passes again.

### 1.6 Playwright E2E (P2 governance, planning, gates, follow-ups, exit journey; P3 carve-out), own stack

Stack set up as in the CI e2e job, on the reviewer's own database and ports (API :4762, web :3762):

```
$ DATABASE_URL=…/hub_test_p2fr_e2e DATABASE_MIGRATION_URL=…/hub_test_p2fr_e2e HUB_MODE=demo NODE_ENV=development \
  node deploy/docker/api-entrypoint.cjs migrate   → post-migrate SQL applied (RLS, grants, triggers, audit chain); migrate: done
  node apps/api/dist/cli/seed-demo.js             → demo seed complete
  PORT=4762 HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 node apps/api/dist/main.js &   → /readyz {"status":"ready"}
  node apps/api/dist/worker.js &
$ env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4762 pnpm --filter @hub/web run build   → exit 0
$ (apps/web) env -u NODE_ENV npx next start -p 3762                                     → /login HTTP 200
$ HUB_WEB_URL=http://127.0.0.1:3762 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test \
    tests/p2-governance.spec.ts tests/p2-planning.spec.ts tests/p2-gates.spec.ts tests/p2-web-followups.spec.ts \
    tests/qa-p2-exit-journey.spec.ts tests/p3-carveout.spec.ts --reporter=list
  18 passed (4.6m)
```

The UI steps of the fixes that these specs exercise: the paper's "No supporting evidence or attachment — reason" field
(DOM-P2-14); every present member votes, each declaring "no conflict" in the vote dialog (DOM-P2R-01, GOV-015); a change request
approved in the UI on the decision raised for it (DOM-P2R-03); the prerequisite refusal in English and Arabic (DOM-P2R-07); the exit
journey decision → action → verified closure. The run rewrote tracked screenshots under `e2e/screenshots/`. They were restored with
`git checkout -- transformation-hub/e2e/screenshots` and are not part of this change.

### 1.7 Processes started and stopped

- E2E stack: API node PID 22174 (wrapper 22173), worker node PID 22189 (wrapper 22188), web `npm exec` 23553 / `sh` 23575 /
  `next-server` 23576 (wrapper 23552). Command lines were checked, then the processes were stopped with `kill`. Afterwards `curl`
  to :4762/readyz and :3762/login returns no connection (`000`). Other `next-server` processes on the host (PIDs 1853, 17996) belong
  to other agents and were not touched.
- The two full API runs and the probe runs ended on their own.
- Left in place: the reviewer's databases `hub_test_p2fr`, `hub_test_p2fr_boot`, `hub_test_p2fr_probe`, `hub_test_p2fr_e2e` (test
  data only). Nothing else was left running.

### 1.8 NOT EXECUTED

- The rest of the Playwright suite (`a11y`, `p1-*`, `p2-cockpit`, `p2-documents`, `qa-p2-arabic-rtl`, `qa-p2-gate-review-journey`,
  `p3-readiness`, `p4-*`, `p5-ai`, `qa-p1-*`). It is outside this focused domain review.
- CI on `8f8d72b` (no push to the integration branch by the reviewer). Docker, Compose, Helm (not started, as instructed).
- Evidence re-check on **baselines and perimeter versions with an external approval**: with the DEMO matrix, `baseline_approval` and
  the G1 type `gate_decision_operational` are within the committee's authority, so no external approval can arise on these paths
  through the API. Judged from code (both go through `decisionRelianceIssue`; §4.3).
- A probe for the race between an approval and a concurrent evidence rejection (§4.4): code analysis only.
- TSA extension and cutover go/no-go decision reuse (DOM-P2F-09): code only; the TSA terms approval was executed.

## 2. Integrity of the re-review probes

The implementer renamed the re-review probes as asked. `git diff 41f569f 8f8d72b` on the two files shows:

- The four `DEFECT` probes (DOM-P2R-03, -04a, -04b, -05; the "Fix status" section says "five") are renamed `… (fixed,
  regression)`. **No assertion changed.** Note: the
  DOM-P2R-03 probe raises its paper without a subject, so it now passes through `change_control.decision_no_subject`, not
  `decision_other_subject`. Both are the required 422. The "other subject" case is covered by the implementer's
  `p2r-decision-reliance.spec.ts` and by this review's baseline probe (§3).
- The two `OBSERVATION` probes (DOM-P2R-01, -02), which pinned the defective behaviour, now assert the implemented rule. That is the
  expected treatment of an observation once a rule is implemented.
- One setup line of `RE DOM-P2-20` now also has Legal vote (the new closing rule needs every present eligible vote). Its assertions are
  unchanged.

One test of another review no longer proves what it was written for. **`p2-qa-adversarial.spec.ts` "two change requests … approved at the
same time on ONE final decision"** now passes vacuously. Its log line in §1.3 reads `requests waiting before release 0; approve
statuses [422,422] codes ["change_control.decision_no_subject","change_control.decision_no_subject"]`. Both approvals are refused
by the subject rule before any lock is taken. See §4.4 (informational).

## 3. Per-finding status

Legend. **Fixed**: the finding as written is resolved, and an executed test proves it. **Partially fixed**: part of it is
resolved. **Not fixed**: still open. "Probe" = this review's `p2-domain-final*.spec.ts`. "RE-review probe" = the renamed
`p2-domain-rereview*.spec.ts`. "Implementer test" = the new `p2r-*.spec.ts` files. All results are from §1.3 to §1.5.

| Finding | Sev. | Status | Evidence (executed unless marked "code") | Residual / new finding |
|---|---|---|---|---|
| **DOM-P2R-03** decision subject binding | High | **Fixed** | RE-review probe: change Y refused on the decision about X (422). Implementer tests: 422 `change_control.decision_other_subject` for Y; X approved on its own decision; subject validated in the project (404 for another project's record), open records only (`subject_not_open`), both fields together (400), locked after the first submission even when returned to draft (`subject_locked`); DB check and same-project trigger. **Probe RE DOM-P2R-03 (baselines):** baseline 2 refused on the paper raised for baseline 1 (`decision_other_subject`), on a baseline-type paper raised for a change request (`decision_other_subject`) and on an unbound paper (`decision_no_subject`); approved on its own paper, with the registry row `baseline_version → B2`. **Probe RE (bypass):** after submission and return, an id-only edit and a re-typed edit are refused and the subject is unchanged. Three concurrent "edit subject + submit" pairs on the same version: exactly one succeeds each time and the final row is consistent (never "submitted with a changed subject"). Code: the only writes of `decision.subject_*` are `create` / `update` (`decisions.service.ts:247-302`); AI drafts are stored as artifacts, not decision rows. | The gate path ignores the subject → **DOM-P2F-10 (Low)**. |
| **DOM-P2R-04** external-approval evidence at every reliance | High | **Fixed** (reliance on every P2 path; reassessment flag on gate cycles, which is what REQ-LCY-015 / REQ-DAT-014 require) | RE-review probes 04a (approved G0 flagged after its decision's evidence is rejected) and 04b (change request refused) pass. Implementer tests: gate blocker `gate.blocker.decision_external_evidence_invalid` and decide 422 `gates.decide.decision_evidence_invalid`, decision unchanged; change request 422 `decision_evidence_invalid`; prerequisite satisfied → unsatisfied, task start refused. **Probe DOM-P2F-02 (first half):** a *conflicting* evidence link also refuses the approval (422 `decision_evidence_invalid`). Code: baselines and perimeter versions use the same `decisionRelianceIssue` (§4.3). | The recorder of the external approval can restore the evidence by re-verifying it → **DOM-P2F-02 (Low)**. Approved change requests / baselines / perimeter versions are not flagged, and the decision cannot be re-evidenced → **DOM-P2F-05 (Low)**. |
| **DOM-P2R-05** one decision per perimeter version (P3) | High | **Fixed** | RE-review probe passes (version 2 refused on the decision that approved version 1). Registry `decision_use` unique per (decision, kind), append-only, same-project (implementer registry test: unique violation, `append_only_violation` on UPDATE/DELETE, `cross_project_reference`); partial unique index `perimeter_version_decision_uq`. **Probe RE DOM-P2R-03/-05 (perimeter):** a G1 paper raised FOR version 1 cannot approve version 2 (`perimeter.version.decision_other_subject`). | An unbound G1 paper approves whichever single version comes first → **DOM-P2F-08 (Low, P3)**. |
| **DOM-P2R-01** vote closing | Medium | **Fixed as recommended** (rule PROPOSED, pending Q-40) | RE-review probe: after the chair's single approve vote, the secretariat's outcome is refused (`governance.outcome.votes_outstanding`, outstanding 3); the secretariat cannot close (403 `governance.voting.not_chair`); the chair closes with a reason; a late vote is refused (`governance.vote.voting_closed`); the snapshot lists 3 non-voters. Implementer tests: meeting (2 approve / 2 reject once all voted → tie escalated), closure reason required (400), closed twice (422), a new round reopens voting, circulation waits for every appointed member. | Under the proposed rule the chair can still close after one vote and have a 1–0 outcome recorded (the same RE-review probe records the tally "1 approve, 0 reject, 0 abstain of 1 eligible votes" on a within-mandate paper; DOM-P2F-01 shows the resulting status `approved`; governance-owner choice, §6). A **recused** chair can close → **DOM-P2F-01 (Medium)**. A vote can land after the close → **DOM-P2F-03 (Low)**. |
| **DOM-P2R-02** cost impact confirmed by a non-requester | Low | **Fixed** (conservative option, pending Q-43) | RE-review probe: the requester's own 0 is refused (`change_control.amount_unconfirmed`); after Finance records 1,500,000 the approval is refused as outside delegated authority. Implementer tests: the requester re-recording does not confirm; Finance's recording does, with audit `costImpactConfirmed: true`. | **Probe OBSERVATION DOM-P2F-06:** a confirmation given on the draft survives the requester's later restatement of the cost (approved on the stale 0). Implementer test: a change with no cost impact at all is approved without any confirmation → **DOM-P2F-06 (Low)**. |
| **DOM-P2R-07** prerequisite removal | Low | **Partially fixed** | Implementer tests: reason required (400); the accountable person is refused while it blocks (403 `removal_by_blocked_party`, audited as denied); the PM removes with a reason (audited with the reason); a satisfied prerequisite may be removed by the accountable person. | **Probe DEFECT DOM-P2F-04:** with no accountable person the rule fails open, and the workstream lead removes and starts the task. **OBSERVATION:** with a contributor accountable, the workstream lead (who may start the task) removes it and starts it → **DOM-P2F-04 (Low)**. |
| **GOV-015 / F-01** declaration before voting | Medium (F-01 of the QA review; a P2-gate gap in the re-review §5) | **Fixed** (rule PROPOSED, A-50) | Implementer tests: no declaration → 422 `governance.vote.declaration_required` and no vote row; an on-behalf "no conflict" does not count; the member's own declaration (register or with the vote) does; an `interest_declared` member may vote; a recused member cannot. UI: the vote dialog's conflict step (§1.6). | **Probe OBSERVATION DOM-P2F-07:** a declaration given at meeting 1 still counts when the item is voted in round 2 at meeting 2 (charter §14.1 says "at the start of each meeting, per agenda item") → **DOM-P2F-07 (Low)**. |
| **DOM-P2-14** paper evidence or "none" reason | Low | **Fixed** | Implementer tests: submission refused without evidence and reason (`missing: ["supportingEvidence"]`), accepted with an evidence link or a reason. **Probe RE DOM-P2-14:** a blank reason ("   ") is no reason (422). UI field in §1.6. | **OBSERVATION** (acceptable): the rule is checked at submission; an evidence link superseded afterwards leaves a submitted paper with 0 active links. A note-only link counts as evidence. |

## 4. The shared mechanism (decision-use registry and reliance helper)

Checked against `docs/architecture/module-guide.md` "Relying on a governance decision",
`apps/api/src/modules/governance/decision-reliance.ts` and `packages/domain/src/decision-reliance.ts`.

### 4.1 Can a decision be used for two kinds that should be exclusive?

The registry is unique per **(decision, kind)** only. One decision may therefore back one record of **each** kind: a change
request, a baseline version, a perimeter version and a gate cycle. What keeps kinds apart:

- **Change request vs baseline:** both use `subjectRule: 'required'`, and a paper names one record. So the paper raised for change
  request X cannot back a baseline (executed: `decision_other_subject`), and vice versa by the same rule. **Exclusive.**
- **Perimeter version + G1 gate cycle:** allowed by design ("a G1 decision may back the G1 gate cycle and one perimeter version").
  This is a governance choice to confirm (A-52, §6).
- **Gate cycle vs change request / baseline:** the gate path does **not** read the subject (`subjectRule: 'none'`; the binding is the
  gate key). A paper raised FOR change request X, of the gate type `gate_decision_operational` with gate key G1, was linked to G1 and
  shows no decision blocker (executed, OBSERVATION). It cannot approve X, because the change request needs type
  `change_request_budget` (422 `decision_type_mismatch`, executed). **Exclusivity therefore rests on decision types only**: on the
  approved matrix having no `gateKeys` on `change_request_budget` / `baseline_approval`. That holds for the DEMO matrix, but it is
  a configuration, not an enforced rule → **DOM-P2F-10 (Low)**.

### 4.2 Can a subject be changed through any other route?

No route found. Every write to `decision` was listed (`grep` on `schema.decision` writes): `create`, `update` (draft only, subject locked
after `firstSubmittedAt`), `startReview`/`returnToDraft`/`resume` (status, round, meeting), `initiateCirculation` and meeting
scheduling (`meetingId`), `recordOutcome`, `closeVoting`, `recordExternalApproval`, `supersede`, implementation commands. None
sets `subject_type` / `subject_id`. AI decision-paper drafts are stored as AI artifacts, not decision rows. Bypass attempts through
`update` (id only, re-typed, clearing) are refused after submission (executed). A concurrent edit-and-submit cannot leave a changed
subject on a submitted paper (optimistic version; executed 3 times). The database enforces "both or neither", the allowed
types and the same project. It does not freeze the subject after submission; that is enforced in the API only (acceptable).

### 4.3 Is the evidence re-check applied on every P2 path?

| Path | Re-check | Evidence |
|---|---|---|
| Gate view / blockers | yes: `decisionsFor` → `decisionExternalEvidence` → `gateDecisionIssue` | executed (implementer: `decision_external_evidence_invalid` blocker, RAG not green) |
| Gate decide | yes: `lockDecisionForReliance` → `gateApprovalDecisionIssue` with the current evidence | executed (implementer: 422 `gates.decide.decision_evidence_invalid`) |
| Change-request approval | yes: `evaluateAuthority` → lock → `decisionRelianceIssue` | executed (RE-review 04b, implementer, probe DOM-P2F-02: rejected and conflicting evidence) |
| Baseline approval | yes, same function as change requests | **code** (`change-control.service.ts:356`, `evaluateDelegatedApproval`); not reachable with the DEMO matrix (§1.8) |
| Perimeter-version approval | yes: `gateApprovalDecisionIssue` with `externalEvidence` + `assertDecisionReliance` | **code** (`perimeter-versions.service.ts:190-222`); not reachable with the DEMO matrix |
| Prerequisite satisfaction | yes: `PrerequisiteService.state` reads the link | executed (implementer: satisfied → unsatisfied, task start 422) |
| Reassessment flag after the evidence fails | **approved gate cycles only** (`gates.service.ts:767-775`) | executed (RE-review 04a flags G0). Not for approved change requests, baselines or perimeter versions (probe OBSERVATION DOM-P2F-05) → DOM-P2F-05 |

Weakness in the re-check itself: "verified by a second person" is implemented as `verified: !!l.reviewedBy`
(`decision-reliance.ts:50`). This holds at recording time, where the verifier cannot record (`decisions.service.ts:718`). It is not
re-checked after a conflict is resolved and the link re-verified, possibly by the recorder → DOM-P2F-02.

### 4.4 Concurrency

- **Decision row lock + registry unique index.** Sound as defense in depth. On the paths that use the mechanism no API-reachable
  race for the same kind remains: change requests and baselines are subject-bound, one gate cycle is current per gate, and one
  perimeter version can be proposed at a time. (The readiness paths, which do not use it, are DOM-P2F-09.) As a result, the QA-P2-01 race probe now passes without exercising the lock (§2). The unique index and the
  `409 …decision_already_used` mapping are proven by the implementer's direct-insert backstop tests. **Informational:** this is test
  evidence of the index, not of the lock under a real race.
- **Subject edit vs submission:** safe (optimistic version; executed).
- **Vote vs chair's closing:** not serialized. A vote whose request has passed the "voting open" check commits after the close
  (executed deterministically with a table lock) → DOM-P2F-03.
- **Approval vs concurrent evidence rejection:** the reliance reads the evidence link without locking it
  (`decisionExternalEvidence`, plain `SELECT`). An approval can therefore commit on a link that a concurrent command rejected. For
  gates the reassessment job flags the cycle afterwards. For change requests and baselines nothing does (DOM-P2F-05). Code analysis;
  not executed.

### 4.5 Modules outside P2 that rely on decisions without the mechanism

The module guide says the mechanism is "one mechanism for every module". At `8f8d72b` the **readiness** module (P3: TSA approval,
TSA extension, cutover go/no-go), **finance** (P4: budget-line approval) and **JV** (P4: closings) still use
`linkedDecisionIssue(Code)` (`packages/domain/src/readiness.ts:294-301`). It checks type and finality only: no subject, no registry, no
external-evidence re-check. Executed for TSA terms: one `tsa_approval_or_extension` decision approved two different TSAs, with 0
registered uses → **DOM-P2F-09 (High, P3 scope)**. The P4 counterparts are the open P4 findings DOM-P4-01 (decision reused for another
closing) and DOM-P4-08 (external approval with rejected evidence). Their `it.fails` probes still fail as expected in §1.3.

## 5. New findings

Severity scale as in the previous reviews. **High**: a mandatory rule named in the spec or a phase exit criterion can be bypassed
through the API. **Medium**: a mandatory requirement is only partly enforced, but a manual workaround exists. **Low**: a gap in
precision, hardening or documentation.

### DOM-P2F-01 — Medium — A chair recused from an item can close voting on it

- **Location:** `apps/api/src/modules/governance/decisions.service.ts:656-684` (`closeVoting`);
  `packages/domain/src/governance.ts:646-654` (`assertVotingClosable`: status, tabled, not already closed, actor = chair seat, reason);
  `governance.support.ts:224` (`chairUserId: this.chairOn(members, onDate)` ignores recusals). The chair's presence at the meeting is
  not checked either.
- **Spec / requirements:** REQ-GOV-015 "recused members are excluded from quorum and voting"; `committee-charter-draft.md` §14.2 (a
  conflicted member takes no part in the item); proposed rule A-49 / Q-40 (the chair closes the vote).
- **Reproduction (executed):** `DEFECT DOM-P2F-01`. The chair records a recusal on item X ("related party"). The sponsor votes
  approve. The recused chair closes voting ("Enough votes") → 201. The secretariat records the outcome → `approved`, "1 approve, 0
  reject, 0 abstain of 1 eligible votes". Finance and Legal were present and eligible and never voted.
- **Why it matters:** the closing step introduced by the DOM-P2R-01 fix decides who is counted. A member excluded from the item for
  a conflict can use it to secure an outcome on that item.
- **Workaround:** the secretariat can defer and resume the item (a new round) instead of recording the outcome.
- **Recommendation:** refuse `close-voting` by a member recused from the item (422 `governance.voting.chair_recused`). The governance
  owner decides who closes instead (vice-chair, or the secretariat on the committee's instruction), and whether the closing chair
  must be recorded present. Owner: backend-data-engineer (governance) + governance owner. **Before the P2 gate, or accepted by the
  governance owner as a condition.**

### DOM-P2F-02 — Low — External-approval evidence re-verified by the approval's own recorder counts again

- **Location:** `apps/api/src/modules/governance/decision-reliance.ts:50` (`verified: !!l.reviewedBy`);
  `apps/api/src/modules/documents/evidence.service.ts:267-304` (`verify`: excludes the linker and the uploader only);
  `packages/domain/src/documents.ts:328-333` (a `conflicting` link becomes `active` when its counterpart is superseded or rejected).
  The recorder of the external approval is not stored on the decision row (only in the audit trail).
- **Rule:** DOM-P2-12 as documented in `module-guide.md` and `decision-reliance.ts` ("an ACTIVE link VERIFIED by a second person";
  `recordExternalApproval` refuses a recorder who verified the evidence, `decisions.service.ts:718`).
- **Reproduction (executed):** `DEFECT DOM-P2F-02`. Decision D for change request X (1,500,000) is approved externally. The PM links
  the evidence and Legal verifies it; the second secretariat member records the approval. A contradicting record is linked with
  `conflictsWithLinkId`, and the approval of X is refused (`decision_evidence_invalid`). Correct so far. The contradicting link is
  superseded. The **recorder** then verifies the original link (accept) → `active`, `reviewed_by` = recorder. X is approved on D →
  201.
- **Recommendation:** store `externalApprovalRecordedBy` on the decision. Treat evidence whose current verifier is that person as
  unverified in `decisionExternalEvidence`. Also add the recorder to the "not self" subjects when verifying a link that targets
  that decision.

### DOM-P2F-03 — Low — A vote can be committed after the chair closed voting (race)

- **Location:** `decisions.service.ts:383-456` (`castVote` checks `assertVotingOpen` on the decision row it read, without locking
  the row) vs `:656-684` (`closeVoting` updates the row). Neither serializes against the other.
- **Rule:** `authority-matrix.md` §3 step 5 (b), proposed A-49: "no further vote is accepted in that round".
- **Reproduction (executed, deterministic):** `DEFECT DOM-P2F-03`. A test-only owner transaction holds `LOCK TABLE vote IN EXCLUSIVE
  MODE`, so Finance's vote request stops at its INSERT after all its checks. The chair closes voting → 201; the audit lists Finance
  among `notVoted`. On release, Finance's vote commits (201). The outcome counts it ("2 approve … of 2 eligible votes"). The close
  record and the tally disagree.
- **Recommendation:** lock the decision row (`SELECT … FOR UPDATE`) in `castVote` before `assertVotingOpen`, as `closeVoting` and
  `recordOutcome` update it. Alternatively, have `recordOutcome` refuse votes created after `votingClosedAt`.

### DOM-P2F-04 — Low — Prerequisite removal: fails open without an accountable person; the "blocked party" is narrower than who can start the task

- **Location:** `apps/api/src/modules/planning/prerequisites.service.ts:136` (`blockedUserIds: [succ.accountableUserId]`);
  `packages/domain/src/decision-reliance.ts:317-325` (a null id matches nobody). Task start is open to the accountable owner, an R
  assignee, or any holder of `planning.task.manage` on the workstream (`planning-support.ts:235-249`).
- **Rule:** proposed A-53 ("the blocked party cannot remove it"); `module-guide.md` I-R3 (separation of duties fails **closed** on
  an unknown subject).
- **Reproduction (executed):** `DEFECT DOM-P2F-04`. A task with no accountable person and a pending agreement as prerequisite: the
  workstream lead removes it with a reason (201) and starts the task (201, `in_progress`). **OBSERVATION:** with a contributor as the
  accountable person, the same workstream lead removes the prerequisite and starts the task. Allowed under A-53 as written.
- **Recommendation:** fail closed (403 `policy.sod_subject_unknown`) when the successor has no accountable person. For A-53, the
  governance owner decides whether "blocked party" means everyone who may start the task (owner, R assignees, workstream lead /
  PM who then start it), for example refusing a start by the person who removed a blocking prerequisite.

### DOM-P2F-05 — Low — After the external-approval evidence fails, approvals that relied on it are not flagged, and no command re-evidences the decision

- **Location:** `gates.service.ts:767-775` (the job loads the decisions of approved **gate** cycles only). There is no reader of
  `decision_use` for `change_request` / `baseline_version` / `perimeter_version` when the evidence changes. `externalEvidenceLinkId`
  is written only by `recordExternalApproval`, which requires status `recommended` (`decisions.service.ts:702`).
- **Reproduction (executed):** `OBSERVATION DOM-P2F-05`. Change request Y is approved on decision D (external approval, verified
  evidence), then Finance rejects the evidence as defective and the worker runs. Y stays `approved`; no escalation and no
  reassessment audit row reference Y or D after the rejection. Recording the external approval again with a fresh verified link is
  refused (422 `governance.external.not_recommended`). Yet the refusal text of the reliance check says "until the external approval
  is evidenced again" (`decision-reliance.ts:273`).
- **Also (code):** any holder of `documents.evidence.link`, for example the PM who linked it, can **supersede** the external-approval
  link. This permanently stops a Board-approved decision from backing anything and flags the approved gates. It fails closed and is
  audited, but a single non-governance role can disable a reserved-matter approval.
- **Assessment:** REQ-LCY-015 and REQ-DAT-014 name gates (and KPIs, summaries); gates are covered. The re-review's recommendation (2)
  asked for more. Low.
- **Recommendation:** extend the evidence job to the `decision_use` rows of the decision (raise one escalation listing the approved
  records; never modify them). Add a controlled "re-evidence external approval" command (second-person verified, not by the
  original recorder), or change the refusal text. Restrict superseding a decision's external-approval link to the governance
  roles.

### DOM-P2F-06 — Low — The cost confirmation is not bound to what was assessed

- **Location:** `change-control.service.ts:577-596` (`updateChangeRequest`: an assessor may set `costImpact` on a draft; later edits of
  `impacts` / `proposedChange` by the requester keep `costImpactRecordedBy`); `:871-876` (`crAmount`: no amount and no cost text →
  `none`, decided without confirmation).
- **Reproduction (executed):** `OBSERVATION DOM-P2F-06`. The sponsor raises a change. The PM (an assessor, not the requester) records
  0 on the draft → `costImpactConfirmed: true`. The sponsor then restates the cost as "1,500,000 DEMO-SAR … above the DEMO limit"
  and widens the scope; the confirmation is kept. The chair approves within delegated authority (audit `costImpactConfirmed: true`,
  `basis: delegated_authority`). The implementer's own test also approves a change with no cost impact without confirmation ("No
  cost").
- **Recommendation (governance owner, Q-43):** reset the confirmation when the requester edits impacts or the proposed change after
  it. Decide whether "no cost impact" also needs an assessor's explicit 0 for `change_request_budget` approvals.

### DOM-P2F-07 — Low — Conflict declarations carry over to later meetings and rounds; a declared interest votes without a ruling

- **Location:** `governance.support.ts:188-195` (declarations per decision, any meeting, any round);
  `governance.ts:663-677` (`VOTING_DECLARATIONS = ['no_conflict', 'interest_declared']`).
- **Reproduction (executed):** `OBSERVATION DOM-P2F-07`. The chair declares "no conflict" with a round-1 vote at meeting 1. The item is
  deferred and resumed at meeting 2 (round 2), and the chair votes without a new declaration → 201. The only declaration on file is
  the one from meeting 1. The implementer's test shows an `interest_declared` member voting at once (documented in A-50 as open).
- **Rule:** `committee-charter-draft.md` §14.1 "Members declare conflicts at appointment and at the start of each meeting, per agenda
  item".
- **Recommendation (governance owner, Q-40):** require the declaration per meeting (or per round), and decide whether a declared
  interest blocks the vote until the chair rules.

### DOM-P2F-08 — Low (P3 scope) — An unbound G1 paper approves whichever perimeter version comes first

- **Location:** `perimeter-versions.service.ts:215-221` (`subjectRule: 'if_set'`).
- **Reproduction (executed):** `OBSERVATION DOM-P2F-08`. Version 1 is proposed. Two G1 papers are voted: one raised for version 1 and
  one raised for no record. Version 1 is rejected, the register changes (different snapshot hash) and version 2 is proposed. The
  paper for version 1 is refused for version 2 (correct). The unbound paper, whose votes all predate version 2, approves it → 201.
- **Recommendation:** make G1 papers name the version (`required`), or bind the decision to the `snapshotHash` current when it was
  voted. Governance owner (A-52). Owner: backend-data-engineer (carve-out) → P3.

### DOM-P2F-09 — High (P3 scope; P4 counterparts DOM-P4-01 / DOM-P4-08) — Readiness decisions bypass the shared reliance mechanism

- **Location:** `apps/api/src/modules/readiness/tsa.service.ts:330-338` (`approveTerms`), `:400-408` (`requestExtension`: refuses the
  same decision only for the same TSA's current extension), `cutover.service.ts:329-337` (`linkGoDecision`); all rely on
  `linkedDecisionIssue` (`packages/domain/src/readiness.ts:294-301`): type and finality only, no subject, no `decision_use`, no
  external-evidence re-check.
- **Spec / requirements:** REQ-GOV-022 ("Approval interfaces and commands enforce delegated authority … (subject, thresholds,
  limits, body)"); REQ-TSA-005 ("an approved decision recorded against the TSA"); `module-guide.md` "Relying on a governance decision"
  (one mechanism for every module; a new consumer's default is `subjectRule: 'required'`); the DOM-P2R-03/-04/-05 principle.
- **Reproduction (executed):** `DEFECT DOM-P2F-09`. One final `tsa_approval_or_extension` decision approves the terms of TSA A (201) and
  then of TSA B (201). Both rows carry the same `approval_decision_id`, and 0 uses are registered. TSA extension and cutover go
  decisions: same pattern, by code.
- **Scope:** P3 (readiness/TSA requirements are P3). It does not change the P2 verdict. It **blocks the P3 gate**, like DOM-P2R-05. A
  batch approval (one decision for a TSA schedule) is a legitimate governance pattern, but then it must be modeled explicitly (A-52
  "allow one decision to authorize several records explicitly"), not implied.
- **Recommendation:** move readiness, finance and JV onto `lockDecisionForReliance` + `decisionRelianceIssue` + `registerDecisionUse`
  (kinds `tsa_approval`, `tsa_extension`, `cutover_go`, `budget_line`, `jv_closing` …; subject types added to `DECISION_SUBJECT_TYPES`
  and `hub_target_table()`). Owner: backend-data-engineer (readiness; finance / JV for P4).

### DOM-P2F-10 — Low — The gate path ignores the decision's subject; kind exclusivity rests on matrix types

- **Location:** `packages/domain/src/gates.ts:301-315` (`gateApprovalDecisionIssue`: gate key, finality, type, body; no subject);
  `gates.service.ts:309-400`.
- **Reproduction (executed):** `OBSERVATION (shared mechanism)`. A paper raised FOR change request X, of type
  `gate_decision_operational` with gate key G1, is approved within the mandate and linked to G1 (201) with no decision blocker. It
  cannot approve X (422 `decision_type_mismatch`).
- **Recommendation:** refuse, for a gate, a decision raised for a record other than a perimeter version (G1), or refuse a paper that
  has both a gate key and a non-perimeter subject. Alternatively, have the governance owner confirm that matrix types stay disjoint
  (no `gateKeys` on change-request / baseline types) and validate that when a matrix is approved.

### Informational

- **QA-P2-01 race probe is vacuous** (§2, §4.4). Its authors should re-target it, or record that the race is no longer reachable
  through the API and that the lock is defense in depth.
- **Register status.** REQ-GOV-015 / REQ-GOV-016 are `Tested`. Until DOM-P2F-01 is fixed (or accepted by the governance owner), the
  gate report should name it against REQ-GOV-015. REQ-TSA-005 (P3) is `Tested`, but DOM-P2F-09 applies to extensions too. The lead
  should review it at the P3 gate.

## 6. The proposed rules: are they reasonable, conservative defaults?

The reviewer does not set Mobily policy. For each rule: is it a reasonable engineering default, and what must the governance owner
confirm (Assessment pending — governance owner)?

| Rule | Judgement | What the governance owner must confirm |
|---|---|---|
| **Q-40 / A-40** abstentions count as not approving; the threshold is over the votes cast | Reasonable and conservative (an abstention never helps an approval). | Whether abstentions count as not approving, and whether the denominator is the votes cast or the eligible members present. |
| **Q-40 / A-49** the outcome only when every present eligible member voted, or the chair closed voting with a reason, or the circulation deadline passed; non-voters are listed and not counted | Reasonable; it closes the timing flaw of DOM-P2R-01 and makes truncation visible (reason, audit, `notVoted` in the snapshot). **Not the most conservative option:** a chair can still close after one vote and obtain a 1–0 approval (executed: RE-review probe tally, and `approved` in probe DOM-P2F-01). Counting present non-voters as not approving would remove that lever. Two engineering defects must be fixed whatever the choice: DOM-P2F-01 and DOM-P2F-03. | (a) who may close (chair only; vice-chair when the chair is recused; secretariat on instruction); (b) whether present non-voters count as not approving after a closure; (c) any minimum number of votes cast for an approval after a closure (for example, at least the quorum); (d) whether the closing chair must be present. |
| **Q-40 / A-50** a member votes only after their own declaration for the item; on-behalf does not count; a declared interest may vote | Reasonable; "own declaration" is conservative. Two points are less conservative than the charter: declarations carry over to later meetings and rounds (DOM-P2F-07), and a declared interest votes without a chair ruling. | Whether a declaration is needed per meeting (charter §14.1) or per round; whether `interest_declared` blocks the vote until the chair rules (recuse or permit), and who rules when the chair is conflicted. |
| **A-51 / Q-43** the cost impact decides authority only once an assessor other than the requester records or confirms it | Conservative, a sound maker-checker default. The residuals are in DOM-P2F-06. | Whether Finance specifically must assess stated costs; whether "no cost impact" needs an explicit assessed 0; whether the confirmation resets on later edits by the requester. |
| **A-52** one decision per record: subject named and fixed from submission; one perimeter version per G1 decision; registry unique per decision and kind | Conservative and correct for the P2 paths; it closes DOM-P2R-03 and -05. | (a) whether one decision may authorize several records (a batch: a TSA schedule, a set of change requests); today this is impossible for change requests and baselines (conservative) and unrestricted in readiness / finance / JV (DOM-P2F-09); (b) whether a G1 decision may back both the G1 gate cycle and a perimeter version; (c) whether G1 papers must name the perimeter version (DOM-P2F-08); (d) whether a gate decision may name a non-perimeter subject (DOM-P2F-10). |
| **O-1** a decision linked to ANY earlier cycle of a gate (approved or rejected) cannot back a later cycle | Conservative (a reopened gate always gets a fresh decision) and consistent with spec §3 "preserving previous status and decisions". Executed (implementer: `gates.decide.decision_reused` after a rejected cycle; a fresh decision approves). | That a rejection citing a decision "uses" it. That a decision merely **linked** to an earlier cycle (never decided) also counts as used, as the code does (`priorDecisionIds` takes the linked decision of every other cycle). |
| **A-53** removing a prerequisite needs a reason; while it blocks, not by the person accountable for the task / milestone | Reasonable minimum, but narrower than "the blocked party", and it fails open without an accountable person (DOM-P2F-04). | Who counts as the blocked party (accountable owner only, or also R assignees and the workstream lead / PM who would start it); whether removals on baselined tasks go through change control. |

## 7. Can DOM-P2R-06 and DOM-P2R-08 (Low, not addressed) remain open at the P2 gate?

**Yes, both, as recorded Low items with an owner**, for these reasons:

- **DOM-P2R-06 (gate ownership at role level).** Separation between **individuals** holds and is tested: starter ≠ reviewer ≠
  submitter; approver ∉ {submitter, reviewer} (`dom-p2-16-gate-roles.spec.ts` 11/11, RE DOM-P2-16). The gap is at role level (PM
  override on G0/G1; any workstream lead owning G1/G4/G5/G6) and is documented in `business-gates.md` §2.4. It needs a governance
  decision and a proposed `ownerWorkstreamKey` in the template (P3, where G1 and G4 are exercised on real carve-out data). Condition:
  record it in the P2 gate report with the governance owner as owner and P3 as target.
- **DOM-P2R-08 (on-behalf recusal before the member votes needs only a reason).** The recording is audited, shown in the tally
  snapshot (`recordedBy`, `onBehalf`), and accepted by charter §14.6. With the new closing rule it slightly increases what the
  secretariat and chair can shape together (a member excluded on-behalf is no longer "outstanding"). So the governance owner should
  decide it together with Q-40 (a `ruledBy` chair ruling, or the member's own declaration). Condition: same as above, target the
  Q-40 decision.

## 8. Verdict

**PASS WITH CONDITIONS** for the P2 domain gate at `8f8d72b`.

- The three High findings of the re-review are **fixed**, with executed evidence: DOM-P2R-03 (a decision authorizes only the record
  it names; subject locked after submission; bypass and race attempts refused), DOM-P2R-04 (evidence re-checked at every P2
  reliance; gates flagged) and DOM-P2R-05 (one decision per perimeter version; P3 scope). The re-review probes pass unchanged.
- DOM-P2R-01, DOM-P2R-02, GOV-015 and DOM-P2-14 are **fixed** (the first three as proposed rules pending the governance owner).
  DOM-P2R-07 is **partially fixed** (DOM-P2F-04).
- No Critical or High finding is open in **P2** scope. The P2 exit criterion "block decisions outside authority" now holds on the
  P2 paths.
- Open in P2 scope: **1 Medium** (DOM-P2F-01) and **7 Low** (DOM-P2F-02 to -07, -10). Open in P3 scope: **DOM-P2F-09 (High)** and
  DOM-P2F-08 (Low); DOM-P2F-09 **blocks the P3 gate**.

**Conditions for the P2 gate:**

1. DOM-P2F-01 is fixed (a recused member cannot close voting), or the governance owner records who closes when the chair is
   recused and accepts the current behaviour until then.
2. The governance owner confirms, or explicitly accepts as interim defaults, Q-40 (A-40, A-49, A-50), Q-43 (A-51), A-52, A-53 and O-1
   (§6). Until then they stay recorded as assumptions / proposed rules (`assumptions-and-open-questions.md`, governance
   documents), as they are now — not as Mobily policy.
3. The P2 gate report lists DOM-P2F-02 to -07 and -10, DOM-P2R-06 and DOM-P2R-08 as open Low items with owners and target phases.
4. The P3 plan carries DOM-P2F-09 (High) and DOM-P2F-08 as P3-gate blockers, and the P4 plan carries DOM-P4-01 / DOM-P4-08. The shared
   mechanism is not yet "one mechanism for every module".

**Next action for the implementers:** fix DOM-P2F-01 and DOM-P2F-03 (governance; small). In P3, fix DOM-P2F-09 and move readiness
onto the shared mechanism. Turn this review's `it.fails` probes into plain tests (drop `.fails` and `DEFECT`) as each defect is
fixed, without weakening them.
