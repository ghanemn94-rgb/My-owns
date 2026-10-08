// Dependency Map (T08) screen (T-DG3-FE-B; REQ-PB-051, REQ-PB-052, REQ-S09-008; ADR-0023 §4-§5). Replaces the stub.
//  - the seven B0081 columns: Dependency, From (an initiative or External), To, Type, Needed by, Owner,
//    Status / mitigation; plus the schedule flags (needed-by conflict, sequenced before its predecessor, Unknown);
//  - a create/edit form; a 422 dependency.cycle is shown as the translated message WITH the path, built from the
//    problem's `cycle` extension (e.g. INI-01 → INI-02 → INI-03 → INI-01); nothing is written;
//  - dependency types: the system types (Decision, Tech, Data, Vendor, Other) cannot be retired; an administrator
//    (dependency_type.configure) adds, relabels and retires custom types. Archive, never delete.
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Permission } from "@mth/shared";
import { ApiError, api, getSessionGeneration, newIdempotencyKey } from "../../api/client.ts";
import { p3Keys, useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Dialog, Field, isBlankText, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { WorkspaceFrame, useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import {
  ConflictNotice,
  FlagList,
  FormAlert,
  TableRegion,
  codeText,
  isVersionConflict,
  p3ErrorMessage,
  pointerError,
} from "../prioritization/p3ui.tsx";
import { useRoadmap, type T08Dependency } from "../roadmap/api.ts";
import { dependencyUrls, useDependencyTypes, useT08Dependencies, type CycleNode, type DependencyType } from "./api.ts";

export function DependenciesPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="dependencies"
      title={t("dependencies.title")}
      subtitle={t("dependencies.subtitle")}
      writePermissions={["dependency.edit"]}
    >
      <DependenciesBody />
    </WorkspaceFrame>
  );
}

type Ini = { id: string; code: string; name: string };

/** The translated cycle message with its path, or null when the error is not a dependency cycle. */
export function cycleMessage(t: TFunction, error: unknown, arrow: string): string | null {
  if (!(error instanceof ApiError) || error.code !== "dependency.cycle") return null;
  const cycle = (error.problem as unknown as { cycle?: CycleNode[] } | null)?.cycle ?? [];
  const path = cycle.map((n) => n.code).join(` ${arrow} `);
  // U+2066/U+2069 (LRI/PDI) isolate the left-to-right path inside an Arabic sentence.
  return path
    ? t("dependencies.problem.dependency__cycle", { path: `\u2066${path}\u2069` })
    : t("dependencies.cycleNoPath");
}

function DependenciesBody() {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const deps = useT08Dependencies(tid);
  const types = useDependencyTypes();
  const roadmap = useRoadmap(tid);
  const refresh = useP3Refresh(tid);
  const { byId } = usePeople(tid);
  const locale = useLocale();
  const [editing, setEditing] = useState<T08Dependency | "new" | null>(null);
  const [archiving, setArchiving] = useState<T08Dependency | null>(null);
  const [conflict, setConflict] = useState(false);
  const canEdit = can("dependency.edit");
  const initiatives: Ini[] = (roadmap.data?.initiatives ?? []).map((i) => ({ id: i.id, code: i.code, name: i.name }));
  const ini = new Map(initiatives.map((i) => [i.id, i]));
  const typeLabel = (code: string) => {
    const ty = types.data?.find((x) => x.code === code);
    return ty ? (locale === "ar" ? ty.labelAr : ty.labelEn) : code;
  };
  const endpoint = (kind: string, id: string | null, label: string | null) => {
    if (kind === "initiative" && id) {
      const i = ini.get(id);
      return i ? (
        <span>
          <bdi dir="ltr" className="code">
            {i.code}
          </bdi>{" "}
          {i.name}
        </span>
      ) : (
        <Unknown />
      );
    }
    if (kind === "external") return <span>{t("dependencies.external", { label: label ?? "" })}</span>;
    return <span>{label ?? t(`dependencies.kind.${kind}`, { defaultValue: kind })}</span>;
  };

  return (
    <>
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <Section
        id="map"
        title={t("dependencies.map.title")}
        intro={t("dependencies.map.intro")}
        actions={
          canEdit ? (
            <button type="button" className="button button--secondary" onClick={() => setEditing("new")}>
              <Icon name="plus" /> {t("dependencies.map.add")}
            </button>
          ) : null
        }
      >
        <QueryState
          query={deps}
          isEmpty={(d) => d.length === 0}
          empty={<p className="muted">{t("dependencies.map.empty")}</p>}
        >
          {(rows) => (
            <TableRegion label={t("dependencies.map.caption")}>
              <table className="table table--compact" data-testid="t08">
                <caption>{t("dependencies.map.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("dependencies.col.dependency")}</th>
                    <th scope="col">{t("dependencies.col.from")}</th>
                    <th scope="col">{t("dependencies.col.to")}</th>
                    <th scope="col">{t("dependencies.col.type")}</th>
                    <th scope="col">{t("dependencies.col.neededBy")}</th>
                    <th scope="col">{t("dependencies.col.owner")}</th>
                    <th scope="col">{t("dependencies.col.statusMitigation")}</th>
                    <th scope="col">{t("dependencies.col.flags")}</th>
                    {canEdit ? <th scope="col">{t("dependencies.col.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} data-dependency={d.code}>
                      <th scope="row">
                        <bdi dir="ltr" className="code">
                          {d.code}
                        </bdi>{" "}
                        {d.description}
                      </th>
                      <td>{endpoint(d.fromKind, d.fromInitiativeId, d.fromLabel)}</td>
                      <td>{endpoint(d.toKind, d.toInitiativeId, d.toLabel)}</td>
                      <td>{typeLabel(d.dependencyType)}</td>
                      <td>{d.neededBy ? formatBusinessDate(d.neededBy, locale) : <Unknown />}</td>
                      <td>
                        <PersonName id={d.ownerUserId} people={byId} />
                      </td>
                      <td>
                        {t(`dependencies.status.${d.status}`)}
                        {d.mitigation ? <div className="muted">{d.mitigation}</div> : null}
                      </td>
                      <td>
                        <FlagList flags={d.flags} />
                      </td>
                      {canEdit ? (
                        <td>
                          {d.status !== "archived" ? (
                            <div className="toolbar">
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                onClick={() => setEditing(d)}
                              >
                                {t("dependencies.map.edit", { code: d.code })}
                              </button>
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                onClick={() => setArchiving(d)}
                              >
                                {t("dependencies.map.archive", { code: d.code })}
                              </button>
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )}
        </QueryState>
      </Section>
      <TypesSection />
      {editing ? (
        <DependencyDialog
          record={editing === "new" ? null : editing}
          initiatives={initiatives}
          types={(types.data ?? []).filter((x) => x.status === "active")}
          onClose={() => setEditing(null)}
          onConflict={async () => {
            setEditing(null);
            setConflict(true);
            await refresh();
          }}
          onDone={async () => {
            if (!(await refresh())) return;
            setEditing(null);
          }}
        />
      ) : null}
      {archiving ? (
        <ReasonDialog
          title={t("dependencies.map.archiveTitle", { code: archiving.code })}
          description={t("dependencies.map.archiveBody")}
          confirmLabel={t("dependencies.map.archive", { code: archiving.code })}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            try {
              await api.send(dependencyUrls.archive(archiving.id), {
                method: "POST",
                body: { reason },
                ifMatch: archiving.version,
              });
            } catch (e) {
              if (isVersionConflict(e)) {
                setArchiving(null);
                setConflict(true);
                await refresh();
                return;
              }
              throw e;
            }
            if (!(await refresh())) return;
            setArchiving(null);
          }}
        />
      ) : null}
    </>
  );
}

type FormValues = {
  description: string;
  fromKind: "initiative" | "external";
  fromInitiativeId: string;
  fromLabel: string;
  toInitiativeId: string;
  dependencyType: string;
  neededBy: string;
  ownerUserId: string;
  status: string;
  mitigation: string;
};

function valuesOf(d: T08Dependency | null): FormValues {
  return {
    description: d?.description ?? "",
    fromKind: d?.fromKind === "external" ? "external" : "initiative",
    fromInitiativeId: d?.fromInitiativeId ?? "",
    fromLabel: d?.fromKind === "external" ? (d.fromLabel ?? "") : "",
    toInitiativeId: d?.toInitiativeId ?? "",
    dependencyType: d?.dependencyType ?? "",
    neededBy: d?.neededBy ?? "",
    ownerUserId: d?.ownerUserId ?? "",
    status: d?.status ?? "open",
    mitigation: d?.mitigation ?? "",
  };
}

function DependencyDialog({
  record,
  initiatives,
  types,
  onClose,
  onDone,
  onConflict,
}: {
  record: T08Dependency | null;
  initiatives: readonly Ini[];
  types: readonly DependencyType[];
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const locale = useLocale();
  // The path reads in the codes' own (Latin, left-to-right) order in both languages: INI-01 → INI-02 → INI-01.
  const arrow = "→";
  const { people } = usePeople(tid);
  const [v, setV] = useState<FormValues>(() => valuesOf(record));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => setV({ ...v, [k]: value });

  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    const text = (k: keyof FormValues, required: boolean) => {
      const x = v[k];
      if (x === "") {
        if (required) errs[k] = "validation.required";
      } else if (isBlankText(x)) errs[k] = "validation.blank";
    };
    text("description", true);
    if (v.fromKind === "initiative") {
      if (!v.fromInitiativeId) errs["fromInitiativeId"] = "validation.required";
    } else text("fromLabel", true);
    if (!v.toInitiativeId) errs["toInitiativeId"] = "validation.required";
    else if (v.fromKind === "initiative" && v.fromInitiativeId === v.toInitiativeId)
      errs["toInitiativeId"] = "dependency.self";
    if (!v.dependencyType) errs["dependencyType"] = "validation.required";
    text("mitigation", false);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const from =
      v.fromKind === "initiative"
        ? { kind: "initiative", initiativeId: v.fromInitiativeId }
        : { kind: "external", label: v.fromLabel };
    const full: Record<string, unknown> = {
      description: v.description,
      from,
      toInitiativeId: v.toInitiativeId,
      dependencyType: v.dependencyType,
      neededBy: v.neededBy || null,
      ownerUserId: v.ownerUserId || null,
      mitigation: v.mitigation || null,
    };
    const action = beginSessionGuard();
    setBusy(true);
    try {
      if (record === null) {
        await api.send(dependencyUrls.collection, {
          method: "POST",
          body: { transformationId: tid, ...full },
          idempotencyKey: key,
        });
      } else {
        const base = valuesOf(record);
        const body: Record<string, unknown> = {};
        if (v.description !== base.description) body["description"] = full["description"];
        if (
          v.fromKind !== base.fromKind ||
          v.fromInitiativeId !== base.fromInitiativeId ||
          v.fromLabel !== base.fromLabel
        )
          body["from"] = from;
        if (v.toInitiativeId !== base.toInitiativeId) body["toInitiativeId"] = v.toInitiativeId;
        if (v.dependencyType !== base.dependencyType) body["dependencyType"] = v.dependencyType;
        if (v.neededBy !== base.neededBy) body["neededBy"] = full["neededBy"];
        if (v.ownerUserId !== base.ownerUserId) body["ownerUserId"] = full["ownerUserId"];
        if (v.mitigation !== base.mitigation) body["mitigation"] = full["mitigation"];
        if (v.status !== base.status) body["status"] = v.status;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        await api.send(dependencyUrls.item(record.id), { method: "PATCH", body, ifMatch: record.version });
      }
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        await onConflict();
        return;
      }
      const fieldErrs: Record<string, string> = {};
      for (const p of ["description", "toInitiativeId", "dependencyType", "neededBy", "mitigation"]) {
        if (e instanceof ApiError && e.fieldErrors.some((f) => f.pointer === `/${p}`)) fieldErrs[p] = "server";
      }
      setErrors(fieldErrs);
      setServerError(e);
      if (Object.keys(fieldErrs).length > 0) focusInvalid();
    } finally {
      setBusy(false);
    }
  };

  const cycle = cycleMessage(t, serverError, arrow);
  const alert = serverError ? (cycle ?? p3ErrorMessage(t, serverError)) : null;
  const err = (k: string) => {
    const c = errors[k];
    if (!c) return undefined;
    if (c === "server")
      return k === "toInitiativeId" && cycle ? t("dependencies.cycleField") : pointerError(t, serverError, `/${k}`);
    return codeText(t, c) ?? undefined;
  };
  const iniOptions = initiatives.map((i) => (
    <option key={i.id} value={i.id}>
      {i.code} · {i.name}
    </option>
  ));

  return (
    <Dialog
      title={record ? t("dependencies.form.editTitle", { code: record.code }) : t("dependencies.form.newTitle")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("dependencies.form.save")}
          </button>
        </>
      }
    >
      <FormAlert message={alert} />
      <Field label={t("dependencies.col.dependency")} error={err("description")} required>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={2000}
          />
        )}
      </Field>
      <fieldset className="fieldset">
        <legend>{t("dependencies.col.from")}</legend>
        {(["initiative", "external"] as const).map((k) => (
          <label key={k} className="checkbox">
            <input type="radio" name="from-kind" checked={v.fromKind === k} onChange={() => set("fromKind", k)} />
            {t(`dependencies.form.fromKind.${k}`)}
          </label>
        ))}
      </fieldset>
      {v.fromKind === "initiative" ? (
        <Field label={t("dependencies.form.fromInitiative")} error={err("fromInitiativeId")} required>
          {(c) => (
            <select {...c} value={v.fromInitiativeId} onChange={(e) => set("fromInitiativeId", e.target.value)}>
              <option value="">{t("common.form.choose")}</option>
              {iniOptions}
            </select>
          )}
        </Field>
      ) : (
        <Field
          label={t("dependencies.form.fromLabel")}
          hint={t("dependencies.form.fromLabelHint")}
          error={err("fromLabel")}
          required
        >
          {(c) => (
            <input
              {...c}
              type="text"
              value={v.fromLabel}
              onChange={(e) => set("fromLabel", e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
      )}
      <Field label={t("dependencies.col.to")} error={err("toInitiativeId")} required>
        {(c) => (
          <select {...c} value={v.toInitiativeId} onChange={(e) => set("toInitiativeId", e.target.value)}>
            <option value="">{t("common.form.choose")}</option>
            {iniOptions}
          </select>
        )}
      </Field>
      <Field label={t("dependencies.col.type")} error={err("dependencyType")} required>
        {(c) => (
          <select {...c} value={v.dependencyType} onChange={(e) => set("dependencyType", e.target.value)}>
            <option value="">{t("common.form.choose")}</option>
            {types.map((ty) => (
              <option key={ty.code} value={ty.code}>
                {locale === "ar" ? ty.labelAr : ty.labelEn}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("dependencies.col.neededBy")} error={err("neededBy")}>
        {(c) => <input {...c} type="date" value={v.neededBy} onChange={(e) => set("neededBy", e.target.value)} />}
      </Field>
      <Field label={t("dependencies.col.owner")}>
        {(c) => (
          <select {...c} value={v.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
            <option value="">{t("common.value.notAssigned")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {record ? (
        <Field label={t("dependencies.form.status")}>
          {(c) => (
            <select {...c} value={v.status} onChange={(e) => set("status", e.target.value)}>
              {(["open", "at_risk", "resolved"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`dependencies.status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <Field label={t("dependencies.form.mitigation")} error={err("mitigation")}>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            value={v.mitigation}
            onChange={(e) => set("mitigation", e.target.value)}
            maxLength={4000}
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Dependency types (REQ-PB-052): system types are undeletable; administrators configure the others. */
function TypesSection() {
  const { t } = useTranslation();
  const me = useMe();
  const { archived } = useWorkspace();
  const types = useDependencyTypes();
  const queryClient = useQueryClient();
  const canConfigure = !archived && canAnywhere(me, "dependency_type.configure" as Permission);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DependencyType | null>(null);
  const [retireError, setRetireError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const reload = async () => {
    const generation = getSessionGeneration();
    await queryClient.invalidateQueries({ queryKey: p3Keys.dependencyTypes });
    return getSessionGeneration() === generation;
  };
  const retire = async (ty: DependencyType) => {
    setRetireError(null);
    const action = beginSessionGuard();
    try {
      await api.send(dependencyUrls.type(ty.code), { method: "DELETE", ifMatch: ty.version });
      if (action.stale()) return;
      await reload();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        setConflict(true);
        await reload();
        return;
      }
      setRetireError(e);
    }
  };
  return (
    <Section
      id="types"
      title={t("dependencies.types.title")}
      intro={t("dependencies.types.intro")}
      actions={
        canConfigure ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("dependencies.types.add")}
          </button>
        ) : null
      }
    >
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <FormAlert message={retireError ? p3ErrorMessage(t, retireError) : null} />
      <QueryState query={types}>
        {(list) => (
          <TableRegion label={t("dependencies.types.caption")}>
            <table className="table table--compact" data-testid="dependency-types">
              <caption>{t("dependencies.types.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("dependencies.types.code")}</th>
                  <th scope="col">{t("dependencies.types.labelEn")}</th>
                  <th scope="col">{t("dependencies.types.labelAr")}</th>
                  <th scope="col">{t("dependencies.types.kind")}</th>
                  <th scope="col">{t("dependencies.types.status")}</th>
                  {canConfigure ? <th scope="col">{t("dependencies.col.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {[...list]
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((ty) => (
                    <tr key={ty.code} data-type={ty.code}>
                      <th scope="row">
                        <bdi dir="ltr" className="code">
                          {ty.code}
                        </bdi>
                      </th>
                      <td lang="en" dir="ltr">
                        {ty.labelEn}
                      </td>
                      <td lang="ar" dir="rtl">
                        {ty.labelAr}
                      </td>
                      <td>
                        {ty.isSystem ? (
                          <span className="badge">
                            <Icon name="lock" /> {t("dependencies.types.system")}
                          </span>
                        ) : (
                          t("dependencies.types.custom")
                        )}
                      </td>
                      <td>{t(`dependencies.types.state.${ty.status}`)}</td>
                      {canConfigure ? (
                        <td>
                          <div className="toolbar">
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => setEditing(ty)}
                            >
                              {t("dependencies.types.relabel", { code: ty.code })}
                            </button>
                            {ty.isSystem ? (
                              <span className="muted">{t("dependencies.types.undeletable")}</span>
                            ) : ty.status === "active" ? (
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                onClick={() => void retire(ty)}
                              >
                                {t("dependencies.types.retire", { code: ty.code })}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </QueryState>
      {adding || editing ? (
        <TypeDialog
          record={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onConflict={async () => {
            setAdding(false);
            setEditing(null);
            setConflict(true);
            await reload();
          }}
          onDone={async () => {
            if (!(await reload())) return;
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function TypeDialog({
  record,
  onClose,
  onDone,
  onConflict,
}: {
  record: DependencyType | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(record?.code ?? "");
  const [labelEn, setLabelEn] = useState(record?.labelEn ?? "");
  const [labelAr, setLabelAr] = useState(record?.labelAr ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    if (!record && !/^[a-z][a-z0-9_]{1,47}$/.test(code))
      errs["code"] = code ? "dependency_type.code_format" : "validation.required";
    for (const [k, x] of [
      ["labelEn", labelEn],
      ["labelAr", labelAr],
    ] as const) {
      if (x === "") errs[k] = "validation.required";
      else if (isBlankText(x)) errs[k] = "validation.blank";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      if (record) {
        const body: Record<string, string> = {};
        if (labelEn !== record.labelEn) body["labelEn"] = labelEn;
        if (labelAr !== record.labelAr) body["labelAr"] = labelAr;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        await api.send(dependencyUrls.type(record.code), { method: "PATCH", body, ifMatch: record.version });
      } else {
        await api.send(dependencyUrls.types, { method: "POST", body: { code, labelEn, labelAr } });
      }
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        await onConflict();
        return;
      }
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => (errors[k] ? (codeText(t, errors[k]!) ?? undefined) : undefined);
  return (
    <Dialog
      title={record ? t("dependencies.types.relabelTitle", { code: record.code }) : t("dependencies.types.addTitle")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("dependencies.types.save")}
          </button>
        </>
      }
    >
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      {record ? null : (
        <Field
          label={t("dependencies.types.code")}
          hint={t("dependencies.types.codeHint")}
          error={err("code")}
          required
        >
          {(c) => (
            <input {...c} type="text" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={48} />
          )}
        </Field>
      )}
      <Field label={t("dependencies.types.labelEn")} error={err("labelEn")} required>
        {(c) => (
          <input
            {...c}
            type="text"
            dir="ltr"
            lang="en"
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            maxLength={100}
          />
        )}
      </Field>
      <Field label={t("dependencies.types.labelAr")} error={err("labelAr")} required>
        {(c) => (
          <input
            {...c}
            type="text"
            dir="rtl"
            lang="ar"
            value={labelAr}
            onChange={(e) => setLabelAr(e.target.value)}
            maxLength={100}
          />
        )}
      </Field>
    </Dialog>
  );
}
