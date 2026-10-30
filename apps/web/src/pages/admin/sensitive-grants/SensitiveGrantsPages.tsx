// Administration > Sensitive grants (T-DG6-FE-B; ADR-0051 §2; REQ-S10-002; D-195 Q3). listSensitiveGrants
// (sensitive_record.read; one transformation at a time, as the contract requires) with the status and record-type
// filters, and one grant's detail (getSensitiveGrant). A holder of `sensitive_record.grant` revokes an active grant with a
// reason (revokeSensitiveGrant, If-Match the grant's version); grants are created on the record's own page (the
// access-restriction panel), where the record is known. A record title the caller may not read arrives redacted
// (`recordTitleRedacted`) and is shown as "Restricted record", never guessed. The auditor reads, and never sees a write
// control. A grant is an access decision, never a business approval.
import type { SensitiveGrant } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "../../../api/client.ts";
import { p6Paths, useP6AdminRefresh, useSensitiveGrant, useSensitiveGrants, type P6Query } from "../../../api/p6.ts";
import { useAllTransformations } from "../../../api/queries.ts";
import { useLocale } from "../../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { ReasonDialog } from "../../../components/ReasonDialog.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { EmptyState, QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Chip, StatusChip } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  CursorPagerControls,
  Fact,
  NotApprovalNote,
  ReadOnlyNote,
  useCan,
  useCursorPager,
  useHomeOrganizationId,
} from "../security/shared.tsx";

const STATUS_TABLE = { active: ["draft", "check"], revoked: ["closed", "cross"] } as const;

/** The in-app path of a sensitive-capable record (the evidence register has no detail page). */
export function recordPath(g: Pick<SensitiveGrant, "transformationId" | "recordType" | "recordId">): string {
  const base = `/transformations/${encodeURIComponent(g.transformationId)}`;
  if (g.recordType === "benefit") return `${base}/benefits/${encodeURIComponent(g.recordId)}`;
  if (g.recordType === "business_case") return `${base}/business-cases/${encodeURIComponent(g.recordId)}`;
  return `${base}/evidence`;
}

function RecordTitle({ g }: { g: SensitiveGrant }) {
  const { t } = useTranslation();
  if (g.recordTitleRedacted || g.recordTitle === null)
    return <Chip tone="neutral" icon="lock" label={t("adminP6.grants.titleRedacted")} data="redacted" />;
  return (
    <Link className="link" to={recordPath(g)}>
      {g.recordTitle}
    </Link>
  );
}

function GrantStatus({ status }: { status: string }) {
  return <StatusChip value={status} table={STATUS_TABLE} labelKey="adminP6.grants.statusValue" />;
}

function useRevoke(onDone: () => Promise<unknown>) {
  const { t } = useTranslation();
  const [revoking, setRevoking] = useState<SensitiveGrant | null>(null);
  const dialog = revoking ? (
    <ReasonDialog
      title={t("adminP6.grants.revokeTitle")}
      description={t("adminP6.grants.revokeDescription")}
      confirmLabel={t("adminP6.grants.revoke")}
      onClose={() => setRevoking(null)}
      onConfirm={async (reason) => {
        await api.send(p6Paths.revokeSensitiveGrant(revoking.id), {
          method: "POST",
          body: { reason },
          ifMatch: revoking.version,
        });
        setRevoking(null);
        await onDone();
      }}
    />
  ) : null;
  return { dialog, start: setRevoking };
}

export function SensitiveGrantsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.sensitiveGrants.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const canGrant = useCan("sensitive_record.grant");
  const [search, setSearch] = useSearchParams();
  const tid = search.get("transformationId") ?? "";
  const status = search.get("status") ?? "";
  const recordType = search.get("recordType") ?? "";
  const pager = useCursorPager();
  const query: P6Query = {
    transformationId: tid,
    ...(status ? { status } : {}),
    ...(recordType ? { recordType } : {}),
  };
  const grants = useSensitiveGrants<SensitiveGrant>(query, pager.cursor);
  const transformations = useAllTransformations({ organizationId, sort: "name:asc" });
  const refresh = useP6AdminRefresh("sensitive-grants", "audit");
  const revoke = useRevoke(refresh);
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    pager.reset();
    setSearch(next, { replace: true });
  };
  const columns: RegisterColumn<SensitiveGrant>[] = [
    {
      id: "record",
      header: t("adminP6.grants.record"),
      rowHeader: true,
      hideable: false,
      cell: (g) => (
        <span className="block">
          <RecordTitle g={g} />
          <span className="block small muted">{t(`adminP6.grants.recordTypeValue.${g.recordType}`)}</span>
        </span>
      ),
      sortValue: (g) => g.recordTitle ?? "",
      filterText: (g) => `${g.recordTitle ?? ""} ${g.recordType}`,
    },
    {
      id: "grantee",
      header: t("adminP6.grants.grantee"),
      cell: (g) => g.granteeDisplayName ?? t("adminP6.grants.unknownPerson"),
      sortValue: (g) => g.granteeDisplayName ?? "",
    },
    { id: "reason", header: t("adminP6.grants.reason"), cell: (g) => g.reason },
    {
      id: "status",
      header: t("adminP6.grants.status"),
      cell: (g) => <GrantStatus status={g.status} />,
      sortValue: (g) => g.status,
    },
    {
      id: "granted",
      header: t("adminP6.grants.granted"),
      cell: (g) => formatDateTime(g.grantedAt, locale),
      sortValue: (g) => g.grantedAt,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (g) => (
        <span className="row-actions">
          <Link
            className="button button--link button--small"
            to={`/admin/sensitive-grants/${encodeURIComponent(g.id)}`}
          >
            {t("adminP6.common.details")}
            <span className="visually-hidden">: {g.granteeDisplayName ?? g.id}</span>
          </Link>
          {canGrant && g.status === "active" ? (
            <button
              type="button"
              className="button button--link button--small"
              data-action="revoke-grant"
              onClick={() => revoke.start(g)}
            >
              {t("adminP6.grants.revoke")}
              <span className="visually-hidden">: {g.granteeDisplayName ?? g.id}</span>
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <div className="page" data-p6-screen="sensitive-grants">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.sensitiveGrants.summary")}
        crumbs={adminCrumbs(t, { label: title })}
      />
      <p className="muted">{t("adminP6.grants.intro")}</p>
      {canGrant ? <NotApprovalNote text={t("adminP6.grants.notApproval")} /> : <ReadOnlyNote />}
      <Section id="grant-filters" title={t("adminP6.common.filters")}>
        <div className="grid grid--3">
          <div className="field">
            <label className="field__label" htmlFor="grants-transformation">
              {t("adminP6.common.transformation")}
              <span className="field__required"> ({t("common.form.required")})</span>
            </label>
            <select
              id="grants-transformation"
              value={tid}
              onChange={(e) => setFilter("transformationId", e.target.value)}
            >
              <option value="">{t("adminP6.common.pickTransformation")}</option>
              {(transformations.data ?? []).map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="grants-status">
              {t("adminP6.grants.status")}
            </label>
            <select id="grants-status" value={status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">{t("adminP6.common.allOption")}</option>
              <option value="active">{t("adminP6.grants.statusValue.active")}</option>
              <option value="revoked">{t("adminP6.grants.statusValue.revoked")}</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="grants-record-type">
              {t("adminP6.grants.recordType")}
            </label>
            <select
              id="grants-record-type"
              value={recordType}
              onChange={(e) => setFilter("recordType", e.target.value)}
            >
              <option value="">{t("adminP6.common.allOption")}</option>
              <option value="benefit">{t("adminP6.grants.recordTypeValue.benefit")}</option>
              <option value="business_case">{t("adminP6.grants.recordTypeValue.business_case")}</option>
              <option value="evidence">{t("adminP6.grants.recordTypeValue.evidence")}</option>
            </select>
          </div>
        </div>
      </Section>
      <Section id="grants" title={t("adminP6.grants.listTitle")} intro={t("adminP6.grants.revokedNote")}>
        {!tid ? (
          <EmptyState title={t("adminP6.grants.pickTransformation")} />
        ) : (
          <QueryState query={grants}>
            {(page) => (
              <>
                <RegisterTable
                  id="p6-sensitive-grants"
                  caption={t("adminP6.grants.listTitle")}
                  rows={page.items}
                  columns={columns}
                  getRowId={(g) => g.id}
                  emptyTitle={t("adminP6.grants.empty")}
                  pageSize={50}
                />
                <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={grants.isFetching} />
              </>
            )}
          </QueryState>
        )}
      </Section>
      {revoke.dialog}
    </div>
  );
}

export function SensitiveGrantPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { grantId } = useParams();
  const title = t("nav.p6.sensitiveGrant.title");
  usePageTitle(title);
  const grant = useSensitiveGrant<SensitiveGrant>(grantId);
  const canGrant = useCan("sensitive_record.grant");
  const refresh = useP6AdminRefresh("sensitive-grants", "audit");
  const revoke = useRevoke(refresh);
  return (
    <div className="page" data-p6-screen="sensitive-grant">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.sensitiveGrant.summary")}
        crumbs={adminCrumbs(
          t,
          { label: t("nav.p6.sensitiveGrants.title"), to: "/admin/sensitive-grants" },
          { label: title },
        )}
      />
      <QueryState query={grant}>
        {(g) => (
          <>
            <section className="card" aria-labelledby="grant-facts" data-grant={g.id} data-grant-status={g.status}>
              <h2 id="grant-facts" className="card__title">
                <RecordTitle g={g} />
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.grants.recordType")}>
                  {t(`adminP6.grants.recordTypeValue.${g.recordType}`)}
                </Fact>
                <Fact label={t("adminP6.grants.grantee")}>
                  {g.granteeDisplayName ?? t("adminP6.grants.unknownPerson")}
                </Fact>
                <Fact label={t("adminP6.grants.status")}>
                  <GrantStatus status={g.status} />
                </Fact>
                <Fact label={t("adminP6.grants.reason")}>{g.reason}</Fact>
                <Fact label={t("adminP6.grants.granted")}>{formatDateTime(g.grantedAt, locale)}</Fact>
                {g.revokedAt ? (
                  <>
                    <Fact label={t("adminP6.grants.revoked")}>{formatDateTime(g.revokedAt, locale)}</Fact>
                    <Fact label={t("adminP6.grants.revokeReason")}>{g.revokeReason ?? t("adminP6.common.none")}</Fact>
                  </>
                ) : null}
                <Fact label={t("adminP6.common.version", { version: "" }).trim()}>
                  <Code>{g.version}</Code>
                </Fact>
              </dl>
              <div className="form__actions">
                {canGrant && g.status === "active" ? (
                  <button
                    type="button"
                    className="button button--danger"
                    data-action="revoke-grant"
                    onClick={() => revoke.start(g)}
                  >
                    {t("adminP6.grants.revoke")}
                  </button>
                ) : null}
                <Link
                  className="link"
                  to={`/admin/sensitive-grants?transformationId=${encodeURIComponent(g.transformationId)}`}
                >
                  {t("adminP6.common.back")}
                </Link>
              </div>
            </section>
            {canGrant ? null : <ReadOnlyNote />}
          </>
        )}
      </QueryState>
      {revoke.dialog}
    </div>
  );
}
