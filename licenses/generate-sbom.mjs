#!/usr/bin/env node
// SBOM (CycloneDX 1.6 JSON) and licence inventory (CSV) generated from the committed pnpm lockfile
// (REQ-S16-009, REQ-S19-003; P1 increment). Licence ids come from the installed packages' package.json.
//
//   node licenses/generate-sbom.mjs            write licenses/sbom.cdx.json and licenses/inventory.csv
//   node licenses/generate-sbom.mjs --check    exit 1 if the committed files differ from a fresh generation
//                                              (i.e. the lockfile changed without regenerating the inventory)
//
// Output is deterministic: no wall-clock timestamp (set SOURCE_DATE_EPOCH to add one) and a serial number derived
// from the lockfile hash. Needs an installed workspace (node_modules) for licence metadata; nothing else, no network.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, integrityToHash, purl } from "./lib/lockfile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const { entries, lockSha256 } = buildInventory(root);
if (!existsSync(join(root, "node_modules", ".pnpm"))) {
  console.error("BLOCKED: node_modules/.pnpm not found; licence ids need an installed workspace");
  process.exit(3);
}
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const images = JSON.parse(readFileSync(join(root, "deploy", "images.lock.json"), "utf8")).images;

const serial = (() => {
  const h = createHash("sha256").update(`mth-sbom:${lockSha256}`).digest("hex");
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
})();

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

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv =
  [
    "name,version,license,scope,direct_dependency_of,integrity",
    ...entries.map((e) =>
      [e.name, e.version, e.license, e.scope, e.directOf.join("; "), e.integrity ?? ""].map(csvCell).join(","),
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
const unknown = entries.filter((e) => e.license === "NOASSERTION" && e.scope !== "development");
const summary = `packages=${entries.length} runtime=${counts.runtime ?? 0} bundled=${counts.bundled ?? 0} development=${counts.development ?? 0} containers=${images.length} shipped-without-licence-id=${unknown.length} lockfile-sha256=${lockSha256}`;

const outJson = join(root, "licenses", "sbom.cdx.json");
const outCsv = join(root, "licenses", "inventory.csv");
if (check) {
  const same = (p, s) => existsSync(p) && readFileSync(p, "utf8") === s;
  const ok = same(outJson, json) && same(outCsv, csv);
  console.log(`${ok ? "OK" : "STALE"}: ${summary}`);
  if (!ok)
    console.error(
      "licenses/sbom.cdx.json or licenses/inventory.csv is out of date: run node licenses/generate-sbom.mjs",
    );
  if (unknown.length > 0)
    console.error(`shipped packages without a licence id: ${unknown.map((e) => `${e.name}@${e.version}`).join(", ")}`);
  process.exit(ok && unknown.length === 0 ? 0 : 1);
}
writeFileSync(outJson, json);
writeFileSync(outCsv, csv);
console.log(`wrote licenses/sbom.cdx.json and licenses/inventory.csv: ${summary}`);
if (unknown.length > 0) {
  console.error(`shipped packages without a licence id: ${unknown.map((e) => `${e.name}@${e.version}`).join(", ")}`);
  process.exit(1);
}
