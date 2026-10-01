# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **DG0 is APPROVED** (gate `docs/delivery/gates/DG0.json`, candidate `sha256:84130c62…`, 19/19 DG0-final requirements; 29 review rounds). Carried intact onto this branch.
- **This branch (`claude/mobily-transformation-platform-regate`) is the clean DG1 re-gate.** The first DG1 drive ran 16 review rounds and reached an all-PASS round-16 gate, but the first complete `validate.mjs --stage DG1` exposed record-integrity debt that predated the frozen gate schema: the round-2 code-security record used the pre-schema `checks_run` shape, and two records re-listed earlier-raised findings without a local `.findings.json`. Those are write-once committed, so they can only be corrected by a history rewrite — which, starting from round 2, cascades new SHAs through every round and breaks all closure anchors. Per the user's decision (D-056 path C), DG1 is re-gated on a **clean base** (`85e5bbd`, the last commit before any DG1 review evidence): the final, fully-remediated P1 product + ADRs/ERD/OpenAPI/register/decisions are carried here, and DG1 is reviewed in **one clean gate round** with conformant tooling so `validate.mjs --stage DG1`, `--historical` and `--pipeline` all exit 0.
- **The full 16-round development narrative is preserved** on branch `claude/mobily-transformation-platform-kwcc4i` and tag `dg1-dev-history-d1cb245`, and in `decisions.md` (D-001…D-057) and `docs/delivery/findings.json` on that branch. Nothing is lost; the clean branch simply carries a conformant gate record for the final artifact.
- **DG1 state:** BUILDING (final product integrated). **Next action:** freeze the DG1 candidate → run the three independent reviews (domain, code-security, QA) + release audit on the final candidate → APPROVED. REQ-DLV-042's online-registry installer effect is the disclosed environmental residual D-057 (covered by the offline acceptance suite), as keycloak is D-049.

## DG1 scope (P1 — architecture and working foundation)

12 DG1-final requirements: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`. The eight P1-active API modules (platform, audit, identity, access, organization, transformations, jobs, admin) are implemented and unit-tested; workflows/kpi/reporting are declared-but-reserved boundaries (D-047). Stack and conventions fixed by the P1 ADRs (`docs/architecture/adr/`).

## Unresolved blockers

None on this branch. (The kwcc4i branch's `validate.mjs --stage DG1` reports the three documented historical write-once-record artifacts from D-056; this clean branch does not carry them.)
