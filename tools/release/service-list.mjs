#!/usr/bin/env node
// The service and dependency list of the release (ADR-0062 §6; REQ-S19-003 "the service list matches the Compose
// file"). Generates deploy/service-list.json from deploy/compose/*.yaml, deploy/images.lock.json and
// licenses/{inventory.csv,sbom.cdx.json}.
//
//   node tools/release/service-list.mjs [--root <dir>]            write deploy/service-list.json
//   node tools/release/service-list.mjs --check [--root <dir>]    exit 1 if the committed file differs
//
// Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED (missing input), 3 BLOCKED (no installed workspace: the `yaml` package of the
// lockfile is resolved from apps/api, the precedent of deploy/scripts/check-ci-needs.mjs). No network.
// A later Compose service must add ONE line to SERVICE_ROLES (p7-work-split A.2) and regenerate the file.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = "deploy/service-list.json";
const APP_IMAGE = "${MTH_APP_IMAGE:-mth-app:local}";

/** ADR-0062 §6, verbatim. */
export const SERVICE_ROLES = Object.freeze({
  db: "PostgreSQL database of the hub (product data, audit, job queue).",
  migrate: "One-shot database migration run before the API and worker start.",
  api: "HTTP API and the web application (single-page app served by the API).",
  worker: "Background job worker (notifications, schedules, connectors, exports).",
  keycloak:
    "Test identity provider for local verification only; production uses Mobily's corporate identity provider.",
  smoke: "One-shot smoke test of a running stack (test profile).",
  "load-generate": "One-shot generator of the synthetic load dataset (load profile, never production).",
  "load-sessions": "One-shot creation of synthetic load-test sessions (load profile, never production).",
});

/** p7-work-split A.3, verbatim. No enterprise-messaging row: restricted-network.md lists no such channel at DG6. */
export const EXTERNAL_DEPENDENCIES = Object.freeze([
  {
    name: "Corporate OIDC identity provider",
    required: true,
    offUntil: null,
    guide: "docs/operations/identity-saml-broker.md",
  },
  {
    name: "SMTP relay (email notifications)",
    required: false,
    offUntil: "an email channel is configured and enabled",
    guide: "docs/operations/notifications.md",
  },
  {
    name: "S3-compatible object store (evidence)",
    required: false,
    offUntil: "the storage setting is switched to s3",
    guide: "docs/operations/storage.md",
  },
  {
    name: "Connector source endpoints",
    required: false,
    offUntil: "an http_pull connector is created and enabled",
    guide: "docs/operations/restricted-network.md",
  },
  {
    name: "Assistant model endpoint",
    required: false,
    offUntil: "the assistant setting is enabled with http_endpoint",
    guide: "docs/operations/restricted-network.md",
  },
]);

export class ServiceListError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function loadYaml() {
  try {
    return createRequire(join(REPO, "apps", "api", "package.json"))("yaml");
  } catch {
    throw new ServiceListError("service-list: BLOCKED: the yaml package is not installed (run pnpm install)", 3);
  }
}

/** Minimal RFC 4180 CSV reader (the inventory's reason column is quoted when needed). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : Object.keys(v));
const asStrings = (v) =>
  (v == null ? [] : Array.isArray(v) ? v : []).map((x) =>
    typeof x === "string" ? x : `${x.source ?? ""}:${x.target ?? ""}${x.published ? `:${x.published}` : ""}`,
  );

/** Generates the list object. Throws ServiceListError on a missing role or an unpinned image. */
export function generateServiceList({ root = REPO, roles = SERVICE_ROLES, external = EXTERNAL_DEPENDENCIES } = {}) {
  const YAML = loadYaml();
  const composeDir = join(root, "deploy", "compose");
  if (!existsSync(composeDir)) throw new ServiceListError(`service-list: BLOCKED: ${composeDir} not found`, 2);
  const tags = ["!reset", "!override"].flatMap((tag) => [
    { tag, collection: "seq", resolve: (v) => v },
    { tag, collection: "map", resolve: (v) => v },
    { tag, resolve: (v) => v },
  ]);
  const files = readdirSync(composeDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const services = new Map();
  for (const f of files) {
    const rel = `deploy/compose/${f}`;
    const doc = YAML.parse(readFileSync(join(composeDir, f), "utf8"), { merge: true, customTags: tags }) ?? {};
    for (const [name, def] of Object.entries(doc.services ?? {})) {
      const s = services.get(name) ?? { name, files: [], def: {} };
      s.files.push(rel);
      // The base definition is the one that sets `image`; overlays (no-egress, load) only extend it and are listed
      // in `files`. The values reported are the base file's (a variant's `!reset` ports are not the default).
      if (def && def.image !== undefined) s.def = def;
      services.set(name, s);
    }
  }
  const lock = JSON.parse(readFileSync(join(root, "deploy", "images.lock.json"), "utf8")).images;
  const lockId = new Map(lock.map((i) => [`${i.ref}:${i.tag}@${i.digest}`, i]));
  const out = [];
  for (const name of [...services.keys()].sort()) {
    const { files: defFiles, def } = services.get(name);
    if (!Object.hasOwn(roles, name)) throw new ServiceListError(`service-list: no role text for service '${name}'`, 1);
    const image = def.image ?? null;
    let imageLockId;
    let imageScope;
    if (image === APP_IMAGE) (imageLockId = "mth-app"), (imageScope = "application");
    else {
      const hit = lockId.get(image);
      if (!hit)
        throw new ServiceListError(
          `service-list: service '${name}' image '${image}' is not a deploy/images.lock.json entry`,
          1,
        );
      imageLockId = hit.id;
      imageScope = hit.scope;
    }
    const profiles = asList(def.profiles);
    out.push({
      name,
      files: defFiles,
      profiles,
      image,
      imageLockId,
      imageScope,
      dependsOn: asList(def.depends_on),
      volumes: asStrings(def.volumes),
      publishedPorts: asStrings(def.ports),
      networks: asList(def.networks),
      role: roles[name],
      requiredInProduction: profiles.length === 0,
    });
  }
  // The SBOM's container components must equal the images.lock.json entries (ADR-0062 §6).
  const sbom = JSON.parse(readFileSync(join(root, "licenses", "sbom.cdx.json"), "utf8"));
  const sbomIds = (sbom.components ?? [])
    .filter((c) => c.type === "container")
    .map((c) => String(c["bom-ref"]).replace(/^container:/, ""))
    .sort();
  const lockIds = lock.map((i) => i.id).sort();
  if (JSON.stringify(sbomIds) !== JSON.stringify(lockIds))
    throw new ServiceListError(
      `service-list: SBOM container components (${sbomIds.join(", ")}) differ from deploy/images.lock.json (${lockIds.join(", ")}): run node licenses/generate-sbom.mjs`,
      1,
    );
  const containerProc = new Map(
    (sbom.components ?? [])
      .filter((c) => c.type === "container")
      .map((c) => [
        String(c["bom-ref"]).replace(/^container:/, ""),
        c.properties?.find((p) => p.name === "mth:procurement")?.value ?? null,
      ]),
  );
  const inventory = parseCsv(readFileSync(join(root, "licenses", "inventory.csv"), "utf8"));
  const tally = (key) =>
    Object.fromEntries(
      Object.entries(
        inventory.reduce((acc, r) => ((acc[r[key] || "(none)"] = (acc[r[key] || "(none)"] ?? 0) + 1), acc), {}),
      ).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  return {
    $comment:
      "GENERATED by node tools/release/service-list.mjs (ADR-0062 §6); do not edit. `--check` fails when it differs from the Compose files. Engineering inventory, not an IT approval.",
    schemaVersion: 1,
    composeFiles: files.map((f) => `deploy/compose/${f}`),
    services: out,
    external: external.map((e) => ({ name: e.name, required: e.required, offUntil: e.offUntil, guide: e.guide })),
    dependencies: {
      lockfileSha256: createHash("sha256")
        .update(readFileSync(join(root, "pnpm-lock.yaml")))
        .digest("hex"),
      packages: inventory.length,
      packagesByScope: tally("scope"),
      packagesByProcurement: tally("procurement"),
      containerImages: lock.map((i) => ({
        id: i.id,
        ref: i.ref,
        tag: i.tag,
        digest: i.digest,
        scope: i.scope,
        licenseNote: i.license,
        procurement: containerProc.get(i.id) ?? null,
      })),
    },
  };
}

/** Serialized exactly as Prettier formats it (deploy/ is under format:check), plain JSON when Prettier is absent. */
export async function serialize(list, root = REPO) {
  const raw = `${JSON.stringify(list, null, 2)}\n`;
  try {
    const prettier = await import("prettier");
    const options = (await prettier.resolveConfig(join(root, OUT))) ?? {};
    return await prettier.format(raw, { ...options, parser: "json" });
  } catch {
    return raw;
  }
}

export async function run({ root = REPO, check = false, roles = SERVICE_ROLES } = {}) {
  const text = await serialize(generateServiceList({ root, roles }), root);
  const target = join(root, OUT);
  if (check) {
    const same = existsSync(target) && readFileSync(target, "utf8") === text;
    if (!same)
      throw new ServiceListError(
        "service-list: deploy/service-list.json is out of date: run node tools/release/service-list.mjs",
        1,
      );
    return "service-list: OK deploy/service-list.json matches the Compose files";
  }
  writeFileSync(target, text);
  return `service-list: wrote ${OUT}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--root");
  const root = i >= 0 ? resolve(argv[i + 1]) : REPO;
  run({ root, check: argv.includes("--check") }).then(
    (msg) => {
      console.log(msg);
      process.exit(0);
    },
    (e) => {
      console.error(e instanceof ServiceListError ? e.message : `service-list: BLOCKED: ${e.message}`);
      process.exit(e instanceof ServiceListError ? e.exitCode : 2);
    },
  );
}
