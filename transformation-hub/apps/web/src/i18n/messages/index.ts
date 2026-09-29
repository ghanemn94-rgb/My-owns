/**
 * Message catalogues. Imported only by the root layout (a Server Component), which passes the active
 * locale's catalogue to the client provider — the client bundle never ships both languages.
 */
import type { Locale } from '../config';
import enCommon from './en/common.json';
import enNav from './en/nav.json';
import enAuth from './en/auth.json';
import enPortfolio from './en/portfolio.json';
import enProject from './en/project.json';
import enMembers from './en/members.json';
import enStates from './en/states.json';
import enStatuses from './en/statuses.json';
import enAdmin from './en/admin.json';
import enGates from './en/gates.json';
import enDocuments from './en/documents.json';
import arCommon from './ar/common.json';
import arNav from './ar/nav.json';
import arAuth from './ar/auth.json';
import arPortfolio from './ar/portfolio.json';
import arProject from './ar/project.json';
import arMembers from './ar/members.json';
import arStates from './ar/states.json';
import arStatuses from './ar/statuses.json';
import arAdmin from './ar/admin.json';
import arGates from './ar/gates.json';
import arDocuments from './ar/documents.json';

const en = {
  common: enCommon,
  nav: enNav,
  auth: enAuth,
  portfolio: enPortfolio,
  project: enProject,
  members: enMembers,
  states: enStates,
  statuses: enStatuses,
  admin: enAdmin,
  gates: enGates,
  documents: enDocuments,
};

export type Messages = typeof en;

/** `satisfies` makes the compiler reject an Arabic catalogue that is missing an English key. */
const ar = {
  common: arCommon,
  nav: arNav,
  auth: arAuth,
  portfolio: arPortfolio,
  project: arProject,
  members: arMembers,
  states: arStates,
  statuses: arStatuses,
  admin: arAdmin,
  gates: arGates,
  documents: arDocuments,
} satisfies DeepShape<Messages>;

type DeepShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepShape<T[K]> };

export const MESSAGES: Record<Locale, Messages> = { en, ar: ar as unknown as Messages };
