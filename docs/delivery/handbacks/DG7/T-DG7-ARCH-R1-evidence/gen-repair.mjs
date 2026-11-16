// T-DG7-ARCH-R1: renders the "Coverage repair" part of docs/architecture/data-dictionary.md from the catalogue dump
// written by dump-catalogue.ts (a disposable database migrated with every shipped migration) and the hand-written
// purposes and column descriptions in descriptions.mjs. Types, nullability, defaults, constraints, indexes, triggers
// and mth_app privileges are PostgreSQL's own (`::text` casts removed for readability, as in the earlier generators).
//   node gen-repair.mjs <catalogue.json>  > part.md     (exit 1 and a list on stderr when a column has no description)
import { readFileSync } from "node:fs";
import { TABLES, STANDARD } from "./descriptions.mjs";

const { catalogue, detail } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pub = new Map(catalogue.tables.filter((t) => t.schema === "public").map((t) => [t.name, t]));
const by = (rows, t) => rows.filter((r) => r.t === t);
const esc = (s) => String(s).replaceAll("|", "\\|");
const clean = (s) => String(s).replaceAll("::text", "");
const missing = [];
const out = [];
for (const [name, meta] of Object.entries(TABLES)) {
  const t = pub.get(name);
  if (!t) throw new Error(`no table ${name}`);
  const cols = catalogue.columns.filter((c) => String(c.oid) === String(t.oid)).sort((a, b) => a.num - b.num);
  const kindText = t.kind === "v" ? "View" : t.kind === "p" ? "Partitioned table" : "Table";
  const priv = by(detail.privileges, name)[0]?.p ?? "none";
  out.push(`## ${name}`, "");
  out.push(`- **${kindText}.** ${meta.purpose}`);
  out.push(`- **Migrations:** ${meta.migrations}. **Earlier text:** ${meta.earlier}.`);
  out.push(`- **\`mth_app\` privileges:** ${priv}.`, "");
  const num = new Map(by(detail.attnums, name).map((a) => [a.num, a.col]));
  const colCons = new Map();
  const tableCons = [];
  const kind = { c: "CHECK", u: "UNIQUE", f: "FK", p: "PK", x: "EXCLUDE" };
  for (const k of by(detail.constraints, name)) {
    if (k.contype === "t" || k.contype === "n") continue;
    const def = clean(k.def);
    const single = k.conkey && k.conkey.length === 1;
    let text = null;
    if (single && k.contype === "p") text = "PK";
    else if (single && k.contype === "f") {
      const m = /REFERENCES (\w+)\((\w+)\)/.exec(def);
      text = m ? `FK → ${m[1]}(${m[2]}) (\`${k.conname}\`)` : null;
    } else if (single && k.contype === "c") text = `\`${k.conname}\`: \`${def}\``;
    if (text) {
      const col = num.get(k.conkey[0]);
      colCons.set(col, [...(colCons.get(col) ?? []), text]);
    } else tableCons.push(`- \`${k.conname}\` (${kind[k.contype] ?? k.contype}): \`${def}\``);
  }
  const defs = new Map(by(detail.defaults, name).map((d) => [d.col, clean(d.def)]));
  out.push("| Column | Type | Null | Default | Column constraints | Description |", "|---|---|---|---|---|---|");
  for (const c of cols) {
    const d = meta.columns?.[c.name] ?? STANDARD[c.name];
    if (!d) missing.push(`${name}.${c.name}`);
    const dv = defs.get(c.name);
    out.push(
      `| ${c.name} | ${c.type} | ${c.notnull ? "NOT NULL" : "NULL"} | ${dv ? `\`${esc(dv)}\`` : ""} | ${esc((colCons.get(c.name) ?? []).join("; "))} | ${esc(d ?? "")} |`,
    );
  }
  out.push("");
  if (t.kind === "v") {
    const v = by(detail.views, name)[0];
    out.push("**Definition** (`pg_get_viewdef`):", "", "```sql", clean(v.def).trim(), "```", "");
  }
  if (tableCons.length) out.push("**Table constraints:**", "", ...tableCons, "");
  const idx = by(detail.indexes, name).filter((i) => !i.pk && !i.by_constraint);
  if (idx.length) {
    out.push("**Indexes:**", "");
    for (const r of idx) {
      const uniq = /CREATE UNIQUE INDEX/.test(r.def) ? "UNIQUE " : "";
      out.push(`- \`${r.name}\`: \`${uniq}${clean(r.def).replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING btree /, "")}\``);
    }
    out.push("");
  }
  const trg = by(detail.triggers, name);
  if (trg.length) {
    out.push("**Triggers:**", "");
    for (const r of trg) {
      const d = r.def
        .replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, (_m, ct) => (ct ? "CONSTRAINT " : ""))
        .replace(/ ON public\.\S+/, "")
        .replace(/ EXECUTE FUNCTION (\S+)$/, " → `$1`");
      out.push(`- \`${r.tgname}\`: ${d}`);
    }
    out.push("");
  }
}
if (missing.length) {
  console.error(`missing descriptions (${missing.length}):\n${missing.join("\n")}`);
  process.exitCode = 1;
}
console.log(out.join("\n").replace(/\n+$/, ""));
