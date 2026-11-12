#!/usr/bin/env node
// SBOM (CycloneDX 1.6 JSON) and licence inventory (CSV) generated from the committed pnpm lockfile
// (REQ-S16-009, REQ-S19-003; P1 increment, procurement flag and direct-dependency check ADR-0062 §7).
// Licence ids come from the installed packages' package.json.
//
//   node licenses/generate-sbom.mjs            write licenses/sbom.cdx.json and licenses/inventory.csv
//   node licenses/generate-sbom.mjs --check    exit 1 if the committed files differ from a fresh generation
//                                              (i.e. the lockfile changed without regenerating the inventory), if a
//                                              shipped package has no licence id, or if a direct dependency is not
//                                              pinned exactly, not the lockfile's version, or has no licence
//   --root <dir>                               another workspace root (the tests' fixtures); default: this repository
//
// The procurement flag is an engineering classification of SPDX expressions. It is not legal advice and not a
// procurement decision: Mobily procurement or legal decides (licenses/README.md "Procurement flag").
//
// Output is deterministic: no wall-clock timestamp (set SOURCE_DATE_EPOCH to add one) and a serial number derived
// from the lockfile hash. Needs an installed workspace (node_modules) for licence metadata; nothing else, no network.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildInventory, integrityToHash, purl, splitKey } from "./lib/lockfile.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Licences whose terms need no procurement step (ADR-0062 §7). */
export const PERMISSIVE = Object.freeze([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Zlib",
]);
/** Image-only addition: the PostgreSQL License is OSI-approved and permissive (ADR-0062 §7, postgres image). */
export const IMAGE_PERMISSIVE = Object.freeze([...PERMISSIVE, "PostgreSQL"]);
export const REASON_REQUIRED = "Custom or commercial licence: a procurement or legal decision is needed before use.";
export const reasonReview = (expr) =>
  `Licence ${expr} is not in the permissive set: review the obligations before redistribution.`;
export const reasonImage = (note) =>
  `Image contains components under several licences (${note}): review before redistribution.`;

/** Parses an SPDX expression into a tree, or returns null when it is not one (AND binds tighter than OR). */
export function parseSpdx(expr) {
  const tokens = String(expr).match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const primary = () => {
    const t = tokens[i++];
    if (t === undefined) throw new Error("end");
    if (t === "(") {
      const e = orExpr();
      if (tokens[i++] !== ")") throw new Error("paren");
      return e;
    }
    if (t === ")" || /^(AND|OR|WITH)$/i.test(t) || !/^[A-Za-z0-9.+:-]+$/.test(t)) throw new Error("token");
    let node = { id: t };
    if (peek() === "WITH") {
      i++;
      const exc = tokens[i++];
      if (!exc || !/^[A-Za-z0-9.+-]+$/.test(exc)) throw new Error("with");
      node = { id: t, with: exc };
    }
    return node;
  };
  const andExpr = () => {
    const parts = [primary()];
    while (peek() === "AND") {
      i++;
      parts.push(primary());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const orExpr = () => {
    const parts = [andExpr()];
    while (peek() === "OR") {
      i++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  try {
    const tree = orExpr();
    return i === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

function satisfied(node, set) {
  if (node.or) return node.or.some((n) => satisfied(n, set));
  if (node.and) return node.and.every((n) => satisfied(n, set));
  return !node.with && set.includes(node.id);
}

/** { procurement, reason } for a package licence expression (ADR-0062 §7 table). */
export function classifyLicence(expr, { image = false } = {}) {
  const e = String(expr ?? "").trim();
  if (e === "UNLICENSED" || /^SEE LICEN[SC]E IN/i.test(e) || e.includes("LicenseRef-"))
    return { procurement: "required", reason: REASON_REQUIRED };
  const tree = parseSpdx(e);
  if (tree && satisfied(tree, image ? IMAGE_PERMISSIVE : PERMISSIVE))
    return { procurement: "not_required", reason: "" };
  return { procurement: "review", reason: reasonReview(e || "NOASSERTION") };
}

/** A container image's licence note: an SPDX expression is classified; a note naming several licences is review. */
export function classifyImage(note) {
  const n = String(note ?? "").trim();
  if (parseSpdx(n)) return classifyLicence(n, { image: true });
  return { procurement: "review", reason: reasonImage(n) };
}

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Workspace manifests: root, apps/*, packages/* (pnpm-workspace.yaml), as [importer, relative path]. */
function workspaceManifests(root) {
  const out = [[".", "package.json"]];
  for (const group of ["apps", "packages"]) {
    if (!existsSync(join(root, group))) continue;
    for (const d of readdirSync(join(root, group)).sort())
      if (existsSync(join(root, group, d, "package.json"))) out.push([`${group}/${d}`, `${group}/${d}/package.json`]);
  }
  return out;
}

/** The direct-dependency check (ADR-0062 §7): one message per violation, [] when clean. */
export function checkDirectDependencies(root, lock, entries) {
  const problems = [];
  const licensed = new Map(entries.map((e) => [`${e.name}@${e.version}`, e.license]));
  for (const [importer, rel] of workspaceManifests(root)) {
    const pj = JSON.parse(readFileSync(join(root, rel), "utf8"));
    const resolved = lock.importers.get(importer) ?? [];
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(pj[kind] ?? {})) {
        if (String(spec).startsWith("workspace:")) continue;
        if (!EXACT.test(spec)) {
          problems.push(`generate-sbom: ${rel}: ${name} is not pinned to an exact version (${spec})`);
          continue;
        }
        const r = resolved.find((d) => d.name === name && d.kind === kind);
        const version = r ? splitKey(`${name}@${r.version}`).version : null;
        if (version !== spec) {
          problems.push(`generate-sbom: ${rel}: ${name}@${spec} is not in pnpm-lock.yaml`);
          continue;
        }
        const lic = licensed.get(`${name}@${spec}`);
        if (!lic || lic === "NOASSERTION")
          problems.push(`generate-sbom: direct dependency ${name}@${spec} has no licence in the inventory`);
      }
    }
  }
  return problems;
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function generate({ root = REPO, check = false } = {}) {
  const log = [];
  const err = [];
  if (!existsSync(join(root, "node_modules", ".pnpm"))) {
    return {
      code: 3,
      log,
      err: ["BLOCKED: node_modules/.pnpm not found; licence ids need an installed workspace"],
    };
  }
  const { entries, lockSha256, lock } = buildInventory(root);
  for (const e of entries) Object.assign(e, classifyLicence(e.license));
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const images = JSON.parse(readFileSync(join(root, "deploy", "images.lock.json"), "utf8")).images.map((img) => ({
    ...img,
    ...classifyImage(img.license),
  }));

  const serial = (() => {
    const h = createHash("sha256").update(`mth-sbom:${lockSha256}`).digest("hex");
    return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  })();

  const procurementProps = (x) => [
    { name: "mth:procurement", value: x.procurement },
    { name: "mth:procurement-reason", value: x.reason },
  ];

  const component = (e) => {
    const scoped = e.name.startsWith("@");
    const hash = integrityToHash(e.integrity);
    return {
      type: "library",
      "bom-ref": purl(e.name, e.version),
      ...(scoped
        ? { group: e.name.slice(0, e.name.indexOf("/")), name: e.name.slice(e.name.indexOf("/") + 1) }
        : { name: e.name }),
      version: e.version,
      scope: e.scope === "development" ? "excluded" : "required",
      ...(hash ? { hashes: [hash] } : {}),
      licenses: [{ expression: e.license }],
      purl: purl(e.name, e.version),
      properties: [
        { name: "mth:scope", value: e.scope },
        ...e.directOf.map((d) => ({ name: "mth:direct-dependency-of", value: d })),
        ...procurementProps(e),
      ],
    };
  };

  const containerComponent = (img) => ({
    type: "container",
    "bom-ref": `container:${img.id}`,
    name: img.ref,
    version: img.digest ? `${img.tag}@${img.digest}` : img.tag,
    // deploy/images.lock.json `scope`: production images ship/run in production; test-ci images (test IdP, CI browser
    // container) never do.
    scope: img.scope === "production" ? "required" : "excluded",
    licenses: [{ expression: "NOASSERTION" }],
    properties: [
      { name: "mth:role", value: img.role },
      { name: "mth:license-note", value: img.license },
      {
        name: "mth:digest-pinned",
        value: img.digest
          ? "yes"
          : img.blockedReason
            ? `NO - ${img.blockedReason}`
            : "NO (not yet pinned; see deploy/images.lock.json)",
      },
      ...procurementProps(img),
    ],
  });

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: serial,
    version: 1,
    metadata: {
      ...(process.env.SOURCE_DATE_EPOCH
        ? { timestamp: new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() }
        : {}),
      tools: { components: [{ type: "application", name: "mth licenses/generate-sbom.mjs", version: "1" }] },
      component: {
        type: "application",
        "bom-ref": "mth-app",
        name: rootPkg.name,
        version: rootPkg.version,
        description: "Mobily Transformation Hub (not an official PMI product)",
      },
      properties: [
        { name: "mth:source", value: "pnpm-lock.yaml" },
        { name: "mth:lockfile-sha256", value: lockSha256 },
      ],
    },
    components: [...entries.map(component), ...images.map(containerComponent)],
    dependencies: [
      {
        ref: "mth-app",
        dependsOn: entries
          .filter((e) => e.directOf.some((d) => !d.endsWith("(dev)")))
          .map((e) => purl(e.name, e.version)),
      },
      ...entries.map((e) => ({
        ref: purl(e.name, e.version),
        dependsOn: e.dependsOn.map((k) => {
          const at = k.lastIndexOf("@");
          return purl(k.slice(0, at), k.slice(at + 1));
        }),
      })),
    ],
  };

  const csv =
    [
      "name,version,license,scope,direct_dependency_of,integrity,procurement,procurement_reason",
      ...entries.map((e) =>
        [e.name, e.version, e.license, e.scope, e.directOf.join("; "), e.integrity ?? "", e.procurement, e.reason]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n") + "\n";
  // Formatted exactly as `pnpm format` would (the repository's format:check covers licenses/), when prettier is
  // installed; plain JSON.stringify otherwise (e.g. a production-only tree). Content is identical either way.
  const json = await (async () => {
    const raw = `${JSON.stringify(bom, null, 2)}\n`;
    try {
      const prettier = await import("prettier");
      const options = (await prettier.resolveConfig(join(root, "licenses", "sbom.cdx.json"))) ?? {};
      return await prettier.format(raw, { ...options, parser: "json" });
    } catch {
      return raw;
    }
  })();

  const counts = entries.reduce((acc, e) => ((acc[e.scope] = (acc[e.scope] ?? 0) + 1), acc), {});
  const proc = [...entries, ...images].reduce(
    (acc, e) => ((acc[e.procurement] = (acc[e.procurement] ?? 0) + 1), acc),
    {},
  );
  const unknown = entries.filter((e) => e.license === "NOASSERTION" && e.scope !== "development");
  const direct = checkDirectDependencies(root, lock, entries);
  const summary = `packages=${entries.length} runtime=${counts.runtime ?? 0} bundled=${counts.bundled ?? 0} development=${counts.development ?? 0} containers=${images.length} shipped-without-licence-id=${unknown.length} procurement(not_required=${proc.not_required ?? 0} review=${proc.review ?? 0} required=${proc.required ?? 0}) direct-dependency-problems=${direct.length} lockfile-sha256=${lockSha256}`;

  const outJson = join(root, "licenses", "sbom.cdx.json");
  const outCsv = join(root, "licenses", "inventory.csv");
  const unknownMsg = () =>
    `shipped packages without a licence id: ${unknown.map((e) => `${e.name}@${e.version}`).join(", ")}`;
  if (check) {
    const same = (p, s) => existsSync(p) && readFileSync(p, "utf8") === s;
    const ok = same(outJson, json) && same(outCsv, csv);
    log.push(`${ok ? "OK" : "STALE"}: ${summary}`);
    if (!ok)
      err.push("licenses/sbom.cdx.json or licenses/inventory.csv is out of date: run node licenses/generate-sbom.mjs");
    if (unknown.length > 0) err.push(unknownMsg());
    err.push(...direct);
    return { code: ok && unknown.length === 0 && direct.length === 0 ? 0 : 1, log, err, entries, images };
  }
  writeFileSync(outJson, json);
  writeFileSync(outCsv, csv);
  log.push(`wrote licenses/sbom.cdx.json and licenses/inventory.csv: ${summary}`);
  if (unknown.length > 0) err.push(unknownMsg());
  err.push(...direct);
  return { code: unknown.length > 0 || direct.length > 0 ? 1 : 0, log, err, entries, images };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--root");
  const r = await generate({ root: i >= 0 ? resolve(argv[i + 1]) : REPO, check: argv.includes("--check") });
  r.log.forEach((l) => console.log(l));
  r.err.forEach((l) => console.error(l));
  process.exit(r.code);
}
