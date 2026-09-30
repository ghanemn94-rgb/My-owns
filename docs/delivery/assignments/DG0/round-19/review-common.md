# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:6720ad2c5ea1d5bddb27a430536d27a962ded8224a373db101891e81d652922a`, source commit `0a652018bdf4975f83e580796d0775141a3dae9a`. The manifest is `docs/delivery/candidates/DG0/6720ad2c5ea1d5bd.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `19`. Write your record to `docs/delivery/reviews/DG0/round-19/<your-role>.json`.
- **Implementation authors of the reviewed scope:** `transformation-analyst` (analysis, register, coverage, glossary, field inventory, journeys, permissions, acceptance map, stage plan) and `delivery-orchestrator` (agent definitions, runner, write guard, gate tooling and schemas, CI workflow, source extraction scripts, delivery records). Put both in `implementation_author`. Neither is you.

## DG0 approval conditions (master prompt §21, row P0)
> **Outputs:** full source extraction, field/template inventory, glossary, requirement IDs, user journeys, stage plan, agent definitions, gate schema/validator and assumptions.
> **Evidence required before approval:** all source items accounted for; the ten definitions validated and the required stage agents actually invoked; the review protocol and gate validator reject missing/invalid evidence; no invented source requirements.

Early-stage rule (§0.2): check the actual specifications, contracts, agent setup and feasibility. Don't claim that future runtime features have already passed tests. The product requirements (all areas other than DLV) are only required to be completely and correctly **SPECIFIED** at DG0.

## What's in the candidate (a map, not a claim of correctness)

**Sources**
- `docs/source/`: the playbook docx, `playbook.md` and `playbook.blocks.json` (B0001–B0165), the master prompt with its anchored blocks (M0001–M0423), and the extraction scripts in `tools/source/`.

**Analysis**
- `docs/analysis/`:
  - `source-coverage.csv` and `master-prompt-coverage.csv`;
  - `glossary.md`, `field-inventory.md`, `permissions-matrix.md`, `user-journeys.md`;
  - `acceptance-map.md`, `stage-plan.md`;
  - `parts/`: the analyst part files merged into the register.
- `docs/delivery/requirements.csv` (the register) and `docs/delivery/requirements-spec.md` (its rules).

**Agents and tooling**
- `.claude/agents/*.md` (ten definitions); `tools/agents/` (runner, write guard and scopes, per-role settings, guard tests); `docs/delivery/agents.md` (the invocation mechanism and load-check evidence).
- `tools/gates/`: validator, candidate hashing, schemas, findings import, self-tests. Also `.github/workflows/delivery-gates.yml`.

**Delivery records**
- `docs/delivery/{environment,decisions,agent-protocol}.md` and `CLAUDE.md`.

**Excluded from the candidate by design (delivery metadata, decision D-005)**
- `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md`, `stages.json`. You may still inspect them as evidence; for example, `docs/delivery/runs/DG0/*/meta.json` and `transcript.jsonl.gz` are the invocation evidence.

## Findings and output format
- Put findings in `docs/delivery/reviews/DG0/round-19/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-19/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-19 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-132`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 19 specifics (re-review after the round-18 repairs)

- **The candidate changed after round 18.** Review the new frozen candidate in full. Use `git diff 701870e913335957143b61fb200e01c4265802c4..0a652018bdf4975f83e580796d0775141a3dae9a` to see everything that changed since the round-18 candidate baseline (`701870e913335957143b61fb200e01c4265802c4`, "DG0: mark F-DG0-150/151 fixed"); it includes the D-033/D-034/D-035 changes below.
- **Verify your own earlier findings independently.** Each finding you raised is in `docs/delivery/findings.json` with its `fix_revision`/`fix_summary`. Reproduce the original failure against the pre-fix commit where possible, then show whether it is fixed. Record each in `docs/delivery/reviews/DG0/round-19/<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|ACCEPTED_OBSERVATION|OPEN", "note", "evidence": []}]}`. Use `CLOSED_VERIFIED` only if the fix is complete. You may only verify findings **you** reported.
- **New findings** continue in your ID block: domain-reviewer from `F-DG0-013`; code-security-reviewer from `F-DG0-154`; qa-verifier from `F-DG0-240`. Every finding must have `stage_id` `DG0`.
- **Rule changes since round 1.** The validator binds each review to its run. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt. If the classifier returns no verdict, wait and retry; the runner resumes automatically. Record anything you ultimately couldn't run as BLOCKED.
- **Round-19 rules (read `docs/delivery/decisions.md` D-016 to D-035 and `docs/delivery/threat-model.md`). The three changes since round 18 are D-033, D-034, D-035:**
  - **D-033 (F-DG0-152, High, mandatory): a per-run Landlock domain.** Each agent run now enters its own scope-only Landlock domain (`tools/agents/landlock_exec.py`, applied after `setpriv`, before `claude` execs; `handled_access_fs=0`, `handled_access_net=0`, `scoped=SIGNAL|ABSTRACT_UNIX_SOCKET`, ABI >= 6). Being in any non-empty Landlock domain restricts ptrace to that domain and its descendants; every run enters its OWN domain, so two concurrent runs are siblings and the kernel refuses one run's `/proc/<peer-pid>/root|cwd` access and its signals to the other, while the empty access masks leave the run's own areas and its nested bwrap working. `sandbox.json` records a `landlock` block (`scoped:["SIGNAL","ABSTRACT_UNIX_SOCKET"], handled_access_fs:0, handled_access_net:0, per_run_domain:true`); `tools/gates/lib/rules.mjs` requires it on every gate review/audit record. **code-security: verify F-DG0-152** — the finding's own reproduction (`docs/delivery/test-evidence/DG0/code-security/round-18/r18-proc-peer-root-repro.mjs`, log `03-...`) and the mitigation spike (`r18-landlock-spike.mjs`, log `04-...`) are the reference; the unit test `tools/agents/tests/process-sandbox.test.mjs` "F-DG0-152 …" has a positive control (cross-run write and signal succeed WITHOUT the domain, refused WITH it, own areas writable, nested bwrap still works). **F-DG0-153** (threat-model "Mechanically prevented" row-1 wording) is fixed in the same change.
  - **D-034: write-once history was repaired.** Round 17's outcome commit had DELETED the round-17 `qa-verifier.findings.json` and `qa-verifier.verifications.json` that its own auto-commit had committed — a delete under `reviews/DG0/**`, which `checkWriteOnce` forbids and which would have blocked this gate. The linear range was rewritten with `git filter-branch` to **re-add** those two files at their original blobs to every commit (evidence restored, nothing lost), and `import-findings.mjs` was hardened to **skip** an interrupted run's record-less verifications instead of throwing (that throw is what drove the round-17 mistake). **code-security and the auditor: verify the history is sound.** In a fresh clone: `node -e "import('./tools/gates/lib/rules.mjs').then(m=>{const e=[];m.checkWriteOnce(process.cwd(),'DG0',e);console.log(e.length,e)})"` reports **0** errors; `git ls-tree HEAD docs/delivery/reviews/DG0/round-17/` shows both `qa-verifier.*` files at blobs `862693f…` and `276e32c…`; no other file under `reviews/`, `runs/` or `candidates/` was modified or deleted. A local backup ref `backup/pre-writeonce-repair-565ab3f` exists.
  - **D-035: the validator tolerates a pruned historical `source_commit`.** This branch's pre-round-12 history was truncated in an earlier session (earliest commit is "DG0 round 12 …"; 91 commits total), so the `source_commit`s of rounds 1–12 no longer exist, and round 18's was rewritten by D-034. `findManifest` now tolerates a **genuinely missing** `source_commit` (`git cat-file -e <sha>^{commit}` fails) while KEEPING: the manifest entries self-consistently hashing to its `candidate_id`, the manifest matching the review-round record, and the GATE candidate recomputed independently from the retained `gate.source_commit` (`checkCandidate`, unchanged). A reachable-but-mismatched commit still errors. **Assess whether this is an acceptable loosening of a redundant check on non-gate rounds; if you judge it weakens gate integrity, raise a finding.**
  - The D-030/D-031/D-032 process sandbox is otherwise unchanged: read-only root, host-bind procfs, **shared host PID namespace**, **private IPC namespace** (`--unshare-ipc`), only `CAP_SETFCAP`, `no_new_privs`, **plus the per-run Landlock domain (D-033)**. You write only your own areas (shell or file tools); review/gate/register writes are staged and copied back for your own files only; `sandbox.json` records `procfs: host-bind`, `unshare: ["ipc"]`, and the `landlock` block.
  - **Your shell** has no network; make disposable copies with `git clone <repo> "$TMPDIR/<name>"`. Nested bubblewrap works, so `tools/gates/sandbox-run.sh`, the process-sandbox tests and `tools/gates/prefreeze.sh` run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Verify your `FIXED_PENDING_VERIFICATION` findings and act on your observations:**
    - code-security-reviewer verifies **F-DG0-152** (D-033) and **F-DG0-153**, confirms **F-DG0-150/151** stay CLOSED and D-031/F-DG0-148 (`--unshare-ipc`) still hold, and re-accepts **F-DG0-147** as an observation if you still agree.
    - **F-DG0-149 (residual 7 — read-write host `/proc`, uid-0-writable `/proc/sys`): assess it READ-ONLY** exactly as in round 18. Do **not** perform an actual `/proc/sys` write. Assess from the mount configuration (`sandbox.json`/`agent_sandbox.py`), the capability set (uid 0, `CapEff` = `CAP_SETFCAP` only, `no_new_privs`), `test -w` mode-bit reads, and the write guard's fail-closed block of any path resolving through `/proc`, `/sys` or `/dev`. Note that D-033's Landlock domain does not change this own-run residual (`handled_access_fs=0`) but it does close the cross-run amplification. If you agree it is a Low, non-mandatory, disclosed residual, record `{"finding_id":"F-DG0-149","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` (the auditor must concur); if larger than disclosed, keep it OPEN with `result: FAIL`.
    - qa-verifier verifies **F-DG0-236** and **F-DG0-237** (its round-18 verification was lost to the account session limit) and **F-DG0-239** (`docs/delivery/agents.md` wording).
    - domain-reviewer has no finding pending verification. F-DG0-145 (High), 146 and 148 are already CLOSED_VERIFIED and need no re-verification.
  - **Evidence entries** must be existing repository files, optionally with `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
