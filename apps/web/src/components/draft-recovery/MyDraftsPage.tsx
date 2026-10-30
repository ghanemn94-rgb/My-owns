// "Your drafts" (T-DG6-FE-D2; ADR-0057 §6 listMyFormDrafts; REQ-S15-010 "unsaved drafts are recoverable", REQ-S15-011
// "Draft - not submitted"): the caller's open drafts in every transformation they can still read, newest first, one
// API page at a time ("Show more drafts"). The table sorts, filters, pages and hides columns (RegisterTable). A draft
// whose record was saved by someone since shows the conflict state in its row. Only the caller sees their drafts;
// a draft is never counted in a total and approves nothing.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { formatDateTime } from "../../lib/format.ts";
import { Icon } from "../Icon.tsx";
import { PageHeader, usePageTitle } from "../Page.tsx";
import { RegisterTable, type RegisterColumn } from "../RegisterTable.tsx";
import { EmptyState, ErrorState, LoadingState, NoPermissionState, StaleBanner } from "../States.tsx";
import { isNoPermission } from "../../lib/problem.ts";
import { titleOf, useRecordTypes } from "../form-framework/api.ts";
import { DraftBadge } from "./DraftRecovery.tsx";
import { useMyFormDrafts, type MyFormDraft } from "./api.ts";
import "../compare/compare.css";

/** The record page of a draft, where its editor offers "Restore draft"; null when this release has no such route. */
export function draftRecordPath(d: Pick<MyFormDraft, "transformationId" | "recordType" | "recordId">): string | null {
  if (!d.recordId) return null;
  if (d.recordType === "T05") return `/transformations/${d.transformationId}/initiatives/${d.recordId}`;
  return null;
}

export function MyDraftsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("productivity.drafts.mineTitle"));
  const drafts = useMyFormDrafts();
  const types = useRecordTypes();
  const typeTitle = (code: string) => {
    const rt = types.data?.find((x) => x.code === code);
    return rt ? titleOf(locale, rt) : code;
  };
  const rows = drafts.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: RegisterColumn<MyFormDraft>[] = [
    {
      id: "recordType",
      header: t("productivity.drafts.recordType"),
      cell: (d) => (
        <span>
          <bdi dir="ltr" className="code">
            {d.recordType}
          </bdi>{" "}
          {typeTitle(d.recordType)}
        </span>
      ),
      sortValue: (d) => d.recordType,
      filterText: (d) => `${d.recordType} ${typeTitle(d.recordType)}`,
      rowHeader: true,
      hideable: false,
    },
    {
      id: "transformation",
      header: t("productivity.drafts.transformation"),
      cell: (d) => (
        <span>
          <bdi dir="ltr" className="code">
            {d.transformationCode}
          </bdi>{" "}
          <span className="text-cell">{d.transformationName}</span>
        </span>
      ),
      sortValue: (d) => d.transformationCode,
      filterText: (d) => `${d.transformationCode} ${d.transformationName}`,
    },
    {
      id: "state",
      header: t("productivity.drafts.base"),
      cell: (d) =>
        d.baseRecordVersion === null ? (
          <span>{t("productivity.drafts.newRecord")}</span>
        ) : d.baseChanged ? (
          <span className="inline-edit__state" data-state="conflict">
            <Icon name="alert" /> {t("productivity.drafts.baseMoved", { version: d.baseRecordVersion })}
          </span>
        ) : (
          <span>{t("productivity.drafts.baseVersion", { version: d.baseRecordVersion })}</span>
        ),
      sortValue: (d) => (d.baseChanged ? 1 : 0),
    },
    {
      id: "status",
      header: t("productivity.drafts.statusColumn"),
      cell: () => <DraftBadge />,
    },
    {
      id: "savedAt",
      header: t("productivity.drafts.savedAt"),
      cell: (d) => <span>{formatDateTime(d.updatedAt, locale) ?? d.updatedAt}</span>,
      sortValue: (d) => d.updatedAt,
    },
    {
      id: "open",
      header: t("productivity.drafts.open"),
      hideable: false,
      cell: (d) => {
        const path = draftRecordPath(d);
        return path ? (
          <Link
            className="link"
            to={path}
            aria-label={t("productivity.drafts.openLabel", {
              form: typeTitle(d.recordType),
              transformation: d.transformationCode,
            })}
          >
            {t("productivity.drafts.open")}
          </Link>
        ) : (
          <span className="muted small">{t("productivity.drafts.noLink")}</span>
        );
      },
    },
  ];

  return (
    <div className="page" data-page="my-drafts">
      <PageHeader title={t("productivity.drafts.mineTitle")} subtitle={t("productivity.drafts.mineSubtitle")} />
      {drafts.isPending ? (
        <LoadingState />
      ) : drafts.isError && !drafts.data ? (
        isNoPermission(drafts.error) ? (
          <NoPermissionState error={drafts.error} />
        ) : (
          <ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} />
        )
      ) : rows.length === 0 ? (
        <EmptyState title={t("productivity.drafts.empty")} body={t("productivity.drafts.emptyBody")} />
      ) : (
        <>
          {drafts.isRefetchError ? (
            <StaleBanner updatedAt={drafts.dataUpdatedAt} onRetry={() => void drafts.refetch()} />
          ) : null}
          <RegisterTable<MyFormDraft>
            id="p6.my-drafts"
            caption={t("productivity.drafts.mineCaption")}
            rows={rows}
            columns={columns}
            getRowId={(d) => d.id}
            emptyTitle={t("productivity.drafts.empty")}
            defaultSort={{ id: "savedAt", dir: "desc" }}
            pageSize={25}
          />
          {drafts.hasNextPage ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void drafts.fetchNextPage()}
              disabled={drafts.isFetchingNextPage}
            >
              {t("productivity.drafts.more")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
