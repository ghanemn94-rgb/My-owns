#!/usr/bin/env node
/**
 * Hard-coded UI string check (REQ-UX-002; run by `pnpm --filter @hub/web lint`, or `node scripts/check-hardcoded-strings.mjs`).
 *
 * Every user-visible text must come from the i18n catalogues (t('…') / useT). This scan parses every .tsx file under
 * src/app and src/components with the TypeScript compiler and reports:
 *   1. JSX text (<b>Save</b>) that contains letters (Latin or Arabic);
 *   2. string literals rendered as JSX children ({'Save'} / {"Save"} / {`Save`} without interpolation);
 *   3. string literals in user-visible attributes (aria-label, title, placeholder, alt, aria-description,
 *      aria-roledescription, aria-valuetext, label).
 * Text inside i18n calls is never JSX text, so it is not reported. Technical tokens (acronyms such as RAG, CSV, ISO 4217
 * codes, units) are allow-listed below; anything else must use an i18n key. A line can opt out explicitly with a
 * trailing `// i18n-ignore: <reason>` comment (reported in the summary so reviewers see every exception).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const ROOTS = ['src/app', 'src/components'].map((r) => join(webRoot, r));

const LETTERS = /[A-Za-z؀-ۿ]/;
/** Technical tokens that are the same in every language (product/technical names, codes, units). */
const ALLOWED_TOKENS = new Set([
  'AI', 'API', 'CSV', 'DD', 'DOCX', 'GTM', 'ID', 'IdP', 'ISO', 'JSON', 'JV', 'KPI', 'KPIs', 'MFA', 'NDA', 'NOC', 'OIDC', 'PDF',
  'PMO', 'PPTX', 'RAG', 'RAID', 'SAR', 'SHA', 'SHA-256', 'SLA', 'SSO', 'TSA', 'UTC', 'WBS', 'XLSX', 'USD', 'EUR',
  'h', 'd', 'x', 'px', 'ms', 'KB', 'MB', 'GB',
]);
const VISIBLE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'label']);

function isAllowed(text) {
  const t = text.trim();
  if (!LETTERS.test(t)) return true; // punctuation, digits, symbols (·, —, →, %, /, …)
  // Every word must be an allowed technical token or a G1-style code (letter+digits), e.g. "G5", "WS06".
  const words = t.split(/[\s/·—–\-:,.()[\]+×→←|]+/).filter(Boolean);
  return words.every((w) => !LETTERS.test(w) || ALLOWED_TOKENS.has(w) || /^[A-Z]{1,4}\d{1,3}$/.test(w));
}

function walkDir(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function scan(roots) {
  const findings = [];
  const ignored = [];
  for (const file of roots.flatMap((r) => walkDir(r))) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node, kind, text) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const where = `${relative(webRoot, file)}:${line + 1}`;
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      const ignore = /\/\/\s*i18n-ignore:\s*(.+)$/.exec(lines[line] ?? '') ?? /\{\/\*\s*i18n-ignore:\s*(.+?)\s*\*\/\}/.exec(lines[line - 1] ?? '');
      if (ignore) ignored.push(`${where} ${kind} "${snippet}" — ${ignore[1].trim()}`);
      else findings.push(`${where} ${kind} "${snippet}"`);
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText(sf);
        if (!isAllowed(text)) report(node, 'jsx-text', text);
      } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        const e = node.expression;
        if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && !isAllowed(e.text)) report(node, 'jsx-child-literal', e.text);
      } else if (ts.isJsxAttribute(node) && VISIBLE_ATTRS.has(node.name.getText(sf)) && node.initializer) {
        const init = node.initializer;
        const lit = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression : null;
        if (lit && !isAllowed(lit.text)) report(node, `attr:${node.name.getText(sf)}`, lit.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { findings, ignored };
}

// Self-test on every run: the fixture holds known violations and allowed cases; the check must flag exactly those.
const FIXTURE = join(here, 'fixtures', 'hardcoded-strings');
const EXPECTED = ['attr:title "Hard-coded tooltip"', 'jsx-text "Project overview"', 'jsx-child-literal "Inline literal"', 'attr:placeholder "Search projects"', 'jsx-text "مشروع تجريبي"', 'attr:aria-label "Close dialog"'];
const self = scan([FIXTURE]).findings.map((f) => f.replace(/^\S+ /, ''));
if (JSON.stringify(self.slice().sort()) !== JSON.stringify(EXPECTED.slice().sort())) {
  console.error(`Hard-coded UI string check SELF-TEST FAILED — the scanner no longer detects the fixture violations.\n  expected: ${EXPECTED.join(' | ')}\n  found:    ${self.join(' | ')}`);
  process.exit(2);
}

const { findings, ignored } = scan(ROOTS);

if (findings.length) {
  console.error(`Hard-coded UI string check FAILED (${findings.length}):\n  ${findings.join('\n  ')}\nUse an i18n key (src/i18n/messages/{en,ar}) — or, for a genuine technical token, extend ALLOWED_TOKENS.`);
  process.exit(1);
}
console.log(`Hard-coded UI string check passed (self-test: ${EXPECTED.length} fixture violations detected): ${ROOTS.map((r) => relative(webRoot, r)).join(', ')} scanned; no JSX text or visible attribute literals outside i18n${ignored.length ? `; ${ignored.length} explicit exception(s):\n  ${ignored.join('\n  ')}` : ''}.`);
