// The automation builder catalogue (OpenAPI `getAutomationCatalogue`; ADR-0043 §2; REQ-S12-001, REQ-S12-002,
// REQ-S12-026; T-DG5-BE-H):
//   GET /admin/automation-catalogue   the triggers (event, schedule, request; their condition fields and whether they
//                                     name an initiating user) and the action types, including the six human-only types
//                                     listed so the builder can name them (automation.read)
// Both catalogues are read-only rows of 0074/0075. An automatic action's `parametersSchema` is the JSON Schema of its
// registry descriptor (the module that owns the action defines it); an action without a descriptor, a starter-only
// action and a human-only action list `{}` and are not selectable for an admin rule.
import type { DbOrTx } from "@mth/db";
import { PERMISSION_CODES, type Permission } from "@mth/shared";
import type { AutomationCatalogue } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf, type Principal } from "../access/index.ts";
import { problems, type ModuleDeps } from "../platform/index.ts";
import { automationActionRegistry } from "./registry.ts";
import { samplePayloadOf } from "./samples.ts";

export const CATALOGUE = "/api/v1/admin/automation-catalogue";

export interface TriggerRow {
  readonly code: string;
  readonly trigger_kind: string;
  readonly owner_module: string;
  readonly label_en: string;
  readonly label_ar: string;
  readonly condition_fields: string[];
  readonly initiating_user_field: string | null;
  readonly admin_selectable: boolean;
  readonly source_ref: string;
}

export interface ActionTypeRow {
  readonly code: string;
  readonly action_class: string;
  readonly owner_module: string;
  readonly label_en: string;
  readonly label_ar: string;
  readonly required_permission_code: string | null;
  readonly admin_selectable: boolean;
  readonly source_ref: string;
}

export interface CatalogueRows {
  readonly triggers: ReadonlyMap<string, TriggerRow>;
  readonly actions: ReadonlyMap<string, ActionTypeRow>;
}

/** Both catalogues, keyed by code (ordered by code). */
export async function loadCatalogueRows(db: DbOrTx): Promise<CatalogueRows> {
  const [triggers, actions] = await Promise.all([
    db.selectFrom("automation_trigger").selectAll().orderBy("code").execute(),
    db.selectFrom("automation_action_type").selectAll().orderBy("code").execute(),
  ]);
  return {
    triggers: new Map(triggers.map((t) => [t.code, t as TriggerRow])),
    actions: new Map(actions.map((a) => [a.code, a as ActionTypeRow])),
  };
}

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSION_CODES);

function parametersSchemaOf(code: string): Record<string, unknown> {
  const descriptor = automationActionRegistry().get(code);
  if (descriptor === undefined) return {};
  const schema = z.toJSONSchema(descriptor.parametersSchema, { unrepresentable: "any" }) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/**
 * T-DG5-BE-C4 (D-164 d): `samplePayload` for an event trigger whose outbox event has a payload schema (samples.ts), a
 * complete synthetic example valid against it; omitted for every other trigger.
 */
function samplePayloadField(t: TriggerRow): { samplePayload?: Record<string, unknown> } {
  const sample = samplePayloadOf(t.code, t.trigger_kind);
  return sample === undefined ? {} : { samplePayload: sample };
}

export function presentCatalogue(rows: CatalogueRows): AutomationCatalogue {
  return {
    triggers: [...rows.triggers.values()].map((t) => ({
      code: t.code,
      triggerKind: t.trigger_kind as "event" | "schedule" | "request",
      ownerModule: t.owner_module,
      labelEn: t.label_en,
      labelAr: t.label_ar,
      conditionFields: [...t.condition_fields],
      hasInitiatingUser: t.initiating_user_field !== null,
      adminSelectable: t.admin_selectable,
      sourceRef: t.source_ref,
      ...samplePayloadField(t),
    })),
    actionTypes: [...rows.actions.values()].map((a) => ({
      code: a.code,
      actionClass: a.action_class as "automatic" | "human_only",
      ownerModule: a.owner_module,
      labelEn: a.label_en,
      labelAr: a.label_ar,
      requiredPermissionCode:
        a.required_permission_code !== null && KNOWN_PERMISSIONS.has(a.required_permission_code)
          ? (a.required_permission_code as Permission)
          : null,
      // An automatic action is offered to admin rules only when its owning module registered a descriptor.
      adminSelectable: a.admin_selectable && automationActionRegistry().get(a.code) !== undefined,
      parametersSchema: a.action_class === "automatic" ? parametersSchemaOf(a.code) : {},
      sourceRef: a.source_ref,
    })),
  };
}

/** `automation.read` held at any scope (the catalogue is global), else 403. */
export function requireAutomationReader(principal: Principal): void {
  if (!holdsAnywhere(principal, "automation.read")) throw problems.forbidden();
}

export function registerAutomationCatalogueRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(CATALOGUE, { config: { access: { permission: "automation.read" } } }, async (request) => {
    requireAutomationReader(principalOf(request));
    return presentCatalogue(await loadCatalogueRows(db));
  });
  return [`GET ${CATALOGUE}`];
}
