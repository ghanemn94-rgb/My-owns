#!/usr/bin/env node
// The handover role matrix (ADR-0072 §4; p7-work-split §H, DOC-C; REQ-S19-015 item "Role matrix").
//
//   node tools/release/role-matrix.mjs [--root <dir>] [--out <file>] (--check | --write | --stdout)
//
// Generates docs/handover/role-matrix.md from ONE source: packages/shared/src/permissions.ts (PERMISSIONS, ROLES,
// PERMISSION_CATEGORIES, ROLE_KINDS), imported with Node 24's built-in TypeScript type stripping. It is the object that
// packages/db/src/seed.test.ts pins to the seed migrations, so the handover matrix, the code and the database seeds
// cannot drift silently. The English and Arabic role names and permission descriptions are not in permissions.ts:
// they are read from the seed migrations' own INSERT rows (`INSERT INTO role (...)`, `INSERT INTO permission (...)`),
// which are what an installation's database holds. A permission or role without a seeded label, or a migration that
// relabels one (`UPDATE role`/`UPDATE permission`), is refused (exit 2): the matrix never shows a guessed label.
//
// Output: deterministic (sorted by code), no timestamp. `--check` regenerates in memory and exits 1 on any byte
// difference with the file (T-H3). `--write` writes it. `--stdout` prints it.
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (the file differs), 2 BLOCKED (missing or invalid input, usage).
// Dependency-free: Node built-ins only. Never reads or writes docs/delivery/**. The roles are a configurable starting
// point, not a Mobily-approved access policy; nothing here grants or records an approval (G1-G6 or DG0-DG7).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, "..", "..");
export const PERMISSIONS_PATH = "packages/shared/src/permissions.ts";
export const MIGRATIONS_DIR = "packages/db/migrations";
export const OUTPUT_PATH = "docs/handover/role-matrix.md";

/** p7-work-split §H.3 (the Arabic is provisional, D-243 Q7). */
export const TEXTS = Object.freeze({
  provisionalEn: "Arabic text: provisional. It has not been checked by a qualified Arabic reviewer.",
  provisionalAr: "النص العربي مؤقت. لم يراجعه مراجع عربي مؤهل.",
  headerEn:
    "These roles and permissions are the platform's configurable starting point, not a Mobily-approved access policy.",
  headerAr: "هذه الأدوار والصلاحيات هي نقطة البداية القابلة للتهيئة في المنصة، وليست سياسة وصول معتمدة من موبايلي.",
});

/** Category headings (EN / AR provisional). The keys must equal PERMISSION_CATEGORIES (checked). */
const CATEGORY_LABELS = Object.freeze({
  read: ["Read", "قراءة"],
  write: ["Write", "كتابة"],
  configure: ["Configure", "تهيئة"],
  business_approval: ["Business approval (inside the product)", "اعتماد الأعمال (داخل المنتج)"],
  finance_validation: ["Finance validation (inside the product)", "التحقق المالي (داخل المنتج)"],
});

/** Role kinds (EN / AR provisional). The keys must equal ROLE_KINDS (checked). */
const KIND_LABELS = Object.freeze({
  source: ["Playbook role", "دور من الدليل"],
  implementation: ["Implementation role", "دور تنفيذي"],
  technical_admin: ["Technical administration", "إدارة تقنية"],
});

export class InputError extends Error {}

// ------------------------------------------------------------------------------------------------ SQL row parsing

/** Skips whitespace and `--` comments from `i`; returns the next index. */
function skipSpace(sql, i) {
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i += 1;
    if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
    } else return i;
  }
}

/**
 * Parses the VALUES tuples of one INSERT statement starting at `i` (just after VALUES): `('a', 'b''c', true), (...)`
 * up to the terminating `;`. Each value is a string (quotes removed, '' unescaped) or a bare token.
 */
export function parseValues(sql, i) {
  const rows = [];
  for (;;) {
    i = skipSpace(sql, i);
    if (sql[i] !== "(") throw new InputError(`unexpected SQL near: ${sql.slice(i, i + 40)}`);
    i += 1;
    const row = [];
    for (;;) {
      i = skipSpace(sql, i);
      if (sql[i] === "'") {
        let s = "";
        i += 1;
        for (;;) {
          if (i >= sql.length) throw new InputError("unterminated SQL string");
          if (sql[i] === "'") {
            if (sql[i + 1] === "'") {
              s += "'";
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          s += sql[i];
          i += 1;
        }
        row.push(s);
      } else {
        const m = /^[^,()\s]+/.exec(sql.slice(i));
        if (m === null) throw new InputError(`unexpected SQL value near: ${sql.slice(i, i + 40)}`);
        row.push(m[0]);
        i += m[0].length;
      }
      i = skipSpace(sql, i);
      if (sql[i] === ",") {
        i += 1;
        continue;
      }
      if (sql[i] === ")") {
        i += 1;
        break;
      }
      throw new InputError(`unexpected SQL near: ${sql.slice(i, i + 40)}`);
    }
    rows.push(row);
    i = skipSpace(sql, i);
    if (sql[i] === ",") {
      i += 1;
      continue;
    }
    if (sql[i] === ";") return rows;
    throw new InputError(`unexpected SQL after a row near: ${sql.slice(i, i + 40)}`);
  }
}

/** Every row of `INSERT INTO <table> (<columns>) VALUES ...` in `sql`, as objects keyed by column. */
export function insertRows(sql, table) {
  const re = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)\\s*VALUES`, "g");
  const out = [];
  for (const m of sql.matchAll(re)) {
    const columns = m[1].split(",").map((c) => c.trim());
    for (const values of parseValues(sql, m.index + m[0].length)) {
      if (values.length !== columns.length) throw new InputError(`INSERT INTO ${table}: column count mismatch`);
      out.push(Object.fromEntries(columns.map((c, k) => [c, values[k]])));
    }
  }
  return out;
}

/** Reads the seeded labels of roles and permissions from every migration of `migrationsDir`, in file order. */
export function seededLabels(migrationsDir) {
  if (!existsSync(migrationsDir)) throw new InputError(`no migrations directory: ${migrationsDir}`);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const roles = new Map();
  const permissions = new Map();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    if (/\bUPDATE\s+(ONLY\s+)?(public\.)?(role|permission)\s+SET\b/i.test(sql.replace(/--[^\n]*/g, "")))
      throw new InputError(`${f} updates a seeded role or permission; this generator reads INSERT rows only`);
    for (const r of insertRows(sql, "role")) {
      if (roles.has(r.code)) throw new InputError(`role ${r.code} is seeded twice (${f})`);
      roles.set(r.code, { nameEn: r.name_en, nameAr: r.name_ar, kind: r.kind, file: f });
    }
    for (const p of insertRows(sql, "permission")) {
      if (permissions.has(p.code)) throw new InputError(`permission ${p.code} is seeded twice (${f})`);
      permissions.set(p.code, { category: p.category, en: p.description_en, ar: p.description_ar, file: f });
    }
  }
  return { roles, permissions, files };
}

// ------------------------------------------------------------------------------------------------ the model

/** Imports permissions.ts (type stripping) and joins it with the seeded labels. Throws InputError on a gap. */
export async function loadModel(root) {
  const permissionsFile = join(root, PERMISSIONS_PATH);
  if (!existsSync(permissionsFile)) throw new InputError(`missing ${PERMISSIONS_PATH} under ${root}`);
  let mod;
  try {
    mod = await import(pathToFileURL(permissionsFile).href);
  } catch (e) {
    throw new InputError(`cannot import ${PERMISSIONS_PATH}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { PERMISSIONS, ROLES, PERMISSION_CATEGORIES, ROLE_KINDS } = mod;
  if (typeof PERMISSIONS !== "object" || typeof ROLES !== "object" || !Array.isArray(PERMISSION_CATEGORIES))
    throw new InputError(`${PERMISSIONS_PATH} does not export PERMISSIONS, ROLES and PERMISSION_CATEGORIES`);
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same([...PERMISSION_CATEGORIES], Object.keys(CATEGORY_LABELS)))
    throw new InputError("PERMISSION_CATEGORIES changed: update CATEGORY_LABELS in role-matrix.mjs");
  if (!same([...ROLE_KINDS], Object.keys(KIND_LABELS)))
    throw new InputError("ROLE_KINDS changed: update KIND_LABELS in role-matrix.mjs");

  const labels = seededLabels(join(root, MIGRATIONS_DIR));
  const roleCodes = Object.keys(ROLES).sort();
  const roles = roleCodes.map((code) => {
    const def = ROLES[code];
    const seeded = labels.roles.get(code);
    if (seeded === undefined) throw new InputError(`role ${code} has no seeded name in ${MIGRATIONS_DIR}`);
    if (seeded.kind !== def.kind) throw new InputError(`role ${code}: kind ${def.kind} differs from the seed`);
    for (const p of def.permissions)
      if (!(p in PERMISSIONS)) throw new InputError(`role ${code} holds an unknown permission ${p}`);
    return {
      code,
      nameEn: seeded.nameEn,
      nameAr: seeded.nameAr,
      kind: def.kind,
      inheritsDownward: def.inheritsDownward === true,
      permissions: new Set(def.permissions),
    };
  });
  for (const code of labels.roles.keys())
    if (!(code in ROLES)) throw new InputError(`role ${code} is seeded but not in ROLES`);
  const permissions = Object.keys(PERMISSIONS)
    .sort()
    .map((code) => {
      const seeded = labels.permissions.get(code);
      if (seeded === undefined) throw new InputError(`permission ${code} has no seeded description in ${MIGRATIONS_DIR}`);
      if (seeded.category !== PERMISSIONS[code])
        throw new InputError(`permission ${code}: category ${PERMISSIONS[code]} differs from the seed`);
      return { code, category: PERMISSIONS[code], en: seeded.en, ar: seeded.ar };
    });
  for (const code of labels.permissions.keys())
    if (!(code in PERMISSIONS)) throw new InputError(`permission ${code} is seeded but not in PERMISSIONS`);
  return { roles, permissions, categories: [...PERMISSION_CATEGORIES] };
}

// ------------------------------------------------------------------------------------------------ rendering

const cell = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Renders the Markdown (deterministic; LF; ends with one newline). */
export function render(model) {
  const { roles, permissions, categories } = model;
  const L = [];
  L.push("# Role matrix (الأدوار والصلاحيات)", "");
  L.push(TEXTS.provisionalEn, "");
  L.push(`<p dir="rtl" lang="ar">${TEXTS.provisionalAr}</p>`, "");
  L.push(
    "<!-- Generated by tools/release/role-matrix.mjs. Do not edit by hand: run `node tools/release/role-matrix.mjs --write`; `--check` fails on any difference (ADR-0072 §4, T-H3). -->",
    "",
  );
  L.push(TEXTS.headerEn, "");
  L.push(`<p dir="rtl" lang="ar">${TEXTS.headerAr}</p>`, "");
  const approvalCodes = new Set(
    permissions.filter((p) => p.category === "business_approval" || p.category === "finance_validation").map((p) => p.code),
  );
  const adminApprovers = roles
    .filter((r) => r.kind === "technical_admin" && [...r.permissions].some((c) => approvalCodes.has(c)))
    .map((r) => `\`${r.code}\``);
  L.push("## How to read this matrix", "");
  L.push(
    `- **Source.** \`${PERMISSIONS_PATH}\` (\`PERMISSIONS\`, \`ROLES\`), the object that \`packages/db/src/seed.test.ts\` pins to the seed migrations. The English and Arabic names and descriptions are the seeded rows of \`${MIGRATIONS_DIR}/\`.`,
    "- **Starting point only.** The database is the runtime source of truth. An access administrator assigns roles at a scope (organization, business unit, transformation) and may change the defaults after installation, so a running installation can differ from this table (Administration > Users and Assignments).",
    "- **Cells.** `✓` means the role holds the permission by default. An empty cell means it does not.",
    "- **Scope.** A role marked _inherits downward_ that is granted at a wider scope also applies to the narrower scopes inside it. The other roles apply only at the scope they are assigned.",
    `- **Business approvals.** The permissions in the business-approval and Finance-validation categories are approvals **inside the product** (for example the product gates G1–G6). They are recorded per person and per decision. ${adminApprovers.length === 0 ? "No technical-administration role holds one by default" : `Technical-administration roles holding one by default: ${adminApprovers.join(", ")}`}, and no service identity can hold one (ADR-0053). These product approvals are unrelated to the engineering delivery gates DG0–DG7.`,
    `- **Size.** ${roles.length} roles and ${permissions.length} permissions. The Arabic texts are provisional.`,
    "",
  );
  L.push("## Roles (الأدوار)", "");
  L.push("| Code (الرمز) | English name | الاسم بالعربية | Kind (النوع) | Inherits downward | Permissions held |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of roles) {
    const [kEn, kAr] = KIND_LABELS[r.kind];
    L.push(
      `| \`${r.code}\` | ${cell(r.nameEn)} | ${cell(r.nameAr)} | ${kEn} (${kAr}) | ${r.inheritsDownward ? "yes" : "no"} | ${r.permissions.size} |`,
    );
  }
  L.push("");
  L.push("## Permissions by category (الصلاحيات حسب الفئة)", "");
  const header = `| Permission (الصلاحية) | Description | الوصف | ${roles.map((r) => `\`${r.code}\``).join(" | ")} |`;
  const rule = `| --- | --- | --- | ${roles.map(() => ":-:").join(" | ")} |`;
  for (const category of categories) {
    const rows = permissions.filter((p) => p.category === category);
    const [cEn, cAr] = CATEGORY_LABELS[category];
    L.push(`### ${cEn} / ${cAr}: ${rows.length}`, "");
    if (rows.length === 0) {
      L.push("No permission in this category.", "");
      continue;
    }
    L.push(header, rule);
    for (const p of rows)
      L.push(
        `| \`${p.code}\` | ${cell(p.en)} | ${cell(p.ar)} | ${roles.map((r) => (r.permissions.has(p.code) ? "✓" : " ")).join(" | ")} |`,
      );
    L.push("");
  }
  return L.join("\n");
}

// ------------------------------------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, out: undefined, mode: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root" || a === "--out") {
      const v = argv[i + 1];
      if (v === undefined) throw new InputError(`${a} needs a value`);
      if (a === "--root") opts.root = resolve(v);
      else opts.out = resolve(v);
      i += 1;
    } else if (a === "--check" || a === "--write" || a === "--stdout") {
      if (opts.mode !== undefined) throw new InputError("give exactly one of --check, --write, --stdout");
      opts.mode = a.slice(2);
    } else throw new InputError(`unknown argument ${a}`);
  }
  if (opts.mode === undefined) throw new InputError("give exactly one of --check, --write, --stdout");
  opts.out ??= join(opts.root, OUTPUT_PATH);
  return opts;
}

export async function main(argv) {
  let opts;
  let text;
  try {
    opts = parseArgs(argv);
    text = render(await loadModel(opts.root));
  } catch (e) {
    if (e instanceof InputError) {
      console.error(`BLOCKED: ${e.message}`);
      console.error(
        "usage: node tools/release/role-matrix.mjs [--root <dir>] [--out <file>] (--check | --write | --stdout)",
      );
      return 2;
    }
    throw e;
  }
  if (opts.mode === "stdout") {
    process.stdout.write(text);
    return 0;
  }
  if (opts.mode === "write") {
    writeFileSync(opts.out, text);
    console.log(`role-matrix: wrote ${opts.out}`);
    return 0;
  }
  const current = existsSync(opts.out) ? readFileSync(opts.out, "utf8") : null;
  if (current === text) {
    console.log(`role-matrix: PASS (${opts.out} is current)`);
    return 0;
  }
  console.error(
    current === null
      ? `FAIL: ${opts.out} does not exist; run node tools/release/role-matrix.mjs --write`
      : `FAIL: ${opts.out} differs from the generated matrix; run node tools/release/role-matrix.mjs --write`,
  );
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
