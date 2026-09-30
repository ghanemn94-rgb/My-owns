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
import enPlanning from './en/planning.json';
import enGovernance from './en/governance.json';
import enCarveout from './en/carveout.json';
import enNewco from './en/newco.json';
import enReadiness from './en/readiness.json';
import enJv from './en/jv.json';
import enFinance from './en/finance.json';
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
import arPlanning from './ar/planning.json';
import arGovernance from './ar/governance.json';
import arCarveout from './ar/carveout.json';
import arNewco from './ar/newco.json';
import arReadiness from './ar/readiness.json';
import arJv from './ar/jv.json';
import arFinance from './ar/finance.json';

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
  planning: enPlanning,
  governance: enGovernance,
  carveout: enCarveout,
  newco: enNewco,
  readiness: enReadiness,
  jv: enJv,
  finance: enFinance,
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
  planning: arPlanning,
  governance: arGovernance,
  carveout: arCarveout,
  newco: arNewco,
  readiness: arReadiness,
  jv: arJv,
  finance: arFinance,
} satisfies DeepShape<Messages>;

type DeepShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepShape<T[K]> };

export const MESSAGES: Record<Locale, Messages> = { en, ar: ar as unknown as Messages };
