// The elements of one configuration version (T-DG5-FE-B; REQ-S06-004, REQ-S06-006; ADR-0039 §2): the resolved list
// (catalogue overridden by the version's rows), filtered by element type, with the edit, add and remove dialogs of an
// editable draft. The methodology administrator changes text, labels, help text, phases, gates, approvers, reminders
// and escalation routing here without a code change. The API refuses what would break an invariant (a stable key, a
// protected source element, ADM_METHOD as approver) with the ADR-0039 §13 codes, which the form shows translated.
import {
  CONFIG_ELEMENT_TYPES,
  ELEMENT_TYPES_BY_KIND,
  STABLE_KEY_PATTERN,
  type ConfigElementType,
} from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { p5Paths, useConfigElements } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { type P4Values } from "../my-work/p4ui.tsx";
import {
  ROLE_LIST_MAX,
  StudioFormDialog,
  roleListRows,
  roleListValue,
  type StudioFieldSpec,
} from "./StudioFormDialog.tsx";
import {
  BODY_ATTRIBUTES,
  ROLE_CODE_PATTERN,
  STUDIO_NS,
  TEXT_ATTRIBUTES,
  attrText,
  elementLabel,
  type ConfigElement,
  type ConfigVersion,
} from "./api.ts";
import { type ActionRunner } from "./ui.tsx";
import { ProvenanceBadge } from "../../components/provenance-badge/ProvenanceBadge.tsx";
import { useMethodologyElements } from "../playbook/api.ts";

/** Per element type, the extra (non-text) attributes the dialog edits (ADR-0039 §2 attribute schemas). */
type ExtraKind = "role" | "days" | "flag" | "mode" | "roles";
const EXTRA: Partial<Record<ConfigElementType, readonly { name: string; kind: ExtraKind }[]>> = {
  gate: [
    { name: "defaultApproverRoleCode", kind: "role" },
    { name: "submissionEnabled", kind: "flag" },
  ],
  // T-DG5-FE-G2 (F-DG5-QA-A-3; ADR-0039 §2, ADR-0044 §4): a route is either one approver role, or an ORDERED list of
  // roles with a mode (sequential: one step after another, in this order; parallel: all steps at once; any: one of them).
  approver_route: [
    { name: "mode", kind: "mode" },
    { name: "approverRoleCodes", kind: "roles" },
    { name: "approverRoleCode", kind: "role" },
  ],
  reminder: [
    { name: "offsetWorkingDays", kind: "days" },
    { name: "recipientRoleCode", kind: "role" },
  ],
  escalation_rule: [
    { name: "offsetWorkingDays", kind: "days" },
    { name: "recipientRoleCode", kind: "role" },
  ],
  gate_criterion: [{ name: "mandatory", kind: "flag" }],
  mandatory_artifact: [{ name: "mandatory", kind: "flag" }],
  checklist_item: [{ name: "mandatory", kind: "flag" }],
};

/** The route modes of an approver route (the element schema's `mode`). */
export const ROUTE_MODES = ["sequential", "parallel", "any"] as const;
/** The number of roles a sequential or parallel route runs with (ADR-0044 §4: 2-6 business roles). */
export const ROUTE_ROLES_MIN = 2;
export const ROUTE_ROLES_MAX = 6;

/** The element types an administrator may add as new admin-origin elements (D-142 Q4: never a 7th gate, an 11th dimension). */
const ADDABLE: readonly ConfigElementType[] = [
  "methodology_text",
  "gate_criterion",
  "mandatory_artifact",
  "checklist_item",
  "approver_route",
  "reminder",
  "escalation_rule",
];

const hasBody = (type: string) => type === "methodology_text";

/**
 * The attributes a put sends: the version's own attributes, the edited values on top (an emptied optional value is
 * dropped), and for an approver route the catalogue's approver when neither form is present (exactly one is required).
 */
export function elementPutAttributes(
  element: Pick<ConfigElement, "elementType" | "attributes" | "catalogueAttributes">,
  values: P4Values,
): { attributes: Record<string, unknown> } | { fieldErrors: Record<string, string> } {
  const type = element.elementType;
  const attributes: Record<string, unknown> = { ...element.attributes };
  const errors: Record<string, string> = {};
  const texts = [...TEXT_ATTRIBUTES, ...(hasBody(type) ? BODY_ATTRIBUTES : [])];
  for (const name of texts) {
    const v = values[name];
    if (typeof v === "string" && v.trim() !== "") attributes[name] = v;
    else delete attributes[name];
  }
  for (const extra of EXTRA[type as ConfigElementType] ?? []) {
    const v = values[extra.name];
    if (extra.kind === "mode") {
      // "" keeps no own mode (the shipped one, or a single-step approval); otherwise one of the schema's modes.
      if (typeof v === "string" && (ROUTE_MODES as readonly string[]).includes(v)) attributes[extra.name] = v;
      else delete attributes[extra.name];
      continue;
    }
    if (extra.kind === "roles") {
      // The ordered list, empty rows dropped; each a role code; at most 10 (the schema), order kept.
      const codes = roleListRows(typeof v === "string" ? v : "")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (codes.length === 0) delete attributes[extra.name];
      else if (codes.some((c) => !ROLE_CODE_PATTERN.test(c))) errors[extra.name] = "validation.code";
      else if (codes.length > ROLE_LIST_MAX) errors[extra.name] = "validation.too_big";
      else attributes[extra.name] = codes;
      continue;
    }
    if (extra.kind === "flag") {
      // "" keeps the shipped default (no own value); "true"/"false" set it explicitly.
      if (v === "true" || v === "false") attributes[extra.name] = v === "true";
      else delete attributes[extra.name];
      continue;
    }
    const s = typeof v === "string" ? v.trim() : "";
    if (s === "") {
      delete attributes[extra.name];
      continue;
    }
    if (extra.kind === "role") {
      if (!ROLE_CODE_PATTERN.test(s)) errors[extra.name] = "validation.code";
      else attributes[extra.name] = s;
    } else {
      if (!/^[0-9]{1,3}$/.test(s) || Number(s) > 250) errors[extra.name] = "validation.too_big";
      else attributes[extra.name] = Number(s);
    }
  }
  if (type === "approver_route") routeRules(element, values, attributes, errors);
  return Object.keys(errors).length > 0 ? { fieldErrors: errors } : { attributes };
}

/**
 * The approver-route rules (T-DG5-FE-G2; ADR-0039 §2: exactly one of `approverRoleCode` and `approverRoleCodes`):
 * both entered is refused on the single role; neither entered keeps the catalogue's form; a sequential or parallel mode
 * needs an ordered list of 2-6 roles (ADR-0044 §4), otherwise the route would silently be a single-step approval.
 */
function routeRules(
  element: Pick<ConfigElement, "catalogueAttributes">,
  values: P4Values,
  attributes: Record<string, unknown>,
  errors: Record<string, string>,
): void {
  const entered = (name: string) => typeof values[name] === "string" && String(values[name]).trim() !== "";
  if (entered("approverRoleCode") && attributes["approverRoleCodes"] !== undefined) {
    errors["approverRoleCode"] = "studio_route.one_approver_form";
    return;
  }
  if (attributes["approverRoleCodes"] !== undefined) delete attributes["approverRoleCode"];
  else if (attributes["approverRoleCode"] === undefined) {
    const codes = element.catalogueAttributes["approverRoleCodes"];
    const code = element.catalogueAttributes["approverRoleCode"];
    if (Array.isArray(codes)) attributes["approverRoleCodes"] = codes;
    else if (typeof code === "string") attributes["approverRoleCode"] = code;
    else errors["approverRoleCodes"] = "validation.required";
  }
  const mode = attributes["mode"];
  const list = attributes["approverRoleCodes"];
  if ((mode === "sequential" || mode === "parallel") && errors["approverRoleCodes"] === undefined) {
    const n = Array.isArray(list) ? list.length : 0;
    if (n < ROUTE_ROLES_MIN || n > ROUTE_ROLES_MAX) errors["approverRoleCodes"] = "studio_route.size";
  }
}

export function ElementsSection({
  version,
  editable,
  runner,
  refresh,
}: {
  version: ConfigVersion;
  editable: boolean;
  runner: ActionRunner;
  refresh: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const types = ELEMENT_TYPES_BY_KIND[version.configKind];
  const [type, setType] = useState<string>(types[0] ?? "");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const elements = useConfigElements(version.id, {
    ...(type ? { elementType: type } : {}),
    ...(includeRemoved ? { includeRemoved: "true" } : {}),
  });
  // T-DG5-FE-G2 (REQ-PB-002; ADR-0049 §2): the provenance of the seeded elements (custom extension of the playbook v1.0,
  // B0158-B0162, or foundation-inspired, B0156), as the published methodology resolves it. A failed read shows no badge,
  // never a wrong one; no element is ever labelled a PMI standard.
  const profiles = useMethodologyElements({}, version.configKind === "methodology");
  const profileOf = (e: ConfigElement) =>
    profiles.data?.items.find((p) => p.elementRef === `${e.elementType}.${e.stableKey}`);
  const [editing, setEditing] = useState<ConfigElement | null>(null);
  const [adding, setAdding] = useState(false);

  if (types.length === 0)
    return (
      <Section id="elements" title={t("studio.elements.title")}>
        <p className="muted">{t("studio.elements.otherScreen")}</p>
      </Section>
    );

  const fieldsFor = (elementType: string, withKey: boolean): StudioFieldSpec[] => [
    ...(withKey
      ? [
          {
            name: "elementType",
            label: t("studio.elements.type"),
            kind: "select" as const,
            required: true,
            options: ADDABLE.filter((x) => (types as readonly string[]).includes(x)).map((x) => ({
              value: x,
              label: t(`studio.elementType.${x}`),
            })),
          },
          {
            name: "stableKey",
            label: t("studio.elements.stableKey"),
            hint: t("studio.elements.stableKeyHint"),
            kind: "text" as const,
            required: true,
            max: 96,
            ltr: true,
          },
        ]
      : []),
    { name: "labelEn", label: t("studio.elements.labelEn"), kind: "text", max: 200, ltr: true },
    { name: "labelAr", label: t("studio.elements.labelAr"), kind: "text", max: 200 },
    { name: "helpEn", label: t("studio.elements.helpEn"), kind: "textarea", max: 2000, ltr: true },
    { name: "helpAr", label: t("studio.elements.helpAr"), kind: "textarea", max: 2000 },
    ...(hasBody(elementType) || withKey
      ? ([
          {
            name: "bodyEn",
            label: t("studio.elements.bodyEn"),
            kind: "textarea",
            max: 20000,
            ltr: true,
            when: (v: P4Values) => hasBody(withKey ? String(v["elementType"] ?? "") : elementType),
          },
          {
            name: "bodyAr",
            label: t("studio.elements.bodyAr"),
            kind: "textarea",
            max: 20000,
            when: (v: P4Values) => hasBody(withKey ? String(v["elementType"] ?? "") : elementType),
          },
        ] as StudioFieldSpec[])
      : []),
    ...[...new Set(Object.values(EXTRA).flatMap((list) => list.map((x) => `${x.name}:${x.kind}`)))]
      .map((s) => s.split(":") as [string, ExtraKind])
      .filter(([name]) =>
        withKey ? true : (EXTRA[elementType as ConfigElementType] ?? []).some((x) => x.name === name),
      )
      .map(
        ([name, kind]): StudioFieldSpec => ({
          name,
          label: t(`studio.elements.attr.${name}`),
          ...(kind === "role" ? { hint: t("studio.elements.roleHint") } : {}),
          ...(kind === "roles" ? { hint: t("studio.elements.route.rolesHint") } : {}),
          kind: kind === "flag" || kind === "mode" ? "select" : kind === "roles" ? "roleList" : "text",
          ...(kind === "mode"
            ? {
                options: ROUTE_MODES.map((m) => ({ value: m, label: t(`studio.elements.route.mode.${m}`) })),
                hint: t("studio.elements.route.modeHint"),
              }
            : {}),
          ...(kind === "flag"
            ? {
                options: [
                  { value: "true", label: t("studio.policies.yes") },
                  { value: "false", label: t("studio.policies.no") },
                ],
                hint: t("studio.elements.flagHint"),
              }
            : {}),
          ...(kind === "role" || kind === "days" ? { ltr: true } : {}),
          ...(withKey
            ? {
                when: (v: P4Values) =>
                  (EXTRA[String(v["elementType"] ?? "") as ConfigElementType] ?? []).some((x) => x.name === name),
              }
            : {}),
        }),
      ),
  ];

  const initialOf = (e: ConfigElement): P4Values => {
    const v: P4Values = {};
    for (const name of [...TEXT_ATTRIBUTES, ...BODY_ATTRIBUTES]) v[name] = attrText(e, name);
    for (const extra of EXTRA[e.elementType] ?? []) {
      const own = e.attributes[extra.name];
      const raw = own ?? e.catalogueAttributes[extra.name];
      if (extra.kind === "flag") v[extra.name] = typeof own === "boolean" ? String(own) : "";
      else if (extra.kind === "roles")
        // The version's own single role replaces the catalogue's list (exactly one form is in force).
        v[extra.name] =
          Array.isArray(raw) && typeof e.attributes["approverRoleCode"] !== "string"
            ? roleListValue(raw.map(String))
            : "";
      else if (extra.name === "approverRoleCode" && Array.isArray(e.attributes["approverRoleCodes"]))
        v[extra.name] = ""; // the version's own list replaces the catalogue's single role
      else v[extra.name] = raw === undefined || raw === null ? "" : String(raw);
    }
    return v;
  };

  return (
    <Section
      id="elements"
      title={t("studio.elements.title")}
      intro={t("studio.elements.intro")}
      actions={
        editable && ADDABLE.some((x) => (types as readonly string[]).includes(x)) ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            {t("studio.elements.add")}
          </button>
        ) : null
      }
    >
      <div className="toolbar">
        <label>
          {t("studio.elements.type")}{" "}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((x) => (
              <option key={x} value={x}>
                {t(`studio.elementType.${x}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label className="checkbox">
          <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />
          {t("studio.elements.includeRemoved")}
        </label>
      </div>
      <QueryState
        query={elements}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("studio.elements.empty")} />}
      >
        {(rows) => (
          <div className="table-wrap">
            <table className="table" data-table="elements">
              <caption className="visually-hidden">{t("studio.elements.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.elements.stableKey")}</th>
                  <th scope="col">{t("studio.elements.label")}</th>
                  <th scope="col">{t("studio.elements.help")}</th>
                  <th scope="col">{t("studio.elements.change")}</th>
                  {editable ? <th scope="col">{t("studio.elements.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const label = elementLabel(e, locale);
                  return (
                    <tr key={`${e.elementType}/${e.stableKey}`} data-element={`${e.elementType}:${e.stableKey}`}>
                      <th scope="row">
                        <bdi dir="ltr" className="code">
                          {e.stableKey}
                        </bdi>
                        {e.sourceRef ? (
                          <span className="block small muted">
                            <bdi dir="ltr">{e.sourceRef}</bdi>
                          </span>
                        ) : null}
                      </th>
                      <td>
                        {label}
                        {(() => {
                          const profile = profileOf(e);
                          return profile ? (
                            <span className="block" data-element-provenance={profile.elementRef}>
                              <ProvenanceBadge provenance={profile.provenance} overridden={profile.overridden} />
                            </span>
                          ) : null;
                        })()}
                        {e.elementType === "approver_route" ? <RouteSummary element={e} /> : null}
                      </td>
                      <td>
                        <TextCell value={attrText(e, locale === "ar" ? "helpAr" : "helpEn")} />
                      </td>
                      <td>
                        {e.removed
                          ? t("studio.elements.removed")
                          : e.overridden
                            ? t("studio.elements.overridden")
                            : e.origin === "admin"
                              ? t("studio.elements.added")
                              : t("studio.elements.unchanged")}
                      </td>
                      {editable ? (
                        <td>
                          {!e.removed ? (
                            <>
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                aria-label={`${t("studio.elements.edit")} ${label}`}
                                onClick={() => setEditing(e)}
                              >
                                {t("studio.elements.edit")}
                              </button>{" "}
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                aria-label={`${t("studio.elements.remove")} ${label}`}
                                disabled={runner.busy}
                                onClick={() =>
                                  void runner.run(p5Paths.removeConfigElement(version.id, e.elementType, e.stableKey), {
                                    ifMatch: version.version,
                                  })
                                }
                              >
                                {t("studio.elements.remove")}
                              </button>
                            </>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {editing ? (
        <StudioFormDialog
          title={t("studio.elements.editTitle", {
            type: t(`studio.elementType.${editing.elementType}`),
            key: editing.stableKey,
          })}
          description={t("studio.elements.editBody")}
          fields={fieldsFor(editing.elementType, false)}
          initial={initialOf(editing)}
          submitLabel={t("studio.elements.save")}
          method="PUT"
          url={p5Paths.configElement(version.id, editing.elementType, editing.stableKey)}
          version={version.version}
          namespaces={STUDIO_NS}
          toBody={(values) => {
            const built = elementPutAttributes(editing, values);
            return "fieldErrors" in built ? built : { attributes: built.attributes };
          }}
          onDone={refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {adding ? (
        <AddElementDialog
          version={version}
          fields={fieldsFor("", true)}
          refresh={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}

/** The route an approver-route element puts in force: its mode and its ordered roles, or its single approver. */
export function RouteSummary({ element }: { element: Pick<ConfigElement, "attributes" | "catalogueAttributes"> }) {
  const { t } = useTranslation();
  const own = element.attributes;
  const pick = (name: string) => (name in own ? own[name] : element.catalogueAttributes[name]);
  // Exactly one form is in force: the version's own form wins over the catalogue's.
  const ownList = Array.isArray(own["approverRoleCodes"]);
  const ownSingle = typeof own["approverRoleCode"] === "string";
  const list = ownSingle ? undefined : pick("approverRoleCodes");
  const single = ownList ? undefined : pick("approverRoleCode");
  const mode = typeof pick("mode") === "string" ? String(pick("mode")) : null;
  if (Array.isArray(list) && list.length > 0) {
    const modeLabel = (ROUTE_MODES as readonly string[]).includes(mode ?? "")
      ? t(`studio.elements.route.modeShort.${mode}`)
      : t("studio.elements.route.modeShort.none");
    return (
      <span className="block small" data-route-summary={mode ?? "none"}>
        {t("studio.elements.route.summary", { mode: modeLabel })}{" "}
        <ol className="route-steps">
          {list.map((code, i) => (
            <li key={i} data-route-step={i + 1}>
              <bdi dir="ltr" className="code">
                {String(code)}
              </bdi>
            </li>
          ))}
        </ol>
      </span>
    );
  }
  return typeof single === "string" ? (
    <span className="block small" data-route-summary="single">
      {t("studio.elements.route.summarySingle")}{" "}
      <bdi dir="ltr" className="code">
        {single}
      </bdi>
    </span>
  ) : null;
}

/** Adds an admin-origin element (D-142 Q4: "create" is a draft version containing the element). */
function AddElementDialog({
  version,
  fields,
  refresh,
  onClose,
}: {
  version: ConfigVersion;
  fields: StudioFieldSpec[];
  refresh: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<{ type: string; key: string }>({ type: "", key: "" });
  const valid =
    (CONFIG_ELEMENT_TYPES as readonly string[]).includes(target.type) && STABLE_KEY_PATTERN.test(target.key);
  return (
    <StudioFormDialog
      title={t("studio.elements.addTitle")}
      description={t("studio.elements.addBody")}
      fields={fields}
      submitLabel={t("studio.elements.save")}
      method="PUT"
      url={valid ? p5Paths.configElement(version.id, target.type, target.key) : p5Paths.configElements(version.id)}
      version={version.version}
      namespaces={STUDIO_NS}
      onValuesChange={(v) => setTarget({ type: String(v["elementType"] ?? ""), key: String(v["stableKey"] ?? "") })}
      toBody={(values) => {
        const key = String(values["stableKey"] ?? "");
        if (!STABLE_KEY_PATTERN.test(key)) return { fieldErrors: { stableKey: "validation.key" } };
        const built = elementPutAttributes(
          { elementType: String(values["elementType"]) as ConfigElementType, attributes: {}, catalogueAttributes: {} },
          values,
        );
        return "fieldErrors" in built ? built : { origin: "admin", attributes: built.attributes };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
