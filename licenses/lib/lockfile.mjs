// Dependency inventory from the committed pnpm lockfile (lockfileVersion 9.0) plus licence metadata read from the
// installed packages. Dependency-free (Node standard library only) so it runs in CI, in the image build and offline.
//
// Scopes (every lockfile package gets exactly one):
//   runtime      reachable from the production dependencies of apps/api, apps/worker or packages/{config,db,shared}:
//                shipped as node_modules in the mth-app image
//   bundled      reachable only from apps/web production dependencies: compiled into the SPA bundle (fonts, React, ...)
//   development  everything else (build, lint, test tooling); never shipped
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_IMPORTERS = ["apps/api", "apps/worker", "packages/config", "packages/db", "packages/shared"];
export const BUNDLED_IMPORTERS = ["apps/web"];

const unquote = (s) =>
  s
    .trim()
    .replace(/^'(.*)'$/, "$1")
    .replace(/^"(.*)"$/, "$1");

/** Split "name@version(peer@x)(...)" into { name, version, peers }. */
export function splitKey(key) {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  const name = key.slice(0, at);
  const rest = key.slice(at + 1);
  const paren = rest.indexOf("(");
  return { name, version: paren === -1 ? rest : rest.slice(0, paren), peers: paren === -1 ? "" : rest.slice(paren) };
}

/** Line-based parser for the three sections of a v9 lockfile that the inventory needs. */
export function parseLockfile(text) {
  const lines = text.split(/\r?\n/);
  if (!/^lockfileVersion: '?9\./.test(lines[0] ?? "")) throw new Error("expected pnpm lockfileVersion 9.x");
  const importers = new Map(); // importer -> [{ name, version, kind }]
  const packages = new Map(); // "name@version" -> { integrity }
  const snapshots = new Map(); // "name@version(peers)" -> [depKey]
  let section = null;
  let current = null;
  let depKind = null;
  let depName = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      section = line.replace(/:.*$/, "");
      current = null;
      continue;
    }
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (section === "importers") {
      if (indent === 2) {
        current = unquote(body.replace(/:$/, ""));
        importers.set(current, []);
      } else if (indent === 4) {
        depKind = body.replace(/:$/, "");
      } else if (indent === 6) {
        depName = unquote(body.replace(/:$/, ""));
      } else if (indent === 8 && body.startsWith("version:")) {
        importers.get(current).push({ name: depName, version: unquote(body.slice(8)), kind: depKind });
      }
    } else if (section === "packages") {
      if (indent === 2) {
        current = unquote(body.replace(/:$/, ""));
        packages.set(current, { integrity: null });
      } else if (indent === 4 && body.startsWith("resolution:")) {
        const m = /integrity: ([^,}\s]+)/.exec(body);
        if (m) packages.get(current).integrity = m[1];
      }
    } else if (section === "snapshots") {
      if (indent === 2) {
        const inline = body.endsWith(": {}");
        current = unquote(body.replace(/: \{\}$/, "").replace(/:$/, ""));
        snapshots.set(current, []);
        if (inline) current = null;
      } else if (indent === 4) {
        depKind = body.replace(/:$/, "");
      } else if (indent === 6 && current && (depKind === "dependencies" || depKind === "optionalDependencies")) {
        const idx = body.indexOf(": ");
        const name = unquote(body.slice(0, idx));
        snapshots.get(current).push(`${name}@${unquote(body.slice(idx + 2))}`);
      }
    }
  }
  return { importers, packages, snapshots };
}

function reach(lock, importerNames) {
  const seen = new Set();
  const stack = [];
  for (const imp of importerNames) {
    for (const d of lock.importers.get(imp) ?? []) {
      if (d.kind === "devDependencies" || d.version.startsWith("link:")) continue;
      stack.push(`${d.name}@${d.version}`);
    }
  }
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of lock.snapshots.get(key) ?? []) stack.push(dep);
  }
  return new Set(
    [...seen].map((k) => {
      const { name, version } = splitKey(k);
      return `${name}@${version}`;
    }),
  );
}

/** Index of installed packages: "name@version" -> absolute package directory (first real directory found). */
export function indexInstalled(root) {
  const index = new Map();
  const store = join(root, "node_modules", ".pnpm");
  if (!existsSync(store)) return index;
  const consider = (dir) => {
    try {
      if (!statSync(dir).isDirectory()) return;
      const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const key = `${pj.name}@${pj.version}`;
      if (!index.has(key)) index.set(key, dir);
    } catch {
      /* not a package */
    }
  };
  for (const entry of readdirSync(store).sort()) {
    const nm = join(store, entry, "node_modules");
    if (!existsSync(nm)) continue;
    for (const name of readdirSync(nm).sort()) {
      if (name.startsWith("@")) {
        for (const sub of readdirSync(join(nm, name)).sort()) consider(join(nm, name, sub));
      } else if (name !== ".bin") {
        consider(join(nm, name));
      }
    }
  }
  return index;
}

function licenseOf(pj) {
  if (typeof pj.license === "string") return pj.license;
  if (pj.license && typeof pj.license.type === "string") return pj.license.type;
  if (Array.isArray(pj.licenses)) {
    const ids = pj.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (ids.length > 0) return ids.length === 1 ? ids[0] : `(${ids.join(" OR ")})`;
  }
  return "NOASSERTION";
}

/** Build the inventory: one entry per lockfile package, sorted by name then version. */
export function buildInventory(root) {
  const lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const lock = parseLockfile(lockText);
  const runtime = reach(lock, RUNTIME_IMPORTERS);
  const bundled = reach(lock, BUNDLED_IMPORTERS);
  const installed = indexInstalled(root);
  const directOf = new Map();
  for (const [imp, deps] of lock.importers) {
    for (const d of deps) {
      if (d.version.startsWith("link:")) continue;
      const key = `${d.name}@${splitKey(`${d.name}@${d.version}`).version}`;
      if (!directOf.has(key)) directOf.set(key, new Set());
      directOf.get(key).add(`${imp === "." ? "(root)" : imp}${d.kind === "devDependencies" ? " (dev)" : ""}`);
    }
  }
  const entries = [];
  for (const [key, meta] of lock.packages) {
    const { name, version } = splitKey(key);
    const dir = installed.get(key) ?? null;
    let license = "NOASSERTION";
    let homepage = null;
    if (dir) {
      const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      license = licenseOf(pj);
      homepage = typeof pj.homepage === "string" ? pj.homepage : null;
    }
    const scope = runtime.has(key) ? "runtime" : bundled.has(key) ? "bundled" : "development";
    entries.push({
      name,
      version,
      license,
      scope,
      integrity: meta.integrity,
      directOf: [...(directOf.get(key) ?? [])].sort(),
      installedDir: dir,
      homepage,
      dependsOn: [],
    });
  }
  // Dependency edges (by name@version, peers collapsed) for the SBOM graph.
  const byKey = new Map(entries.map((e) => [`${e.name}@${e.version}`, e]));
  for (const [snapKey, deps] of lock.snapshots) {
    const { name, version } = splitKey(snapKey);
    const e = byKey.get(`${name}@${version}`);
    if (!e) continue;
    for (const d of deps) {
      const s = splitKey(d);
      const ref = `${s.name}@${s.version}`;
      if (byKey.has(ref) && !e.dependsOn.includes(ref)) e.dependsOn.push(ref);
    }
  }
  for (const e of entries) e.dependsOn.sort();
  entries.sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1));
  return { entries, lockSha256: createHash("sha256").update(lockText).digest("hex"), lock };
}

export function purl(name, version) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${version}`;
}

/** "sha512-<base64>" -> { alg: "SHA-512", content: hex } */
export function integrityToHash(integrity) {
  if (!integrity) return null;
  const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(integrity);
  if (!m) return null;
  const alg = { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[m[1]];
  return { alg, content: Buffer.from(m[2], "base64").toString("hex") };
}
