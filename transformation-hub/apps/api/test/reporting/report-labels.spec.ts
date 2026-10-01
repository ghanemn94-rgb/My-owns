import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPORT_LABELS } from '../../src/modules/reporting/render/labels';
import { ENUM_LABELS } from '../../src/modules/reporting/render/enum-labels';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { generate, RP } from './report-kit';

/**
 * REQ-UX-020 / REQ-RPT-007 (reports part): the exported files and the Reports screen say the same thing in both languages.
 * The file labels (apps/api/src/modules/reporting/render/labels.ts, enum-labels.ts) and the web catalogue
 * (apps/web/src/i18n/messages/{en,ar}/reports.json `content`, statuses.json) must be identical, and every key a report can
 * contain must have a label in English and Arabic (no raw keys in a file or on the screen).
 */
const MESSAGES = join(__dirname, '..', '..', '..', 'web', 'src', 'i18n', 'messages');
const web = (locale: 'en' | 'ar', ns: string) => JSON.parse(readFileSync(join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Record<string, unknown>;

function flatten(o: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof o === 'string') out[prefix] = o;
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const GROUPS = ['meta', 'sections', 'tables', 'columns', 'figures', 'notes', 'sources'] as const;

describe('REQ-UX-020 report labels: files and screen use the same English and Arabic texts', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the web catalogue reports.json content equals the file labels, and the enum labels equal statuses.json`, () => {
      const content = (web(locale, 'reports').content ?? {}) as Record<string, unknown>;
      for (const g of GROUPS) expect(flatten(content[g]), `${locale} content.${g}`).toEqual(flatten(REPORT_LABELS[locale][g]));
      expect(content.enums, `${locale} content.enums`).toEqual(REPORT_LABELS[locale].enums);
      const statuses = web(locale, 'statuses');
      for (const [name, values] of Object.entries(ENUM_LABELS[locale])) expect(statuses[name], `${locale} statuses.${name} (regenerate enum-labels.ts from the web catalogue)`).toEqual(values);
    });
  }
});

describe('REQ-RPT-007 every key a report can contain has an English and an Arabic label', () => {
  let pm: Client;
  let dc: string;
  beforeAll(async () => {
    dc = await projectIdByCode(DC);
    pm = await loginAs('pm');
  });
  afterAll(async () => {
    await closeApp();
    await closePools();
  });

  it('all report kinds of the demo project: section, table, column, figure, note, register-source and enum labels exist in en and ar', async () => {
    const meeting = (await owner().query<{ id: string }>(`select m.id from meeting m join committee c on c.id = m.committee_id where m.project_id = $1 and c.classification in ('internal','confidential') order by m.number limit 1`, [dc])).rows[0]!;
    const kinds = ['executive_summary', 'committee_pack', 'workstream_weekly', 'look_ahead', 'day1_readiness', 'tsa_exit', 'jv_closing', 'health_data_quality', 'minutes'];
    const missing: string[] = [];
    let checked = 0;
    for (const kind of kinds) {
      const s = await generate(pm, dc, kind === 'minutes' ? { kind, meetingId: meeting.id } : { kind });
      const d = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as {
        sections: { key: string; figures: { key: string }[]; sourceRefs: { type: string; label: string }[]; tables: { key: string; columns: { key: string; type: string; enumName: string | null }[]; rows: Record<string, unknown>[] }[]; notes: { code: string }[] }[];
      };
      for (const locale of ['en', 'ar'] as const) {
        const L = REPORT_LABELS[locale];
        const need = (ok: boolean, what: string) => {
          checked++;
          if (!ok) missing.push(`${locale} ${kind}: ${what}`);
        };
        for (const sec of d.sections) {
          need(!!L.sections[sec.key], `section ${sec.key}`);
          // KPI sections print their values in the `kpis` table (name, value, state); their figures are not printed.
          if (!sec.key.startsWith('kpis.')) for (const f of sec.figures) need(!!L.figures[f.key], `figure ${f.key}`);
          for (const n of sec.notes) need(!!L.notes[n.code], `note ${n.code}`);
          // A source reference that names a register is printed in the file's language; others are record codes.
          for (const r of sec.sourceRefs.filter((x) => x.type === 'register')) need(!!L.sources[r.label], `register source ${r.label}`);
          for (const tb of sec.tables) {
            need(!!L.tables[tb.key], `table ${tb.key}`);
            for (const c of tb.columns) need(!!L.columns[c.key], `column ${tb.key}.${c.key}`);
            for (const c of tb.columns.filter((x) => x.type === 'enum')) {
              for (const r of tb.rows) {
                const raw = r[c.key];
                if (typeof raw !== 'string' || raw === '') continue;
                const [name, value] = c.enumName ? [c.enumName, raw] : (raw.split(':', 2) as [string, string]);
                need(!!(L.enums[name]?.[value] ?? ENUM_LABELS[locale][name]?.[value]), `enum ${tb.key}.${c.key} ${name}.${value}`);
              }
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(200);
  });
});
