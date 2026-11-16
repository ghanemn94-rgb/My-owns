// Shared helpers of the licence tests (ADR-0062 §7, §9). The fixture workspace is copied under $TMPDIR and its
// node_modules is written at run time; nothing is written to the repository.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const TOOL = join(REPO, "licenses", "generate-sbom.mjs");

/** Licences of the fixture packages; `undefined` writes a package.json without a `license` field. */
export const DEFAULT_LICENCES = { "dev-lib@2.0.0": "MIT", "licensed-lib@1.0.0": "ISC", "unlicensed-lib@1.0.0": "MIT" };

/** A copy of the fixture workspace with installed package.json files. Returns the root directory. */
export function fixtureWorkspace(licences = DEFAULT_LICENCES, edit) {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "mth-licences-"));
  cpSync(join(HERE, "fixtures", "workspace"), root, { recursive: true });
  mkdirSync(join(root, "deploy"), { recursive: true });
  cpSync(join(REPO, "deploy", "images.lock.json"), join(root, "deploy", "images.lock.json"));
  mkdirSync(join(root, "licenses"), { recursive: true });
  writeFileSync(join(root, "licenses", ".prettierrc.json"), "{}\n"); // keep the repository's Prettier config out
  for (const [key, licence] of Object.entries(licences)) {
    const at = key.lastIndexOf("@");
    const [name, version] = [key.slice(0, at), key.slice(at + 1)];
    const dir = join(root, "node_modules", ".pnpm", key, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name, version, ...(licence === undefined ? {} : { license: licence }) }),
    );
  }
  if (edit) edit(root);
  return root;
}

export const editJson = (path, f) => writeFileSync(path, JSON.stringify(f(JSON.parse(readFileSync(path, "utf8")))));

/** Runs generate-sbom.mjs; returns { code, stdout, stderr }. */
export function sbom(args) {
  try {
    const stdout = execFileSync(process.execPath, [TOOL, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout), stderr: String(e.stderr) };
  }
}
