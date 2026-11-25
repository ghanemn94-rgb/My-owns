# DG7 round 4: qa-verifier narrative (T-DG7-REV-QA-RG4)

Candidate `sha256:9d3d5f62c921eb8f07ffb323b57d500a04e0608cbea2ed1ab0ebddec7b625403` (3160 files), source commit `2fd69c3753ffb1f96aaf787f8526daa0bf59abe7`. The JSON record `qa-verifier.json` is authoritative. This file summarises it.

**Verdict: PASS.**

- The three findings I reported in round 3 are repaired on this candidate. I verified each one and closed it.
- I raise one new Low finding. It is a documentation drift and does not block the gate.
- Nothing is Critical, High or mandatory.

## Verifications (as the reporter)

| Finding | Result | Why |
| --- | --- | --- |
| F-DG7-1081 | PASS, CLOSED_VERIFIED | My round-3 reproduction now passes. My new test also passes 6/6. It runs the three Compose steps as separate processes, each with its own `TMPDIR`. The config list is exact and no phase writes to stderr. A `config/` file that changes between phases is refused, and so is a tampered listing. The orchestrator's Compose run rg4c step C5 is clean. |
| F-DG7-1082 | PASS, CLOSED_VERIFIED | `restore.sh` now gives restored evidence to the evidence root's owner, with modes `0700`/`0600`. R7 checks the owner and the modes, and `backup-restore.md` §5 documents the rule. An owner that cannot be set fails as R7 with exit 1, and a malformed `--evidence-owner` is refused with exit 2. Compose run rg4c moved 2 real evidence objects and 1 queued job. The API's uid 10001, with no capabilities, read every restored object back with the same SHA-256. I judged rg4c from its logs and did not re-run it, because this sandbox has no Docker daemon. |
| F-DG7-1083 | PASS, CLOSED_VERIFIED | ADR-0066 Amendment 2 records the DO-D13 changes: the `/mth/deploy` layout, `DAC_READ_SEARCH` and `DATABASE_URL_FILE`. It also answers DO-D13 Q2. D-285 exists. |

## New finding

**F-DG7-1111 (Low, solution-architect).** ADR-0066 has no amendment for DO-D14.

- The §7 R7 row does not state the ownership rule.
- A2.7 still describes DO-D14 as "not built" and as "open findings".
- Residual 9 still says the evidence and job legs "moved zero items".
- The SA-ADR73 handback disclosed this lag and asked for an Amendment 3. D-285 does not record that request.
- Guide §8 also does not record the rg4c run.

This is documentation drift with no behavioural effect.

## Everything else on this candidate

**Gate checks**

- Validators: the historical runs DG6…DG0, the pipeline and the register checks pass.
- `--stage DG7` fails only because the gate record does not exist yet.

**Build and tests**

- Build and static checks pass. My first lint run failed because of my own temporary test copy; the re-run passes.
- Unit tests, in both locales: three files failed.
  - Two of them hit the 5 s timeout at host load 15–22.
  - The third failed because my sparse clone lacked one input directory.
  - All three pass alone, 3 runs out of 3.
- Integration: 4696 tests pass, the same counts as round 3.
- e2e, in English (LTR) and Arabic (RTL):
  - Product: 572 passed. The 2 demo-only skips pass on the demo stack.
  - Root acceptance: 288 passed. The 18 axe skips are by design, and the connection log shows only loopback destinations.
  - Demo: 10 passed.
  - Offline drill: 10 of 10 spec runs passed.

**Drills**

- A18, on one archive: verify 7/7, transfer drill D0–D11 and the harness 10/10. My first launch was my own path error.
- A19, container-free: R1–R9 pass, and R7 now carries the owner fields.
- A06, A26, the A27 re-drill and dictionary/init all pass.

**Tool tests**

- The release-tool batch has 6 T-H4 failures, caused by my sparse clone. They pass when the protocol-audit report directory is added.
- The transfer-drill test T-B17 failed once under load: one extra automation execution landed after measurement. The tool fails closed in that case, and the test passes alone 2/2.

**Release checks**

- Secret scans pass.
- Handover checks pass. `known-limitations.md` is bound to the rg3 protocol-audit report: it fails `--check` against the rg4 report, which differs only in the header.
- My protocol audit is identical to the orchestrator's: 279 hits, all disclosed.

## Not re-run by me

- The container and Compose halves (D-267, rg4/rg4b/rg4c) were judged from the orchestrator's logs.
- Live CI and the live registry were not run. They are environmental residuals.

## Run disclosures

- The domain and code-security reviewers' runs were auto-committed during my run.
- By 11:05Z the main working tree also held uncommitted repair work by others (DO-D15, SA-ADR74).
- I read none of it. My clones were pinned to `2fd69c375`.

## Approvals

No business, Finance or IT approval is claimed. Product G6 never implies DG7.
