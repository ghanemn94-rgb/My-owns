# Handback T-DG6-ARCH-11 (solution-architect): ADR amendments for D-207 (asynchronous live-export assembly)

- **Stage:** P6 / DG6 (FIXING after review round 1). **Task:** T-DG6-ARCH-11. **Finding:** F-DG6-147. **Decision:** D-207, read verbatim.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-ARCH-11-solution-architect-20261101T230117Z-114368f1","session_id":"114368f1-f2c5-4088-a8ca-c3882dca88b2"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-ARCH-11.md`. Its SHA-256 was verified as `184e24f3…6bac6` before reading. Git shows the file as modified in the working tree; that change is the orchestrator's, not mine.
- **Tree:** main checkout `/home/user/My-owns`, `HEAD` `8268ac5a66e25c986b1c13c86f5e931b9c792a32` (branch `claude/mobily-transformation-platform-dg5-regate2`). The task changes documents only, so there is no worktree.
- **Time:** started `Sun Nov 1 23:01:42 UTC 2026`. Ended `Sun Nov 1 23:21:01 UTC 2026`.
- **Changes are uncommitted**, as the assignment requires.

## Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0046-p5-exporters-pdf-docx-xlsx-pptx-csv-fonts-rtl-injection-export-jobs.md` | New dated amendment "2026-11-01, T-DG6-ARCH-11; D-207, F-DG6-147", sections H1–H6, amending §2, §5 and §6. |
| `docs/architecture/adr/ADR-0058-p6-performance-load-dataset-workload-p95-index-plan-async-export.md` | New dated amendment T2, amending §7: the 2 s start, the amended proof assertions and the re-measurement. |
| `docs/architecture/data-dictionary.md` | New section "P6 round-1 repair migration 0124 (DG6)": the nullable `snapshot_id`, the `live_selection` column, two CHECKs, the partial index, the replaced `export_job_guard()` and the validation layers. |
| `docs/architecture/erd.md` | New §1ab: the relationship becomes `report_snapshot \|o--o{ export_job`, plus an entity-register row. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-11-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-11-evidence/validate-dg5-historical.log`, `prettier-check.log` | Check logs. |

All four document edits only add text. No earlier text was removed or rewritten (`git diff --stat`: 143 insertions, 0 deletions before this handback). `docs/api/openapi.yaml` was **not** edited, because BE-Y5 owns it.

## Behaviour delivered (documents only)

How D-207 is recorded:

| D-207 item | Where |
| --- | --- |
| (1) synchronous validate, authorize and restricted-source check; D-199's 403 unchanged; job, progress and audit written; 202 with no snapshot | ADR-0046 H2; ADR-0058 T2 |
| (2) durable API-process snapshot watch, `FOR UPDATE SKIP LOCKED`, access re-check, then the snapshot, then the `export_job.requested` outbox event; access lost → failed job with an `errorCode` and en/ar text, no file | ADR-0046 H3 and H6 |
| (3) `ExportJob.snapshotId` nullable until assigned; idempotent replay compares the stored selection | ADR-0046 H2 (replay) and H5; data dictionary (`live_selection`, API layer) |
| (4) migration 0124: snapshot nullable while pending, selection column, CHECK; seed free-id example moves to 0125 | ADR-0046 H4; data dictionary "P6 round-1 repair migration 0124"; ERD §1ab |
| (5) exports of an existing snapshot unchanged; data-as-of is the assembly time, on the snapshot | ADR-0046 H1; ADR-0058 T2 "Unchanged" |
| owners and the DO-Y2 re-measurement with `EXPORT_RATE_LIMIT_PER_MINUTE` set high | ADR-0058 T2 "The measurement" |

Requirement rows. These are documents only: the behaviour is BE-Y5's, and the proof is DO-Y2's.

- **REQ-S20-030**, acceptance: "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester". ADR-0058 T2 restates the proof's assertions to match the new flow: 202 within 2 s with a job id, `snapshotId` assigned before the job leaves `queued`, `percent` 0→100, `succeeded`, requester-only download, and 404 for others and for AUD. This text alone does **not** satisfy the row. It is satisfied only when BE-Y5's implementation and DO-Y2's measurement show it.
- **REQ-S13-005**, acceptance: "A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria". This is unchanged by the amendment: an export still renders exactly one stored snapshot (H1).

### Citations checked (as the assignment requires)

- **ADR-0002 rule 5** (`ADR-0002-modular-monolith-boundaries.md`, "Dependency direction rules", item 5) literally says "Packages depend in one direction: `apps/*` → `packages/*`; …". It does **not** literally say "the worker imports no API code". That is a correct consequence of the rule, because `apps/worker` → `apps/api` is not a permitted direction, and ADR-0046 §1 and ADR-0055 §2 state the consequence in those words. H3 cites the rule's literal content and then the consequence, so the citation is exact.
- **The connector-run-watch precedent** is ADR-0055 §2, "The run", as amended on 2026-10-30 by T-DG6-ARCH-07. It describes `connectorRunWatchStep` in `apps/api/src/modules/integrations/runs.ts`, which `integrations/index.ts` starts at `onReady` and stops at `onClose`, which is not started under `NODE_ENV=test`, and which is safe on several replicas. That watch itself follows BE-K's heartbeat-watch precedent. I verified that `connectorRunWatchStep` exists in both files named. One difference is recorded in H3: the connector watch uses advisory lock 730310, while the snapshot watch uses the row lock with `SKIP LOCKED`, as D-207 decides. So ADR-0016 gets no new lock number.
- **The assemblers are API code.** This is confirmed: they are in `apps/api/src/modules/reporting/reports/assemblers/*.ts`.

## Checks (real exit codes)

| Command | Environment | Result |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` | main checkout, Node 24.21.0, offline | **exit 0**, "PASS gate DG5 (historical)". It ran longer than 120 s and the harness moved it to the background, where it completed with exit 0. Log: `T-DG6-ARCH-11-evidence/validate-dg5-historical.log`. |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | same | **exit 0**, "All matched files use Prettier code style!" (xargs ran prettier in several batches). Log: `T-DG6-ARCH-11-evidence/prettier-check.log`. It was re-run after this handback was written (see the log's last run). |

No typecheck, lint or test run is required for a documents-only change, and none was run. None is claimed.

## Operations routed (pending-list delta)

None. This task changes no code and no `p6-pending-*.ts` or `p6-exercises-*.ts` file.

## For the orchestrator: contract, schema and dependency needs, and open questions

- **Contract (breaking, decided by D-207).** `ExportJob.snapshotId` changes from a UUID to a UUID or `null` (it stays required). This changes the type of a field in a DG5-approved response, so I am raising it as a breaking change, as my rules require, even though D-207 already decides it. BE-Y5 edits `openapi.yaml`, the zod mirror and the web client.
- **Schema.** Migration `0124` is BE-Y5's, and I wrote no migration. The names in the documents are the architecture's design: `live_selection`, `export_job_live_selection_shape`, `export_job_snapshot_pending`, `export_job_pending_assembly_idx`, the audit action `export_job.assemble`, and the indicative file name `0124_p6_export_job_pending_snapshot.sql`. **Q4:** if BE-Y5 ships other names, either BE-Y5 aligns with these documents or the orchestrator reconciles the documents at merge. BE-Y5's worktree had no changes when I checked, read-only, at about 23:06 UTC.
- **Dependency.** None.
- **Q1 (D-199's synchronous 403 without a snapshot).** Today the restricted-source check reads `report_snapshot_source`, the assembled snapshot's sources (`jobs.ts` `includesRestrictedSources`). D-207 (1) keeps the 403 synchronous, but assembly now happens after the 202. H2 states the requirement and leaves the computation to BE-Y5. H3 adds a second check on the assembled sources, so a restricted source found only at assembly fails the job and no file is written. The orchestrator should confirm that BE-Y5's synchronous computation keeps every DG5/DG6 403 case.
- **Q2 (error code).** H3 uses the existing `export.source_unavailable`, with its existing en/ar text in `apps/web/src/i18n/{en,ar}/problems.json:764`, both for access lost and for a restricted source found at assembly. No new enum value is added. If the orchestrator prefers a distinct code, that is an enum change in the contract.
- **Q3 (a repeatedly failing assembly).** H3 requires that it ends `failed` with `export.render_failed` and never loops silently. The bound (number of attempts) is BE-Y5's.
- **Interval.** H3 sets the watch's poll to 1 s. BE-Y5 may change it with a measurement.

## User-facing texts made untrue

None found in my scope. The existing `export__source_unavailable` text ("You no longer have access to this report's records." / "لم تعد لديك صلاحية الوصول إلى سجلات هذا التقرير.") stays true for the new failure path. BE-Y5 owns how a pending export (`snapshotId: null`) is shown in en and ar (its assignment). I did not check web strings beyond this one.

## What remains

- Implementation, contract, migration and tests: T-DG6-BE-Y5.
- The re-measurement on the merged tree: T-DG6-DO-Y2.
- Q1–Q4 above, for the orchestrator.
- At merge, reconcile ADR-0046 H4 and the data dictionary with the shipped `0124` and add file and line citations. The orchestrator can do this, or a follow-up architecture task.
- ADR-0046 §5 Flow step 1 still says `boss.send` after COMMIT. The code has used the `export_job.requested` outbox event since DG5 (`jobs.ts:3–4`). H3 describes the outbox, but I did not rewrite that older sentence, to keep the amendment additive. It is an observation for the orchestrator.
- F-DG6-147 stays open. Only a reviewer can verify its fix.

Nothing here grants a G1–G6 business approval or implies any DG0–DG7 gate result.
