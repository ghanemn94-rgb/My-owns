// Administration > Operations > Service identities (T-DG6-FE-B; ADR-0053 §1, §7; REQ-S16-029). listServiceIdentities and
// getServiceIdentity (operations.read), and putServiceIdentity (service_identity.configure; If-Match; a reason): the
// grant of a job or connector can be narrowed, or restored up to its declaration, never widened (the declaration is set
// by a migration; the server answers 422 service_identity.grant_exceeds_declaration otherwise, and the form offers only
// declared codes). A service identity reads data; it never approves anything.
// The response type is written from docs/api/openapi.yaml 1.5.0-p6 (no zod mirror exists for slice J at this revision).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p6Paths, useP6AdminRefresh, useServiceIdentities, useServiceIdentity } from "../../../api/p6.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Chip, HumanDecisionNote, pick, useRunner, type Runner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  Fact,
  isValidReason,
  NotApprovalNote,
  ReadOnlyNote,
  ReasonField,
  useCan,
  useHomeOrganizationId,
  useSavedNotice,
  type SavedNotice,
} from "../security/shared.tsx";

export interface ServiceIdentity {
  readonly id: string;
  readonly code: string;
  readonly subjectKind: "job" | "connector";
  readonly queueName: string | null;
  readonly connectorId: string | null;
  readonly scopeLevel: "platform" | "organization";
  readonly organizationId: string | null;
  readonly declaredPermissionCodes: readonly string[];
  readonly grantedPermissionCodes: readonly string[];
  readonly sensitiveAccess: "none" | "aggregate_only";
  readonly labelEn: string;
  readonly labelAr: string;
  readonly reason: string;
  readonly version: number;
  readonly updatedAt: string;
}

function GrantCount({ s }: { s: ServiceIdentity }) {
  const { t } = useTranslation();
  const narrowed = s.grantedPermissionCodes.length < s.declaredPermissionCodes.length;
  return (
    <span data-granted={s.grantedPermissionCodes.length} data-declared={s.declaredPermissionCodes.length}>
      {t("adminP6.serviceIdentities.grantedOfDeclared", {
        granted: s.grantedPermissionCodes.length,
        declared: s.declaredPermissionCodes.length,
      })}{" "}
      {narrowed ? (
        <Chip tone="neutral" icon="lock" label={t("adminP6.serviceIdentities.narrowed")} data="narrowed" />
      ) : null}
    </span>
  );
}

export function ServiceIdentitiesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.serviceIdentities.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const identities = useServiceIdentities<ServiceIdentity>({ organizationId });
  const columns: RegisterColumn<ServiceIdentity>[] = [
    {
      id: "label",
      header: t("adminP6.serviceIdentities.label"),
      rowHeader: true,
      hideable: false,
      cell: (s) => (
        <span className="block">
          <Link className="link" to={`/admin/service-identities/${encodeURIComponent(s.id)}`}>
            {pick(locale, s.labelEn, s.labelAr) ?? s.code}
          </Link>
          <span className="block small muted">
            <Code>{s.code}</Code>
          </span>
        </span>
      ),
      sortValue: (s) => s.code,
      filterText: (s) => `${s.code} ${s.labelEn} ${s.labelAr} ${s.queueName ?? ""}`,
    },
    {
      id: "kind",
      header: t("adminP6.serviceIdentities.subjectKind"),
      cell: (s) => t(`adminP6.serviceIdentities.subjectKindValue.${s.subjectKind}`),
      sortValue: (s) => s.subjectKind,
    },
    {
      id: "scope",
      header: t("adminP6.serviceIdentities.scope"),
      cell: (s) => t(`adminP6.serviceIdentities.scopeValue.${s.scopeLevel}`),
      sortValue: (s) => s.scopeLevel,
    },
    {
      id: "granted",
      header: t("adminP6.serviceIdentities.granted"),
      cell: (s) => <GrantCount s={s} />,
      sortValue: (s) => s.grantedPermissionCodes.length - s.declaredPermissionCodes.length,
    },
    {
      id: "sensitive",
      header: t("adminP6.serviceIdentities.sensitiveAccess"),
      cell: (s) => t(`adminP6.serviceIdentities.sensitiveAccessValue.${s.sensitiveAccess}`),
    },
    {
      id: "queue",
      header: t("adminP6.serviceIdentities.queue"),
      cell: (s) => (s.queueName ? <Code>{s.queueName}</Code> : t("adminP6.common.none")),
    },
  ];
  return (
    <div className="page" data-p6-screen="service-identities">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.serviceIdentities.summary")}
        crumbs={adminCrumbs(t, { label: t("nav.p6.operations.title"), to: "/admin/operations" }, { label: title })}
      />
      <p className="muted">{t("adminP6.serviceIdentities.intro")}</p>
      <HumanDecisionNote />
      <Section id="service-identities" title={t("adminP6.serviceIdentities.listTitle")}>
        <QueryState query={identities}>
          {(rows) => (
            <RegisterTable
              id="p6-service-identities"
              caption={t("adminP6.serviceIdentities.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(s) => s.id}
              emptyTitle={t("adminP6.serviceIdentities.empty")}
              defaultSort={{ id: "label", dir: "asc" }}
              pageSize={25}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function GrantForm({ s, runner, notice }: { s: ServiceIdentity; runner: Runner; notice: SavedNotice }) {
  const { t } = useTranslation();
  const [granted, setGranted] = useState<string[]>([...s.grantedPermissionCodes]);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const { saved, setSaved } = notice;
  const toggle = (code: string) =>
    setGranted((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  return (
    <form
      className="form"
      noValidate
      data-form="service-identity-grant"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const bad = !isValidReason(reason);
        setInvalid(bad);
        if (bad) return;
        const body = {
          grantedPermissionCodes: s.declaredPermissionCodes.filter((c) => granted.includes(c)),
          reason,
        };
        void runner
          .run<ServiceIdentity>(p6Paths.serviceIdentity(s.id), { method: "PUT", body, ifMatch: s.version })
          .then((r) => {
            if (r) {
              setReason("");
              setSaved(true);
            }
          });
      }}
    >
      {saved ? (
        <p className="banner banner--success" role="status">
          <Icon name="check" /> {t("adminP6.common.saved")}
        </p>
      ) : null}
      <fieldset className="field">
        <legend className="field__label">{t("adminP6.serviceIdentities.grantForm")}</legend>
        <p className="field__hint">{t("adminP6.serviceIdentities.declarationNote")}</p>
        {s.declaredPermissionCodes.map((code) => (
          <label key={code} className="checkbox">
            <input type="checkbox" checked={granted.includes(code)} onChange={() => toggle(code)} /> <Code>{code}</Code>
          </label>
        ))}
      </fieldset>
      <ReasonField id="service-identity-reason" value={reason} onChange={setReason} invalid={invalid} />
      <NotApprovalNote />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("adminP6.common.save")}
        </button>
      </div>
    </form>
  );
}

export function ServiceIdentityPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { serviceIdentityId } = useParams();
  const title = t("nav.p6.serviceIdentity.title");
  usePageTitle(title);
  const identity = useServiceIdentity<ServiceIdentity>(serviceIdentityId);
  const canConfigure = useCan("service_identity.configure");
  const refresh = useP6AdminRefresh("service-identities", "audit");
  const runner = useRunner(refresh);
  const notice = useSavedNotice();
  return (
    <div className="page" data-p6-screen="service-identity">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.serviceIdentity.summary")}
        crumbs={adminCrumbs(
          t,
          { label: t("nav.p6.serviceIdentities.title"), to: "/admin/service-identities" },
          { label: title },
        )}
      />
      <QueryState query={identity}>
        {(s) => (
          <>
            <section className="card" aria-labelledby="service-identity-facts" data-service-identity={s.code}>
              <h2 id="service-identity-facts" className="card__title">
                {pick(locale, s.labelEn, s.labelAr) ?? s.code}
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.serviceIdentities.code")}>
                  <Code>{s.code}</Code>
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.subjectKind")}>
                  {t(`adminP6.serviceIdentities.subjectKindValue.${s.subjectKind}`)}
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.scope")}>
                  {t(`adminP6.serviceIdentities.scopeValue.${s.scopeLevel}`)}
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.queue")}>
                  {s.queueName ? <Code>{s.queueName}</Code> : t("adminP6.common.none")}
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.sensitiveAccess")}>
                  {t(`adminP6.serviceIdentities.sensitiveAccessValue.${s.sensitiveAccess}`)}
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.granted")}>
                  <GrantCount s={s} />
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.declared")}>
                  <ul className="plain-list" data-list="declared">
                    {s.declaredPermissionCodes.map((c) => (
                      <li key={c} data-granted={s.grantedPermissionCodes.includes(c)}>
                        <Code>{c}</Code>{" "}
                        {s.grantedPermissionCodes.includes(c) ? (
                          <Chip tone="draft" icon="check" label={t("adminP6.serviceIdentities.granted")} />
                        ) : (
                          <Chip tone="neutral" icon="lock" label={t("adminP6.serviceIdentities.narrowed")} />
                        )}
                      </li>
                    ))}
                  </ul>
                </Fact>
                <Fact label={t("adminP6.serviceIdentities.currentReason")}>{s.reason}</Fact>
                <Fact label={t("adminP6.common.lastChanged")}>{formatDateTime(s.updatedAt, locale)}</Fact>
              </dl>
            </section>
            {canConfigure ? (
              <Section id="service-identity-form" title={t("adminP6.serviceIdentities.grantForm")}>
                {runner.alert}
                <GrantForm key={s.version} s={s} runner={runner} notice={notice} />
              </Section>
            ) : (
              <ReadOnlyNote />
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
