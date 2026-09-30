#!/usr/bin/env node
/**
 * i18n consistency check (run: pnpm --filter @hub/web i18n:check)
 *  1. en and ar catalogues have exactly the same keys in every namespace;
 *  2. no message is empty;
 *  3. {placeholders} are identical between languages;
 *  4. statuses.<enumName> covers every value of every enum exported by packages/domain/src/enums.ts;
 *  5. every server message code the domain emits (status dimensions, gate blockers — QA-P1-14; finance explanations and
 *     EV / equity / currency / unit findings — FINANCE_MESSAGES_EN) has a translation `<namespace>.messages.<code>`
 *     (gates / finance) in en and ar with the same placeholders as the domain's English template, and no stale code is
 *     left in the catalogue.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'src', 'i18n', 'messages');
const require = createRequire(import.meta.url);
const enums = require('@hub/domain/dist/enums.js');

const errors = [];
const load = (locale, ns) => JSON.parse(readFileSync(join(root, locale, `${ns}.json`), 'utf8'));
const namespaces = readdirSync(join(root, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const arNamespaces = readdirSync(join(root, 'ar')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
for (const ns of namespaces) if (!arNamespaces.includes(ns)) errors.push(`ar/${ns}.json missing`);
for (const ns of arNamespaces) if (!namespaces.includes(ns)) errors.push(`en/${ns}.json missing`);

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

let count = 0;
for (const ns of namespaces.filter((n) => arNamespaces.includes(n))) {
  const en = flatten(load('en', ns));
  const ar = flatten(load('ar', ns));
  for (const [k, v] of en) {
    count++;
    if (!ar.has(k)) errors.push(`ar missing ${ns}:${k}`);
    else {
      if (typeof ar.get(k) !== 'string' || ar.get(k).trim() === '') errors.push(`ar empty ${ns}:${k}`);
      if (placeholders(v) !== placeholders(ar.get(k))) errors.push(`placeholder mismatch ${ns}:${k} (en: ${placeholders(v)} / ar: ${placeholders(ar.get(k))})`);
    }
    if (typeof v !== 'string' || v.trim() === '') errors.push(`en empty ${ns}:${k}`);
  }
  for (const k of ar.keys()) if (!en.has(k)) errors.push(`en missing ${ns}:${k}`);
}

const camel = (c) => c.toLowerCase().replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
let enumValues = 0;
for (const locale of ['en', 'ar']) {
  const statuses = load(locale, 'statuses');
  for (const [name, values] of Object.entries(enums)) {
    if (!Array.isArray(values)) continue;
    const group = statuses[camel(name)];
    if (!group) {
      errors.push(`${locale} statuses.${camel(name)} missing (enum ${name})`);
      continue;
    }
    for (const v of values) {
      if (locale === 'en') enumValues++;
      if (!group[v]) errors.push(`${locale} statuses.${camel(name)}.${v} missing`);
    }
  }
}

// 5. Server message codes ↔ <namespace>.messages.* (gates: DIMENSION_MESSAGES_EN + GATE_MESSAGES_EN; finance: FINANCE_MESSAGES_EN)
const { DIMENSION_MESSAGES_EN } = require('@hub/domain/dist/carveout.js');
const { GATE_MESSAGES_EN } = require('@hub/domain/dist/gates.js');
const { FINANCE_MESSAGES_EN } = require('@hub/domain/dist/finance.js');
const serverCatalogues = { gates: { ...DIMENSION_MESSAGES_EN, ...GATE_MESSAGES_EN }, finance: FINANCE_MESSAGES_EN };
let serverCodeCount = 0;
for (const [ns, serverCodes] of Object.entries(serverCatalogues)) {
  serverCodeCount += Object.keys(serverCodes).length;
  for (const locale of ['en', 'ar']) {
    const catalogue = flatten(load(locale, ns).messages ?? {});
    for (const [code, template] of Object.entries(serverCodes)) {
      if (!catalogue.has(code)) errors.push(`${locale} ${ns}.messages.${code} missing (server message code)`);
      else if (placeholders(catalogue.get(code)) !== placeholders(template)) {
        errors.push(`placeholder mismatch ${locale} ${ns}.messages.${code} (server: ${placeholders(template)} / ${locale}: ${placeholders(catalogue.get(code))})`);
      }
    }
    for (const code of catalogue.keys()) if (!(code in serverCodes)) errors.push(`${locale} ${ns}.messages.${code} is not a server message code`);
  }
}

if (errors.length) {
  console.error(`i18n check FAILED (${errors.length} problems):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${namespaces.length} namespaces, ${count} keys per language, ${enumValues} enum values translated in en and ar, ${serverCodeCount} server message codes (gates + finance).`,
);
