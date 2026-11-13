# Handback T-DG7-ARCH-06 (solution-architect): slice M (+ K, L): release envelope, A28 sealing, A26/A27 drill procedures

- **Stage:** P7, DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `4345ce95113c564058b3dd5ad5d79079d6723f59` (`git rev-parse HEAD` at start; working tree clean except this run's own `docs/delivery/runs/DG7/…` directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-06.md`, SHA-256 `20f9115d460600a884d5afaed0d23ba834a821b0676dbf0cb76714a60a86f6f8` (checked with `sha256sum`, equal to the invocation's value).
- **Invocation:** run `DG7-T-DG7-ARCH-06-solution-architect-20261113T033612Z-e8edd6c4`, session `e8edd6c4-2d79-49a0-9883-36b5228c7b6c`.
- **Time:** `date -u` at start `Fri Nov 13 03:36:22 UTC 2026`; at the end `Fri Nov 13 03:56:29 UTC 2026`. About 20 minutes, well inside the 2-hour budget.

## 1. Changed files

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0073-p7-release-envelope-a28-sealing-verify-final-report-a26-a27-drills.md` (new) | ADR-0073: the two-step of l.621 in full (§1), artefacts and paths (§2), envelope list, manifest format, layout and README (§3), `seal.mjs` (§4), `verify-seal.mjs` V1–V18 (§5), gate-system rules L1–L5 (§6), final-report template and check (§7), rehearsal with a synthetic DG7 record on a sparse scratch clone (§8), outcomes (§9), A26 procedure (§10), A27 procedure (§11), schema/contract/locks (§12), who builds what (§13), residuals, alternatives, version evidence. ADR-0074 stays reserved and unused. |
| `docs/architecture/p7-work-split.md` | **Appended only** (221 lines added, 0 deleted; `git diff --stat`): §M (M.0–M.7, with `### M.1 DO-J: seal, verify-seal, release notes and the final-report template (devops-engineer; W8; after ARCH-06 and DO-A)`, file ownership, exact texts, tests T-M1–T-M14, requirement → clause → test → owner for REQ-DLV-041, S20-028, DLV-031), §K (A26 and A27 procedures, requirement table for S20-026, S20-027, DLV-030, S20-031), §L (how the slice L results become seal inputs). |
| `apps/api/test/support/p7-pending.ts` | Finalized (p7-plan §5.3): a two-line comment states that ARCH-06 declares no operation, so no `P7_PENDING_ARCH_06` exists and the four imports are the complete, frozen set. No code change. |
| `apps/api/src/modules/platform/advisory-locks.ts` | Comment only: 730420–730421 reserved for the ARCH-06 block, not allocated. |
| `docs/architecture/adr/ADR-0016-p2-data-model-registers-guards.md` | §6 registry: one reserved row 730420–730421 and the ARCH-06 entry in the allocation sentence. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-06-solution-architect.md` (new) | This handback. |

No migration (`0156`–`0157` unused and, by ADR-0073 §12, retired like `0131`–`0132`). No OpenAPI change (965 operations). No permission, ERD, data-dictionary or permissions-matrix change. No new dependency.

## 2. Behaviour delivered (design only; nothing executable is delivered by this task)

- **REQ-DLV-041:** the seal (S1–S12) and the A28 check (V1–V17) specified so that every clause of the acceptance text maps to a named check (p7-work-split §M.6). Payload hash and envelope archive checksum are separate seal-report fields. Payload drift after approval is refused with the l.621 text. Outputs only go to git-ignored `dist/release/` or META-excluded `docs/delivery/test-evidence/DG7/seal/`, enforced by an output-path guard in both tools, and re-checked by step S12.
- **REQ-S20-028:** same checks, plus the declaration rule (ADR-0073 §9.3) and the statement that sealing grants no approval (§4.6).
- **REQ-DLV-031:** the final-report template (exact text, M0074 verbatim as section 2) and the V18 check (capability → executed check → existing evidence file, CAP-01…CAP-12).
- **REQ-S20-026, REQ-S20-027 (and REQ-DLV-030):** orchestrator procedures K1–K8 and K9–K15. A27 uses a real historical checkpoint (`d8868b2a5c074b13c04693a88644c25ef2792583`, DG6 `FIXING`, frozen `5e819f7a…`, rounds 5–6; confirmed with `git show d8868b2a5:docs/delivery/stages.json`).
- **D-244 O3** (where the `demo-data/` sealing input lives): `dist/release/inputs/demo-data/`, with its `inputSha256` recorded at the freeze in `test-evidence/DG7/orchestrator/freeze/demo-data-input.json` (ADR-0073 §3.3).

## 3. Checks actually run

Environment: this sandbox, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, repository working tree at base + this task's edits.

| Command | Exit | Output tail |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (at start, before any edit) | 0 | `PASS gate DG6 (historical)` |
| `npx prettier --write` on the five changed files | 0 | the `.md` files are outside prettier's scope here (no line printed for them); the two `.ts` files `(unchanged)` |
| `pnpm -r typecheck` | 0 | `apps/worker typecheck: Done`, `apps/api typecheck: Done` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` (no findings) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `All matched files use Prettier code style!` |
| `node tools/release/claims-scan.mjs` | 0 | `claims-scan: PASS (852 files; D 115, U 737; negated 27; allowed 19)` |
| `node tools/release/secret-scan.mjs --path <ADR-0073> --path docs/architecture/p7-work-split.md` | 0 | `secret-scan: PASS (path; 2 files; allowed 0; canary (documented) 0)` |
| `node tools/gates/validate.mjs --historical --stage DG6` (at the end, after the edits; ran in the background after the 120 s foreground timeout) | 0 | `PASS gate DG6 (historical)` |
| `git diff --check` | 0 | no whitespace errors |

## 4. Known gaps, open questions, and anything undone

**Not done by design (other owners):** the tools, template, release notes and rehearsal (DO-J, W8); the A26 and A27 drills, the freeze input and the real seal (orchestrator).

**Open questions for the orchestrator:**

- **O1. Lost `demo-data/` sealing input** (ADR-0073 §3.3). A re-export has a different `inputSha256` but does not change the payload hash. The ADR requires a `progress.md` record, the secret scan and an A18 import of the new input. It leaves open whether a reviewer must re-check the new input. Please decide, or keep the directory safe from the freeze to the seal.
- **O2. A26 precondition P-K1** (ADR-0073 §10). I did not determine where `run-agent.sh` and `tools/agents/agent_sandbox.py` (`prepare`/`finish`) copy back staged review records, or where the review-role auto-commit runs, when `--cwd` is a worktree. If either targets the main repository's `docs/delivery/reviews/DG7/`, the drill would create real DG7 review rounds. That must not happen, and fixing it is a gate-tool change only you can make. Please check before scheduling A26. It is not started (D-249/`progress.md`: "the A26 drill follows when disk allows").
- **O3. No decisions.md entries between the freeze and the declaration** (ADR-0073 §1). `docs/delivery/decisions.md` is in the payload, so a post-freeze entry changes the working-tree candidate, and S4/V15 then refuse. The ADR routes those decisions to `progress.md` until the declaration. Please confirm. The alternative, a META-excluded decisions file, would be a `candidate.mjs` change.
- **O4. The plan's "same term lists as the P6 seeded-text scan"** (p7-plan §4.1 step 5) does not exist in that form. `seeded-texts.test.ts` holds business-term and internal-reference lists, not DG/G terms. ADR-0073 §6 defines rules L1–L5 itself and says so (Context 6).
- **O5. Review records are not text-scanned for DG/G confusion** (ADR-0073 §6). Only field checks apply to them (V7), because correct narratives such as "DG6 exercised the G6 workflow" would otherwise block delivery. A reviewer may judge that narrower than "no DG record is confused with G1-G6". The gate records themselves get both field and text checks.
- **O6. V16 in the rehearsal clone** may be BLOCKED for DG0–DG6 if `validate.mjs --historical` needs `runs/**`, which the sparse clone omits for disk reasons (Residual 2). The real seal runs it in the full repository.
- **O7. DO-J's assignment** should list `tools/release/lib/{envelope,gate-labels,final-report}.mjs`, `tools/release/tests/{seal,verify-seal,release-notes}.test.mjs`, `tools/release/tests/fixtures/seal/**`, `docs/handover/{final-report.template.md,release-notes.md}`, with no `.gitignore` line (D-244 O6). That is p7-work-split §M.1.

**Nothing in the assignment is left undone.**

## 5. Merge instructions

- One commit with the six files above. No migration, contract or generated-file regeneration is needed.
- `apps/api/test/support/p7-pending.ts` is now frozen. Later tasks edit only their own `p7-pending-<task>.ts`.
- No conflict is expected. ARCH-06 is the last ARCH writer of `p7-work-split.md`, `advisory-locks.ts` (comment) and ADR-0016 §6.
- Schedule DO-J after this merge (D-255 W8 order). Give it §M.1 as its file list and O7 above.
