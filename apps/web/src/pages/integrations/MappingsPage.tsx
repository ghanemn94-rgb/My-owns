// Administration > Integrations > Connector > Field mappings (T-DG6-FE-C; ADR-0055 §1; ADR-0056 §9; REQ-S17-001).
// The source column -> target field pairs of the current configuration version, edited against the target columns of
// the connector's import template. Saving is a new configuration version (If-Match: the connector's version), so the
// connector is "Not verified" again until a test run succeeds. connector.configure edits; connector.read reads.
// Field errors are stored as keys and translated at render time. Each target is named once (the server refuses otherwise with connector.mappings_invalid). One form-level alert.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { QueryState } from "../../components/States.tsx";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";
import {
  integrationPaths,
  useConnector,
  useConnectorMappings,
  useIntegrationsRefresh,
  type Connector,
  type ConnectorMappings,
  type FieldMapping,
} from "./api.ts";

export function ConnectorMappingsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { connectorId = "" } = useParams();
  usePageTitle(t("integrations.mappings.title"));
  const connector = useConnector(connectorId);
  const mappings = useConnectorMappings(connectorId);
  const name = connector.data ? (localName(connector.data, locale) ?? connector.data.code) : "";
  return (
    <div className="page" data-p6-screen="integrations-mappings">
      <PageHeader
        title={t("integrations.mappings.title")}
        subtitle={t("integrations.mappings.intro")}
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("integrations.title"), to: "/admin/integrations" },
          { label: name || t("integrations.connector.title"), to: `/admin/integrations/connectors/${connectorId}` },
          { label: t("integrations.mappings.title") },
        ]}
      />
      <QueryState query={connector}>
        {(c) => (
          <QueryState query={mappings}>
            {(m) => <MappingsEditor key={`${c.version}:${m.configVersionNo}`} connector={c} mappings={m} />}
          </QueryState>
        )}
      </QueryState>
    </div>
  );
}

function MappingsEditor({ connector, mappings }: { connector: Connector; mappings: ConnectorMappings }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useIntegrationsRefresh();
  const canEdit = canAnywhere(me, "connector.configure");
  const [rows, setRows] = useState<FieldMapping[]>(() => mappings.fieldMappings.map((m) => ({ ...m })));
  const [reason, setReason] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [formError, setFormError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (key: string) => {
    const col = mappings.targetColumns.find((c) => c.key === key);
    return col ? (locale === "ar" ? col.labelAr : col.labelEn) : key;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const errs: Record<number, string> = {};
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (r.source.trim() === "" || r.source.length > 100) errs[i] = "integrations.mappings.sourceRequired";
      else if (r.target === "") errs[i] = "integrations.mappings.targetRequired";
      else if (seen.has(r.target)) errs[i] = "integrations.mappings.targetTwice";
      seen.add(r.target);
    });
    const rErr = reason.trim().length < 3 ? "admin.reason_required" : undefined;
    setRowErrors(errs);
    setReasonError(rErr);
    if (Object.keys(errs).length > 0 || rErr) return;
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<ConnectorMappings>(integrationPaths.mappings(connector.id), {
        method: "PUT",
        body: { fieldMappings: rows.map((r) => ({ source: r.source.trim(), target: r.target })), reason },
        ifMatch: connector.version,
      });
      if (action.stale()) return;
      setBusy(false);
      setNotice(t("integrations.mappings.saved"));
      await refresh();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };

  return (
    <section className="card" aria-labelledby="mappings-h">
      <h2 id="mappings-h" className="card__title">
        {t("integrations.mappings.versionTitle", { version: mappings.configVersionNo })}
      </h2>
      {notice ? (
        <p className="banner banner--success" role="status">
          <Icon name="check" /> <span>{notice}</span>
        </p>
      ) : null}
      {!canEdit ? (
        <>
          <p className="banner banner--info" data-read-only>
            <Icon name="lock" /> <span>{t("integrations.readOnly")}</span>
          </p>
          {rows.length === 0 ? (
            <p className="muted">{t("integrations.mappings.none")}</p>
          ) : (
            <TableScrollRegion caption={t("integrations.mappings.title")}>
              <table className="table" data-mappings>
                <caption className="visually-hidden">{t("integrations.mappings.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("integrations.mappings.source")}</th>
                    <th scope="col">{t("integrations.mappings.target")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.target}>
                      <td>
                        <bdi dir="ltr">{r.source}</bdi>
                      </td>
                      <td>{label(r.target)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          )}
        </>
      ) : (
        <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-mappings-form>
          {formError ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
            </p>
          ) : null}
          <p className="small muted">{t("integrations.mappings.newVersionNote")}</p>
          {rows.map((r, i) => (
            <fieldset className="fieldset integrations-mapping" key={i} data-mapping-row={i}>
              <legend className="visually-hidden">{t("integrations.mappings.rowLegend", { n: i + 1 })}</legend>
              <Field label={t("integrations.mappings.source")} error={rowErrors[i] ? t(rowErrors[i]) : undefined}>
                {(c) => (
                  <input
                    {...c}
                    dir="ltr"
                    value={r.source}
                    maxLength={100}
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, source: e.target.value } : y)))}
                  />
                )}
              </Field>
              <Field label={t("integrations.mappings.target")}>
                {(c) => (
                  <select
                    {...c}
                    value={r.target}
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, target: e.target.value } : y)))}
                  >
                    <option value="">{t("common.form.choose")}</option>
                    {mappings.targetColumns.map((col) => (
                      <option key={col.key} value={col.key}>
                        {label(col.key)} ({col.key}){col.required ? ` · ${t("integrations.mappings.required")}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
              >
                {t("integrations.mappings.remove")}
                <span className="visually-hidden">: {r.source || i + 1}</span>
              </button>
            </fieldset>
          ))}
          {rows.length < 100 ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setRows((x) => [...x, { source: "", target: "" }])}
            >
              <Icon name="plus" /> {t("integrations.mappings.add")}
            </button>
          ) : null}
          <Field
            label={t("integrations.field.reason")}
            hint={t("common.form.reasonHint")}
            error={reasonError ? fieldErrorMessage(t, reasonError) : undefined}
            required
          >
            {(c) => (
              <textarea {...c} rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
          <div className="toolbar">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? t("integrations.form.saving") : t("integrations.mappings.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
