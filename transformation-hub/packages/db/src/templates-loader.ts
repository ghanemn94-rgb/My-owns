import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PoolClient, Pool } from 'pg';

export interface TemplateFile {
  key: string;
  version: number;
  kind: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  [k: string]: unknown;
}

export function templatesDir(): string {
  return join(__dirname, '..', 'seed', 'templates');
}

export function readTemplateFiles(dir = templatesDir()): TemplateFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as TemplateFile);
}

const stable = (v: unknown): string =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`;

/**
 * Upsert templates and PUBLISH their versions. Published versions are immutable: if a file changes but keeps the same
 * version number, loading fails (bump the version instead) — projects pin versions (AT-26).
 * Must run with the OWNER role (bypasses RLS) or inside an org-scoped context.
 */
export async function loadTemplates(db: Pool | PoolClient, orgId: string, files = readTemplateFiles(), log: (m: string) => void = () => undefined) {
  const results: { key: string; version: number; action: 'created' | 'unchanged' }[] = [];
  for (const t of files) {
    const hash = createHash('sha256').update(stable(t)).digest('hex');
    const tpl = await db.query<{ id: string }>(
      `insert into project_template (id, org_id, key, kind, name, description)
       values (gen_random_uuid(), $1, $2, $3, $4, $5)
       on conflict (org_id, key) do update set name = excluded.name, description = excluded.description
       returning id`,
      [orgId, t.key, t.kind, t.name.en, t.description.en],
    );
    const templateId = tpl.rows[0]!.id;
    const existing = await db.query<{ definition_hash: string }>(
      `select definition_hash from project_template_version where template_id = $1 and version_no = $2`,
      [templateId, t.version],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].definition_hash !== hash) {
        throw new Error(`Template ${t.key} v${t.version} changed but is already published — bump "version" to publish a new version`);
      }
      results.push({ key: t.key, version: t.version, action: 'unchanged' });
      continue;
    }
    await db.query(
      `insert into project_template_version (id, org_id, template_id, version_no, status, definition, definition_hash, change_summary, published_at)
       values (gen_random_uuid(), $1, $2, $3, 'published', $4, $5, $6, now())`,
      [orgId, templateId, t.version, JSON.stringify(t), hash, `Loaded from ${t.key}.v${t.version}.json`],
    );
    results.push({ key: t.key, version: t.version, action: 'created' });
    log(`template ${t.key} v${t.version} published`);
  }
  return results;
}
