# Agent operating protocol (shared by all project agents)

This file is mandatory reading for every project agent in `.claude/agents/`. It condenses section 0 of `docs/source/master-prompt-v2.0.md`. Where they differ, the master prompt wins.

## Two gate systems: never mix them

- **DG0–DG7** are *software delivery gates* for the engineering team. Their records live in `docs/delivery/`.
- **G1–G6** are *business transformation approvals inside the product* (Case for Change … Sustain). They are product features.
- An engineering agent can never grant a real business, Finance or IT production approval. A demo Sponsor approval in seed data approves nothing real.
- Product gate G6 (Sustain) never implies that engineering gate DG7 has passed, and DG7 never implies any G1–G6 business approval.

## Sources of truth

| What | Where |
|---|---|
| Authoritative methodology (playbook v1.0) | `docs/source/playbook.md` (block anchors `B0001`–`B0165`); original `docs/source/Business_Transformation_Playbook.docx` |
| Product and delivery requirements | `docs/source/master-prompt-v2.0.md` (sections §0–§21) |
| Requirement register | `docs/delivery/requirements.csv` |
| Stage state and candidates | `docs/delivery/stages.json`, `docs/delivery/candidates/` |
| Decisions and assumptions | `docs/delivery/decisions.md` |
| Findings | `docs/delivery/findings.json` |
| Reviews / gates | `docs/delivery/reviews/DGx/round-N/`, `docs/delivery/gates/DGx.json` |
| Gate rules (validator) | `tools/gates/` (implementers must not edit it) |

## Assignment contract (what every delegation contains)

Every assignment names: stage ID; task and requirement IDs; exact source/reference files; candidate/base revision; permitted files; constraints; input/output contracts; acceptance checks; dependency status; and the expected handback path. If any of these is missing or contradictory, say so in your handback. Do not guess.

Verify the starting revision (`git rev-parse HEAD`, and `git status`) before you write anything. Do not assume your workspace contains the latest integration candidate.

## Implementation handback contract

Write your handback to the path given in the assignment (default `docs/delivery/handbacks/<stage>/<task-id>-<role>.md`). It must contain:

1. **Changed files**, with a one-line purpose for each.
2. **Behaviour delivered**, per requirement ID.
3. **Checks actually run**: exact command, environment, and the actual result or exit status. Paste the relevant output tail.
4. **Known gaps / not done**, stated plainly. An unfinished task is unfinished even if everything else went well.
5. **Merge instructions** (migrations to run, ordering, conflicts to expect).

Never report a check as passed if you did not run it. If a tool, credential or service is missing, report the check as **BLOCKED** with the exact reason.

## Review record contract (reviewers and auditor)

Reviewers write one JSON record to `docs/delivery/reviews/<DGx>/round-<N>/<role>.json`. Create it and your sidecars **only with the Write/Edit tools**, never through the shell: the validator binds each of them to the exact bytes your run wrote with its file tools (D-021). They're write-once, so never edit a file from an earlier round. The record goes that conforms to `tools/gates/schemas/review.schema.json`, plus an optional Markdown narrative next to it. Required fields: `stage_id`, `candidate_id`, `source_commit`, `reviewer_role`, `invocation_reference`, `implementation_author`, `independence_declaration`, `requirements_checked`, `checks_run[]` (each with `procedure`, `command` where applicable, `environment`, `expected`, `actual`, `exit_status`, `result`), `findings[]` (finding IDs), `verdict` (PASS/FAIL/BLOCKED), `evidence_paths[]`, `reviewed_at`.

- Inspect the frozen candidate directly: source, diffs, rendered screens, running behaviour. An implementer's summary is not evidence.
- Form your verdict **before** reading any other reviewer's conclusions for the same round.
- For your `invocation_reference`, copy exactly the value the orchestrator gives you. Never invent run IDs.
- A reviewer must not have authored any implementation in the reviewed scope. If you did, declare it and return BLOCKED.
- Anything you cannot check: record it as BLOCKED with the reason. Never write PASS by default.

## Findings contract

Each finding gets a stable ID `F-<DGx>-<NNN>` (the orchestrator allocates numbers; propose them in your record as `F-<DGx>-<role-prefix>-<n>` if you have none yet). Each one records: requirement ID, severity, reproduction, expected vs actual, evidence, and `mandatory_violation` (true if it breaks a mandatory requirement, data integrity, calculation accuracy, access control or deployment portability).

| Severity | Use for |
|---|---|
| Critical | Exploitable severe security flaw, data loss, fundamentally invalid financial results |
| High | Broken required workflow, major integrity failure |
| Medium | Material defect with limited scope |
| Low | Optional polish |

A severity label never overrides the mandatory-requirement rule. An author never closes their own finding. Only the originating reviewer or another qualified non-author verifies a fix.

A finding closes only through a reviewer-authored `<role>.verifications.json` sidecar in a review round. A Low, non-mandatory finding can be accepted as an observation only when both the reporting specialist (or another specialist) and the release-auditor add an entry `{"finding_id", "result": "PASS", "status_after": "ACCEPTED_OBSERVATION", "note": "<rationale>"}` to their own sidecars. The sidecar's **latest** entry for the finding decides, and it's bound to that reviewer's own run for the round. The orchestrator mirrors it into `findings.json` with `tools/gates/import-findings.mjs`, and the validator checks that the two match (D-018).

## Write scopes (mechanically enforced)

`tools/agents/guard-write.mjs` runs as a PreToolUse hook on Write/Edit for every project agent and enforces `tools/agents/write-scopes.json`:

- Reviewers write only review records and evidence.
- `qa-verifier` may also write tests under `tests/qa/**` and `e2e/**`.
  - **Before the candidate freezes:** test-first acceptance tests go there and become part of the candidate.
  - **During a review of a frozen candidate:** new tests go under `docs/delivery/test-evidence/<DGx>/qa/tests/`, so they don't alter the candidate. The orchestrator promotes them into `tests/qa/` in the next stage.
- Implementers cannot write gate rules, agent definitions, source documents, reviews, gate records or `stages.json`.

Bash is not path-guarded. Using Bash to write outside your scope is a protocol violation, and the orchestrator checks `git status` after every run. Reviewers who execute code must do so in a disposable copy: a temporary clone or worktree, or a throwaway database or container. Never do it in the candidate tree.

## Honesty rules

- Do not label planned features as delivered. Do not fabricate provenance, test results, run IDs, approvals, screenshots or evidence.
- Record demonstration data as synthetic.
- Do not claim PMI certification, official Mobily brand compliance or regulatory compliance.
- `#0078FF` is a provisional brand token, not a verified Mobily colour.

## Infrastructure: permission-classifier outages

Your shell runs in the permission mode `auto`. Sometimes the server-side classifier returns no verdict, and a command is refused with "classifier gave no verdict" or "Classifier unavailable". That's a transient infrastructure failure, not a judgement about your action.

- **Retry a refused command.** Retry up to 3 times, and keep working on non-shell parts of the task in between.
- **If you still can't run what the task needs, stop cleanly.** End your turn with a final message whose **first line is exactly** `CLASSIFIER-BLOCKED`, followed by what's done and what's pending. The runner then resumes the **same session** (same invocation reference) after a pause, up to 6 times, and you continue from where you stopped.
- **Never report a check as passed that didn't run.**
