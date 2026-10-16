// The readable rule builder (T-DG5-FE-D; REQ-S12-001, REQ-S12-002, REQ-S12-026; ADR-0043 §2, amendment D-146): the
// trigger(s) from the builder catalogue, the conditions on the trigger's fields, the actions with their typed
// settings (create_task, notify, escalate: role, message, due days, target transformation), and the identity the rule
// runs as. Human decisions (approve a gate, decide an approval or an investment, attest a Finance value, decide an
// executive ask or a methodology migration) are listed as NOT automatable and cannot be chosen; the server refuses them
// again (422 automation_rule.human_only_action) and the database a third time.
import { AUTOMATION_CONDITION_OPS, AUTOMATION_MESSAGE_KEYS, HUMAN_ONLY_ACTION_CODES } from "@mth/shared/schemas";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { pick } from "./ui.tsx";
import type { AutomationCatalogue } from "./api.ts";

export interface ConditionDraft {
  field: string;
  op: string;
  value: string;
}
export interface ActionDraft {
  type: string;
  role: string;
  messageKey: string;
  dueInWorkingDays: string;
  targetTransformationId: string;
}
export interface ContentDraft {
  triggerCodes: string[];
  conditions: ConditionDraft[];
  actions: ActionDraft[];
  runAs: "initiating_user" | "service";
  servicePermissionCodes: string;
}

/** The role parameter of each automatic admin action (D-146). */
const ROLE_PARAM: Record<string, string> = { create_task: "assigneeRole", notify: "recipientRole", escalate: "toRole" };

export const emptyContent = (): ContentDraft => ({
  triggerCodes: [],
  conditions: [],
  actions: [
    {
      type: "create_task",
      role: "",
      messageKey: AUTOMATION_MESSAGE_KEYS[0],
      dueInWorkingDays: "",
      targetTransformationId: "",
    },
  ],
  runAs: "service",
  servicePermissionCodes: "",
});

/** The builder's model of a stored content (OpenAPI AutomationRuleContent). */
export function toContentDraft(c: {
  triggerCodes: readonly string[];
  conditions?: readonly { field: string; op: string; value?: unknown }[];
  actions: readonly { type: string; parameters?: Record<string, unknown> }[];
  runAs: "initiating_user" | "service";
  servicePermissionCodes?: readonly string[];
}): ContentDraft {
  return {
    triggerCodes: [...c.triggerCodes],
    conditions: (c.conditions ?? []).map((x) => ({
      field: x.field,
      op: x.op,
      value: x.value === undefined ? "" : Array.isArray(x.value) ? x.value.join(", ") : String(x.value as string),
    })),
    actions: c.actions.map((a) => {
      const p = a.parameters ?? {};
      const roleKey = ROLE_PARAM[a.type];
      return {
        type: a.type,
        role: roleKey ? String(p[roleKey] ?? "") : "",
        messageKey: String(p["messageKey"] ?? AUTOMATION_MESSAGE_KEYS[0]),
        dueInWorkingDays: p["dueInWorkingDays"] === undefined ? "" : String(p["dueInWorkingDays"] as number),
        targetTransformationId: String(p["targetTransformationId"] ?? ""),
      };
    }),
    runAs: c.runAs,
    servicePermissionCodes: (c.servicePermissionCodes ?? []).join(", "),
  };
}

const conditionValue = (op: string, v: string): unknown => {
  if (op === "present" || op === "absent") return undefined;
  if (op === "in")
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  if (v.trim() === "true") return true;
  if (v.trim() === "false") return false;
  return v.trim();
};

/** The request member `content` of a builder model. */
export function toContentBody(d: ContentDraft): Record<string, unknown> {
  return {
    triggerCodes: d.triggerCodes,
    conditions: d.conditions.map((c) => {
      const value = conditionValue(c.op, c.value);
      return { field: c.field.trim(), op: c.op, ...(value === undefined ? {} : { value }) };
    }),
    actions: d.actions.map((a) => {
      const roleKey = ROLE_PARAM[a.type];
      const parameters: Record<string, unknown> = {};
      if (roleKey) parameters[roleKey] = a.role.trim();
      parameters["messageKey"] = a.messageKey;
      if (a.type === "create_task" && /^\d+$/.test(a.dueInWorkingDays.trim()))
        parameters["dueInWorkingDays"] = Number(a.dueInWorkingDays.trim());
      if (a.targetTransformationId) parameters["targetTransformationId"] = a.targetTransformationId;
      return { type: a.type, parameters };
    }),
    runAs: d.runAs,
    ...(d.runAs === "service"
      ? {
          servicePermissionCodes: d.servicePermissionCodes
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

export function ContentEditor({
  value,
  onChange,
  catalogue,
  transformations,
  idPrefix,
}: {
  value: ContentDraft;
  onChange: (v: ContentDraft) => void;
  catalogue: AutomationCatalogue;
  transformations: readonly { id: string; code: string; name: string }[];
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const triggers = catalogue.triggers.filter((x) => x.adminSelectable);
  const actionTypes = catalogue.actionTypes.filter((x) => x.adminSelectable && x.actionClass === "automatic");
  const fields = [
    ...new Set(catalogue.triggers.filter((x) => value.triggerCodes.includes(x.code)).flatMap((x) => x.conditionFields)),
  ];
  const set = (patch: Partial<ContentDraft>) => onChange({ ...value, ...patch });
  const setCondition = (i: number, patch: Partial<ConditionDraft>) =>
    set({ conditions: value.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAction = (i: number, patch: Partial<ActionDraft>) =>
    set({ actions: value.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const id = (x: string) => `${idPrefix}-${x}`;
  return (
    <div data-builder="automation-content">
      <fieldset>
        <legend>{t("workflowsP5.rules.whenTitle")}</legend>
        <p className="field__hint">{t("workflowsP5.rules.whenHint")}</p>
        {triggers.map((tr) => (
          <div className="field" key={tr.code}>
            <label className="checkbox" htmlFor={id(`trigger-${tr.code}`)}>
              <input
                id={id(`trigger-${tr.code}`)}
                type="checkbox"
                checked={value.triggerCodes.includes(tr.code)}
                onChange={(e) =>
                  set({
                    triggerCodes: e.target.checked
                      ? [...value.triggerCodes, tr.code]
                      : value.triggerCodes.filter((c) => c !== tr.code),
                  })
                }
              />{" "}
              {pick(locale, tr.labelEn, tr.labelAr)}{" "}
              <bdi dir="ltr" className="small muted code">
                {tr.code}
              </bdi>{" "}
              <span className="small muted">· {t(`workflowsP5.triggerKind.${tr.triggerKind}`)}</span>
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("workflowsP5.rules.ifTitle")}</legend>
        {value.conditions.length === 0 ? <p className="muted small">{t("workflowsP5.rules.noConditions")}</p> : null}
        {value.conditions.map((c, i) => (
          <div className="grid grid--3" key={i} data-condition-row={i}>
            <div className="field">
              <label className="field__label" htmlFor={id(`cond-field-${i}`)}>
                {t("workflowsP5.rules.conditionField", { n: i + 1 })}
              </label>
              <select
                id={id(`cond-field-${i}`)}
                value={c.field}
                onChange={(e) => setCondition(i, { field: e.target.value })}
              >
                <option value="">{t("workflowsP5.choose")}</option>
                {[...new Set([...fields, ...(c.field ? [c.field] : [])])].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={id(`cond-op-${i}`)}>
                {t("workflowsP5.rules.conditionOperator", { n: i + 1 })}
              </label>
              <select id={id(`cond-op-${i}`)} value={c.op} onChange={(e) => setCondition(i, { op: e.target.value })}>
                {AUTOMATION_CONDITION_OPS.map((o) => (
                  <option key={o} value={o}>
                    {t(`workflowsP5.operator.${o}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={id(`cond-value-${i}`)}>
                {t("workflowsP5.rules.conditionValue", { n: i + 1 })}
              </label>
              <input
                id={id(`cond-value-${i}`)}
                dir="ltr"
                value={c.value}
                disabled={c.op === "present" || c.op === "absent"}
                onChange={(e) => setCondition(i, { value: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => set({ conditions: value.conditions.filter((_, j) => j !== i) })}
            >
              {t("workflowsP5.rules.removeCondition", { n: i + 1 })}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => set({ conditions: [...value.conditions, { field: fields[0] ?? "", op: "eq", value: "" }] })}
        >
          {t("workflowsP5.rules.addCondition")}
        </button>
      </fieldset>
      <fieldset>
        <legend>{t("workflowsP5.rules.thenTitle")}</legend>
        {value.actions.map((a, i) => (
          <div className="card form--inset" key={i} data-action-row={i}>
            <div className="grid grid--3">
              <div className="field">
                <label className="field__label" htmlFor={id(`action-type-${i}`)}>
                  {t("workflowsP5.rules.actionType", { n: i + 1 })}
                </label>
                <select
                  id={id(`action-type-${i}`)}
                  value={a.type}
                  onChange={(e) => setAction(i, { type: e.target.value })}
                >
                  {actionTypes.map((x) => (
                    <option key={x.code} value={x.code}>
                      {pick(locale, x.labelEn, x.labelAr)}
                    </option>
                  ))}
                  {actionTypes.some((x) => x.code === a.type) ? null : <option value={a.type}>{a.type}</option>}
                </select>
              </div>
              {ROLE_PARAM[a.type] ? (
                <div className="field">
                  <label className="field__label" htmlFor={id(`action-role-${i}`)}>
                    {t(`workflowsP5.rules.param.${ROLE_PARAM[a.type]}`)} {i + 1}
                  </label>
                  <input
                    id={id(`action-role-${i}`)}
                    dir="ltr"
                    value={a.role}
                    onChange={(e) => setAction(i, { role: e.target.value })}
                  />
                </div>
              ) : null}
              <div className="field">
                <label className="field__label" htmlFor={id(`action-message-${i}`)}>
                  {t("workflowsP5.rules.param.messageKey")} {i + 1}
                </label>
                <select
                  id={id(`action-message-${i}`)}
                  value={a.messageKey}
                  onChange={(e) => setAction(i, { messageKey: e.target.value })}
                >
                  {AUTOMATION_MESSAGE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {t(`workflowsP5.message.${k.split(".").pop()}`)}
                    </option>
                  ))}
                </select>
              </div>
              {a.type === "create_task" ? (
                <div className="field">
                  <label className="field__label" htmlFor={id(`action-due-${i}`)}>
                    {t("workflowsP5.rules.param.dueInWorkingDays")} {i + 1}
                  </label>
                  <input
                    id={id(`action-due-${i}`)}
                    dir="ltr"
                    inputMode="numeric"
                    value={a.dueInWorkingDays}
                    onChange={(e) => setAction(i, { dueInWorkingDays: e.target.value })}
                  />
                </div>
              ) : null}
              <div className="field">
                <label className="field__label" htmlFor={id(`action-target-${i}`)}>
                  {t("workflowsP5.rules.param.targetTransformationId")} {i + 1}
                </label>
                <select
                  id={id(`action-target-${i}`)}
                  value={a.targetTransformationId}
                  onChange={(e) => setAction(i, { targetTransformationId: e.target.value })}
                >
                  <option value="">{t("workflowsP5.rules.eventTransformation")}</option>
                  {transformations.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.code} · {tr.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {value.actions.length > 1 ? (
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => set({ actions: value.actions.filter((_, j) => j !== i) })}
              >
                {t("workflowsP5.rules.removeAction", { n: i + 1 })}
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => set({ actions: [...value.actions, { ...emptyContent().actions[0]! }] })}
        >
          {t("workflowsP5.rules.addAction")}
        </button>
        <div className="banner banner--info" role="note" data-state="human-only-actions">
          <p>{t("workflowsP5.rules.humanOnlyTitle")}</p>
          <ul>
            {HUMAN_ONLY_ACTION_CODES.map((c) => (
              <li key={c} data-human-only={c}>
                {t(`workflowsP5.humanOnly.${c}`)}
              </li>
            ))}
          </ul>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("workflowsP5.rules.runAsTitle")}</legend>
        <div className="field">
          <label className="field__label" htmlFor={id("run-as")}>
            {t("workflowsP5.rules.runAs")}
          </label>
          <select
            id={id("run-as")}
            value={value.runAs}
            onChange={(e) => set({ runAs: e.target.value as ContentDraft["runAs"] })}
          >
            <option value="service">{t("workflowsP5.runAs.service")}</option>
            <option value="initiating_user">{t("workflowsP5.runAs.initiating_user")}</option>
          </select>
        </div>
        {value.runAs === "service" ? (
          <div className="field">
            <label className="field__label" htmlFor={id("service-permissions")}>
              {t("workflowsP5.rules.servicePermissions")}
            </label>
            <p className="field__hint">{t("workflowsP5.rules.servicePermissionsHint")}</p>
            <input
              id={id("service-permissions")}
              dir="ltr"
              value={value.servicePermissionCodes}
              onChange={(e) => set({ servicePermissionCodes: e.target.value })}
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
