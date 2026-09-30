# DG0 round 26 — code-security-reviewer

**Candidate:** `sha256:7ac7119044c899d4fa7363cb43d209173095d06b37eed75697532b092b7236df` (source `7edacdc`). The HEAD during the run was `2f480e4`, a freeze and assignments commit that touches only metadata. The repository is not shallow.
**Verdict:** **PASS**, with one Low, non-mandatory observation (F-DG0-170).

## D-042 (anchor 1 unconditional): verified
- `tools/gates/lib/rules.mjs:746-749`: a CLOSED_VERIFIED closure verified in a round whose `source_commit` does not resolve is now **rejected** ("… is not present; a closure must be verified against a retained candidate (F-DG0-169)"). It is no longer skipped. Anchor 2 (the verifying run's head) and anchor 3 (the gate candidate) are unchanged. Anchor 2's guard only compares a well-formed, present head, but `checkInvocation` has already hard-errored in every other case.
- **Reproduced, then shown fixed** (`run-sec26-repro.sh` on `--no-local` clones). My round-25 case (SEC25-3/SEC26-1) gives 0 errors at `2386a0f` and is rejected at `7edacdc`.
- **Mutation:** the new unit test "D-042 / F-DG0-169" fails on the pre-D-042 `rules.mjs` and passes on the candidate.
- **No regression:** all 115 real closures have a present round `source_commit`, and 0 fail any anchor. The dry run reports 0 closure or anchor errors.
- **No new gap:**
  - The only surviving absence tolerance, `findManifest`/D-035, still validates a superseded round's manifest when that round is not the verifying round (SEC26-3, 0 errors). It can no longer carry a verification (SEC26-2).
  - F-DG0-164/165/166/168/246/249 still hold (SEC24-1…6, SEC25-1/2/4).
  - SEC24-2 now fails, by design: it asserted the pre-D-042 acceptance of a closure verified in an absent-source round.

## Findings
| ID | Severity | Mandatory | Summary |
|---|---|---|---|
| F-DG0-169 | Low | no | **CLOSED_VERIFIED** (fix `7be8e55`) |
| F-DG0-170 | Low | no | NEW. The `commitPresent()` header comment at `rules.mjs:603-605` still says anchor 1 applies "when it resolves", which contradicts the D-042 code and the updated `checkClosure` comment. Documentation only; the same class as F-DG0-167. |

## Other scope
- **Test suites:** node 102/102, Python 22/22. The pre-freeze passes in a fresh `--no-local` clone.
- **Unchanged since 2386a0f:** tools/agents, .claude and .github.
- **Sandbox probes:** protected paths are read-only from my shell and there is no network. Residual 7 (`/proc/sys` writable; probed with access(2) only, no write) and residual 8 (PIDs visible, `/proc/1/root` denied) are exactly as disclosed.
- **Secrets and CDNs:** none found. `.claude/settings.json` allows only `Bash(bwrap:*)`.
- **CI:** `contents: read`, SHA-pinned actions, `fetch-depth: 0`.
- **Candidate hash:** deterministic.
- **Requirements:** all 19 DG0-final requirements are IMPLEMENTED with existing evidence.
- **Assignment inconsistency:** `review-common.md` says "Review round: `23`". The header, the paths and `stages.json` all say 26, so I used 26.
