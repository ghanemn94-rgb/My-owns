# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **DG0 is APPROVED** (gate `docs/delivery/gates/DG0.json`, candidate `sha256:84130c62…`, 19/19 DG0-final requirements; 29 review rounds). Carried intact onto this branch.
- **DG1 is APPROVED** (gate `docs/delivery/gates/DG1.json`, candidate `sha256:6e0c0db1…` (395 files, source `642e6bfb`), 12/12 DG1-final requirements). Round-4 gate round: 3× PASS (domain, code-security, qa) + release-auditor PASS on the same candidate; all 14 DG1 findings CLOSED_VERIFIED by non-authors; zero unresolved Critical/High; zero unresolved mandatory. `validate.mjs --stage DG1`, `--historical --stage DG1` and `--pipeline` all exit 0.
- **This branch (`claude/mobily-transformation-platform-regate`) is the clean DG1 re-gate.** The first DG1 drive ran 16 review rounds and reached an all-PASS round-16 gate, but the first complete `validate.mjs --stage DG1` exposed record-integrity debt that predated the frozen gate schema: the round-2 code-security record used the pre-schema `checks_run` shape, and two records re-listed earlier-raised findings without a local `.findings.json`. Those are write-once committed, so they can only be corrected by a history rewrite — which, starting from round 2, cascades new SHAs through every round and breaks all closure anchors. Per the user's decision (D-056 path C), DG1 was re-gated on a **clean base** (`85e5bbd`, the last commit before any DG1 review evidence): the final, fully-remediated P1 product + ADRs/ERD/OpenAPI/register/decisions were carried here and DG1 was reviewed in **4 clean gate rounds** with conformant tooling. The re-gate found and fixed genuine bugs: F-DG1-140/141 (Medium mandatory — BU re-parent cycle-under-concurrency via migration 0009 DB guard + advisory lock, and destination-parent authz), F-DG1-142 (rate-limit cookie bypass → token-hash/IP keying), and Low docs/deps/flaky-test/typecheck-coverage items.
- **The full 16-round development narrative is preserved** on branch `claude/mobily-transformation-platform-kwcc4i` and tag `dg1-dev-history-d1cb245`, and in `decisions.md` (D-001…D-058) and `docs/delivery/findings.json` on that branch. Nothing is lost; the clean branch carries a conformant gate record for the final artifact.
- **Next action:** begin **P2 / DG2 (Diagnose, define and design)**. DG2 is now unblocked (depends_on DG1, APPROVED). Run `node tools/gates/validate.mjs --historical --stage DG1` before starting DG2 implementation. REQ-DLV-042's online-registry installer effect is the disclosed environmental residual D-057 (covered by the offline acceptance suite), live GitHub-Actions CI is D-058, and keycloak pinning is D-049.

## DG1 scope (P1 — architecture and working foundation)

12 DG1-final requirements: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. The eight P1-active API modules (platform, audit, identity, access, organization, transformations, jobs, admin) are implemented and unit-tested; workflows/kpi/reporting are declared-but-reserved boundaries (D-047). Stack and conventions fixed by the P1 ADRs (`docs/architecture/adr/`).

## Unresolved blockers

None. DG0 and DG1 are both APPROVED on this branch and all validators exit 0. (The kwcc4i branch's `validate.mjs --stage DG1` reports the three documented historical write-once-record artifacts from D-056; this clean branch does not carry them.)
