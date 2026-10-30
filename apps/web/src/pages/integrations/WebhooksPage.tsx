// Administration > Integrations > Webhook endpoints (T-DG6-FE-C; ADR-0056 §7; REQ-S17-003). An endpoint receives signed
// deliveries for a webhook connector and stages each one as an import. The signing secret is a secret reference that IT
// provisions: this screen shows and accepts the reference (provider and name) only, never a value; the server refuses a
// value (connector.secret_value_refused). Rotation keeps the previous reference valid for a grace period; disabling is
// final. webhook.configure (ADM_TECH) writes; connector.read reads (AUD read-only). One form-level alert per form.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard, useSessionBoundAction } from "../../auth/sessionBound.ts";
import { useCursorPager } from "../../components/DataTable.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";
import { Chip } from "../reports/ui.tsx";
import { OrganizationPicker, useSelectedOrganization } from "../admin/UsersPage.tsx";
import {
  integrationPaths,
  useConnectors,
  useIntegrationsRefresh,
  useWebhookEndpoint,
  useWebhookEndpoints,
  type WebhookEndpoint,
} from "./api.ts";
import { IntegrationsTabs, PagedTable, SecretRefText, type Col } from "./ui.tsx";

const crumbs = (t: (k: string) => string) => [
  { label: t("nav.areas.admin.label"), to: "/admin" },
  { label: t("integrations.title"), to: "/admin/integrations" },
];

function EndpointStatus({ status }: { status: "active" | "disabled" }) {
  const { t } = useTranslation();
  return status === "active" ? (
    <Chip tone="closed" icon="dot" label={t("integrations.webhooks.status.active")} data={status} />
  ) : (
    <Chip tone="neutral" icon="stop" label={t("integrations.webhooks.status.disabled")} data={status} />
  );
}

const SECRET_PROVIDER = /^[a-z][a-z0-9_]{0,31}$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;

export function WebhooksPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("integrations.webhooks.title"));
  const org = useSelectedOrganization();
  const [params] = useSearchParams();
  const connectorFilter = params.get("connector") ?? "";
  const pager = useCursorPager();
  const { reset } = pager;
  useEffect(() => reset(), [org.organizationId, reset]);
  const q = useWebhookEndpoints({ organizationId: org.organizationId }, pager.cursor);
  const connectors = useConnectors({ organizationId: org.organizationId }, null);
  const webhookConnectors = (connectors.data?.items ?? []).filter((c) => c.adapterKind === "webhook");
  const connectorName = (id: string) => {
    const c = connectors.data?.items.find((x) => x.id === id);
    return c ? (localName(c, locale) ?? c.code) : t("integrations.connector.title");
  };
  const canConfigure = canAnywhere(me, "webhook.configure");
  const [creating, setCreating] = useState(false);
  const cols: Col<WebhookEndpoint>[] = [
    {
      id: "label",
      label: t("integrations.webhooks.label"),
      cell: (w) => (
        <Link className="link" to={`/admin/integrations/webhooks/${w.id}`}>
          {w.label}
        </Link>
      ),
      sort: (w) => w.label,
      hideable: false,
    },
    {
      id: "connector",
      label: t("integrations.webhooks.connector"),
      cell: (w) => (
        <Link className="link" to={`/admin/integrations/connectors/${w.connectorId}`}>
          {connectorName(w.connectorId)}
        </Link>
      ),
      sort: (w) => connectorName(w.connectorId),
    },
    {
      id: "status",
      label: t("integrations.field.status"),
      cell: (w) => <EndpointStatus status={w.status} />,
      sort: (w) => w.status,
    },
    {
      id: "secret",
      label: t("integrations.webhooks.signingSecretRef"),
      cell: (w) => <SecretRefText value={w.signingSecretRef} />,
    },
    {
      id: "tolerance",
      label: t("integrations.webhooks.tolerance"),
      cell: (w) => t("integrations.webhooks.seconds", { n: w.toleranceSeconds }),
      sort: (w) => w.toleranceSeconds,
    },
    {
      id: "lastReceipt",
      label: t("integrations.webhooks.lastReceipt"),
      cell: (w) =>
        w.lastReceiptAt ? (
          formatDateTime(w.lastReceiptAt, locale)
        ) : (
          <span className="muted">{t("integrations.webhooks.noReceipt")}</span>
        ),
      sort: (w) => w.lastReceiptAt,
    },
  ];
  return (
    <div className="page" data-p6-screen="integrations-webhooks">
      <PageHeader
        title={t("integrations.webhooks.title")}
        subtitle={t("integrations.webhooks.intro")}
        crumbs={[...crumbs(t).slice(0, 2), { label: t("integrations.webhooks.title") }]}
        actions={
          canConfigure && !creating ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("integrations.webhooks.new")}
            </button>
          ) : null
        }
      />
      <IntegrationsTabs current="webhooks" />
      <p className="small">{t("integrations.webhooks.secretNote")}</p>
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <OrganizationPicker
          organizationId={org.organizationId}
          organizations={org.organizations}
          onSelect={org.select}
        />
      </form>
      {creating && canConfigure ? (
        <CreateEndpointForm
          connectors={webhookConnectors.map((c) => ({ id: c.id, label: localName(c, locale) ?? c.code }))}
          initialConnectorId={connectorFilter}
          onDone={() => setCreating(false)}
        />
      ) : null}
      <QueryState
        query={q}
        isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
        empty={<EmptyState title={t("integrations.webhooks.emptyTitle")} body={t("integrations.webhooks.emptyBody")} />}
      >
        {(p) => (
          <PagedTable
            tableId="webhooks"
            caption={t("integrations.webhooks.title")}
            rows={connectorFilter ? p.items.filter((w) => w.connectorId === connectorFilter) : p.items}
            cols={cols}
            getRowId={(w) => w.id}
            pager={pager}
            nextCursor={p.nextCursor}
            busy={q.isFetching}
          />
        )}
      </QueryState>
    </div>
  );
}

function CreateEndpointForm({
  connectors,
  initialConnectorId,
  onDone,
}: {
  connectors: readonly { id: string; label: string }[];
  initialConnectorId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const begin = useSessionBoundAction();
  const refresh = useIntegrationsRefresh();
  const [connectorId, setConnectorId] = useState(initialConnectorId);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("env");
  const [name, setName] = useState("");
  const [tolerance, setTolerance] = useState("300");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!connectorId) errs["connector"] = "validation.required";
    if (label.trim() === "") errs["label"] = "validation.required";
    if (!SECRET_PROVIDER.test(provider) || !SECRET_NAME.test(name))
      errs["secret"] = "integrations.form.credentialInvalid";
    const n = /^\d{2,3}$/.test(tolerance) ? Number(tolerance) : NaN;
    if (!(n >= 30 && n <= 900)) errs["tolerance"] = "integrations.webhooks.toleranceRange";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const action = begin();
    setBusy(true);
    try {
      const res = await apiRequest<WebhookEndpoint>(integrationPaths.webhooks, {
        method: "POST",
        body: { connectorId, label: label.trim(), signingSecretRef: { provider, name }, toleranceSeconds: n },
      });
      if (action.stale()) return;
      setBusy(false);
      await refresh();
      onDone();
      action.navigate(`/admin/integrations/webhooks/${res.data.id}`);
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
    }
  };
  const err = (k: string) =>
    errors[k] ? (errors[k]!.startsWith("integrations.") ? t(errors[k]!) : fieldErrorMessage(t, errors[k]!)) : undefined;
  return (
    <section className="card" aria-labelledby="webhook-new-h">
      <h2 id="webhook-new-h" className="card__title">
        {t("integrations.webhooks.new")}
      </h2>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-webhook-form>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        <Field label={t("integrations.webhooks.connector")} error={err("connector")} required>
          {(c) => (
            <select {...c} value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
              <option value="">{t("common.form.choose")}</option>
              {connectors.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {connectors.length === 0 ? (
          <p className="small muted">{t("integrations.webhooks.noWebhookConnector")}</p>
        ) : null}
        <Field label={t("integrations.webhooks.label")} error={err("label")} required>
          {(c) => <input {...c} value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field
          label={t("integrations.credentials.provider")}
          hint={t("integrations.webhooks.secretRefHint")}
          error={err("secret")}
          required
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={provider}
              maxLength={32}
              onChange={(e) => setProvider(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("integrations.credentials.secretName")} required>
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={name}
              maxLength={128}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("integrations.webhooks.tolerance")}
          hint={t("integrations.webhooks.toleranceRange")}
          error={err("tolerance")}
          required
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              inputMode="numeric"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
            />
          )}
        </Field>
        <div className="toolbar">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t("integrations.form.saving") : t("integrations.webhooks.create")}
          </button>
          <button type="button" className="button button--secondary" disabled={busy} onClick={onDone}>
            {t("integrations.form.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function WebhookPage() {
  const { t } = useTranslation();
  const { webhookId = "" } = useParams();
  usePageTitle(t("integrations.webhooks.detailTitle"));
  const q = useWebhookEndpoint(webhookId);
  return (
    <div className="page" data-p6-screen="integrations-webhook">
      <PageHeader
        title={q.data?.label ?? t("integrations.webhooks.detailTitle")}
        subtitle={t("integrations.webhooks.secretNote")}
        crumbs={[
          ...crumbs(t),
          { label: t("integrations.webhooks.title"), to: "/admin/integrations/webhooks" },
          { label: q.data?.label ?? t("integrations.webhooks.detailTitle") },
        ]}
      />
      <QueryState query={q}>{(w) => <WebhookView key={w.version} endpoint={w} />}</QueryState>
    </div>
  );
}

function WebhookView({ endpoint: w }: { endpoint: WebhookEndpoint }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useIntegrationsRefresh();
  const canConfigure = canAnywhere(me, "webhook.configure") && w.status === "active";
  const [disabling, setDisabling] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const disable = async (reason: string) => {
    const action = beginSessionGuard();
    await apiRequest<WebhookEndpoint>(integrationPaths.disableWebhook(w.id), {
      method: "POST",
      body: { reason },
      ifMatch: w.version,
    });
    if (action.stale()) return;
    setDisabling(false);
    setNotice(t("integrations.webhooks.disabledNotice"));
    await refresh();
  };
  return (
    <>
      <section className="card" aria-labelledby="webhook-facts-h">
        <h2 id="webhook-facts-h" className="card__title">
          {t("integrations.webhooks.detailTitle")}
        </h2>
        {notice ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> <span>{notice}</span>
          </p>
        ) : null}
        <dl className="facts">
          <dt>{t("integrations.field.status")}</dt>
          <dd>
            <EndpointStatus status={w.status} />
            {w.disableReason ? <span className="small muted"> {w.disableReason}</span> : null}
          </dd>
          <dt>{t("integrations.webhooks.connector")}</dt>
          <dd>
            <Link className="link" to={`/admin/integrations/connectors/${w.connectorId}`}>
              {t("integrations.webhooks.openConnector")}
            </Link>
          </dd>
          <dt>{t("integrations.webhooks.receivePath")}</dt>
          <dd>
            <bdi dir="ltr" className="mono">
              POST {w.receivePath}
            </bdi>
            <p className="small muted">{t("integrations.webhooks.signatureNote")}</p>
          </dd>
          <dt>{t("integrations.webhooks.signingSecretRef")}</dt>
          <dd>
            <SecretRefText value={w.signingSecretRef} />
          </dd>
          <dt>{t("integrations.webhooks.previousSecretRef")}</dt>
          <dd>
            {w.previousSecretRef ? (
              <>
                <SecretRefText value={w.previousSecretRef} />{" "}
                <span className="small muted">
                  {w.previousValidUntil
                    ? t("integrations.webhooks.validUntil", { date: formatDateTime(w.previousValidUntil, locale) })
                    : null}
                </span>
              </>
            ) : (
              <span className="muted">{t("common.value.none")}</span>
            )}
          </dd>
          <dt>{t("integrations.webhooks.secretRotatedAt")}</dt>
          <dd>
            {w.secretRotatedAt ? (
              formatDateTime(w.secretRotatedAt, locale)
            ) : (
              <span className="muted">{t("integrations.webhooks.neverRotated")}</span>
            )}
          </dd>
          <dt>{t("integrations.webhooks.tolerance")}</dt>
          <dd>{t("integrations.webhooks.seconds", { n: w.toleranceSeconds })}</dd>
          <dt>{t("integrations.webhooks.lastReceipt")}</dt>
          <dd>
            {w.lastReceiptAt ? (
              formatDateTime(w.lastReceiptAt, locale)
            ) : (
              <span className="muted">{t("integrations.webhooks.noReceipt")}</span>
            )}
          </dd>
        </dl>
        {canConfigure ? (
          <div className="toolbar">
            {!rotating ? (
              <button type="button" className="button button--secondary" onClick={() => setRotating(true)}>
                {t("integrations.webhooks.rotate")}
              </button>
            ) : null}
            <button type="button" className="button button--danger" onClick={() => setDisabling(true)}>
              {t("integrations.webhooks.disable")}
            </button>
          </div>
        ) : canAnywhere(me, "webhook.configure") ? null : (
          <p className="banner banner--info" data-read-only>
            <Icon name="lock" /> <span>{t("integrations.readOnly")}</span>
          </p>
        )}
      </section>
      {rotating && canConfigure ? (
        <RotateForm
          endpoint={w}
          onDone={(saved) => {
            setRotating(false);
            if (saved) setNotice(t("integrations.webhooks.rotatedNotice"));
          }}
        />
      ) : null}
      {disabling ? (
        <ReasonDialog
          title={t("integrations.webhooks.disableTitle")}
          description={t("integrations.webhooks.disableBody")}
          confirmLabel={t("integrations.webhooks.disable")}
          onConfirm={disable}
          onClose={() => setDisabling(false)}
        />
      ) : null}
    </>
  );
}

function RotateForm({ endpoint: w, onDone }: { endpoint: WebhookEndpoint; onDone: (saved: boolean) => void }) {
  const { t } = useTranslation();
  const refresh = useIntegrationsRefresh();
  const [provider, setProvider] = useState(w.signingSecretRef.provider);
  const [name, setName] = useState("");
  const [grace, setGrace] = useState("24");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!SECRET_PROVIDER.test(provider) || !SECRET_NAME.test(name))
      errs["secret"] = "integrations.form.credentialInvalid";
    const g = /^\d{1,3}$/.test(grace) ? Number(grace) : NaN;
    if (!(g >= 1 && g <= 168)) errs["grace"] = "problems.webhook__grace_invalid";
    if (reason.trim().length < 3) errs["reason"] = "admin.reason_required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<WebhookEndpoint>(integrationPaths.rotateWebhookSecret(w.id), {
        method: "POST",
        body: { signingSecretRef: { provider, name }, graceHours: g, reason },
        ifMatch: w.version,
      });
      if (action.stale()) return;
      setBusy(false);
      onDone(true);
      await refresh();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };
  const err = (k: string) =>
    errors[k]
      ? errors[k]!.startsWith("integrations.") || errors[k]!.startsWith("problems.")
        ? t(errors[k]!)
        : fieldErrorMessage(t, errors[k]!)
      : undefined;
  return (
    <section className="card" aria-labelledby="webhook-rotate-h">
      <h2 id="webhook-rotate-h" className="card__title">
        {t("integrations.webhooks.rotate")}
      </h2>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-rotate-form>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        <p className="small muted">{t("integrations.webhooks.rotateIntro")}</p>
        <Field
          label={t("integrations.credentials.provider")}
          hint={t("integrations.webhooks.secretRefHint")}
          error={err("secret")}
          required
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={provider}
              maxLength={32}
              onChange={(e) => setProvider(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("integrations.credentials.secretName")} required>
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={name}
              maxLength={128}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("integrations.webhooks.graceHours")}
          hint={t("problems.webhook__grace_invalid")}
          error={err("grace")}
          required
        >
          {(c) => (
            <input {...c} dir="ltr" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
          )}
        </Field>
        <Field label={t("integrations.field.reason")} hint={t("common.form.reasonHint")} error={err("reason")} required>
          {(c) => (
            <textarea {...c} rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
        <div className="toolbar">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t("integrations.form.saving") : t("integrations.webhooks.rotateSubmit")}
          </button>
          <button type="button" className="button button--secondary" disabled={busy} onClick={() => onDone(false)}>
            {t("integrations.form.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
