// Administration > Notifications (T-DG6-FE-B; ADR-0054 §3; REQ-S12-023). The in-app inbox always receives every
// notification; email and enterprise messaging are optional channels, and with none configured every workflow still
// completes (A21). listNotificationChannels / getNotificationChannel (notification_channel.configure or operations.read, so the auditor reads them read-only) show both kinds,
// "Not configured" for a channel never saved (version 0, disabled). A holder of the permission saves the email channel
// (putNotificationChannel, If-Match the version or "0"; SMTP credentials are SecretRefs, never values) and sends a test
// message to their own address (testNotificationChannel). Enterprise messaging has no adapter in this release: it is
// shown as not available and cannot be enabled. listNotificationDeliveries lists the channel deliveries. The live mail
// server is Mobily IT's (a disclosed residual).
// Response types are written from docs/api/openapi.yaml 1.5.0-p6 (no zod mirror exists for slice C at this revision).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
  NOTIFICATION_CHANNEL_KINDS,
  p6Paths,
  useNotificationChannel,
  useNotificationChannels,
  useNotificationDeliveries,
  useP6AdminRefresh,
  type NotificationChannelKind,
  type P6Query,
} from "../../../api/p6.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Chip, StatusChip, useRunner, type Runner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  CursorPagerControls,
  EMPTY_SECRET_REF,
  Fact,
  isValidReason,
  isValidSecretRef,
  NotApprovalNote,
  ReadOnlyNote,
  ReasonField,
  SecretRefFields,
  SecretRefNote,
  secretRefOrNull,
  useCan,
  useCursorPager,
  useHomeOrganizationId,
  type SecretRefValue,
  useSavedNotice,
  type SavedNotice,
} from "../security/shared.tsx";

interface SecretRef {
  readonly provider: string;
  readonly name: string;
}
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: "starttls" | "tls" | "none";
  readonly usernameRef: SecretRef | null;
  readonly passwordRef: SecretRef | null;
  readonly fromAddress: string;
}
export interface NotificationChannel {
  readonly organizationId: string;
  readonly channelKind: NotificationChannelKind;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly adapterAvailable: boolean;
  readonly smtp: SmtpSettings | null;
  readonly reason: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}
export interface NotificationChannelTestResult {
  readonly outcome: "sent" | "failed";
  readonly channelKind: NotificationChannelKind;
  readonly errorCode: string | null;
  readonly testedAt: string;
}
export interface NotificationDelivery {
  readonly id: string;
  readonly notificationId: string;
  readonly channelKind: NotificationChannelKind;
  readonly status: "pending" | "sent" | "failed" | "skipped";
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly sentAt: string | null;
  readonly skipReason: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly version: number;
}

/** Enabled is a configuration state, not a favourable status: it never takes the "good" tone. */
export function ChannelStatus({ c }: { c: Pick<NotificationChannel, "enabled" | "adapterAvailable" | "configured"> }) {
  const { t } = useTranslation();
  if (!c.adapterAvailable)
    return <Chip tone="closed" icon="stop" label={t("adminP6.channels.statusUnavailable")} data="unavailable" />;
  if (c.enabled) return <Chip tone="draft" icon="check" label={t("adminP6.channels.statusEnabled")} data="enabled" />;
  if (!c.configured)
    return <Chip tone="neutral" icon="dot" label={t("adminP6.common.notConfigured")} data="not-configured" />;
  return <Chip tone="closed" icon="pause" label={t("adminP6.channels.statusDisabled")} data="disabled" />;
}

function InAppNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="in-app-always">
      <Icon name="info" /> {t("adminP6.channels.inAppNote")}
    </p>
  );
}

export function NotificationChannelsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.notifications.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const channels = useNotificationChannels<NotificationChannel>(organizationId);
  return (
    <div className="page" data-p6-screen="notification-channels">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.notifications.summary")}
        crumbs={adminCrumbs(t, { label: title })}
      />
      <InAppNote />
      <p className="small">
        <Link className="link" to="/admin/notification-deliveries">
          {t("adminP6.channels.deliveriesLink")}
        </Link>
      </p>
      <Section id="notification-channels" title={t("adminP6.channels.listTitle")}>
        <QueryState query={channels}>
          {(rows) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adminP6.channels.listTitle")}>
              <table className="table" data-table="notification-channels">
                <caption className="visually-hidden">{t("adminP6.channels.listTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("adminP6.channels.kind")}</th>
                    <th scope="col">{t("adminP6.channels.status")}</th>
                    <th scope="col">{t("adminP6.common.lastChanged")}</th>
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_CHANNEL_KINDS.map((kind) => {
                    const c = rows.find((r) => r.channelKind === kind);
                    return (
                      <tr key={kind} data-channel={kind}>
                        <th scope="row">
                          <Link className="link" to={`/admin/notification-channels/${kind}`}>
                            {t(`adminP6.channels.kindValue.${kind}`)}
                          </Link>
                        </th>
                        <td>
                          {c ? (
                            <ChannelStatus c={c} />
                          ) : (
                            <Chip tone="neutral" icon="dot" label={t("adminP6.common.notConfigured")} />
                          )}
                        </td>
                        <td>{c?.updatedAt ? formatDateTime(c.updatedAt, locale) : t("adminP6.common.neverChanged")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      <p className="small muted" data-state="residual">
        <Icon name="info" /> {t("adminP6.channels.residual")}
      </p>
    </div>
  );
}

const SECURITY = ["starttls", "tls", "none"] as const;

interface SmtpForm {
  host: string;
  port: string;
  security: (typeof SECURITY)[number];
  usernameRef: SecretRefValue;
  passwordRef: SecretRefValue;
  fromAddress: string;
}
const toSmtpForm = (s: SmtpSettings | null): SmtpForm => ({
  host: s?.host ?? "",
  port: s ? String(s.port) : "587",
  security: s?.security ?? "starttls",
  usernameRef: s?.usernameRef ? { ...s.usernameRef } : EMPTY_SECRET_REF,
  passwordRef: s?.passwordRef ? { ...s.passwordRef } : EMPTY_SECRET_REF,
  fromAddress: s?.fromAddress ?? "",
});

const TEST_TABLE = { sent: ["good", "check"], failed: ["bad", "cross"] } as const;

function EmailForm({
  c,
  runner,
  organizationId,
  notice,
}: {
  c: NotificationChannel;
  runner: Runner;
  organizationId: string;
  notice: SavedNotice;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [enabled, setEnabled] = useState(c.enabled);
  const [form, setForm] = useState<SmtpForm>(() => toSmtpForm(c.smtp));
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<keyof SmtpForm | "reason" | "credentials", boolean>>>({});
  const { saved, setSaved } = notice;
  const [test, setTest] = useState<NotificationChannelTestResult | null>(null);
  const q = `?organizationId=${encodeURIComponent(organizationId)}`;
  const set = <K extends keyof SmtpForm>(k: K, v: SmtpForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const smtpFilled = Boolean(form.host.trim() || form.fromAddress.trim());
  const submit = async () => {
    setSaved(false);
    const user = secretRefOrNull(form.usernameRef);
    const pass = secretRefOrNull(form.passwordRef);
    const needSmtp = enabled || smtpFilled;
    const bad = needSmtp
      ? {
          host: !/^[A-Za-z0-9.-]{1,253}$/.test(form.host.trim()),
          port: !/^[0-9]{1,5}$/.test(form.port.trim()) || Number(form.port) < 1 || Number(form.port) > 65535,
          fromAddress: !/^[^\s@]+@[^\s@]+$/.test(form.fromAddress.trim()) || form.fromAddress.trim().length > 254,
          usernameRef: !isValidSecretRef(form.usernameRef, false),
          passwordRef: !isValidSecretRef(form.passwordRef, false),
          credentials: (user === null) !== (pass === null),
        }
      : {};
    const all = { ...bad, reason: !isValidReason(reason) };
    setInvalid(all);
    if (Object.values(all).some(Boolean)) return;
    const smtp = needSmtp
      ? {
          host: form.host.trim(),
          port: Number(form.port),
          security: form.security,
          usernameRef: user,
          passwordRef: pass,
          fromAddress: form.fromAddress.trim(),
        }
      : null;
    const r = await runner.run<NotificationChannel>(`${p6Paths.notificationChannel("email")}${q}`, {
      method: "PUT",
      body: { enabled, smtp, reason },
      ifMatch: c.version,
    });
    if (r) {
      setReason("");
      setSaved(true);
    }
  };
  const field = (k: "host" | "port" | "fromAddress", label: string, inputMode?: "numeric" | "email") => (
    <div className={`field${invalid[k] ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`smtp-${k}`}>
        {label}
      </label>
      <input
        id={`smtp-${k}`}
        dir="ltr"
        autoComplete="off"
        {...(inputMode ? { inputMode } : {})}
        value={form[k]}
        aria-invalid={invalid[k] || undefined}
        aria-describedby={invalid[k] ? `smtp-${k}-error` : undefined}
        onChange={(e) => set(k, e.target.value)}
      />
      {invalid[k] ? (
        <p id={`smtp-${k}-error`} className="field__error">
          <Icon name="alert" /> {t("adminP6.channels.fieldInvalid")}
        </p>
      ) : null}
    </div>
  );
  return (
    <form
      className="form"
      noValidate
      data-form="email-channel"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {saved ? (
        <p className="banner banner--success" role="status">
          <Icon name="check" /> {t("adminP6.common.saved")}
        </p>
      ) : null}
      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
        {t("adminP6.channels.enable")}
      </label>
      <SecretRefNote />
      <div className="grid grid--2">
        {field("host", t("adminP6.channels.host"))}
        {field("port", t("adminP6.channels.port"), "numeric")}
        <div className="field">
          <label className="field__label" htmlFor="smtp-security">
            {t("adminP6.channels.security")}
          </label>
          <select
            id="smtp-security"
            value={form.security}
            onChange={(e) => set("security", e.target.value as SmtpForm["security"])}
          >
            {SECURITY.map((s) => (
              <option key={s} value={s}>
                {t(`adminP6.channels.securityValue.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {field("fromAddress", t("adminP6.channels.fromAddress"), "email")}
        <SecretRefFields
          id="smtp-username"
          legend={t("adminP6.channels.username")}
          value={form.usernameRef}
          onChange={(v) => set("usernameRef", v)}
          invalid={Boolean(invalid.usernameRef || invalid.credentials)}
        />
        <SecretRefFields
          id="smtp-password"
          legend={t("adminP6.channels.password")}
          value={form.passwordRef}
          onChange={(v) => set("passwordRef", v)}
          invalid={Boolean(invalid.passwordRef || invalid.credentials)}
        />
      </div>
      <p className="small muted">{t("adminP6.channels.noCredentials")}</p>
      <ReasonField id="email-channel-reason" value={reason} onChange={setReason} invalid={Boolean(invalid.reason)} />
      <NotApprovalNote />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("adminP6.common.save")}
        </button>
        {c.configured ? (
          <button
            type="button"
            className="button button--secondary"
            data-action="test-channel"
            disabled={runner.busy}
            onClick={() =>
              void runner
                .run<NotificationChannelTestResult>(`${p6Paths.testNotificationChannel("email")}${q}`, {
                  body: { recipient: "self" },
                })
                .then(setTest)
            }
          >
            {t("adminP6.channels.test")}
          </button>
        ) : null}
      </div>
      {test ? (
        <p role="status" data-test-outcome={test.outcome}>
          <StatusChip value={test.outcome} table={TEST_TABLE} labelKey="adminP6.channels.testResult" />{" "}
          {test.errorCode ? <Code>{test.errorCode}</Code> : null} · {formatDateTime(test.testedAt, locale)}
        </p>
      ) : null}
    </form>
  );
}

export function NotificationChannelPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { channelKind } = useParams();
  const kind = (NOTIFICATION_CHANNEL_KINDS as readonly string[]).includes(channelKind ?? "")
    ? (channelKind as NotificationChannelKind)
    : undefined;
  const title = t("nav.p6.notificationChannel.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const channel = useNotificationChannel<NotificationChannel>(kind, organizationId);
  const refresh = useP6AdminRefresh("notification-channels", "notification-deliveries", "audit");
  const runner = useRunner(refresh);
  const notice = useSavedNotice();
  // Reads need notification_channel.configure or operations.read (the auditor reads); changes need the first.
  const canConfigure = useCan("notification_channel.configure");
  if (!kind) return <NoPermissionState />;
  return (
    <div className="page" data-p6-screen="notification-channel" data-channel={kind}>
      <PageHeader
        title={t(`adminP6.channels.kindValue.${kind}`)}
        subtitle={t("nav.p6.notificationChannel.summary")}
        crumbs={adminCrumbs(
          t,
          { label: t("nav.p6.notifications.title"), to: "/admin/notification-channels" },
          { label: t(`adminP6.channels.kindValue.${kind}`) },
        )}
      />
      <InAppNote />
      <QueryState query={channel}>
        {(c) => (
          <>
            <section className="card" aria-labelledby="channel-facts">
              <h2 id="channel-facts" className="card__title">
                <ChannelStatus c={c} />
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.channels.configured")}>
                  {c.configured ? t("adminP6.common.yes") : t("adminP6.common.no")}
                </Fact>
                <Fact label={t("adminP6.channels.enabled")}>
                  {c.enabled ? t("adminP6.common.yes") : t("adminP6.common.no")}
                </Fact>
                <Fact label={t("adminP6.common.lastChanged")}>
                  {c.updatedAt ? formatDateTime(c.updatedAt, locale) : t("adminP6.common.neverChanged")}
                </Fact>
                {c.reason ? <Fact label={t("adminP6.common.reason")}>{c.reason}</Fact> : null}
              </dl>
            </section>
            {!c.adapterAvailable ? (
              <p className="banner banner--info" role="note" data-state="adapter-unavailable">
                <Icon name="info" /> {t("adminP6.channels.adapterUnavailable")}
              </p>
            ) : canConfigure ? (
              <Section id="email-channel-form" title={t("adminP6.channels.formTitle")}>
                {runner.alert}
                <EmailForm key={c.version} c={c} runner={runner} organizationId={organizationId} notice={notice} />
              </Section>
            ) : (
              <>
                {c.smtp ? (
                  <section className="card" aria-labelledby="smtp-read-only">
                    <h2 id="smtp-read-only" className="card__title">
                      {t("adminP6.channels.formTitle")}
                    </h2>
                    <dl className="workspace-header__grid">
                      <Fact label={t("adminP6.channels.host")}>
                        <Code>
                          {c.smtp.host}:{c.smtp.port}
                        </Code>
                      </Fact>
                      <Fact label={t("adminP6.channels.security")}>
                        {t(`adminP6.channels.securityValue.${c.smtp.security}`)}
                      </Fact>
                      <Fact label={t("adminP6.channels.fromAddress")}>
                        <Code>{c.smtp.fromAddress}</Code>
                      </Fact>
                    </dl>
                  </section>
                ) : null}
                <ReadOnlyNote />
              </>
            )}
            <p className="small muted" data-state="residual">
              <Icon name="info" /> {t("adminP6.channels.residual")}
            </p>
          </>
        )}
      </QueryState>
    </div>
  );
}

const DELIVERY_TABLE = {
  pending: ["neutral", "clock"],
  sent: ["good", "check"],
  failed: ["bad", "cross"],
  skipped: ["closed", "dot"],
} as const;

export function NotificationDeliveriesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.notificationDeliveries.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const [search, setSearch] = useSearchParams();
  const status = search.get("status") ?? "";
  const pager = useCursorPager();
  const query: P6Query = { organizationId, ...(status ? { status } : {}) };
  const deliveries = useNotificationDeliveries<NotificationDelivery>(query, pager.cursor);
  const columns: RegisterColumn<NotificationDelivery>[] = [
    {
      id: "created",
      header: t("adminP6.deliveries.created"),
      rowHeader: true,
      hideable: false,
      cell: (d) => formatDateTime(d.createdAt, locale),
      sortValue: (d) => d.createdAt,
    },
    {
      id: "channel",
      header: t("adminP6.deliveries.channel"),
      cell: (d) => t(`adminP6.channels.kindValue.${d.channelKind}`),
    },
    {
      id: "status",
      header: t("adminP6.deliveries.status"),
      cell: (d) => (
        <span className="block">
          <StatusChip value={d.status} table={DELIVERY_TABLE} labelKey="adminP6.deliveries.statusValue" />
          {d.skipReason ? (
            <span className="block small muted">
              {t("adminP6.deliveries.skipReason")}:{" "}
              {t(`adminP6.deliveries.skipReasonValue.${d.skipReason}`, { defaultValue: d.skipReason })}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (d) => d.status,
    },
    { id: "attempts", header: t("adminP6.deliveries.attempts"), cell: (d) => d.attempts, sortValue: (d) => d.attempts },
    {
      id: "sent",
      header: t("adminP6.deliveries.sentAt"),
      cell: (d) => (d.sentAt ? formatDateTime(d.sentAt, locale) : t("adminP6.common.none")),
    },
    {
      id: "error",
      header: t("adminP6.deliveries.errorCode"),
      cell: (d) => (d.errorCode ? <Code>{d.errorCode}</Code> : t("adminP6.common.none")),
    },
  ];
  return (
    <div className="page" data-p6-screen="notification-deliveries">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.notificationDeliveries.summary")}
        crumbs={adminCrumbs(
          t,
          { label: t("nav.p6.notifications.title"), to: "/admin/notification-channels" },
          { label: title },
        )}
      />
      <p className="muted">{t("adminP6.deliveries.intro")}</p>
      <div className="field">
        <label className="field__label" htmlFor="deliveries-status">
          {t("adminP6.deliveries.status")}
        </label>
        <select
          id="deliveries-status"
          value={status}
          onChange={(e) => {
            const next = new URLSearchParams(search);
            if (e.target.value) next.set("status", e.target.value);
            else next.delete("status");
            pager.reset();
            setSearch(next, { replace: true });
          }}
        >
          <option value="">{t("adminP6.common.allOption")}</option>
          {(["pending", "sent", "failed", "skipped"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`adminP6.deliveries.statusValue.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <Section id="notification-deliveries" title={t("adminP6.deliveries.listTitle")}>
        <QueryState query={deliveries}>
          {(page) => (
            <>
              <RegisterTable
                id="p6-notification-deliveries"
                caption={t("adminP6.deliveries.listTitle")}
                rows={page.items}
                columns={columns}
                getRowId={(d) => d.id}
                emptyTitle={t("adminP6.deliveries.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={deliveries.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}
