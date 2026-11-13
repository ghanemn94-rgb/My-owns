#!/usr/bin/env node
// The generated sections of the handover's known limitations (ADR-0072 §5; p7-work-split §H, DOC-B; REQ-S19-015 item
// "Known limitations"; M0414 "remaining external configuration dependencies"; D-249).
//
//   node tools/release/known-limitations.mjs --protocol-audit <report.json> [--root <dir>] [--environment <file>]
//        [--guide <file>] [--deps <file>] [--review <file>] (--check | --write)
//
// Three blocks of docs/handover/known-limitations.md, each between `<!-- generated:<name> begin -->` and
// `<!-- generated:<name> end -->`, plus docs/handover/external-dependencies.json:
//   external-dependencies  from the residual table of docs/delivery/environment.md (read as ONE named file, never by
//                          walking docs/delivery, D-138), plus three dependencies recorded by decisions rather than in
//                          that table (D-057 live registry, D-058 live CI, D-243 Q12 orchestration target). A table row
//                          this tool does not know, or a known row that is missing, is refused (exit 2): the list never
//                          drops or guesses an entry. The JSON is the contract's ExternalDependency array (ADR-0071),
//                          read by the register snapshot (About) and the release notes.
//   protocol-audit         from a `tools/release/protocol-audit.mjs --all --json` report given as --protocol-audit (the
//                          orchestrator's report at the freeze; DO-I's protocol-audit-all.json is the fixture): head and
//                          SHA-256, the D-249 statement (its text says "listed below", so it precedes the lines), one
//                          line per check x stage that is not PASS with its D-249 disclosure reference, then the
//                          accepted observations (F-DG6-952).
//   provisional-arabic     the provisional-Arabic UI label files with their entry counts (the release-notes rule), and
//                          every handover Markdown file holding Arabic text that docs/handover/arabic-review.json does
//                          not list.
// `--write` rewrites the blocks and the JSON; `--check` regenerates in memory and exits 1 on any byte difference.
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (a file differs), 2 BLOCKED (missing or invalid input, usage).
// Dependency-free: Node built-ins only (the provisional-file rule is imported from release-notes.mjs). It writes only
// the two output files. Nothing here grants or records an approval (G1-G6 or DG0-DG7).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { countProvisional, provisionalFiles } from "./release-notes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, "..", "..");
export const GUIDE_PATH = "docs/handover/known-limitations.md";
export const DEPS_PATH = "docs/handover/external-dependencies.json";
export const REVIEW_PATH = "docs/handover/arabic-review.json";
export const ENVIRONMENT_PATH = "docs/delivery/environment.md";
export const HANDOVER_DIR = "docs/handover";
export const BLOCKS = Object.freeze(["external-dependencies", "protocol-audit", "provisional-arabic"]);
export const ENV_SECTION = "## P6 residuals: live integrations not exercised in this environment";

/** p7-work-split §H.3 (the Arabic is provisional, D-243 Q7). */
export const TEXTS = Object.freeze({
  notVerifiedEn: "Not verified in this release. Mobily IT must supply and test it.",
  notVerifiedAr: "لم يُتحقق منه في هذا الإصدار. يجب أن توفره تقنية المعلومات في موبايلي وتختبره.",
  disclosureEn:
    "The delivery records of gates DG0–DG6 contain the historic protocol observations listed below, found by the protocol audit. None changed product behaviour. They are disclosed here, and no gate was reopened (decision D-249).",
  disclosureAr:
    "تتضمن سجلات التسليم للبوابات DG0–DG6 الملاحظات التاريخية المتعلقة بالبروتوكول المذكورة أدناه، والتي كشفها تدقيق البروتوكول. لم تغيّر أي منها سلوك المنتج. يُفصح عنها هنا، ولم يُعَد فتح أي بوابة (القرار D-249).",
  idpEn:
    "Sign-in has been tested only with a synthetic identity provider. Connecting the corporate identity provider is an external dependency.",
});

/**
 * The rows of the environment.md residual table, by the bold name in their first cell. Each maps to one contract
 * ExternalDependency (ADR-0071; key pattern ^[a-z][a-z0-9_.-]{1,63}$, status not_configured|not_verified|blocked).
 */
export const ENV_ROWS = Object.freeze([
  {
    name: "Corporate identity provider (OIDC)",
    key: "corporate-idp",
    title: "Corporate identity provider (OIDC sign-in through Mobily's IdP)",
    owner: "Mobily IT",
    status: "not_verified",
  },
  {
    name: "Keycloak test realm e2e",
    key: "keycloak-e2e",
    title: "Keycloak test-realm end-to-end sign-in (needs a container runtime)",
    owner: "Mobily IT, or the delivery orchestrator's container host run (D-243 Q1)",
    status: "blocked",
  },
  {
    name: "Brokered SAML",
    key: "saml-broker",
    title: "SAML identity provider through an OIDC broker",
    owner: "Mobily IT",
    status: "not_configured",
  },
  {
    name: "IT object store (S3-compatible)",
    key: "object-store",
    title: "S3-compatible object store for evidence",
    owner: "Mobily IT",
    status: "not_verified",
  },
  { name: "SMTP relay", key: "smtp-relay", title: "SMTP relay for the email channel", owner: "Mobily IT", status: "not_verified" },
  {
    name: "Enterprise messaging",
    key: "enterprise-messaging",
    title: "Enterprise messaging channel (no adapter ships in this release)",
    owner: "Mobily IT",
    status: "not_configured",
  },
  {
    name: "Corporate data source (`http_pull` connector)",
    key: "corporate-data-source",
    title: "Corporate data source for the http_pull connector",
    owner: "Mobily IT",
    status: "not_verified",
  },
  {
    name: "AI model endpoint (optional assistant)",
    key: "ai-endpoint",
    title: "IT-hosted AI model endpoint for the optional assistant (off by default)",
    owner: "Mobily IT",
    status: "not_configured",
  },
]);

/** Dependencies recorded by decisions, not by the environment.md table (ADR-0072 §5.1). */
export const DECISION_ROWS = Object.freeze([
  {
    key: "package-registry",
    title: "Live package and image registry or IT mirror for builds and image pulls",
    owner: "Mobily IT",
    status: "not_verified",
    source: "D-057",
    supplies:
      "An internal npm registry or mirror for the offline build, and an image registry or mirror for the images of `deploy/images.lock.json`",
  },
  {
    key: "live-ci",
    title: "Live CI execution of deploy/ci/ci.yml",
    owner: "Mobily IT",
    status: "not_verified",
    source: "D-058",
    supplies: "A CI runner for `deploy/ci/ci.yml` (copied to `.github/workflows/ci.yml`)",
  },
  {
    key: "orchestration-target",
    title: "Deployment configuration for Mobily's orchestration platform",
    owner: "Mobily IT",
    status: "not_configured",
    source: "D-243 Q12",
    supplies:
      "The name of the target orchestration platform. Deployment configuration for Mobily's orchestration platform is to be written when IT names the target. This release ships no such configuration.",
  },
]);

/** D-249 H1–H11 by check id and stage (`*` = every stage). A hit not in this map is shown as not covered by D-249. */
export const DISCLOSURES = Object.freeze({
  C1: { DG5: ["H1"], DG6: ["H2"] },
  C2: { "*": ["H3"], DG6: ["H3", "H4"] },
  C3: { "*": ["H5"] },
  C4: { DG4: ["H6"], DG5: ["H7"], DG6: ["H7"] },
  C5: { "*": ["H8"] },
  C6: { DG0: ["H9"], DG6: ["H10"] },
  C7: { DG3: ["H11"] },
});
const DISCLOSED_STAGES = new Set(["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6"]);

export class InputError extends Error {}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const posix = (p) => p.split(sep).join("/");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

// --------------------------------------------------------------------------------------------- external deps --

/** Splits one Markdown table line into trimmed cells (escaped pipes kept). */
function cells(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  for (let k = 0; k < inner.length; k++) {
    if (inner[k] === "\\" && inner[k + 1] === "|") {
      cur += "\\|";
      k++;
    } else if (inner[k] === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += inner[k];
  }
  out.push(cur.trim());
  return out;
}

/**
 * Reads the residual table of environment.md: [{ name, proven, residual, supplies, guide }].
 * @param {string} text
 */
export function parseEnvironmentTable(text) {
  const lines = String(text).split("\n");
  const start = lines.findIndex((l) => l.trim() === ENV_SECTION);
  if (start < 0) throw new InputError(`environment.md has no section '${ENV_SECTION}'`);
  let k = start + 1;
  while (k < lines.length && !lines[k].startsWith("## ") && !lines[k].startsWith("| Integration |")) k++;
  if (k >= lines.length || !lines[k].startsWith("| Integration |"))
    throw new InputError("environment.md: the residual table (header '| Integration |') was not found");
  const header = cells(lines[k]);
  if (header.length !== 5) throw new InputError(`environment.md: the residual table has ${header.length} columns, not 5`);
  const rows = [];
  for (k += 2; k < lines.length && lines[k].startsWith("|"); k++) {
    const c = cells(lines[k]);
    if (c.length !== 5) throw new InputError(`environment.md l.${k + 1}: ${c.length} cells, not 5`);
    const m = /^\*\*(.+?)\*\*/.exec(c[0]);
    if (!m) throw new InputError(`environment.md l.${k + 1}: the first cell has no bold integration name`);
    rows.push({ name: m[1], proven: c[1], residual: c[2], supplies: c[3], guide: c[4] });
  }
  if (rows.length === 0) throw new InputError("environment.md: the residual table has no rows");
  return rows;
}

/** The dependency rows: the environment table's (in table order), then the decision rows. */
export function buildDependencies(envRows) {
  const known = new Map(ENV_ROWS.map((r) => [r.name, r]));
  const seen = new Set();
  const out = [];
  for (const row of envRows) {
    const map = known.get(row.name);
    if (!map)
      throw new InputError(
        `environment.md: the residual row '${row.name}' has no mapping in known-limitations.mjs ENV_ROWS (add one; never drop a row)`,
      );
    if (seen.has(row.name)) throw new InputError(`environment.md: the residual row '${row.name}' appears twice`);
    seen.add(row.name);
    const dash = row.supplies.trim() === "" || /^—/.test(row.supplies.trim());
    out.push({
      key: map.key,
      title: map.title,
      owner: map.owner,
      status: map.status,
      source: `\`docs/delivery/environment.md\` (${row.name})`,
      supplies: dash ? "Nothing in this release (no adapter ships)" : row.supplies,
    });
  }
  for (const r of ENV_ROWS)
    if (!seen.has(r.name)) throw new InputError(`environment.md: the residual row '${r.name}' is missing`);
  for (const r of DECISION_ROWS) out.push({ ...r, source: r.source });
  return out;
}

/** The contract array (ADR-0071 ExternalDependency): key, title, owner, status only. */
export const contractDependencies = (deps) =>
  deps.map((d) => ({ key: d.key, title: d.title, owner: d.owner, status: d.status }));

export function renderDependencies(deps) {
  const L = [
    "| Key | Dependency | Status | Owner | What Mobily IT supplies | Source |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const d of deps)
    L.push(
      `| \`${d.key}\` | ${cell(d.title)} | \`${d.status}\` | ${cell(d.owner)} | ${cell(d.supplies)} | ${cell(d.source)} |`,
    );
  L.push(
    "",
    `Every dependency above: ${TEXTS.notVerifiedEn} The same list is \`external-dependencies.json\`, which the About screen and the release notes read.`,
    "",
    TEXTS.idpEn,
  );
  return L.join("\n");
}

// --------------------------------------------------------------------------------------------- protocol audit --

/** Validates the report's shape; returns it parsed. */
export function parseProtocolAudit(bytes, label = "protocol-audit report") {
  let r;
  try {
    r = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new InputError(`${label} is not valid JSON`);
  }
  const ok =
    r &&
    typeof r === "object" &&
    r.tool === "tools/release/protocol-audit.mjs" &&
    typeof r.head === "string" &&
    /^[0-9a-f]{40}$/.test(r.head) &&
    Array.isArray(r.stages) &&
    Array.isArray(r.checks) &&
    r.checks.every(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.requirement === "string" &&
        typeof c.stage === "string" &&
        ["PASS", "HIT", "BLOCKED"].includes(c.status) &&
        Array.isArray(c.hits) &&
        Array.isArray(c.notes),
    );
  if (!ok)
    throw new InputError(
      `${label} is not a 'tools/release/protocol-audit.mjs --all --json' report (tool, head, stages, checks[] with id, name, requirement, stage, status, hits, notes)`,
    );
  return r;
}

/** The D-249 reference for a check x stage. */
export function disclosureOf(id, stage) {
  if (!DISCLOSED_STAGES.has(stage)) return `not in D-249 (${stage}: disclosed by this release's records)`;
  const m = DISCLOSURES[id];
  const refs = m?.[stage] ?? m?.["*"];
  return refs ? `D-249 ${refs.join(", ")}` : "not in D-249 (found after it; to be decided by the orchestrator)";
}

export function renderProtocolAudit(report, bytes) {
  const L = [
    `Report: \`tools/release/protocol-audit.mjs\` ${cell(report.version ?? "")}, repository head \`${report.head}\`, SHA-256 \`${sha256(bytes)}\`, stages ${report.stages.join(", ")}.`,
    "",
    TEXTS.disclosureEn,
    "",
    "| Check | Requirement | Stage | Result | Hits | Disclosure |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let rows = 0;
  for (const c of report.checks) {
    if (c.status === "PASS") continue;
    rows++;
    const result = c.status === "BLOCKED" ? "BLOCKED (not a pass)" : "HIT";
    L.push(
      `| ${cell(c.id)} ${cell(c.name)} | ${cell(c.requirement)} | ${cell(c.stage)} | ${result} | ${c.hits.length} | ${disclosureOf(c.id, c.stage)} |`,
    );
  }
  if (rows === 0) L.push("| (none) | | | | 0 | |");
  const accepted = [];
  for (const c of report.checks)
    for (const n of c.notes)
      if (n && n.kind === "accepted-observation" && Array.isArray(n.items))
        for (const it of n.items)
          accepted.push(
            `- ${cell(c.id)} ${cell(c.name)}, ${cell(it.stage ?? c.stage)}: ${cell(it.kind ?? "observation")}, reported as the accepted observation ${cell((it.accepted_observation ?? []).join(", "))} (not a new hit; the approved history is not rewritten).`,
          );
  L.push("", "Accepted observations reported by the audit:", "");
  L.push(...(accepted.length ? accepted : ["- none"]));
  return L.join("\n");
}

// ----------------------------------------------------------------------------------------- provisional Arabic --

/** Reads docs/handover/arabic-review.json: an array of { path, reviewer, date }. */
export function readReview(file) {
  if (!existsSync(file)) throw new InputError(`missing ${posix(file)}`);
  let v;
  try {
    v = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new InputError(`${posix(file)} is not valid JSON`);
  }
  const ok =
    Array.isArray(v) &&
    v.every(
      (e) =>
        e &&
        typeof e === "object" &&
        Object.keys(e).sort().join(",") === "date,path,reviewer" &&
        typeof e.path === "string" &&
        typeof e.reviewer === "string" &&
        e.reviewer.trim() !== "" &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date),
    );
  if (!ok) throw new InputError(`${posix(file)} must be an array of { path, reviewer, date } entries`);
  return v;
}

const ARABIC = /[؀-ۿ]/;

/** Every Markdown file under docs/handover with Arabic text, as repository paths, sorted. */
export function arabicHandoverFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile() && name.endsWith(".md") && ARABIC.test(readFileSync(abs, "utf8")))
        out.push(posix(relative(root, abs)));
    }
  };
  const base = join(root, HANDOVER_DIR);
  if (existsSync(base)) walk(base);
  return out.sort();
}

export function renderProvisional(root, review) {
  const reviewed = new Set(review.map((e) => e.path));
  const files = provisionalFiles(root, ["apps/web/src/i18n"]).map((abs) => ({
    path: posix(relative(root, abs)),
    entries: countProvisional(readFileSync(abs, "utf8")),
  }));
  const L = ["| Provisional Arabic UI label file | Entries |", "| --- | --- |"];
  for (const f of files) L.push(`| \`${f.path}\` | ${f.entries} |`);
  const total = files.reduce((a, f) => a + f.entries, 0);
  L.push(`| Total | ${total} |`);
  const docs = arabicHandoverFiles(root).filter((p) => !reviewed.has(p));
  L.push("", `Handover files with Arabic text not listed in \`${REVIEW_PATH}\` (${docs.length}):`, "");
  L.push(...(docs.length ? docs.map((p) => `- \`${p}\``) : ["- none"]));
  L.push(
    "",
    `\`${REVIEW_PATH}\` lists ${review.length} file(s) checked by a qualified Arabic reviewer. Every Arabic text not listed there is provisional.`,
  );
  return L.join("\n");
}

// ------------------------------------------------------------------------------------------------- splicing --

export const beginOf = (name) => `<!-- generated:${name} begin -->`;
export const endOf = (name) => `<!-- generated:${name} end -->`;

/** Replaces the body of one generated block; refuses a missing, repeated or misordered marker pair. */
export function spliceBlock(text, name, body) {
  const b = beginOf(name);
  const e = endOf(name);
  const i = text.indexOf(b);
  const j = text.indexOf(e);
  if (i < 0 || j < 0) throw new InputError(`the guide has no '${b}' … '${e}' pair`);
  if (text.indexOf(b, i + 1) >= 0 || text.indexOf(e, j + 1) >= 0) throw new InputError(`the guide repeats '${b}' or '${e}'`);
  if (j < i) throw new InputError(`'${e}' precedes '${b}'`);
  return `${text.slice(0, i + b.length)}\n${body}\n${text.slice(j)}`;
}

/** Everything the tool generates, in memory. */
export function generate(opts) {
  const envText = readNamed(opts.environment, "environment.md");
  const auditBytes = readNamedBytes(opts.protocolAudit, "protocol-audit report");
  const report = parseProtocolAudit(auditBytes);
  const review = readReview(opts.review);
  const deps = buildDependencies(parseEnvironmentTable(envText));
  if (!existsSync(opts.guide)) throw new InputError(`missing guide ${posix(opts.guide)}`);
  let guide = readFileSync(opts.guide, "utf8");
  guide = spliceBlock(guide, "external-dependencies", renderDependencies(deps));
  guide = spliceBlock(guide, "protocol-audit", renderProtocolAudit(report, auditBytes));
  guide = spliceBlock(guide, "provisional-arabic", renderProvisional(opts.root, review));
  const json = `${JSON.stringify(contractDependencies(deps), null, 2)}\n`;
  return { guide, json, deps, report };
}

function readNamedBytes(file, label) {
  if (!file) throw new InputError(`no ${label} given`);
  if (!existsSync(file) || !lstatSync(file).isFile()) throw new InputError(`${label} not found: ${file}`);
  return readFileSync(file);
}
const readNamed = (file, label) => readNamedBytes(file, label).toString("utf8");

function parseArgs(argv) {
  const o = { mode: null };
  const take = (k) => {
    const v = argv[k + 1];
    if (v === undefined || v.startsWith("--")) throw new InputError(`${argv[k]} needs a value`);
    return v;
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--check" || a === "--write") {
      if (o.mode) throw new InputError("give exactly one of --check and --write");
      o.mode = a.slice(2);
    } else if (["--root", "--environment", "--protocol-audit", "--guide", "--deps", "--review"].includes(a)) {
      o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = take(k);
      k++;
    } else throw new InputError(`unknown argument ${a}`);
  }
  if (!o.mode) throw new InputError("give exactly one of --check and --write");
  if (!o.protocolAudit) throw new InputError("--protocol-audit <report.json> is required");
  const root = resolve(o.root ?? DEFAULT_ROOT);
  return {
    mode: o.mode,
    root,
    environment: resolve(root, o.environment ?? ENVIRONMENT_PATH),
    protocolAudit: resolve(o.protocolAudit),
    guide: resolve(root, o.guide ?? GUIDE_PATH),
    deps: resolve(root, o.deps ?? DEPS_PATH),
    review: resolve(root, o.review ?? REVIEW_PATH),
  };
}

export const USAGE =
  "usage: node tools/release/known-limitations.mjs --protocol-audit <report.json> [--root <dir>] [--environment <file>] [--guide <file>] [--deps <file>] [--review <file>] (--check | --write)";

export function main(argv, { out = console.log, err = console.error } = {}) {
  let opts;
  let g;
  try {
    opts = parseArgs(argv);
    g = generate(opts);
  } catch (e) {
    if (e instanceof InputError) {
      err(`known-limitations: BLOCKED: ${e.message}`);
      err(USAGE);
      return 2;
    }
    throw e;
  }
  const shown = (p) => posix(relative(opts.root, p)) || p;
  if (opts.mode === "write") {
    writeFileSync(opts.guide, g.guide);
    writeFileSync(opts.deps, g.json);
    out(`known-limitations: wrote ${shown(opts.guide)} and ${shown(opts.deps)} (${g.deps.length} dependencies; report head ${g.report.head})`);
    return 0;
  }
  const stale = [];
  if (readFileSync(opts.guide, "utf8") !== g.guide) stale.push(shown(opts.guide));
  if (!existsSync(opts.deps) || readFileSync(opts.deps, "utf8") !== g.json) stale.push(shown(opts.deps));
  if (stale.length) {
    err(
      `known-limitations: FAIL: ${stale.join(" and ")} differ from the generated content; run node tools/release/known-limitations.mjs --protocol-audit <report> --write`,
    );
    return 1;
  }
  out(`known-limitations: PASS (${shown(opts.guide)} and ${shown(opts.deps)} are current)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
