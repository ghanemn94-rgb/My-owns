# DG0 round 13: qa-verifier narrative

- **Candidate:** `sha256:c3364ac2f1c27b37bdaef6c07196d25b13016e94703449b9ff87524ff18afb79`, commit `6c61f2e`.
  - I confirmed it from the working tree (HEAD `a733aaf`; only metadata commits follow the freeze), from `--ref 6c61f2e` and from `--diff`.
- **Run:** `DG0-T-DG0-REV-QA-R13-qa-verifier-20260928T215437Z-64831320`.
- **Verdict:** FAIL, on Low items only. There are no Critical, High or Medium findings in the QA scope.

## What passed

1. **Required commands.** Run in a disposable clone of `6c61f2e`, all exit 0 (log 01):
   - extraction;
   - gate tests 48/48 (4 of them sandbox tests);
   - agent tests 21/21;
   - Python 14 tests;
   - register, pipeline and candidate.
   - Reconcile and pipeline also pass at HEAD, where frozen equals the working tree (log 01b).
2. **Pre-freeze.** In a fresh clone: 10/10 PASS, every candidate-executing check sandboxed (log 02).
3. **A24/A25.** QA13-REG passes 94/94. It is the round-9 suite, adapted to D-026 run evidence. Every negative the assignment lists is rejected against an accepted control:
   - missing reviewer, author as reviewer, shared invocation;
   - failed, blocked or gate-test check;
   - unresolved High finding, incomplete requirement;
   - non-existent anchor, SOURCE row without a playbook block;
   - coverage matrix missing a block, or mapped to a non-citing requirement;
   - change after freeze, tampered manifest;
   - metadata invariance.
4. **13 new independent cases**, none of them in `tools/*/tests`, all pass:
   - V1 to V4: exact-cwd deny list, `docs/source` required, missing cwd, non-normalised entries.
   - S1 to S7: `sandbox-run.sh` runs committed HEAD only, drops a hostile environment, runs no source hooks, rejects bad revisions, writes neither `.git` nor HOME. Prefreeze never executes a planted `.pyc` and catches uncommitted drift.
   - R3: stub rule, both directions.
   - C1: metadata invariance; a `tests/qa` file or a mode change alters the candidate.
5. **Register integrity** (my own parser): 411 rows, 0 VERIFIED, 19 DG0 rows IMPLEMENTED with existing evidence, all 28 scenarios referenced, both coverage matrices exactly complete, 0 errors. I opened the evidence for the 7 changed DLV rows and exercised it.
6. **Agent setup.**
   - Load evidence: 10 runs, 10 distinct sessions, all `claude-opus-5-5`, 10/10 blocked out-of-scope writes. The `agents.md` table matches the raw evidence.
   - Live in this session: the Write tool on `docs/source/QA-PROBE.txt` was blocked by the guard, and 6/6 shell writes to protected paths were refused by the OS sandbox.
7. **Feasibility:** all 28 scenarios have a level, a stage and a gate.

## Verifications

- **CLOSED_VERIFIED:** F-DG0-226, 227, 228, 229, 230 and 232.
  - For 226, 227, 228, 229 and 230, I reproduced the original failure on the old commit and showed it fixed on the candidate.
  - F-DG0-229 reproduced on `7f09967`: planted bytecode ran during prefreeze and wrote `.git/hooks/post-commit` with orchestrator rights. On the candidate it is inert.
- **F-DG0-231 stays OPEN (Low):**
  - `agents.md` line 28 still says `--setting-sources project,local`.
  - The three reviewer agent definitions still prescribe `git worktree add /tmp/review-<id>`, which fails in the sandbox.

## New findings (Low, non-mandatory; I'd accept each as an observation)

- **F-DG0-233:** `meta.cwd` isn't cross-checked against the transcript's init `cwd` or the replayed prompt. A forged `meta.cwd` plus a matching foreign-root deny list still binds. It needs forged run evidence (threat-model residual 1).
- **F-DG0-234:** the configuration scan keeps only added lines, so removals are never reported. The D-026 stub rule turns "truncate an ignored configuration file to zero" into such a removal. The round-12 runner reported it (exit 71); the candidate does not.
  - My judgement on the assignment's question: the stub rule cannot hide added or altered configuration with content, only the removal of content.
  - Only processes outside the sandbox can do this, and local settings aren't loaded, so the impact is minimal (see `17-stub-rule-judgement.md`).

## Why FAIL and not PASS

Two checks failed, and the protocol allows PASS only when every check passed:
- QA13-K06: residual probes V5, R1b and R2.
- QA13-K16: residual F-DG0-231 drift.

The gate validator would also reject a gate carrying a failed check. The fixes are small:
- bind `meta.cwd` to the transcript init line;
- report `'^<'` lines, or disclose the limit;
- correct `agents.md:28` and the three agent definitions.

Alternatively, the orchestrator may route the three Low findings to ACCEPTED_OBSERVATION with the release-auditor.

## Environment notes

- Everything ran in disposable clones under `$TMPDIR` (the agent sandbox has no network; `/tmp` is read-only).
- My older suites (r2 to r11) aren't hermetic. On this host, global git config forces commit signing through a network service, so they need `GIT_CONFIG_GLOBAL=/dev/null`. That was a harness artefact, recorded in the logs.
- Observation for the security reviewer, not tested: `sandbox-run.sh` creates its work directory under `/tmp/claude-0`, which is the agents' own `$TMPDIR`. Its name is random (`mktemp`), but a still-running agent process could in principle race the clone before `bwrap` starts. Doing so could forge check results, but not escape the read-only root. I could not establish whether agent background processes outlive a run, so I haven't raised this as a finding.
