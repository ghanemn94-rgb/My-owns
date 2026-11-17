# Handback T-DG7-SA-ADR71 (solution-architect): ADR-0071 §5 amendment for the disclosures file

- **Stage:** P7, gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `3127835cff6c576b5a2f6d91918f8557f67cbe2b` (HEAD at start, 12:18:33Z).
  - The orchestrator committed `3ac5a52e1674853dc53e84f49f126cb2a5b79136` (D-282, `docs/delivery/decisions.md` only) at 12:18:59Z, during this run. Every check below ran on that HEAD, plus my working-tree change.
  - The concurrent DO-D11 run (T-DG7-DO-D11) had uncommitted edits in the shared working tree while my checks ran. At 12:44Z these were:
    - `deploy/compose/compose.yaml`, `deploy/scripts/backup.sh`, `deploy/scripts/tests/backup-restore.test.mjs` and `deploy/service-list.json`;
    - `docs/handover/backup-restore.md` and `docs/handover/security-controls.md`;
    - `tools/release/secret-scan.mjs`, `tools/release/tests/secret-scan.test.mjs` and `tools/release/tests/service-list.test.mjs`.

    So rows 4–12 of §3 ran on that combined tree, not on my change alone. None of those files is mine, and my file is none of theirs.
- **Invocation:** `DG7-T-DG7-SA-ADR71-solution-architect-20261117T121803Z-bbbe4796`, session `bbbe4796-b702-40e9-979c-19d17a9deb82`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-SA-ADR71.md`, sha256 `18f34e29e0da2e452486f7acf942093e80d9c6504503872f658c2910eff7a070` (verified).
- **Findings repaired:** F-DG7-1002, F-DG7-1013, F-DG7-1021. They are one defect. An author never closes their own finding, so these await reviewer verification.
- **Two gate systems.** Nothing here grants or implies a G1–G6, Finance or IT approval, or any DG gate decision.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0071-p7-traceability-register-snapshot-about-release-notes-release-blockers-protocol-audit.md` | Adds **Amendment 1 (2026-11-17, T-DG7-SA-ADR71)**, sections A1.1–A1.7, and dated pointers in §5.1, §5.2 and §5.4 to the amendment. No other text of the ADR changed. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR71-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR71-evidence/*.log` | Check logs (§3). |

No code, test, input file, contract, migration, register row or generated file changed. `docs/handover/release-notes.md` is byte-identical (`--check` exit 0). The assignment's "pending entries in `apps/api/test/support/p7-pending*.ts`" and the mutation, authorization, audit, decimal and bilingual deliverables do not apply, because this is a documentation-only task with no operation.

## 2. Behaviour per requirement

**REQ-S02-005 (the finding's requirement), with REQ-S21-003 for context.** ADR-0071 now describes `tools/release/release-notes.mjs` as built, with every claim enumerated (p7-work-split §2 rule 2):

- **A1.1, usage.** The full option list: `--csv`, `--out`, `--deps`, a repeatable `--provisional`, `--disclosures`, `--repo`, `--write` and `--check`.
  - Defaults: `--write`; `--provisional apps/web/src/i18n`.
  - The disclosure default resolves from the tool's own directory, not from `--repo`.
- **A1.2, inputs, complete.** This replaces §5.1's "It reads nothing else". The table lists five inputs, each with its behaviour when missing and when invalid:
  1. the register;
  2. the dependency list;
  3. the provisional files, including the five p7-plan §1.4 component files, named;
  4. the two release-identity files, `apps/api/package.json` and `docs/api/openapi.yaml`;
  5. the disclosure input.

  §5.1 had also omitted input 4 since DO-J (`T-DG7-DO-J-devops-engineer.md` §5 (i)). The amendment corrects that as well. A1.2 also states what the generator never reads: no clock, no environment variable, no network, and nothing under `docs/delivery/**` except `--csv`.
- **A1.3, the disclosure input.**
  - It covers the purpose (ADR-0064 A5.6, D-278), the location (the tool directory, never `docs/delivery/**`) and the strict format `mth-release-notes-disclosures/1`, with each validation rule taken from `parseDisclosures`.
  - It also covers the refusal: BLOCKED, exit 2, nothing written.
  - Scan coverage is stated exactly: the secret-scan payload covers the file. The claims scan covers the texts only as they are printed in `docs/handover/release-notes.md`.
- **A1.4, the sections.** There are eight sections. The new item 6, "Known limitations disclosed in this release", sits between the dependencies and the provisional texts, and the Arabic summary has a matching subsection with the provisional lines. Items 1–5 keep their numbers, so "§5.2 item 1" in `release-notes.mjs` stays valid.
- **A1.5, the exit table.** It adds the exit-2 cases. It also records that an invalid dependency list exits **1** as built, which differs from p7-work-split §2 rule 4. That behaviour is recorded, not changed (see §5).
- **A1.6** maps each statement to the existing tests (5 DO-D10 tests, plus T-I11).
- **A1.7** adds two residuals.
- **Owner's position (D-280 revisit condition).** As the role that authored ADR-0071, I accept the extra checked-in input. D-280's condition "ADR-0071's owner rejects the extra input file" is not met.

## 3. Checks run (real exit codes)

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, agent sandbox, HEAD `3ac5a52e1` plus the working tree. Logs are in `docs/delivery/handbacks/DG7/T-DG7-SA-ADR71-evidence/`.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `npx prettier --check <ADR-0071>` | 0 | PASS | `01-prettier-adr.log` |
| 2 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` | 0 | PASS: "0 unfinished item(s), 23 later clause(s); … up to date" | `02-release-notes-check.log` |
| 3 | `node --test tools/release/tests/release-notes.test.mjs` | 0 | PASS, 14/14 | `03-release-notes-tests.log` |
| 4 | `node tools/release/claims-scan.mjs` (covers the amended ADR in group D) | 0 | PASS: 891 files, negated 28, allowed 19 | `04-claims-scan.log` |
| 5 | `node tools/release/check-handover.mjs` | 2 | BLOCKED: generated sections need `--protocol-audit`. Index, deployment, summaries, security-links and guides all PASS. | `05-check-handover.log` |
| 5b | `node tools/release/protocol-audit.mjs --all --json $TMPDIR/pa.json --quiet`, then `check-handover.mjs --protocol-audit $TMPDIR/pa.json` | 1, then 1 | Audit: hits reported (D-249). Handover: FAIL only in "generated": `known-limitations.md` differs from the content generated from **this live report**. Not caused by this change; see §4 item 1. | `05b-check-handover-with-audit.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | PASS gate DG6 (historical) | `06-validate-historical-DG6.log` |
| 7 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 965 operations | `07-openapi-lint.log` |
| 8 | `pnpm -r typecheck` | 0 | PASS | `08-typecheck.log` |
| 9 | `pnpm lint` | 0 | PASS (`eslint . --max-warnings=0`) | `09-lint.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | PASS: "All matched files use Prettier code style!" | `10-prettier-all.log` |
| 11 | `pnpm test` | 0 | PASS: unit-node 207 files / 3042 tests; unit-web 131 / 2199; unit-formula-nocodegen 3 files, 259 passed, 2 skipped (pre-existing skips; no test file changed by this task) | `11-pnpm-test.log` |
| 12 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract` (disposable PostgreSQL 16 cluster, created and deleted by the script) | 0 | PASS: 3 files, 231 tests | `12-contract-pg.log` |

## 4. Known gaps

1. **check-handover "generated" fails against a live protocol-audit report.**
   - `known-limitations.mjs` reads no ADR (its inputs are the report, the guide, the dependency list and the provisional files), so the amendment cannot affect it.
   - The difference comes from the report: a live `--all` run now includes DG7 runs made after the report that generated the committed section, including this run and DO-D11's.
   - ADR-0071 §7 assigns the authoritative run to the orchestrator at the freeze.
   - I did not regenerate `docs/handover/known-limitations.md`. That is outside my scope, and doing it mid-repair would bake in-flight runs into the disclosure.
2. **No integration test was touched.** The only integration check required is the contract test (row 12).

## 5. Open questions

1. **The invalid dependency list exits 1, not 2 (ADR-0071 A1.5, A1.7 item 2).**
   - p7-work-split §2 rule 4 classes invalid input as exit 2 (BLOCKED). The generator exits 1, and test "T-I11 dependencies" pins it.
   - The amendment records this as a deviation that exists as built.
   - Aligning it is a code and test change for DevOps. Should it be aligned, or accepted as recorded? Exit 1 never reports a pass, so this is not a safety issue.
2. **D-280's text says the extra input was accepted "instead of amending the ADR".** The ADR is now amended. Should D-280 get an orchestrator follow-up note? `decisions.md` is not mine to edit.
3. **Merge.** No ordering or migration is involved. The ADR does not overlap DO-D11's files (`tools/release/secret-scan.mjs` and its evidence).
