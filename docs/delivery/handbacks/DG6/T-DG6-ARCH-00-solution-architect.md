# Handback T-DG6-ARCH-00 (solution-architect): P6 architecture plan

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-00.md`. Its SHA-256 `219db28ca33e90602c5cf2d986ca812b29301a22ec37b509e66f9aa7fa66e1ad` was verified with `sha256sum` before work started.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-00-solution-architect-20261026T134043Z-7827e3ce","session_id":"7827e3ce-ef0d-46fd-9c31-e36d7b544edb"}`.
- **Base:** `HEAD` = `8480971a28373e0841d889794cfacde99d347987` on `claude/mobily-transformation-platform-dg5-regate2`. At the start, `git status` showed no tracked change. It showed untracked top-level sandbox dotfiles (`.bashrc`, `.mcp.json`, etc.) and `docs/delivery/runs/DG6/`, which are not mine and which I did not touch.
- **Time:** `date -u` gave `Mon Oct 26 13:49:50 UTC 2026` at the start and `Mon Oct 26 14:03:01 UTC 2026` just before this handback was written. The final check commands follow, so the total is under 20 minutes by the shell clock, well inside the 2-hour bound.

## 1. Changed files

| File                                                                    | Purpose                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/p6-plan.md` (new)                                    | The P6 plan, in the order the assignment asks:<br>§1 inventory with per-row P1–P5 status, check table and the K carry-forward table;<br>§2 dependencies and critical path;<br>§3 26 DG1–DG5 seams;<br>§4 six ARCH tasks;<br>§5 implementer tasks, waves and shared files;<br>§6 open questions, risks and later-stage rows. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-00-evidence/check-inventory.py` (new) | Checks the plan's §1.2 against the register. It confirms all 48 DG6 ids map to exactly one slice, with no duplicate, missing or extra id. It also confirms that the §1.3 per-slice counts, the total of 48 and the status totals equal what §1.2 says. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-00-solution-architect.md` (new) | This handback.                                                                                                                                                                                          |

There are no ADRs, migrations, contract operations or source changes, as the assignment requires (plan only).

## 2. Summary of the plan (behaviour delivered = the plan)

- **Slices (12, letters A–L):**
  - A Imports and webhooks (2);
  - B Connectors, outbound writes and external-change confirmation (5);
  - C Identity, storage and notification channels (3);
  - D Optional AI assistant (5);
  - E Authorization boundary (5);
  - F Request, input and integrity hardening (5);
  - G Performance and async exports (2);
  - H Search, tables and productivity (4);
  - I UX, accessibility and bilingual (6);
  - J Operational monitoring and service identities (2);
  - K DG5 carry-forward (0 rows; F-DG5-120, 121, 125, 145, 146, 150, 151);
  - L Acceptance and P6 evidence (9).

  The total is **48**.
- **Status against P1–P5:** 0 met, 35 partly met (each names the missing piece and the existing evidence path), and 13 new (S17-001/002/003/005/006/007/008/009/011, S01-005, S20-017, S20-029, DLV-038).
- **Order:** E first: a single `ReadScope` port derived from the ADR-0006 policy. Search (H), the assistant (D), exports and the job service identities (J) all read through it.
  - Critical path: E → J → B → A → L(A17), in parallel with E → H → D → L(A12/A21).
  - Both paths join at G (the load run) and QA-E.
- **ARCH tasks:**

  | Task | Slices | ADRs | Migrations |
  | --- | --- | --- | --- |
  | ARCH-01 | E+F | ADR-0051/0052 | 0098–0103 |
  | ARCH-02 | J+C | ADR-0053/0054 | 0104–0108 |
  | ARCH-03 | B+A | ADR-0055/0056 | 0109–0115 |
  | ARCH-04 | H+G | ADR-0057/0058 | 0116–0121 |
  | ARCH-05 | D | ADR-0059 (0060 reserved) | 0122–0125 |
  | ARCH-06 | I+K | ADR-0061 (0062 reserved) | 0126–0127 |

  - `0128`–`0133` are held for orchestrator repairs.
  - Lock blocks run from 730300 to 730327, and 730328–730339 are held by the orchestrator.
  - The estimate is about 91–93 new operations, giving OpenAPI 1.5.0-p6 at about 937–939 operations.
- **Implementers:** 37 runs (21 backend-workflow, 2 kpi-benefits, 7 devops, 7 frontend-ux), 5 qa-verifier runs and the analyst, in 14 waves of at most 4 runs (D-004). File ownership does not overlap. Sequential "after X" edits are named for `evidence/routes.ts`, `integrations/routes.ts`, `apps/worker/src/kit.ts` and `server.ts`.
- **Reopen candidates the orchestrator must decide before the affected implementer starts (§3, R7):**
  - the DG2 upload allow-list (row 3, Q4);
  - inbox title redaction in DG4 responses (row 6);
  - sensitive values in DG4 totals (row 2, Q3);
  - DG5 branding publish refused below the contrast threshold (row 18);
  - a possible DG5 bulk per-record result (row 15);
  - a fifteenth navigation area (row 19, Q1). The plan recommends against it.
- **Open questions:** Q1–Q14 in §6, each quoting its source. These are the main ones:
  - Q2: short-lived links vs ADR-0010's "never pre-signed";
  - Q5: Keycloak image source (D-049);
  - Q6/Q7: S3 test store and SMTP library, both needing a registry;
  - Q8: what counts as the "network capture";
  - Q9: load-run sessions, infrastructure and the severity of a p95 miss;
  - Q10: offline dependency audit.

## 3. Checks actually run

All ran in `/home/user/My-owns`, with Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin` on `PATH`), offline, in the per-command sandbox.

| #   | Command                                                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node tools/gates/validate.mjs --historical --stage DG5` (at the start, before writing anything)           | `PASS gate DG5 (historical)`, **exit 0**                                                                                                                                                                                                                                                                                                                                                     |
| 2   | `python3 docs/delivery/handbacks/DG6/T-DG6-ARCH-00-evidence/check-inventory.py`                            | The **first run exited 1**: `status totals MISMATCH`. The plan's sentence said "Partly 30, New 18", but the table says 35/13. I corrected the sentence and re-ran. Second run: `A 2 B 5 C 3 D 5 E 5 F 5 G 2 H 4 I 6 J 2 K 0 L 9`, `status {'New': 13, 'Partly': 35}`, `total 48 register 48 duplicates [] missing [] extra []`, `check table matches`, `status totals match`, `PASS`, **exit 0** |
| 3   | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (end of task)   | See §3.1                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | `node tools/gates/validate.mjs --historical --stage DG5` (end of task)                                     | See §3.1                                                                                                                                                                                                                                                                                                                                                                                      |

### 3.1 Final checks

- **Prettier (check 3).** I first ran `npx prettier --write` on my three new files. Then I ran the acceptance command over the whole tracked and untracked file set; `xargs` split it into two batches.
  - Both batches printed `Checking formatting... All matched files use Prettier code style!`. Overall **exit 0**.
  - npm printed three warnings ("Unknown project config strict-peer-dependencies / auto-install-peers / link-workspace-packages"). These are warnings only, not failures.
- **Validator (check 4).** `node tools/gates/validate.mjs --historical --stage DG5` at 14:06:30 UTC printed `PASS gate DG5 (historical)`, **exit 0**.
- **Inventory script (check 2).** Re-run after the Prettier write: `PASS`, exit 0.
- **Afterwards.** This section was then edited with the Edit tool, and the Prettier check was re-run on this file only. The result is in the final message of this run.

## 4. Known gaps / not done

- **Inventory statuses were found by reading the tree and grepping** (file paths are named per row), not by running the P1–P5 suites. A "partly met" row's existing part is asserted from code and tests present at `8480971`, not re-executed here. The ARCH tasks and QA re-runs prove them.
- **Three readings are inferences** that the slice ARCH tasks must confirm:
  - whether P5 bulk edit already returns per-record results (§3 row 15);
  - whether a benefit realized-value explanation panel exists (S15-014; I found KPI and weighted-score explanations only);
  - whether the rate limiter covers routes beyond identity (the `@fastify/rate-limit` registration exists; its route matrix was not read in full).
- **Dependency versions and licences are not verified** (offline). The plan names candidates (`@aws-sdk/client-s3`, an SMTP library, a Keycloak image on Docker Hub, SeaweedFS) only as things the ARCH tasks must verify. The Docker Hub Keycloak publication is marked [UNVERIFIED].
- **Not done by design:** ADR bodies, migrations, contract operations, `p6-work-split.md`. Those are the ARCH-01…06 tasks.

## 5. Merge instructions

- Documentation only: no migrations to run and no ordering constraints.
- Two new files under `docs/architecture/` and `docs/delivery/handbacks/DG6/`. No conflicts are expected.
- The orchestrator should decide Q1–Q4 and the §3 reopen candidates before ARCH-01 starts, because ARCH-01 (W1) writes the ADRs for rows 2, 3 and 6.
