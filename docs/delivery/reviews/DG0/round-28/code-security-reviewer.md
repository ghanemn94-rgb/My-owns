# DG0 round 28: code-security-reviewer narrative

**Candidate:** `sha256:1af91e8f620aec37c560b7adae0b74c8644a5983bb15d02044f312407e05571b`, source commit `331407e`. HEAD `57d7a53` is a metadata-only freeze commit that changes no candidate path. The clone is complete, not shallow.

**Verdict: PASS**, with one Low, non-mandatory finding (F-DG0-171).

## D-044 (F-DG0-250): commit-object requirement
I forged the fields with real annotated-tag objects (`git tag -a` followed by `git rev-parse <tag>`) in disposable `--no-local` clones:

| Probe | Baseline 49b5ad7 (pre-D-044) | Candidate 331407e |
|---|---|---|
| SEC28-1: `fix_revision` is a tag object that peels to the fix | accepted (0 errors) | rejected: "is a tag object, not a commit" |
| SEC28-4: `fix_revision` is a tag of a tag | accepted | rejected |
| SEC28-2: the verifying run's `head_commit_at_start` is a tag | accepted | rejected (review binding and closure binding) |
| SEC28-3: a non-verifying run's `head_commit_at_start` is a tag | accepted | rejected |
| SEC28-5: gate `source_commit` is a tag (D-037) | — | rejected |
| SEC28-6: tree, blob or uppercase `fix_revision` | — | rejected |
| SEC28-7: lightweight tag (resolves to the commit itself) | — | passes, no false positive |

On the candidate, every error each forgery produces is the D-044 object-type message. The standing controls still hold: SEC24–SEC27 produce the same pass/fail set as in round 27. SEC24-2 fails by design (since D-042); SEC26-2 replaces it.

On the real records:
- 118/118 `fix_revision` values are commit objects.
- Every retained `head_commit_at_start` is a commit object. The only exceptions are the 3 absent round-18 runs, the known D-034/D-035 orphan.
- The three anchors show 0 failures across 117 closures.
- Every history bucket in the dry run is 0, and there are no object-type errors.

## F-DG0-171 (Low, mandatory_violation false)
D-044 says it covers "every commit-id field the gate depends on", but a **review round's** `source_commit` has no commit-object rule:
- `findManifest` (rules.mjs:918) recomputes the manifest through a peeled tag.
- `checkReviewRounds` (rules.mjs:774-775) only compares that field with stages.json.
- Anchor 1 (rules.mjs:750-752) peels the tag as well.

This isn't a bypass:
- The freeze tool always writes `rev-parse HEAD`.
- The gate round is commit-typed through the gate.
- A tag only aliases the same commit.
- If the tag is deleted, the round becomes absent in a fresh clone, and anchor 1 then rejects its closures.

I concur with accepting it as an observation (see my verifications sidecar). The auditor must also concur. If the orchestrator fixes it instead, I'll re-verify.

## Other checks
- **Tests:** node 103/103 and Python 22/22 pass. prefreeze passes 11/11.
- **Candidate hash:** deterministic across the working tree, `--ref`, cwd, locale, TZ and umask.
- **Validator exit codes:** correct in every mode I ran.
- **CSV/JSON:** malformed input fails closed.
- **CI:** `contents: read`, SHA-pinned actions, `fetch-depth: 0`. No secrets found; the settings allow only `Bash(bwrap:*)`.
- **Sandbox:** live probes refuse every protected or other-role write. Residual 7 (`/proc/sys` is writable and host-global, F-DG0-149) and residual 8 (PID visibility only) are exactly as the threat model discloses.
- **Requirements:** all 19 DG0-final requirements are IMPLEMENTED, with existing evidence and passing tests in my own runs.

## Honesty notes
- **Probe side effect:** one of my ad-hoc probe commands created an empty top-level `package.json` on the sandbox's throwaway skeleton. That briefly changed the working-tree candidate ID. I removed it and recomputed the ID; see `candidate-and-scope.log`.
- **Wrong base commit:** my requirements script first compared `trading_agent/` against the root commit instead of the delivery base `f099f3d`. The correction is recorded in that log.
- **Round number mismatch:** `review-common.md` says "Review round: 23" but names the round-28 paths. I used round 28, which matches stages.json.
