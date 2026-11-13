// The final delivery report check V18 (ADR-0073 §7.2–§7.3; REQ-DLV-031 "the final delivery report contains the
// limitation statement and links each claimed capability to an executed check"). Node 24 built-ins only; no I/O here:
// the caller passes the template text, the latest seal report and two path predicates.
import { checkGateLabels } from "./gate-labels.mjs";

/** CAP-01 … CAP-12 (ADR-0073 §7.2), with the capability each stands for. */
export const CAPABILITIES = Object.freeze([
  { id: "CAP-01", text: "working application (A02 on the DG7 candidate)" },
  { id: "CAP-02", text: "source archive (build-archive --verify, V4)" },
  { id: "CAP-03", text: "build from the archive with no network (REQ-S19-002)" },
  { id: "CAP-04", text: "clean deployment and setup instructions (A18 transfer drill)" },
  { id: "CAP-05", text: "secure administrator bootstrap (REQ-DLV-039)" },
  { id: "CAP-06", text: "IT handover set (ADR-0072 checks)" },
  { id: "CAP-07", text: "requirement coverage (V9, T-I10)" },
  { id: "CAP-08", text: "test evidence per gate (the REQ-S20-031 index)" },
  { id: "CAP-09", text: "all eight gate reports (V6, V16)" },
  { id: "CAP-10", text: "backup and restore (A19)" },
  { id: "CAP-11", text: "A01–A27 on the DG7 candidate (QA-B/C/D)" },
  { id: "CAP-12", text: "release sealing (this verify report)" },
]);
export const CAP_IDS = Object.freeze(CAPABILITIES.map((c) => c.id));

/** The §7.2 capability line: - **CAP-NN** <capability> — check: `<command or test id>` — result: PASS — evidence: `<path>[#fragment]` */
export const CAPABILITY_LINE = /^- \*\*(CAP-\d{2})\*\* (.+) — check: `([^`]+)` — result: (\S+) — evidence: `([^`#]+)(#[^`]*)?`$/;
/** The §7.2 "not claimed" line in section 6. */
export const NOT_CLAIMED_LINE = /^- \*\*(CAP-\d{2})\*\* not claimed: (.+)$/;
/** The §7.2 gate line: - DGn: <decision>, candidate <id>, record `docs/delivery/gates/DGn.json` */
export const GATE_LINE = /^- (DG[0-7]): ([A-Z_]+), candidate (sha256:[0-9a-f]{64}), record `docs\/delivery\/gates\/(DG[0-7])\.json`$/;

/** The guides section 8 of the template names (ADR-0072 assigns them; T-M12 checks they exist in the tree). */
export function guidePaths(template) {
  const s8 = section(template, 8) ?? "";
  return [...new Set([...s8.matchAll(/docs\/handover\/[A-Za-z0-9._/-]+\.md/g)].map((m) => m[0]))];
}

/**
 * The text of section `n` (from its "## n." heading up to the next "## " heading or the end), or null.
 * @param {string} text @param {number} n
 */
export function section(text, n) {
  const lines = String(text).split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${n}. `));
  if (start < 0) return null;
  let end = lines.findIndex((l, k) => k > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join("\n");
}

/**
 * V18 (ADR-0073 §7.3), rules 1–8.
 * @param {string} text the filled report
 * @param {{ template: string, sealReport: any, isListed: (path: string) => boolean, fileKind: (path: string) => "file"|"dir"|"missing" }} ctx
 *   isListed: the path is a payload file, an envelope-listed file, or a file under docs/delivery/test-evidence/DG7/seal/.
 * @returns {{ ok: boolean, problems: { rule: number, detail: string }[] }}
 */
export function checkFinalReport(text, { template, sealReport, isListed, fileKind }) {
  const problems = [];
  const bad = (rule, detail) => problems.push({ rule, detail });
  text = String(text);

  // 1. No placeholder remains.
  if (text.includes("{{")) bad(1, "a {{ placeholder remains");

  // 2. Sections 2 and 3 are byte-equal to the template's.
  for (const n of [2, 3]) {
    const want = section(template, n);
    const got = section(text, n);
    if (want === null) bad(2, `the template has no section ${n}`);
    else if (got === null || got.trimEnd() !== want.trimEnd()) bad(2, `section ${n} differs from the template`);
  }

  // 3 and 4. Capability lines (section 4) and "not claimed" lines (section 6).
  const seen = new Map(CAP_IDS.map((id) => [id, 0]));
  const evidencePaths = [];
  for (const line of (section(text, 4) ?? "").split("\n").slice(1)) {
    if (!line.startsWith("- **CAP-")) continue;
    const m = CAPABILITY_LINE.exec(line);
    if (!m) {
      bad(4, `capability line does not match the §7.2 pattern: ${line.slice(0, 120)}`);
      const id = /CAP-\d{2}/.exec(line)?.[0];
      if (id && seen.has(id)) seen.set(id, seen.get(id) + 1);
      continue;
    }
    if (!seen.has(m[1])) bad(3, `${m[1]} is not one of CAP-01 … CAP-12`);
    else seen.set(m[1], seen.get(m[1]) + 1);
    if (m[4] !== "PASS") bad(4, `${m[1]} says result: ${m[4]}, not PASS (a capability that did not pass is not claimed)`);
    evidencePaths.push({ id: m[1], path: m[5] });
  }
  for (const line of (section(text, 6) ?? "").split("\n").slice(1)) {
    const m = NOT_CLAIMED_LINE.exec(line);
    if (!m) continue;
    if (!seen.has(m[1])) bad(3, `${m[1]} is not one of CAP-01 … CAP-12`);
    else seen.set(m[1], seen.get(m[1]) + 1);
  }
  for (const [id, n] of seen) if (n !== 1) bad(3, `${id} appears ${n} times (exactly once is required)`);

  // 5. Evidence: a regular file in the sealed repository, and a payload, envelope-listed or seal-directory file.
  for (const { id, path } of evidencePaths) {
    const kind = fileKind(path);
    if (kind === "dir") bad(5, `${id} evidence ${path} is a directory, not a file`);
    else if (kind !== "file") bad(5, `${id} evidence ${path} does not exist`);
    else if (!isListed(path)) bad(5, `${id} evidence ${path} is neither a payload file, an envelope-listed file nor a seal file`);
  }

  // 6. Section 1 equals the latest seal report.
  const s1 = section(text, 1) ?? "";
  const field = (re) => re.exec(s1)?.[1] ?? null;
  if (!sealReport) bad(6, "no seal report to compare with");
  else {
    const ph = field(/^- Payload hash \(DG7 candidate id\): (\S+)$/m);
    const pa = field(/^- Payload archive: .+, SHA-256 ([0-9a-f]{64})$/m);
    const ea = field(/^- Envelope archive: .+, SHA-256 ([0-9a-f]{64})$/m);
    if (ph !== sealReport.payloadHash) bad(6, `payload hash ${ph} is not the seal report's ${sealReport.payloadHash}`);
    if (pa !== sealReport.payloadArchive?.archiveSha256)
      bad(6, `payload archive checksum ${pa} is not the seal report's ${sealReport.payloadArchive?.archiveSha256}`);
    if (ea !== sealReport.envelopeArchive?.archiveSha256)
      bad(6, `envelope archive checksum ${ea} is not the seal report's ${sealReport.envelopeArchive?.archiveSha256}`);
  }

  // 7. Exactly eight gate lines, DG0–DG7.
  const gateLines = (section(text, 5) ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => l.startsWith("- DG"));
  const stages = [];
  for (const l of gateLines) {
    const m = GATE_LINE.exec(l);
    if (!m || m[1] !== m[4]) bad(7, `gate line does not match the §7.2 pattern: ${l.slice(0, 120)}`);
    else stages.push(m[1]);
  }
  const want = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"];
  if (gateLines.length !== 8 || [...stages].sort().join(",") !== want.join(","))
    bad(7, `${gateLines.length} gate line(s); exactly eight, DG0–DG7, are required`);

  // 8. L3 and L4 on the report. Sections 2 and 3 are the template's fixed texts, held byte-equal by rule 2; they are
  // left out here because section 3's fixed sentence "G1-G6 are business approvals inside the product" meets the L4
  // pattern by construction (it defines the product gates; it claims no approval). A section 2 or 3 that differs from
  // the template stays in, and it already fails rule 2.
  let scanned = text;
  for (const n of [2, 3]) {
    const want = section(template, n);
    const got = section(scanned, n);
    if (want !== null && got !== null && got.trimEnd() === want.trimEnd()) scanned = scanned.replace(got, "");
  }
  for (const h of checkGateLabels({ texts: [{ label: "final report", text: scanned }] }).hits) bad(8, `${h.rule}: ${h.detail.slice(0, 160)}`);

  return { ok: problems.length === 0, problems };
}
