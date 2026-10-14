// automation route registration (p5-plan §5.1; p5-work-split §D.1, §D.2). Created as a stub by T-DG5-BE-A; filled by
// T-DG5-BE-H with one registration line per route file of slice D's rules and versions:
//   catalogue.ts  GET /admin/automation-catalogue                                  (BE-H)
//   rules.ts      rules: list, create, get, update, enable, disable                (BE-H)
//   versions.ts   versions: list, create (draft), get, update (draft content)      (BE-H)
//   dry-run.ts    dry runs of a draft (list, run)                                  (BE-H2; stub until then)
//   lifecycle.ts  submit, review, publish, discard                                 (BE-H2; stub until then)
// Each owner edits only its own file; these lines do not change. The failure queue is failures.ts (BE-I), registered
// by index.ts.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerAutomationCatalogueRoutes } from "./catalogue.ts";
import { registerAutomationDryRunRoutes } from "./dry-run.ts"; // BE-H2
import { registerAutomationLifecycleRoutes } from "./lifecycle.ts"; // BE-H2
import { registerAutomationRuleRoutes } from "./rules.ts";
import { registerAutomationVersionRoutes } from "./versions.ts";

/** Registers the rule, version and catalogue routes (and BE-H2's, once filled) and returns them as "METHOD /path". */
export function registerAutomationRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerAutomationCatalogueRoutes(app, deps),
    ...registerAutomationRuleRoutes(app, deps),
    ...registerAutomationVersionRoutes(app, deps),
    ...registerAutomationDryRunRoutes(app, deps),
    ...registerAutomationLifecycleRoutes(app, deps),
  ];
}
