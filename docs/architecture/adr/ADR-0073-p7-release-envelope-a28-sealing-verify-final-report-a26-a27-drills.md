# ADR-0073: P7 release envelope and A28 sealing: the two-step of master prompt l.621, the envelope manifest, the seal and verify tools, where their outputs live, the rehearsal with a synthetic DG7 gate record, the final delivery report template, and the A26 and A27 drill procedures

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-06), 2026-11-13. Base `4345ce95113c564058b3dd5ad5d79079d6723f59` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements:**
  - slice M of `docs/architecture/p7-plan.md`: REQ-DLV-041, REQ-S20-028, REQ-DLV-031;
  - the procedures of slice K the orchestrator runs: REQ-S20-026 (A26) and REQ-S20-027 (A27), with REQ-DLV-030 evidenced by the A27 drill (p7-work-split §J);
  - the A28 halves other ADRs delegated here: ADR-0062 §1 and §4 (archive checksum at sealing), ADR-0063 §1.1 and §5 (envelope scope, claims re-run on the archive's `docs/`), ADR-0071 §2 T-I10 and §5.5 (register and release notes in the archive), ADR-0072 §3 (the final-report template).
- **Sources (quoted where a design point has one):**
  - Master prompt l.621 (M0411): "first review and approve the frozen application/handover payload, excluding review and gate metadata from its hash; then append the resulting DG7 gate record to the release evidence envelope and run A28 to validate the sealed package. A28 is a post-approval packaging check, not a prerequisite that requires DG7 to already exist before DG7 can be approved. Do not declare final delivery complete until sealing and integrity verification pass. A sealing failure blocks delivery; a payload change requires new candidate reviews. Preserve the payload hash and separately record the final archive checksum."
  - M0397 (A28): "After the DG7 candidate review, seal the handover with all eight gate records, agent definitions, requirement coverage and findings; verify package integrity and keep these records distinct from product gates G1–G6."
  - M0074: "Neither the number of agents nor their agreement guarantees correctness. The quality mechanism is independent inspection, executed tests, traceability, repair and reproducible evidence. Preserve this distinction in status and final delivery."
  - M0395 (A26): "Introduce a known defect in a controlled test branch; independent reviewers identify it, the implementer fixes it, and independent rechecks/regression tests prove closure."
  - M0396 (A27): "Resume from a checkpoint; reconstruct current stage/tasks/evidence, reject stale reviews and continue without inventing approvals or requiring routine user confirmation." M0073: "check whether earlier reviews still match the current candidate, and recreate unavailable agent sessions as needed. Never treat a remembered verbal approval as sufficient."
  - l.627: "At final delivery provide the working application/preview, source repository/archive, exact setup instructions, secure administrator bootstrap, IT handover, requirement coverage, test evidence, all eight gate reports and the remaining external configuration dependencies. Mark any unmet mandatory acceptance criterion as a release blocker."
  - Acceptance texts (binding, `docs/delivery/requirements.csv`):
    - REQ-DLV-041: "A28: the sealing check verifies that all eight gate records, the ten agent definitions, the register and the findings are present and match their checksums, that the payload hash equals the DG7 candidate ID, and that no DG record is confused with G1-G6".
    - REQ-S20-028: "A28: After the DG7 candidate review, seal the handover with all eight gate records, agent definitions, requirement coverage and findings; verify package integrity and keep these records distinct from product gates G1–G6. This post-approval sealing check must pass before delivery is declared complete".
    - REQ-DLV-031: "A23;A28: the final delivery report contains the limitation statement and links each claimed capability to an executed check".
    - REQ-S20-026: the A26 text above. REQ-S20-027: the A27 text above. REQ-DLV-030: "A27: in a resumption drill, the reconcile report flags a review whose candidate no longer matches, work continues from progress.md, and no approval appears without a review record".
  - Playbook: no block concerns release sealing or delivery drills. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q8**: seal tooling in `tools/release/**`, no `validate.mjs` change. **Q9**: drill reports in handback evidence; the orchestrator writes `test-evidence/DG7/seal/`. **Q13**: approved records are never rewritten. **Q18**: "A26 drill on a separate branch with drill-local findings". **Q19** (user): REQ-DLV-041 and REQ-S20-028 are recorded IMPLEMENTED with the tooling, the rehearsal and DG0–DG6 evidence, with the marker `completes-after-gate:` naming the clause that completes at the seal.
  - D-244 **O3** (ARCH-01 handback O3): where the `demo-data/` input used at sealing is kept is fixed here (§3.3). **O6**: no `.gitignore` change (`dist/` is already ignored).
  - D-249: protocol-audit hits are disclosed, not rewritten; the DG7 run is made by the orchestrator at the freeze.
  - D-255: W8 runs this task before DO-J.
- **Builds on:** ADR-0062 (payload archive, `buildArchive`/`verifyArchive`, `lib/tar.mjs`), ADR-0063 (`scanSecrets` envelope and path scopes, `scanClaims` with `roots`), ADR-0064 (the `demo-data/` migration manifest, `tables/<table>.ndjson`), ADR-0071 (release notes, `register-snapshot.mjs` `parseRegister`, the `completes-after-gate:` marker), ADR-0072 (`docs/handover/final-report.template.md` owned by DO-J), `tools/gates/lib/candidate.mjs` (read-only: `manifestFromRef`, `manifestFromWorkingTree`, `candidateId`, `META_EXCLUDES`, `APPROVED_SPEC`).

## Context

1. **Self-reference.** A package that contains the DG7 gate record cannot be the thing DG7 approves. l.621 resolves this with two hashes: the **payload hash** (the DG7 candidate id, over the manifest that excludes review and gate metadata) and the **archive checksum** of the sealed envelope, recorded separately.
2. **What already excludes the metadata.** `tools/gates/lib/candidate.mjs` `META_EXCLUDES` keeps `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md` and `stages.json` out of every candidate. `.claude/agents/*.md`, `docs/delivery/requirements.csv` and `docs/delivery/decisions.md` **are** in the payload.
3. **What exists at the base.** `tools/release/build-archive.mjs` (DO-A) builds the payload archive from a commit and checks `--candidate`; `verifyArchive` runs seven checks; `lib/tar.mjs` exports `writeTar`, `gzipDeterministic`, `readTar`, `gunzipArchive`. `secret-scan.mjs` has `--scope envelope --list <file>` and reads a JSON list (`readList`). `claims-scan.mjs` exports `scanClaims({ repo, roots })`. No seal, verify-seal, release-notes or final-report file exists (`ls tools/release`, `ls docs/handover` at the base).
4. **The gate records.** `docs/delivery/gates/DG0.json`–`DG6.json` exist, each with `stage_id`, `decision` `APPROVED`, `candidate_id`, `source_commit`, `manifest_path`, `previous_gate` (`null` for DG0, else the preceding DG id), `reviews` (role → record path), `release_audit` (path), `decided_by` `release-auditor`. Checked on the base with a read of the seven files.
5. **The product gates.** Product gate codes are stored as `G1`–`G6` (`gate_code` columns, for example `gate_dispensation_gate CHECK (gate_code IN ('G1', 'G2', 'G3'))`). The demo installation exported by ADR-0064 therefore carries G-codes in its `tables/*.ndjson`.
6. **The plan's term list.** p7-plan §4.1 step 5 says the label check uses "the same term lists as the P6 seeded-text scan". On reading `apps/api/test/integration/text-scan/seeded-texts.test.ts`, that scan holds business-term and internal-reference lists, **not** a DG/G term list. This ADR therefore defines the label rules itself (§6) and does not claim reuse.
7. **Disk.** The tracked tree at the DG6 approval commit `d8868b2a5` is about 2,847 MiB, of which about 2,782 MiB is under `docs/delivery/{test-evidence,handbacks,runs}/` (measured with `git ls-tree -r -l` by this task). The sandbox has about 4 GB free. Any scratch copy of the repository in this ADR is a **sparse** checkout that omits those three META-excluded directories, which leaves the candidate id unchanged (§8.1).
8. **The drills.** No A26 or A27 drill record exists (`docs/delivery/test-evidence/DG7/orchestrator/` holds only `validate-historical-DG6.log` at the base). `tools/agents/run-agent.sh` accepts `--cwd <dir>`, and its guard protects "the repository and all of its worktrees".

## Decision

### 1. The two-step, in full (l.621)

| Step | Who | What | Output | Changes the payload hash? |
| --- | --- | --- | --- | --- |
| **0. Build** | implementers (DO-J for slice M) | Everything the handover needs is committed before the freeze: code, migrations, contract, `docs/handover/**` (including `release-notes.md` generated by `release-notes.mjs --write` and `final-report.template.md`), the register, `tools/release/{build-archive,seal,verify-seal,release-notes}.mjs` and their tests. | commits | — |
| **1. Rehearse** | DO-J, before the freeze | `seal.mjs --rehearsal` and `verify-seal.mjs --rehearsal` on a **sparse scratch clone** under `$TMPDIR`, with a **synthetic** DG7 gate record (§8). Every tampering case fails. | DO-J handback evidence only | no (scratch clone) |
| **2. Freeze** | orchestrator | `node tools/gates/candidate.mjs --stage DG7 --freeze`. The **payload hash is the DG7 candidate id**. At the freeze verification the orchestrator also exports the demo installation (ADR-0064) to the sealing input directory and records its `inputSha256` (§3.3), and runs `protocol-audit.mjs --all --json` (D-249). | candidate manifest; `test-evidence/DG7/orchestrator/freeze/demo-data-input.json` | defines it |
| **3. Review, audit, approve** | domain, code-security, QA reviewers; release-auditor | The normal gate loop on that candidate id. **A28 is not a prerequisite** (M0411). The reviewers review the seal tools as payload code, together with the rehearsal evidence. | `reviews/DG7/round-N/`, `gates/DG7.json` | no (META-excluded) |
| **4. Seal** | orchestrator, after `gates/DG7.json` says `APPROVED` | `seal.mjs` (§4). It re-derives the payload from `source_commit`, builds the payload archive, writes the envelope manifest and the envelope archive. | `dist/release/*` (archives); `test-evidence/DG7/seal/` (manifest copy, seal report) | no: §3 and §4 step S12 prove it |
| **5. Verify (A28)** | orchestrator; release-auditor may re-run | `verify-seal.mjs` (§5), in repository mode and in archive mode. | `test-evidence/DG7/seal/verify-report-<n>.json` | no |
| **6. Report and declare** | orchestrator | The final delivery report is filled from the template and checked with `verify-seal.mjs --final-report` (§7). Only then is final delivery declared in `progress.md`. | `test-evidence/DG7/seal/final-report.md` | no |

Rules that bind the whole sequence:

- **No payload commit between the freeze and the declaration.** After the freeze the orchestrator records progress only in META-excluded files (`progress.md`, `stages.json`, `test-evidence/**`, `findings.json`, handbacks, assignments). `docs/delivery/decisions.md` is a **payload** file (candidate rule, Context 2), so a decision entry after the freeze changes the working-tree candidate and makes S4 and V15 fail. Decisions taken between approval and the declaration are written to `progress.md` and copied into `decisions.md` only after the declaration. That later copy is outside the delivered payload, which is the archive built from `source_commit`.
- **Sealing never approves anything.** It is an engineering packaging check. It does not create, change or imply a business, Finance or IT approval, and product gate G6 does not imply DG7 (or the reverse). Every seal output carries the statement of §4.6.
- **Failure blocks delivery.** A seal or verify exit other than 0 with the line `verify-seal: PASS` means delivery is blocked (§9).

### 2. The artefacts and where they live

| Artefact | Path | Written by | In the payload hash? |
| --- | --- | --- | --- |
| Payload archive `mth-transformation-hub-<version>.tar.gz` (+ `.sha256`, `.build-report.json`) | `dist/release/` (git-ignored by the existing `dist/` line) | `seal.mjs` through `buildArchive` (ADR-0062) | no (ignored) |
| Envelope archive `mth-transformation-hub-<version>-envelope.tar.gz` (+ `.sha256`) | `dist/release/` | `seal.mjs` | no (ignored) |
| `envelope-manifest-<n>.json` (byte copy of the archive's `ENVELOPE-MANIFEST.json`) | `docs/delivery/test-evidence/DG7/seal/` | `seal.mjs`, run by the orchestrator | no (META-excluded) |
| `seal-report-<n>.json` | `docs/delivery/test-evidence/DG7/seal/` | `seal.mjs` | no |
| `verify-report-<n>.json` | `docs/delivery/test-evidence/DG7/seal/` | `verify-seal.mjs` | no |
| `final-report.md` | `docs/delivery/test-evidence/DG7/seal/` | orchestrator, from the template | no |
| `final-report.template.md` | `docs/handover/` | DO-J | **yes** (it is reviewed) |
| Sealing input `demo-data/` | `dist/release/inputs/demo-data/` | orchestrator at the freeze (§3.3) | no (ignored) |

`<version>` is ADR-0062 §1's (`package.json` version, `-`, first 12 hex digits of the candidate id). `<n>` is the seal sequence number, starting at 1 (§9.2). Implementers cannot write under `test-evidence/**` (write scopes). In the rehearsal the same relative paths are used **inside the scratch clone**, never in the repository (§8).

**Output-path guard.** Both tools refuse an output directory that is neither git-ignored (`git check-ignore -q`) nor matched by `META_EXCLUDES`: `seal: refused output path <path>: it would change the payload hash` (exit 2). The default outputs satisfy the guard. This is how R6 of the plan is enforced in code rather than by convention.

### 3. What the envelope holds

#### 3.1 The fixed list (no folder walk, D-138)

The envelope lists files only by rules over named records. Nothing walks a delivery folder.

| Group | Rule | Count |
| --- | --- | --- |
| Gate records | `docs/delivery/gates/DG0.json` … `DG7.json` | exactly 8 |
| Candidate manifests | each gate record's `manifest_path` | 8 |
| Review records | each gate record's `reviews` values and `release_audit` (the records the gate cites; sidecars are not cited by the gate and are not listed) | at least 32 |
| Agent definitions | `.claude/agents/<name>.md` for the ten names `backend-workflow-engineer`, `code-security-reviewer`, `devops-engineer`, `domain-reviewer`, `frontend-ux-engineer`, `kpi-benefits-engineer`, `qa-verifier`, `release-auditor`, `solution-architect`, `transformation-analyst`, read from `source_commit` (payload files) | exactly 10 |
| Register | `docs/delivery/requirements.csv` read from `source_commit` | 1 |
| Findings | `docs/delivery/findings.json` | 1 |
| Stage records | `docs/delivery/stages.json` | 1 |
| Drill and evidence reports | the `--evidence <key>=<path>` arguments; the keys `A18`, `A19`, `A26`, `A27`, `test-level-index` and `protocol-audit` are **required**; each path must be a regular file under `docs/delivery/test-evidence/DG7/` | 6 |
| Extras | each `--extra <path>`: a regular file under `docs/delivery/test-evidence/` or `docs/delivery/reviews/` | 0 or more |

A missing required file refuses the seal (§4.4). A file that appears twice (for example a review cited by two gates) is listed once, under its first group.

#### 3.2 Where each file is read from

- **Payload files** (agent definitions, the register) are read from git at `source_commit` (`git show <commit>:<path>`). S4 has already proved that the working tree's payload equals it, so the two sources agree, and the envelope never carries a post-approval edit.
- **Envelope-only files** (gates, manifests, reviews, findings, stages, evidence, extras) are read from the working tree. Each must be committed and unchanged against `HEAD` (`git status --porcelain -- <path>` prints nothing). The seal records `HEAD` as `sealCommit`, a traceability pointer, so the envelope can be rebuilt from git.

#### 3.3 The `demo-data/` sealing input (D-244 O3)

- **At the freeze verification** the orchestrator exports the seeded demo installation with `tools/migration/export.mjs` (ADR-0064) into `dist/release/inputs/demo-data/` (git-ignored; a few MiB). It computes `inputSha256` with the function `build-archive.mjs` uses (ADR-0062 §4.2) and writes `docs/delivery/test-evidence/DG7/orchestrator/freeze/demo-data-input.json`: `{ "inputSha256", "files", "sourceEnvironment", "demoChecksum", "exportedFromCommit" }`. It runs `secret-scan.mjs --path dist/release/inputs/demo-data` there and keeps the log beside it.
- **At the seal** `--demo-data dist/release/inputs/demo-data --demo-data-sha256 <inputSha256>` is required. A different hash refuses the seal (§4.4).
- **If the directory is lost**, a re-export has a different `inputSha256` (ADR-0062 Residual 2). The `demo-data/` input is not part of the candidate, so a new export does not change the payload hash, but it is not the input the freeze recorded. The orchestrator then records the replacement in `progress.md` with both hashes, runs the secret scan and the A18 import of the new input again, and only then seals with the new hash. This is open question O1 in the handback. The ADR does not decide whether that also needs a reviewer re-check.

#### 3.4 `ENVELOPE-MANIFEST.json` (UTF-8, keys in the order shown, 2-space indent, LF, final newline, no wall-clock time)

```json
{
  "schemaVersion": 1,
  "kind": "mth-release-envelope",
  "product": "mobily-transformation-hub",
  "version": "<version>",
  "rehearsal": false,
  "gateSystems": "DG0-DG7 are engineering delivery gates. G1-G6 are business approvals inside the product. Neither implies the other, and this envelope grants no business, Finance or IT approval.",
  "payload": {
    "hash": "sha256:<64 hex>",
    "hashAlgorithm": "mth-candidate-v2",
    "sourceCommit": "<40 hex>",
    "files": 0,
    "archive": { "name": "<payload archive file name>", "archiveSha256": "<64 hex>", "tarSha256": "<64 hex>" },
    "demoDataInputSha256": "<64 hex>"
  },
  "gates": [
    { "stage": "DG0", "path": "docs/delivery/gates/DG0.json", "sha256": "<64 hex>", "candidateId": "sha256:<64 hex>", "sourceCommit": "<40 hex>", "decision": "APPROVED", "decidedAt": "<as recorded>" }
  ],
  "candidateManifests": [{ "stage": "DG0", "path": "<manifest_path>", "sha256": "<64 hex>" }],
  "reviews": [{ "stage": "DG0", "role": "domain-reviewer", "path": "<path>", "sha256": "<64 hex>" }],
  "agentDefinitions": [{ "name": "backend-workflow-engineer", "path": ".claude/agents/backend-workflow-engineer.md", "sha256": "<64 hex>" }],
  "register": { "path": "docs/delivery/requirements.csv", "sha256": "<64 hex>", "rows": 0 },
  "findings": { "path": "docs/delivery/findings.json", "sha256": "<64 hex>" },
  "stages": { "path": "docs/delivery/stages.json", "sha256": "<64 hex>" },
  "evidence": [{ "key": "A26", "path": "<path>", "sha256": "<64 hex>" }],
  "extras": [{ "path": "<path>", "sha256": "<64 hex>" }]
}
```

- Arrays are sorted: `gates` and `candidateManifests` by stage, `reviews` by stage then role, `agentDefinitions` by name, `evidence` by key, `extras` by path (UTF-8 byte order).
- `payload.files` is the candidate manifest's entry count. `register.rows` is the data-row count from `parseRegister` (ADR-0071 §2).
- The manifest holds no `sealCommit` and no time. Its bytes, and therefore the envelope archive's `.tar` bytes, are a pure function of the listed files, the payload archive and `<version>` (the ADR-0062 §3 claim, extended).

#### 3.5 The envelope archive layout

One top-level directory `mth-transformation-hub-<version>-envelope/` (with `-REHEARSAL` appended in a rehearsal, ADR-0062 §2.1):

```text
README.txt                         the §3.6 text
ENVELOPE-MANIFEST.json             §3.4
SHA256SUMS                         every other file, sha256sum -c format (ADR-0062 §4.1)
payload/<payload archive>.tar.gz   byte copy of dist/release/<name>.tar.gz
payload/<payload archive>.tar.gz.sha256
evidence/<repository path>         one byte copy per listed file, at its repository path
```

It is written with `lib/tar.mjs` `writeTar` and `gzipDeterministic` (same mtime, modes, order and gzip header rules as ADR-0062 §3). Its SHA-256 is the **archive checksum** of l.621, written to `<name>-envelope.tar.gz.sha256` and to the seal report, separately from the payload hash.

#### 3.6 `README.txt` of the envelope (exact English; IT-facing, D-243 Q7)

```text
Mobily Transformation Hub — release evidence envelope <version>

payload/   The release archive. Its source/ directory hashes to the payload hash below,
           which is the DG7 candidate id the engineering gate approved.
evidence/  Delivery records: the eight engineering gate records DG0-DG7, the review records
           they cite, the candidate manifests, the ten agent definitions, the requirement
           register, the findings, the stage records and the drill reports.

Payload hash:  <payload hash>
Check:         sha256sum -c SHA256SUMS

DG0-DG7 are engineering delivery gates. G1-G6 are business approvals inside the product.
Neither implies the other. This envelope is engineering evidence: it grants no business,
Finance or IT approval, and Mobily IT's acceptance of the package is a separate decision.
Agent count or agreement does not guarantee correctness; see the final delivery report.
```

### 4. `tools/release/seal.mjs` (DO-J)

#### 4.1 Usage

```text
node tools/release/seal.mjs --candidate sha256:<64 hex> \
  --demo-data <dir> --demo-data-sha256 <64 hex> \
  --evidence A18=<path> --evidence A19=<path> --evidence A26=<path> --evidence A27=<path> \
  --evidence test-level-index=<path> --evidence protocol-audit=<path> \
  [--extra <path>]... [--reseal-reason "<text>"] [--rehearsal] \
  [--dist <dir>] [--out <dir>] [--repo <dir>]
```

Defaults: `--dist dist/release`, `--out docs/delivery/test-evidence/DG7/seal`, `--repo` the repository containing the script. Node built-ins only; imports `build-archive.mjs`, `secret-scan.mjs`, `claims-scan.mjs`, `lib/tar.mjs`, `apps/api/scripts/register-snapshot.mjs` (`parseRegister`), and `tools/gates/lib/candidate.mjs` read-only (p7-work-split §2 rule 3).

#### 4.2 Steps (each prints one line `seal: <id> ok|FAIL <detail>`)

| Id | Step |
| --- | --- |
| S1 | Read `docs/delivery/gates/DG7.json`. It must exist, parse, and say `decision` `APPROVED`. |
| S2 | `--candidate` equals the record's `candidate_id`. |
| S3 | `candidateId(manifestFromRef(repo, source_commit, APPROVED_SPEC))` equals `--candidate`. |
| S4 | `candidateId(manifestFromWorkingTree(repo, APPROVED_SPEC))` equals `--candidate` (no payload change since approval). |
| S5 | Mode markers (§8.2): a release seal refuses any gate record carrying `synthetic_rehearsal`; a rehearsal seal requires it on DG7 and refuses it on DG0–DG6. |
| S6 | Collect the §3.1 list. Every file exists as a regular file. Every envelope-only file is committed and unchanged against `HEAD`. |
| S7 | The `demo-data` input hashes to `--demo-data-sha256`. |
| S8 | `buildArchive({ repo, commit: source_commit, demoData, candidate, rehearsal, outDir: --dist })`. Its own `--candidate` check repeats S3. |
| S9 | Write `ENVELOPE-MANIFEST.json`, `SHA256SUMS`, `README.txt`; pack the envelope archive (§3.5). |
| S10 | Scans: `scanSecrets({ scope: "envelope", list: <the manifest's paths> })`, `scanSecrets({ scope: "path", paths: [demo-data input] })`, and `scanClaims({ roots: [<payload archive's docs/ extracted under $TMPDIR>] })`. Any hit fails. The extraction is deleted afterwards. |
| S11 | Write `envelope-manifest-<n>.json` and `seal-report-<n>.json` to `--out` (refused unless the output-path guard passes, §2). |
| S12 | Recompute S4. It must still equal `--candidate` (the seal changed no payload file). |

#### 4.3 The seal report `seal-report-<n>.json`

```json
{
  "schemaVersion": 1,
  "kind": "mth-seal-report",
  "rehearsal": false,
  "sequence": 1,
  "resealReason": null,
  "payloadHash": "sha256:<64 hex>",
  "sourceCommit": "<40 hex>",
  "sealCommit": "<40 hex>",
  "payloadArchive": { "name": "…", "archiveSha256": "<64 hex>", "tarSha256": "<64 hex>" },
  "envelopeArchive": { "name": "…", "archiveSha256": "<64 hex>", "tarSha256": "<64 hex>" },
  "envelopeManifestSha256": "<64 hex>",
  "demoDataInputSha256": "<64 hex>",
  "scans": { "secret": { "files": 0, "hits": 0 }, "claims": { "files": 0, "hits": 0 } },
  "steps": [{ "id": "S1", "ok": true, "detail": "…" }],
  "tool": { "node": "<process.version>", "sealSha256": "<sha256 of seal.mjs>" },
  "sealedAt": "<ISO 8601 UTC>",
  "statement": "<the §4.6 text>"
}
```

`payloadHash` and `envelopeArchive.archiveSha256` are separate fields: "preserve the payload hash and separately record the final archive checksum". `sealedAt` is the only wall-clock value, and it is in the report, never in an archive.

#### 4.4 Exit codes and exact texts (p7-work-split §2 rule 4)

| Exit | Line |
| --- | --- |
| 0 | `seal: sealed payload <hash>; payload archive sha256 <hex>; envelope archive sha256 <hex>` then `seal: run verify-seal next; delivery is not complete until it passes` |
| 1 | `seal: --candidate <id> is not the approved DG7 candidate <id>` (S2) |
| 1 | `seal: the files at <commit> hash to <id>, not the approved <id>` (S3) |
| 1 | `seal: the working tree payload differs from the approved candidate (<c> changed, <a> added, <r> removed); a payload change requires a new candidate and new reviews (master prompt l.621)` (S4, S12) |
| 1 | `seal: demo-data input hashes to <hex>, not the recorded <hex>` (S7) |
| 1 | `seal: <scan> scan found <n> hit(s)` (S10; hits printed masked, ADR-0063) |
| 1 | `seal: a release seal refuses a synthetic gate record: <path>` / `seal: a rehearsal requires a synthetic DG7 gate record` (S5) |
| 2 | `seal: BLOCKED: docs/delivery/gates/DG7.json does not exist; DG7 is not approved` / `seal: BLOCKED: DG7 decision is <value>, not APPROVED` (S1) |
| 2 | `seal: BLOCKED: missing <group> file <path>` / `seal: BLOCKED: <path> is not committed or differs from HEAD` / `seal: BLOCKED: missing --evidence <key>` / `seal: BLOCKED: --evidence <key> must be a file under docs/delivery/test-evidence/DG7/` (S6) |
| 2 | `seal: refused output path <path>: it would change the payload hash` (S11) |
| 2 | `seal: BLOCKED: <out>/seal-report-<n>.json exists; a re-seal needs --reseal-reason` (§9.2) |

#### 4.5 What the seal never does

It never writes under `docs/delivery/gates/`, `reviews/`, `stages.json`, `findings.json`, `progress.md` or `decisions.md`, and never commits. It never deletes an earlier seal or verify report. It never reads a folder of delivery records except through the §3.1 rules.

#### 4.6 The statement (exact; every seal and verify report, the envelope README and the final report carry it)

> Sealing and its verification are engineering packaging checks. They grant no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.

### 5. `tools/release/verify-seal.mjs` (DO-J): the A28 check

#### 5.1 Usage

```text
node tools/release/verify-seal.mjs --envelope <envelope.tar.gz> --expect-sha256 <hex> \
  [--repo <dir>] [--final-report <file>] [--rehearsal] [--out <dir>]
```

- **Archive mode** (always): checks V1–V14 on the envelope archive alone, reading it with `gunzipArchive`/`readTar` in memory. Nothing is extracted to disk except the S10-style claims-scan extraction under `$TMPDIR`, which is deleted.
- **Repository mode** (with `--repo`): adds V15–V17 against the sealed repository.
- **Final-report mode** (with `--final-report`): adds V18 (§7.3).
- The verify report is written to `--out` (default `docs/delivery/test-evidence/DG7/seal`) as `verify-report-<n>.json`, under the same output-path guard.

#### 5.2 Checks

| Id | Check | Requirement clause |
| --- | --- | --- |
| V1 | The envelope file's SHA-256 equals `--expect-sha256`. | l.621 "separately record the final archive checksum" |
| V2 | One top-level directory with the §3.5 name. `SHA256SUMS` lists every other file, and every hash matches. | S20-028 "verify package integrity" |
| V3 | `ENVELOPE-MANIFEST.json` parses as §3.4 (`schemaVersion` 1, `kind`). Every listed path is present under `evidence/` with its `sha256`, and no file is under `evidence/` without being listed. | DLV-041 "present and match their checksums" |
| V4 | The payload archive in `payload/` passes ADR-0062's `verifyArchive(…, { expectSha256: payload.archive.archiveSha256, candidate: payload.hash })`, all seven checks. | S19-001 (A28 half); DLV-041 |
| V5 | `payload.hash` equals the `candidate_id` of `evidence/docs/delivery/gates/DG7.json`. | DLV-041 "the payload hash equals the DG7 candidate ID" |
| V6 | Exactly eight gate records DG0–DG7; each `decision` `APPROVED`; `previous_gate` forms the chain `null`, DG0, …, DG6; each record's `manifest_path` file is in the envelope and its `candidate_id` equals the manifest's. | DLV-041 "all eight gate records"; DLV-021 |
| V7 | Every review record each gate cites is in the envelope; each parses, and its `candidate_id` equals its gate's. | S20-028; S20-023 |
| V8 | Exactly the ten agent definitions of §3.1, each byte-equal to `payload/…/source/.claude/agents/<name>.md` inside the payload archive. | DLV-041 "the ten agent definitions" |
| V9 | The envelope's register is byte-equal to the payload archive's `source/docs/delivery/requirements.csv`; `parseRegister` gives `register.rows` rows with unique ids. | DLV-041 "the register"; S02-003, S19-015 (A28 halves); ADR-0071 T-I10 (A28 repeat) |
| V10 | `findings.json` is present, matches, and parses. The report records the count of DG7 findings by status; it does not re-judge them (the gate did). | DLV-041 "the findings" |
| V11 | Each required `evidence` key is present. | REQ-DLV-039 (drill reports in the package) |
| V12 | Gate-system separation, rules L1–L5 (§6). | DLV-041 "no DG record is confused with G1-G6"; S20-028 "distinct from product gates" |
| V13 | Secret scan of every envelope file (the S10 rules) and claims scan of the payload archive's `docs/`: no hit. | S21-003, S16-033 (A28 halves) |
| V14 | Mode: a release verification refuses `rehearsal: true` in the manifest and any `synthetic_rehearsal` in a gate record; a rehearsal verification requires both. | §8 |
| V15 | (repo) `candidateId(manifestFromWorkingTree)` equals `payload.hash`, and each `evidence/` file equals the repository file at the same path. | R5/R6 of the plan |
| V16 | (repo) `node tools/gates/validate.mjs --historical --stage DGx` exits 0 for DG0–DG7, each run as a child process (output tail in the report). In a rehearsal DG7 is recorded `SKIPPED (rehearsal: synthetic gate record)`, never `PASS`. | p7-plan §4.1 step 5 "all eight gate records validate" |
| V17 | (repo) The latest `seal-report-<n>.json` in `--out` names the same `payloadHash`, `envelopeArchive.archiveSha256` and `envelopeManifestSha256`. | l.621 |
| V18 | (final report) §7.3. | DLV-031 |

#### 5.3 Exit codes and lines

| Exit | Line |
| --- | --- |
| 0 | `verify-seal: PASS` (release mode, every check ok) |
| 0 | `verify-seal: REHEARSAL-PASS (not a release verification; DG7 historical validation skipped: synthetic gate record)` |
| 1 | `verify-seal: FAIL (<n> checks)`, after one line `verify-seal: <id> FAIL <detail>` per failed check |
| 2 | `verify-seal: BLOCKED: <reason>` (unreadable envelope, not gzip, missing argument, `validate.mjs` not runnable) |

Only the exact line `verify-seal: PASS` from a release-mode run with `--repo` **and** `--final-report` allows final delivery to be declared (§9).

### 6. Gate-system separation rules (V12)

| Rule | Scope | Fails when |
| --- | --- | --- |
| L1 | each `gates/DGn.json` | the file name is not `DG<n>.json` for n 0–7; `stage_id` is not `DG<n>`; `previous_gate` is not `DG<n-1>` (`null` for DG0); `decision` is not `APPROVED`; `decided_by` is not `release-auditor` |
| L2 | gate records and `ENVELOPE-MANIFEST.json` | a key or a whole string value equals `G1`–`G6` (`/^G[1-6]$/`), or a key matches `/(product\|business)[ _-]?gate/i` |
| L3 | gate records' string values, the envelope `README.txt` and the final report | a sentence (split on `. `, `; ` and newlines) contains both `/\bDG[0-7]\b/` and `/(?<![A-Za-z0-9-])G[1-6]\b/` and contains none of the separation phrases `does not imply`, `never implies`, `never imply`, `not imply`, `neither implies`, `distinct from`, `separate from`, `not a product gate`, `not an engineering gate` (case-insensitive) |
| L4 | gate records' string values and the final report | a sentence matches `/\b(business\|finance\|it\|production\|sponsor)\b[^.\n]{0,30}\bapprov(al\|als\|ed\|es\|e)\b/i` and contains none of `no`, `not`, `never`, `neither`, `nor`, `without` as a word |
| L5 | the payload archive's `demo-data/tables/*.ndjson` | a row has a `gate_code` value not matching `/^G[1-6]$/`, or any string value of a row in a table whose name starts with `gate_` matches `/^DG[0-7]$/` |

- L1, L2 and L5 are field checks. L3 and L4 are text checks over **texts the delivery controls** (gate records, the README, the final report). Review records are free-form inspection narratives and are **not** text-scanned, because a sentence such as "DG6 exercised the G6 workflow" is correct there. L3/L4 on them would block delivery on wording, not on confusion. They are covered by V7's field check (`candidate_id`) only.
- The rule lists live in `tools/release/lib/gate-labels.mjs` (DO-J), exported for the tests.
- On the base, DO-J runs L1–L4 over the real `gates/DG0.json`–`DG6.json` (T-M9). A hit there is reported to the orchestrator (D-243 Q13: approved records are not rewritten) before the freeze, never fixed by editing a gate record.

### 7. The final delivery report (REQ-DLV-031)

#### 7.1 The template `docs/handover/final-report.template.md` (DO-J; English, ADR-0072 §2; in the payload and reviewed)

Placeholders are `{{NAME}}`. The headings and fixed sentences below are exact.

```text
# Mobily Transformation Hub — final delivery report

## 1. Release identity
- Payload hash (DG7 candidate id): {{PAYLOAD_HASH}}
- Source commit (traceability pointer): {{SOURCE_COMMIT}}
- Payload archive: {{PAYLOAD_ARCHIVE_NAME}}, SHA-256 {{PAYLOAD_ARCHIVE_SHA256}}
- Envelope archive: {{ENVELOPE_ARCHIVE_NAME}}, SHA-256 {{ENVELOPE_ARCHIVE_SHA256}}
- Seal report: {{SEAL_REPORT_PATH}}. Verify report: {{VERIFY_REPORT_PATH}}.

## 2. Limitation statement
Neither the number of agents nor their agreement guarantees correctness. The quality mechanism is independent inspection, executed tests, traceability, repair and reproducible evidence.

## 3. Two gate systems
DG0-DG7 are engineering delivery gates. G1-G6 are business approvals inside the product. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1-G6. This report grants no business, Finance or IT approval. Demonstration data is synthetic.

## 4. Capabilities and the executed checks
{{CAPABILITY_LINES}}

## 5. Engineering gate reports
{{GATE_LINES}}

## 6. Unfinished items and release blockers
{{BLOCKER_LINES}}

## 7. Remaining external configuration dependencies
{{DEPENDENCY_LINES}}

## 8. Where to start
Setup: docs/handover/deployment.md. Administrator bootstrap: docs/handover/deployment.md. Operator guide: docs/handover/operator-guide.md. Known limitations: docs/handover/known-limitations.md. Release notes: docs/handover/release-notes.md.
```

Section 2 is M0074's text verbatim. The guides named in section 8 are those ADR-0072 assigns. If a guide is missing at the freeze, DO-J's T-M12 fails and the orchestrator is told before the freeze.

#### 7.2 The lines the orchestrator fills

- **Capability line** (one per claimed capability): ``- **CAP-NN** <capability> — check: `<command or test id>` — result: PASS — evidence: `<path>[#fragment]` ``
  - The required ids are CAP-01 … CAP-12 (l.627 and the A28 scope): 01 working application (A02 on the DG7 candidate); 02 source archive (`build-archive --verify`, V4); 03 build from the archive with no network (REQ-S19-002); 04 clean deployment and setup instructions (A18 transfer drill); 05 secure administrator bootstrap (REQ-DLV-039); 06 IT handover set (ADR-0072 checks); 07 requirement coverage (V9, T-I10); 08 test evidence per gate (the REQ-S20-031 index); 09 all eight gate reports (V6, V16); 10 backup and restore (A19); 11 A01–A27 on the DG7 candidate (QA-B/C/D); 12 release sealing (this verify report).
  - A capability whose check did not pass, or did not run, is **not** written as a capability line. It goes to section 6 with its reason (BLOCKED or FAIL), and its CAP id is then listed there as `- **CAP-NN** not claimed: <reason>`.
- **Gate line:** `- DGn: <decision>, candidate <id>, record \`docs/delivery/gates/DGn.json\`` (eight lines).
- **Blocker lines:** the "Unfinished items and release blockers" section of `docs/handover/release-notes.md` (ADR-0071 §5) copied verbatim, plus any CAP not claimed. If the section is empty, the single line `None: every register row is IMPLEMENTED.`
- **Dependency lines:** the release-notes section "Remaining external configuration dependencies", verbatim.

#### 7.3 V18: the final-report check

1. No `{{` remains.
2. Sections 2 and 3 are byte-equal to the template's.
3. Every CAP-01 … CAP-12 appears exactly once, either as a capability line or as `not claimed` in section 6.
4. Each capability line matches the §7.2 pattern and says `result: PASS`.
5. Each evidence path is a regular file in the sealed repository **and** is a payload file, an envelope-listed file, or a file under `docs/delivery/test-evidence/DG7/seal/`. A directory or a missing file fails (the validator's evidence rule).
6. The payload hash and the two archive checksums in section 1 equal the latest seal report's.
7. Exactly eight gate lines, DG0–DG7.
8. L3 and L4 pass on the report.

### 8. The rehearsal (DO-J, before the freeze)

#### 8.1 The scratch clone (disk-safe)

```text
git clone --no-checkout --shared <repo> "$TMPDIR/seal-rehearsal"
git -C "$TMPDIR/seal-rehearsal" sparse-checkout set --no-cone '/*' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/'
git -C "$TMPDIR/seal-rehearsal" checkout <HEAD 40 hex>
```

The three omitted directories are in `META_EXCLUDES`, so `candidate.mjs --stage DG7` in the clone prints the same id as the repository at that commit (T-M1 asserts it). `node_modules` is not needed: the seal tools use built-ins and the clone resolves `yaml` only if a scan needs it (none does). The clone is deleted at the end of the test.

#### 8.2 The synthetic DG7 gate record

Written **only inside the scratch clone**, at `docs/delivery/gates/DG7.json`:

- the real record shape (Context 4) with `decision` `APPROVED`, `candidate_id` the clone's candidate id, `source_commit` the clone's `HEAD`, `previous_gate` `DG6`, `decided_by` `release-auditor`;
- plus `"synthetic_rehearsal": true` and `notes` beginning with `SYNTHETIC REHEARSAL RECORD: not a gate decision. Written by the DG7 seal rehearsal in a scratch clone; it approves nothing.`;
- `reviews` and `release_audit` pointing at three synthetic review files and one synthetic audit file the rehearsal writes in the clone under `docs/delivery/reviews/DG7/round-0/`, each with `"synthetic_rehearsal": true` and the same `candidate_id`.

The rehearsal also writes the six required evidence files as one-line synthetic placeholders in the clone and commits everything in the clone. `--rehearsal` is passed to both tools. The real `docs/delivery/gates/` of the repository is never read for DG7 and never written. A test asserts that the repository's `git status --porcelain` is unchanged by the whole rehearsal (T-M2).

#### 8.3 Cases (each a `node --test` case in `tools/release/tests/seal.test.mjs` or `verify-seal.test.mjs`; the test ids are p7-work-split §M.3)

| Case | Tamper | Expected |
| --- | --- | --- |
| R0 | none | seal exit 0; verify exit 0 with `REHEARSAL-PASS`; V16 shows DG0–DG6 PASS (if their historical validation can run in the clone; otherwise BLOCKED with the reason) and DG7 SKIPPED |
| R1 | a payload file in the payload archive changed after sealing (rewrite one entry of `source/`) | V4 FAIL (SHA256SUMS and candidate id) and V1 FAIL |
| R2 | `evidence/docs/delivery/gates/DG3.json` removed from the envelope | V3 and V6 FAIL |
| R3 | one agent definition altered in `evidence/` | V3 and V8 FAIL |
| R4 | register in `evidence/` differs from the payload's (one byte) | V3 and V9 FAIL |
| R5 | synthetic DG7 record with `stage_id` `G6` | seal S1/L1 refuses, or verify V12 L1 FAIL |
| R6 | a gate record value `"G4"` in a new key `product_gate` | V12 L2 FAIL |
| R7 | demo-data fixture row with `gate_code` `DG7` | V12 L5 FAIL |
| R8 | a payload file changed in the working tree after approval | seal S4 exit 1 with the l.621 text |
| R9 | `--candidate` differs from the DG7 record | seal S2 exit 1 |
| R10 | a release-mode verify of a rehearsal envelope | V14 FAIL |
| R11 | `--out` set to a payload path (`docs/handover/x`) | exit 2, output-path guard |
| R12 | a final report with a capability line whose evidence path does not exist, and one with section 2 altered | V18 FAIL for each |
| R13 | after a successful rehearsal seal | `candidate.mjs --stage DG7` in the clone prints the unchanged id (R6 of the plan) |

The tampering cases rebuild the envelope bytes in memory with `lib/tar.mjs` and **keep the recorded `--expect-sha256`**, so V1 also fails where the bytes changed; a case that recomputes the checksum shows that the content checks fail on their own.

### 9. Outcomes

#### 9.1 Failure

A seal exit other than 0, or a verify result other than `verify-seal: PASS`, **blocks delivery**. The orchestrator records the failure in `progress.md` with the report path. Then:

- **A payload repair** (any file in the candidate) needs a new candidate, new reviews and a new audit (l.621). The old seal reports stay as evidence.
- **An envelope-only repair** (a missing or uncommitted delivery record, a wrong `--evidence` path, a lost `dist/release/`) is re-sealed with no new review, because the payload hash is unchanged. V17 and the new seal report show the same `payloadHash`.

#### 9.2 Re-seal

`seal.mjs` refuses to overwrite `seal-report-<n>.json`. A re-seal requires `--reseal-reason "<text>"`, writes sequence `n+1` and leaves every earlier report in place. The archives in `dist/release/` are replaced, and each report records the checksums it produced.

#### 9.3 Declaration

Final delivery is declared in `progress.md` only after: seal exit 0; `verify-seal --repo … --final-report …` printed `verify-seal: PASS`; and the seal, verify and final reports are committed under `test-evidence/DG7/seal/`. The orchestrator then marks the six `completes-after-gate:` clauses complete in its progress entry, citing the verify report. It does not edit the register (AN-P7's) or any approved gate record.

### 10. The A26 drill (REQ-S20-026; orchestrator; D-243 Q18)

**Purpose:** a known defect on a controlled branch is found by independent reviewers, fixed by an implementer, and closed by an independent re-check with a regression test. Every agent run counts against the four concurrent runs of D-004.

| Step | Action | Evidence (`docs/delivery/test-evidence/DG7/orchestrator/a26/`) |
| --- | --- | --- |
| K1 | Record the base `B` (40 hex, current `HEAD`). Create branch `drill/dg7-a26` at `B` and a **sparse** worktree for it outside the repository directory (§8.1's three exclusions; `git worktree add --no-checkout`, then `sparse-checkout set`, then `checkout`). | `drill-log.md` (commands, exit codes) |
| K2 | **Defect card.** Write the defect (file, lines, the behaviour it breaks, the requirement it violates, whether an existing test fails on it) to `defect-card.md`, and record **only its SHA-256** in `progress.md` before any reviewer run. The card is committed after the reviews (K5). The hash commitment proves the defect was fixed in advance and not chosen after the fact. | `defect-card.md` (later), its hash in `progress.md` |
| K3 | **Plant** one commit on the drill branch: a minimal, test-detectable defect in a server-side rule. Recommended class: a mutation route that checks a read permission instead of its write permission (an authorization defect, mandatory by CLAUDE.md). The commit message is neutral ("drill: candidate") so it does not reveal the defect. Compute the drill candidate id with `node tools/gates/candidate.mjs --stage DG7` in the worktree (no `--freeze`; nothing is written to the real `stages.json` or `candidates/`). | `drill-log.md` |
| K4 | **Reviews.** Run at least `code-security-reviewer` and `qa-verifier` (independent, one at a time if slots are short) with `tools/agents/run-agent.sh --cwd <worktree> --stage DG7 --task T-DG7-A26-REV-<role>`. Their assignment names the drill candidate id and the diff `B..drill head` as scope, says that a defect may or may not be present, and directs their findings to the drill-local file `drill-findings.json` in their own evidence directory (`test-evidence/DG7/<key>/a26/`), never `findings.json`. | run records in `runs/DG7/`; reviewer evidence |
| K5 | **Score.** Publish `defect-card.md` and check its hash against K2. The drill passes this step only if at least one reviewer finding names the defect's file and behaviour. A miss is recorded as a drill result, not hidden, and the drill is repeated with a new card. | `score.md` |
| K6 | **Fix.** An implementer of the owning role (never the orchestrator, never a reviewer of K4) fixes it on the drill branch and adds a regression test that fails on the defect commit and passes on the fix (both runs shown). | handback in `handbacks/DG7/`, test output |
| K7 | **Re-check.** A reviewer of K4 (not the implementer) re-runs the regression test and the affected suite on the fix commit and writes a verification entry in its drill-local file. | the reviewer's `a26/` evidence |
| K8 | **Close.** `drill-report.md`: base, defect card hash and text, drill candidate id, run ids, finding ids, fix commit, regression test command and both exit codes, verifier and result, and the statement that the drill branch is not merged and its findings are drill-local. Remove the worktree (`git worktree remove`); keep the branch for traceability. | `drill-report.md` (the seal's `--evidence A26=`) |

- **Precondition P-K1 (open question O2):** where `run-agent.sh` copies a reviewer's staged records back to, and where its review-role auto-commit runs, when `--cwd` is a worktree. If the copy-back or the commit targets the **main** repository's `docs/delivery/reviews/DG7/`, the drill would create DG7 review rounds, which it must never do. The orchestrator checks this before K4 by reading `tools/agents/agent_sandbox.py` (`prepare`/`finish`) and records the answer in `drill-log.md`. If it does target the main repository, K4 waits for an orchestrator tooling decision (a gate-tool change the orchestrator makes and reviewers review).
- **Never:** the planted commit never reaches `claude/mobily-transformation-platform-dg6-regate`; no drill finding enters `findings.json`; no drill record is a DG7 review round.

### 11. The A27 drill (REQ-S20-027, REQ-DLV-030; orchestrator)

**Purpose:** resume from a real checkpoint, reconstruct the stage, tasks and evidence from durable records only, flag stale reviews, and continue without inventing an approval.

**The checkpoint.** Commit `d8868b2a5c074b13c04693a88644c25ef2792583` (the DG6 `source_commit`, D-240). At that commit `stages.json` shows DG6 `FIXING` with frozen candidate `sha256:5e819f7a579dbf98eb78f7f8e326a7ad57d939ed6a0762e3bea912f6dc735ed6` (source `3c8b9a3acfe657348249feb297b52cf208324a07`), round 5 (domain, code-security) and round 6 (domain, qa) recorded (read with `git show d8868b2a5:docs/delivery/stages.json` by this task), and the working tree differs from the frozen manifest (`decisions.md` gained D-240). A reconcile there must flag the round-5 and round-6 records as stale. This is a real historical state, not a constructed one.

| Step | Action | Evidence (`docs/delivery/test-evidence/DG7/orchestrator/a27/`) |
| --- | --- | --- |
| K9 | Sparse scratch clone (§8.1) checked out at the checkpoint, under the orchestrator's `$TMPDIR`. | `drill-log.md` |
| K10 | `node tools/gates/validate.mjs --reconcile` in the clone. Expected: `active stage: DG6 (FIXING)`, the frozen candidate line, `working tree: … (differs: …)`, and each round-5/6 record `(STALE for current content)`. | `reconcile.txt` (full output, exit code) |
| K11 | **Reconstruct** from records only: `progress.md` "Next" line, `stages.json` state, the open tasks (assignments without a handback), the open findings. Write what the resumed session would do next and compare it with what actually happened next (round 7 on the new candidate `10f71f24…`, D-240 "Next"). | `reconstruction.md` |
| K12 | **No invented approval:** `node tools/gates/validate.mjs --stage DG6` in the clone exits non-zero (DG6 is not approved at the checkpoint), and `--pipeline` reports no stage past DG5. Both outputs recorded. | `validate-stage.txt`, `pipeline.txt` |
| K13 | **Fresh sessions:** list the run records of the work that followed the checkpoint (round 7 onwards) and show that each `meta.json` has a session id not used before the checkpoint (the agents were recreated, not resumed from memory). | `sessions.md` |
| K14 | **Validator unit half:** `node --test tools/gates/tests/validator.test.mjs` (the reconcile and A24/A27 cases) on the DG7 tree. | `validator-tests.txt` |
| K15 | `drill-report.md`: each of A27's four clauses ("reconstruct", "reject stale reviews", "continue without inventing approvals", "without requiring routine user confirmation") mapped to K10–K14 with exit codes. The last clause is shown by `progress.md` entries after the checkpoint continuing without a user prompt between rounds 6 and 7. Delete the clone. | `drill-report.md` (the seal's `--evidence A27=`) |

The A27 drill needs no agent run and no branch. It reads history and changes nothing.

### 12. Schema, contract, locks

- **No migration.** `0156`–`0157` stay free and are retired like `0131`–`0132` (D-245 O9). Slice M has no table.
- **No operation and no permission.** The contract is unchanged (965 operations). `apps/api/test/support/p7-pending.ts` is **finalized** by this task (p7-plan §5.3): ARCH-06 adds no list, the import set is final, and the file is frozen.
- **Advisory locks 730420–730421** are reserved for this block and not allocated: the seal and verify tools run outside the API and hold no database lock. Registry comment and ADR-0016 §6 row added.

### 13. Who builds it, and how it is tested

| Task | Builds | Tests |
| --- | --- | --- |
| **ARCH-06** (this) | this ADR; p7-work-split §M, §K, §L; the lock reservation; the `p7-pending.ts` finalization | `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, prettier |
| **DO-J** (W8, after ARCH-06 and DO-A) | `tools/release/{seal,verify-seal,release-notes}.mjs`, `tools/release/lib/{envelope,gate-labels,final-report}.mjs`, `docs/handover/final-report.template.md`, `docs/handover/release-notes.md` (generated), their tests and fixtures, the rehearsal | T-M1 … T-M14 (p7-work-split §M.1), T-I11, T-I13 (fixture half) |
| **orchestrator** | the freeze input (§3.3), the A26 and A27 drills, the seal, the verification, the final report | the drill reports; the seal and verify reports |
| **release-auditor** | reviews the seal tools and rehearsal as payload at DG7; may re-run `verify-seal` after the seal | its DG7 record |

No new dependency, runtime or development.

## Consequences

- The payload the reviewers approve is exactly the payload IT receives: the seal re-derives it from `source_commit`, refuses a drifted working tree, and the archive verifier recomputes the candidate id from `source/`.
- The envelope is reproducible from git: every input is committed, the manifest has no clock, and the tar is deterministic.
- Post-approval decisions go to `progress.md` until the declaration (§1). That is a new constraint on the orchestrator.
- A28's result does not exist at the gate. REQ-DLV-041 and REQ-S20-028 complete after the gate by design (D-243 Q19); their rows carry `completes-after-gate:`.

## Residuals (honest)

1. **Rehearsal is not the release run.** The rehearsal proves the tools on a synthetic DG7 record. The real A28 result exists only after approval, and its V16 for DG7 runs only then.
2. **V16 in the rehearsal clone** may be BLOCKED for DG0–DG6 if `validate.mjs --historical` needs files the sparse clone omits (`runs/**` for review-run binding). DO-J reports that BLOCKED with the reason; the real seal runs in the full repository.
3. **L3/L4 are text heuristics** over texts the delivery controls. They show that those texts state the separation; they cannot prove that no reader could misread a review narrative. Review records are excluded on purpose (§6).
4. **The `demo-data/` input is not reproducible** (ADR-0062 Residual 2). Its loss before the seal forces a re-export and a recorded replacement (§3.3, O1).
5. **A26 depends on P-K1** (where run-agent writes drill review records). Until checked, the drill cannot start.
6. **Envelope size and disk.** The envelope carries the cited review records (about 8 MiB for DG0–DG6) and the payload archive. The orchestrator must have room for two archives in `dist/release/`; the seal fails with an I/O error, never a partial pass, if it does not.
7. **No live CI** for the seal tests (D-058).

## Alternatives considered

- **Seal logic inside `tools/gates/validate.mjs`.** Rejected (D-243 Q8): a gate-rule change, protected from implementers, and not needed for l.621.
- **Putting `DG7.json` into the payload and re-freezing.** Rejected: self-referential (l.621).
- **Walking `docs/delivery/reviews/**` for the envelope.** Rejected (D-138): the envelope lists what the gates cite, so a stray or stale file never enters it.
- **Text-scanning review records for DG/G confusion.** Rejected as above (§6): false positives on correct narratives would block delivery on wording.
- **Signing the envelope (GPG or Sigstore).** Rejected: no company-controlled key exists in this environment, and a builder or personal key is forbidden. IT can sign the archive with its own key on receipt; the SHA-256 values are the integrity basis.
- **A full scratch clone for the rehearsal and A27.** Rejected for disk (Context 7); the sparse clone gives the same candidate id.

## Version evidence (M0314)

No new dependency. The seal and verify tools use Node.js 24.21.0 built-ins (`node:crypto`, `node:zlib`, `node:fs`, `node:child_process`), already pinned (ADR-0001, ADR-0062), and git, already required by the gate tools. `git sparse-checkout --no-cone` and `git clone --shared` are used by the rehearsal and the drills and are present in the host's git (checked by DO-J with `git --version` in its handback).
