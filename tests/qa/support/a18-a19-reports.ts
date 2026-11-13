// qa-verifier (T-DG7-QA-A): the report checks of the A18 transfer drill and the A19 restore drill, as pure functions.
//
// They are pure so the harnesses can prove them on synthetic fixtures (a good report passes, each broken report names
// its problem) before the drills exist: an assertion that never fails proves nothing. Each problem string names the
// acceptance clause it enforces.
//
// Sources (read-only): master prompt §20 A18 "Clean environment starts successfully, restored records/files/
// configuration work and workflows run without the original builder or mandatory public SaaS"; A19 "Restore drill
// recovers database, evidence, audit, snapshots and job state with documented checks and timings";
// ADR-0069 §4 (steps D0–D11, report `mth-transfer-drill/1`); ADR-0066 §2, §7–§9 (manifest `mth-backup/1`, R1–R9,
// `restore-report.json`); p7-work-split §B.4, §B.5, §E.4, §E.5 (tests and exact script lines).
//
// Where an ADR names a field but not its exact JSON shape, the reading used here is stated next to the check and is an
// open question in the handback (docs/delivery/handbacks/DG7/T-DG7-QA-A-qa-verifier.md).

/** Report files are parsed JSON whose shape is checked here, so the type is deliberately loose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

// ------------------------------------------------------------------------------------------------ shared helpers

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

/** A measured duration: a finite number of seconds, >= 0. A missing timing is never read as 0 (Unknown is not 0). */
export function isSeconds(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Every place in a JSON document where a comparison reports inequality: a key `equal`/`match`/`matches` that is
 * `false`, or a `mismatches`/`missing`/`differences` key that is a non-empty array or a positive number.
 */
export function inequalities(doc: Json, path = "$"): string[] {
  const out: string[] = [];
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => out.push(...inequalities(v, `${path}[${i}]`)));
    return out;
  }
  if (!isObj(doc)) return out;
  for (const [k, v] of Object.entries(doc)) {
    const p = `${path}.${k}`;
    if (["equal", "match", "matches"].includes(k) && v === false) out.push(p);
    else if (["mismatches", "missing", "differences"].includes(k)) {
      if ((Array.isArray(v) && v.length > 0) || (typeof v === "number" && v > 0)) out.push(p);
      else out.push(...inequalities(v, p));
    } else out.push(...inequalities(v, p));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ A18 (ADR-0069 §4)

export const TRANSFER_SCHEMA = "mth-transfer-drill/1";
export const TRANSFER_STEPS = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11"] as const;
export const DRILL_IDP_LABEL = "synthetic drill IdP (not a corporate IdP)";
/** p7-work-split §B.5, exit 0. */
export const TRANSFER_PASS_LINE =
  /^transfer-drill: PASS in (\d+(?:\.\d+)?) s: (\d+) tables and (\d+) evidence files equal, origin (\S+), restart verified; report (\S+)$/m;

/**
 * The problems of a `transfer-drill-report.json`. Fields read (ADR-0069 §4 D11): `schemaVersion`, `result`,
 * `steps[]` (`id`, `command`, `exit`, `seconds`, `result`), the archive checksum, and the IdP label. The archive checksum
 * is looked up as `archive.sha256` or `archiveSha256`, and the label as `idp.label` or `idpLabel` (shape not fixed by
 * the ADR; open question O2).
 */
export function transferReportProblems(report: Json, expect: { archiveSha256?: string } = {}): string[] {
  const p: string[] = [];
  if (!isObj(report)) return ["A18 report: not a JSON object"];
  if (report.schemaVersion !== TRANSFER_SCHEMA)
    p.push(`A18 report: schemaVersion is ${JSON.stringify(report.schemaVersion)}, expected ${TRANSFER_SCHEMA}`);
  const steps: Json[] = Array.isArray(report.steps) ? report.steps : [];
  if (!Array.isArray(report.steps)) p.push("A18 report: steps[] missing");
  const ids = steps.map((s) => (isObj(s) ? s.id : undefined));
  if (JSON.stringify(ids) !== JSON.stringify(TRANSFER_STEPS))
    p.push(`A18 report: steps are ${JSON.stringify(ids)}, expected D0..D11 in order (none skipped)`);
  for (const s of steps) {
    if (!isObj(s)) continue;
    if (s.result !== "PASS") p.push(`A18 step ${s.id}: result ${JSON.stringify(s.result)}, expected PASS`);
    if (s.exit !== 0) p.push(`A18 step ${s.id}: exit ${JSON.stringify(s.exit)}, expected 0`);
    if (!isSeconds(s.seconds)) p.push(`A18 step ${s.id}: seconds ${JSON.stringify(s.seconds)} is not a measured time`);
    if (typeof s.command !== "string" || s.command.length === 0) p.push(`A18 step ${s.id}: no command recorded`);
  }
  if (report.result !== "PASS") p.push(`A18 report: result ${JSON.stringify(report.result)}, expected PASS`);
  // `result` PASS only if every step passed (ADR-0069 §4 D11): a PASS beside a failed step is a lie.
  if (report.result === "PASS" && steps.some((s) => !isObj(s) || s.result !== "PASS"))
    p.push("A18 report: result PASS although a step did not pass");
  const archiveSha = report.archive?.sha256 ?? report.archiveSha256;
  if (typeof archiveSha !== "string" || !HEX64.test(archiveSha)) p.push("A18 report: archive SHA-256 not recorded");
  else if (expect.archiveSha256 && archiveSha !== expect.archiveSha256)
    p.push(`A18 report: archive SHA-256 ${archiveSha} is not the archive given (${expect.archiveSha256})`);
  const label = report.idp?.label ?? report.idpLabel;
  if (label !== DRILL_IDP_LABEL)
    p.push(`A18 report: IdP label ${JSON.stringify(label)}, expected "${DRILL_IDP_LABEL}"`);
  return p;
}

/**
 * The problems of `config-trace.json` (ADR-0069 §4 D3, REQ-S19-009 "configured only from the template and guides").
 * Read as `{ entries: [{ key, section }] }` or an array of `{ key, section }` (open question O2). Every key must
 * cite a section heading anchor present in the deployment guide, and must be a key of `.env.example`.
 */
export function configTraceProblems(trace: Json, guideAnchors: ReadonlySet<string>, templateKeys: ReadonlySet<string>) {
  const p: string[] = [];
  const entries: Json[] = Array.isArray(trace) ? trace : Array.isArray(trace?.entries) ? trace.entries : [];
  if (entries.length === 0) p.push("A18 D3: config-trace.json lists no filled key");
  for (const e of entries) {
    const key = e?.key;
    const section = String(e?.section ?? e?.guideSection ?? "").replace(/^.*#/, "");
    if (typeof key !== "string") {
      p.push("A18 D3: a trace entry has no key");
      continue;
    }
    if (!templateKeys.has(key)) p.push(`A18 D3: ${key} is not a key of .env.example (not from the template)`);
    if (!section) p.push(`A18 D3: ${key} cites no guide section (undocumented step)`);
    else if (!guideAnchors.has(section))
      p.push(`A18 D3: ${key} cites #${section}, which docs/handover/deployment.md does not have`);
  }
  return p;
}

/**
 * The problems of `origin-scan.json` (ADR-0069 §4 D10, T-B3): the source origin may remain only in `audit_event`.
 * Read as `{ hits: [{ table, column, rows }] }` (open question O2).
 */
export function originScanProblems(scan: Json): string[] {
  if (!isObj(scan) || !Array.isArray(scan.hits)) return ["A18 D10: origin-scan.json has no hits[] list"];
  return scan.hits
    .filter((h: Json) => !isObj(h) || h.table !== "audit_event")
    .map((h: Json) => `A18 D10: the source origin is stored in ${h?.table}.${h?.column} (${h?.rows} rows)`);
}

/** GitHub-style anchors of the Markdown headings of a guide (`## Database URL` -> `database-url`). */
export function headingAnchors(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    out.add(
      m[1]!
        .replace(/\{#[^}]*\}|<[^>]*>/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-"),
    );
    // Explicit anchors: <a id="x"></a> or {#x}.
    for (const a of m[1]!.matchAll(/\{#([A-Za-z0-9_-]+)\}|id="([A-Za-z0-9_-]+)"/g)) out.add((a[1] ?? a[2])!);
  }
  for (const a of markdown.matchAll(/<a\s+(?:id|name)="([A-Za-z0-9_-]+)"/g)) out.add(a[1]!);
  return out;
}

/** The keys of an env template (`KEY=` lines, commented `# KEY=` lines included). */
export function templateKeys(envExample: string): Set<string> {
  const out = new Set<string>();
  for (const m of envExample.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) out.add(m[1]!);
  return out;
}

// ------------------------------------------------------------------------------------------------ A19 (ADR-0066)

export const BACKUP_SCHEMA = "mth-backup/1";
export const RESTORE_CHECKS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"] as const;
/** ADR-0066 §2 `timings`. */
export const BACKUP_TIMINGS = ["snapshot", "dump", "evidence", "config", "verify"] as const;
/** p7-work-split §E.5, `restore.sh` exit 0. */
export const RESTORE_PASS_LINE = /^restore: (\S+) restored and ready in (\d+(?:\.\d+)?) s; all checks passed$/m;
/** p7-work-split §E.5, `backup.sh` exit 0. */
export const BACKUP_PASS_LINE =
  /^backup: set (\S+) succeeded: (\d+) database bytes, (\d+) evidence objects; manifest sha256 ([0-9a-f]{64})$/m;

/** The problems of a `backup-manifest.json` (ADR-0066 §2). */
export function backupManifestProblems(m: Json): string[] {
  const p: string[] = [];
  if (!isObj(m)) return ["A19 manifest: not a JSON object"];
  if (m.schemaVersion !== BACKUP_SCHEMA) p.push(`A19 manifest: schemaVersion ${JSON.stringify(m.schemaVersion)}`);
  if (typeof m.migrationLevel !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(m.migrationLevel))
    p.push(`A19 manifest: migrationLevel ${JSON.stringify(m.migrationLevel)}`);
  if (!Number.isInteger(m.server?.major)) p.push("A19 manifest: server.major missing");
  const d = m.database;
  if (!isObj(d)) p.push("A19 manifest: database missing");
  else {
    if (d.file !== "db/database.dump" || d.format !== "custom") p.push("A19 manifest: database file/format");
    if (!HEX64.test(String(d.sha256))) p.push("A19 manifest: database.sha256");
    if (!HEX64.test(String(d.snapshotDigest))) p.push("A19 manifest: database.snapshotDigest (snapshots)");
    if (!Number.isInteger(d.auditEvents?.count) && typeof d.auditEvents?.count !== "string")
      p.push("A19 manifest: database.auditEvents.count (audit)");
    if (!isObj(d.pgbossJobsByState)) p.push("A19 manifest: database.pgbossJobsByState (job state)");
  }
  if (!isObj(m.evidence?.attachmentManifest)) p.push("A19 manifest: evidence.attachmentManifest (evidence)");
  if (!HEX64.test(String(m.config?.sha256))) p.push("A19 manifest: config.sha256 (configuration)");
  for (const t of BACKUP_TIMINGS)
    if (!isSeconds(m.timings?.[t])) p.push(`A19 manifest: timings.${t} is not a measured time`);
  if (JSON.stringify(m).match(/password|secret_value|BEGIN [A-Z ]*PRIVATE KEY/i))
    p.push("A19 manifest: holds a credential-like value (ADR-0066 §2: counts and checksums only)");
  return p;
}

/**
 * The problems of a `restore-report.json` (ADR-0066 §7 step 8: every check with its expected and actual value, and
 * the seconds of every step). Read as `{ checks: [{ id, expected, actual, result }], steps: [{ name, seconds }] }`
 * or `timings: { <step>: seconds }` (open question O3).
 */
export function restoreReportProblems(r: Json, checks: readonly string[] = RESTORE_CHECKS): string[] {
  const p: string[] = [];
  if (!isObj(r)) return ["A19 report: not a JSON object"];
  const list: Json[] = Array.isArray(r.checks) ? r.checks : [];
  for (const id of checks) {
    const c = list.find((x) => isObj(x) && x.id === id);
    if (!c) {
      p.push(`A19 report: check ${id} not recorded (documented checks)`);
      continue;
    }
    if (c.result !== "PASS") p.push(`A19 report: check ${id} result ${JSON.stringify(c.result)}, expected PASS`);
    if (!("expected" in c) || !("actual" in c)) p.push(`A19 report: check ${id} lacks expected/actual`);
    else if (c.result === "PASS" && JSON.stringify(c.expected) !== JSON.stringify(c.actual))
      p.push(`A19 report: check ${id} is PASS but expected ${JSON.stringify(c.expected)} != actual`);
  }
  const timings: [string, unknown][] = Array.isArray(r.steps)
    ? r.steps.map((s: Json) => [String(s?.name ?? s?.id), s?.seconds])
    : isObj(r.timings)
      ? Object.entries(r.timings)
      : [];
  if (timings.length === 0) p.push("A19 report: no step timings (timings)");
  for (const [name, s] of timings) if (!isSeconds(s)) p.push(`A19 report: step ${name} has no measured seconds`);
  return p;
}
