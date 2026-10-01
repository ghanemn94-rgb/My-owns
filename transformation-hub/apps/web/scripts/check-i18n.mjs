#!/usr/bin/env node
/**
 * i18n consistency check (run: pnpm --filter @hub/web i18n:check)
 *  1. en and ar catalogues have exactly the same keys in every namespace;
 *  2. no message is empty;
 *  3. {placeholders} are identical between languages;
 *  4. statuses.<enumName> covers every value of every enum exported by packages/domain/src/enums.ts;
 *     (plus the JV vocabularies declared in packages/domain/src/jv.ts — room types, access levels, disclosure statuses, …);
 *  5. every server message code the domain emits (status dimensions, gate blockers, JV signing/closing blockers — QA-P1-14;
 *     finance explanations and EV / equity / currency / unit findings — FINANCE_MESSAGES_EN) has a translation
 *     `<namespace>.messages.<code>` (gates / finance) in en and ar with the same placeholders as the domain's English
 *     template, and no stale code is left in the catalogue;
 *     QA-P2-04: planning explanations (PLANNING_MESSAGES_EN, `planning.messages.plan.*`) and authority reasons
 *     (AUTHORITY_MESSAGES_EN, `governance.messages.authority.*`) — the web routes `plan.*` / `authority.*` codes to those
 *     catalogues (lib/i18n-data.ts `serverMessageKey`), so no other catalogue may use these prefixes;
 *     QA-P34-01: carve-out reconciliation findings, impact summaries and history reasons (PERIMETER_MESSAGES_EN,
 *     `carveout.messages.perimeter.*`), TSA escalation texts and system history rationales of cutover plans
 *     (READINESS_MESSAGES_EN, `readiness.messages.tsa.*` / `readiness.messages.cutover.*`) and legal-entity history reasons
 *     (NEWCO_HISTORY_MESSAGES_EN, `newco.messages.newco.*`);
 *  6. every AI refusal code raised in apps/api/src/modules/ai has `ai.errors.<code>` in en and ar, and every AI detection
 *     code / proposable action has its label; QA-P5-04: the rules-only detection explanations (AI_DETECTION_MESSAGES_EN,
 *     `ai.messages.ai.detection.*`) are checked as in 5, and the Arabic texts the server uses for the model context of an
 *     Arabic AI run (AI_DETECTION_MESSAGES_AR, AI_STATUS_AR) must equal `ai.messages` / `statuses.<vocabulary>` in ar;
 *  7. every refusal code the gates module raises (apps/api/src/modules/gates, packages/domain/src/gates.ts) has a
 *     translated explanation in apps/web/src/lib/refusals.ts (QA-P2-04), whose keys are typed and checked by 1–3;
 *  8. every audit action written with a literal `action: '<module>.…'` in the governance and finance modules has its
 *     history label `<module>.audit.<action with dots as underscores>` in en and ar (QA-P2F-03: the decision history
 *     showed the raw code `governance.decision.close_voting`).
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

// 5. Server message codes ↔ <namespace>.messages.* (gates: DIMENSION_MESSAGES_EN + GATE_MESSAGES_EN + JV_MESSAGES_EN;
//    finance: FINANCE_MESSAGES_EN)
const { DIMENSION_MESSAGES_EN } = require('@hub/domain/dist/carveout.js');
const { GATE_MESSAGES_EN } = require('@hub/domain/dist/gates.js');
const { FINANCE_MESSAGES_EN } = require('@hub/domain/dist/finance.js');
const { PLANNING_MESSAGES_EN } = require('@hub/domain/dist/planning-messages.js');
const { AUTHORITY_MESSAGES_EN } = require('@hub/domain/dist/governance.js');
const { JV_MESSAGES_EN } = jv;
const { PERIMETER_MESSAGES_EN } = require('@hub/domain/dist/perimeter.js');
const { READINESS_MESSAGES_EN } = require('@hub/domain/dist/readiness.js');
const { NEWCO_HISTORY_MESSAGES_EN } = require('@hub/domain/dist/newco.js');
const { AI_DETECTION_MESSAGES_EN, AI_DETECTION_MESSAGES_AR, AI_STATUS_AR, AI_DETECTION_ENUM_PARAMS } = require('@hub/domain/dist/ai/detection-messages.js');
const serverCatalogues = {
  gates: { ...DIMENSION_MESSAGES_EN, ...GATE_MESSAGES_EN, ...JV_MESSAGES_EN },
  finance: FINANCE_MESSAGES_EN,
  planning: PLANNING_MESSAGES_EN,
  governance: AUTHORITY_MESSAGES_EN,
  carveout: PERIMETER_MESSAGES_EN,
  readiness: READINESS_MESSAGES_EN,
  newco: NEWCO_HISTORY_MESSAGES_EN,
  ai: AI_DETECTION_MESSAGES_EN,
};
// Code prefixes routed to a catalogue other than `gates` by useServerMessages (lib/i18n-data.ts serverMessageKey).
const ROUTED_PREFIXES = { planning: ['plan.'], governance: ['authority.'], carveout: ['perimeter.'], readiness: ['tsa.', 'cutover.'], newco: ['newco.'], ai: ['ai.'] };
const i18nDataSrc = readFileSync(join(here, '..', 'src', 'lib', 'i18n-data.ts'), 'utf8');
for (const [ns, prefixes] of Object.entries(ROUTED_PREFIXES)) {
  for (const prefix of prefixes) if (!i18nDataSrc.includes(`['${prefix}', '${ns}']`)) errors.push(`lib/i18n-data.ts ROUTED_PREFIXES does not route "${prefix}" to ${ns}.messages`);
}
for (const [ns, prefixes] of Object.entries(ROUTED_PREFIXES)) {
  if (!serverCatalogues[ns] || Object.keys(serverCatalogues[ns]).length === 0) errors.push(`server message catalogue ${ns} is empty or missing`);
  for (const code of Object.keys(serverCatalogues[ns] ?? {})) if (!prefixes.some((p) => code.startsWith(p))) errors.push(`${ns} server message code ${code} must start with ${prefixes.map((p) => `"${p}"`).join(' or ')} (routed by prefix)`);
  for (const code of Object.keys(serverCatalogues.gates)) for (const prefix of prefixes) if (code.startsWith(prefix)) errors.push(`gates server message code ${code} uses the prefix "${prefix}" routed to ${ns}.messages`);
}
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

// 6a. AI context texts (QA-P5-04): an Arabic AI run's model context is rendered on the server from the same codes; its
//     Arabic templates and status labels must be the catalogue's own texts, so the context says what the screen says.
{
  const arAi = flatten(load('ar', 'ai').messages ?? {});
  for (const [code, text] of Object.entries(AI_DETECTION_MESSAGES_AR)) {
    if (arAi.get(code) !== text) errors.push(`ar ai.messages.${code} differs from the domain's AI_DETECTION_MESSAGES_AR (model context of Arabic runs)`);
  }
  for (const code of Object.keys(AI_DETECTION_MESSAGES_EN)) if (!(code in AI_DETECTION_MESSAGES_AR)) errors.push(`AI_DETECTION_MESSAGES_AR lacks ${code}`);
  const arStatuses = load('ar', 'statuses');
  for (const [vocabulary, labels] of Object.entries(AI_STATUS_AR)) {
    const group = arStatuses[vocabulary];
    if (!group) errors.push(`AI_STATUS_AR.${vocabulary} is not a statuses vocabulary`);
    else {
      for (const [value, label] of Object.entries(labels)) if (group[value] !== label) errors.push(`AI_STATUS_AR.${vocabulary}.${value} differs from ar statuses.${vocabulary}.${value}`);
      for (const value of Object.keys(group)) if (!(value in labels)) errors.push(`AI_STATUS_AR.${vocabulary} lacks ${value} (ar statuses.${vocabulary})`);
    }
  }
  for (const [code, params] of Object.entries(AI_DETECTION_ENUM_PARAMS)) for (const v of Object.values(params)) if (!(v in AI_STATUS_AR)) errors.push(`AI_DETECTION_ENUM_PARAMS.${code} uses ${v}, which AI_STATUS_AR does not carry`);
}

// 6. AI PM Center (`ai` namespace). Detection explanations are checked in 5 / 6a; the AI refusals carry codes the screens
//    translate (`ai.errors.<code>`): every code raised with ruleViolation / conflict / forbidden in apps/api/src/modules/ai
//    must have a translation in en and ar, so a new refusal never reaches an Arabic user as an English sentence. Likewise
//    every rules-only detection code (contracts AI_DETECTION_CODES) and every proposable action (domain AI_PROPOSABLE_ACTIONS).
const aiModuleDir = join(here, '..', '..', 'api', 'src', 'modules', 'ai');
// Raised indirectly through `ruleViolation(v.code, …)` in ai-proposals.service.ts (the scan below only sees literals).
const aiCodes = new Set(['AI_TOOL_DENIED', 'DESTINATION_NOT_APPROVED']);
for (const f of readdirSync(aiModuleDir).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(join(aiModuleDir, f), 'utf8');
  for (const m of src.matchAll(/\b(?:ruleViolation|conflict|forbidden)\(\s*'([^']+)'/g)) aiCodes.add(m[1]);
}
const { AI_DETECTION_CODES } = require('@hub/contracts/dist/ai.js');
const { AI_PROPOSABLE_ACTIONS } = require('@hub/domain/dist/ai.js');
if (aiCodes.size < 10) errors.push(`only ${aiCodes.size} AI refusal codes found in ${aiModuleDir} — scan broken?`);
for (const locale of ['en', 'ar']) {
  const cat = load(locale, 'ai');
  const errs = flatten(cat.errors ?? {});
  for (const code of aiCodes) if (!errs.has(code)) errors.push(`${locale} ai.errors.${code} missing (AI refusal code raised in apps/api/src/modules/ai)`);
  for (const c of AI_DETECTION_CODES) if (!cat.detections?.codes?.[c]) errors.push(`${locale} ai.detections.codes.${c} missing (AI_DETECTION_CODES)`);
  for (const a of AI_PROPOSABLE_ACTIONS) if (!cat.actions?.[a]) errors.push(`${locale} ai.actions.${a} missing (AI_PROPOSABLE_ACTIONS)`);
}

// 7. Gate refusals (QA-P2-04): every code raised with ruleViolation / conflict / forbidden in the gates module and the gate
//    rules has an entry in lib/refusals.ts, so no gate refusal reaches an Arabic user as the server's English detail only.
//    404 codes (notFound) are never explained (existence is not revealed) and are not listed.
const gateSources = [
  ...readdirSync(join(here, '..', '..', 'api', 'src', 'modules', 'gates')).filter((x) => x.endsWith('.ts')).map((f) => join(here, '..', '..', 'api', 'src', 'modules', 'gates', f)),
  join(here, '..', '..', '..', 'packages', 'domain', 'src', 'gates.ts'),
];
// Raised indirectly (a conditional expression or the decision-use registry's `${codePrefix}.decision_already_used`).
const gateCodes = new Set(['gates.decide.decision_not_for_gate', 'gates.decide.decision_evidence_invalid', 'gates.decide.decision_not_final', 'gates.decide.decision_already_used']);
for (const f of gateSources) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:ruleViolation|conflict|forbidden)\(\s*'((?:gates|waiver)\.[a-z_.]+)'/g)) gateCodes.add(m[1]);
}
const refusalsSrc = readFileSync(join(here, '..', 'src', 'lib', 'refusals.ts'), 'utf8');
const refusalCodes = new Set([...refusalsSrc.matchAll(/^\s*'([a-z_.]+)':/gm)].map((m) => m[1]));
if (gateCodes.size < 30) errors.push(`only ${gateCodes.size} gate refusal codes found — scan broken?`);
for (const code of gateCodes) if (!refusalCodes.has(code)) errors.push(`gate refusal code ${code} has no translated explanation in src/lib/refusals.ts`);

// 8. History labels of audit actions (QA-P2F-03). The history screens translate `<module>.audit.<action>`; a missing label
//    shows the raw code in both languages. Only literal actions can be scanned (template literals are listed by hand).
let auditActionCount = 0;
for (const mod of ['governance', 'finance']) {
  const dir = join(here, '..', '..', 'api', 'src', 'modules', mod);
  const actions = new Set();
  for (const f of readdirSync(dir, { recursive: true }).filter((x) => String(x).endsWith('.ts'))) {
    const src = readFileSync(join(dir, String(f)), 'utf8');
    for (const m of src.matchAll(new RegExp(`\\baction:\\s*'(${mod}\\.[a-z_.]+)'`, 'g'))) actions.add(m[1]);
  }
  if (actions.size < 10) errors.push(`only ${actions.size} ${mod} audit actions found — scan broken?`);
  auditActionCount += actions.size;
  for (const locale of ['en', 'ar']) {
    const labels = load(locale, mod).audit ?? {};
    for (const a of actions) {
      const key = a.slice(mod.length + 1).replace(/\./g, '_');
      if (!labels[key]) errors.push(`${locale} ${mod}.audit.${key} missing (history label of the audit action ${a})`);
    }
  }
}

if (errors.length) {
  console.error(`i18n check FAILED (${errors.length} problems):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${namespaces.length} namespaces, ${count} keys per language, ${enumValues} enum values translated in en and ar, ${serverCodeCount} server message codes (gates incl. JV, finance, planning, governance, carve-out, readiness, NewCo, AI detections), ${aiCodes.size} AI refusal codes, ${gateCodes.size} gate refusal codes, ${auditActionCount} governance / finance history labels.`,
);
