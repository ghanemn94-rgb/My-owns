#!/usr/bin/env node
/**
 * i18n consistency check (run: pnpm --filter @hub/web i18n:check)
 *  1. en and ar catalogues have exactly the same keys in every namespace;
 *  2. no message is empty;
 *  3. {placeholders} are identical between languages;
 *  4. statuses.<enumName> covers every value of every enum exported by packages/domain/src/enums.ts;
 *     (plus the JV vocabularies declared in packages/domain/src/jv.ts — room types, access levels, disclosure statuses, …);
 *  5. every server message code the domain emits (status dimensions, gate blockers, JV signing/closing blockers — QA-P1-14) has a translation
 *     `gates.messages.<code>` in en and ar with the same placeholders as the domain's English template, and no stale code
 *     is left in the catalogue.
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
// JV vocabularies live next to their rules (packages/domain/src/jv.ts) rather than in enums.ts; the screens show them too.
const jv = require('@hub/domain/dist/jv.js');
const JV_VOCABULARIES = ['ROOM_TYPES', 'ROOM_ACCESS_LEVELS', 'DISCLOSURE_STATUSES', 'ROOM_ACCESS_EVENT_KINDS', 'ASSESSMENT_BASES', 'DD_REQUEST_ORIGINS', 'DD_DOMAINS', 'DD_EXTERNAL_STATUSES', 'PARTNER_CONFLICT_STATUSES', 'PROGRAM_CLOSURE_STATUSES'];
const vocabularies = { ...enums };
for (const name of JV_VOCABULARIES) {
  if (!Array.isArray(jv[name])) errors.push(`@hub/domain jv.${name} is not an exported vocabulary`);
  else vocabularies[name] = jv[name];
}
let enumValues = 0;
for (const locale of ['en', 'ar']) {
  const statuses = load(locale, 'statuses');
  for (const [name, values] of Object.entries(vocabularies)) {
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

// 5. Server message codes (packages/domain: DIMENSION_MESSAGES_EN, GATE_MESSAGES_EN, JV_MESSAGES_EN) ↔ gates.messages.*
const { DIMENSION_MESSAGES_EN } = require('@hub/domain/dist/carveout.js');
const { GATE_MESSAGES_EN } = require('@hub/domain/dist/gates.js');
const { JV_MESSAGES_EN } = jv;
const serverCodes = { ...DIMENSION_MESSAGES_EN, ...GATE_MESSAGES_EN, ...JV_MESSAGES_EN };
for (const locale of ['en', 'ar']) {
  const catalogue = flatten(load(locale, 'gates').messages ?? {});
  for (const [code, template] of Object.entries(serverCodes)) {
    if (!catalogue.has(code)) errors.push(`${locale} gates.messages.${code} missing (server message code)`);
    else if (placeholders(catalogue.get(code)) !== placeholders(template)) {
      errors.push(`placeholder mismatch ${locale} gates.messages.${code} (server: ${placeholders(template)} / ${locale}: ${placeholders(catalogue.get(code))})`);
    }
  }
  for (const code of catalogue.keys()) if (!(code in serverCodes)) errors.push(`${locale} gates.messages.${code} is not a server message code`);
}

if (errors.length) {
  console.error(`i18n check FAILED (${errors.length} problems):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${namespaces.length} namespaces, ${count} keys per language, ${enumValues} enum values translated in en and ar, ${Object.keys(serverCodes).length} server message codes.`,
);
