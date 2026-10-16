// Administration > Playbook Studio > Form builder (T-DG5-FE-C; ADR-0041 §1-§2; REQ-S05-002, REQ-S05-006): the native
// forms of the registry (`listFormRecordTypes`, methodology.read): templates, source deliverables, the twelve
// extension record types with their "Extension" badge (en and ar), and product records, with their extension-field and
// bulk-edit flags and their status in this release. Read-only for AUD; each form opens its fields screen.
// A form schema is configuration, not a business approval (G1-G6) and never an engineering gate (DG0-DG7).
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { ExtensionBadge } from "../../components/form-framework/ExtensionBadge.tsx";
import { titleOf, useRecordTypes, type FormRecordType } from "../../components/form-framework/api.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { QueryState } from "../../components/States.tsx";
import { ConfigurationNote } from "../studio/ui.tsx";

export function FormBuilderPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const types = useRecordTypes();
  const columns: RegisterColumn<FormRecordType>[] = [
    {
      id: "code",
      header: t("forms.builder.code"),
      cell: (r) => <code dir="ltr">{r.code}</code>,
      sortValue: (r) => r.ordinal,
      hideable: false,
    },
    {
      id: "form",
      header: t("forms.builder.form"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <>
          <Link className="link" to={`/admin/forms/${encodeURIComponent(r.code)}`}>
            {titleOf(locale, r)}
          </Link>
          {r.extensionBadge ? (
            <>
              {" "}
              <ExtensionBadge recordType={r.code} />
            </>
          ) : null}
          {locale === "ar" && r.titleArProvisional ? (
            <span className="block small muted">{t("forms.badge.provisionalAr")}</span>
          ) : null}
        </>
      ),
      sortValue: (r) => titleOf(locale, r),
      filterText: (r) => `${r.code} ${r.titleEn} ${r.titleAr}`,
    },
    {
      id: "kind",
      header: t("forms.builder.kind"),
      cell: (r) => t(`forms.builder.kinds.${r.kind}`),
      sortValue: (r) => r.kind,
      filterText: (r) => t(`forms.builder.kinds.${r.kind}`),
    },
    {
      id: "extensions",
      header: t("forms.builder.extensions"),
      cell: (r) => (r.customFieldsAllowed ? t("forms.builder.allowed") : t("forms.builder.notAllowed")),
      sortValue: (r) => (r.customFieldsAllowed ? 1 : 0),
    },
    {
      id: "bulk",
      header: t("forms.builder.bulk"),
      cell: (r) => (r.bulkEditAllowed ? t("forms.builder.allowed") : t("forms.builder.notAllowed")),
      sortValue: (r) => (r.bulkEditAllowed ? 1 : 0),
    },
    {
      id: "status",
      header: t("forms.builder.status"),
      cell: (r) =>
        r.featureStatus === "working" ? (
          <span className="lifecycle-chip lifecycle-chip--active">
            <Icon name="check" /> {t("forms.builder.statuses.working")}
          </span>
        ) : (
          <span className="lifecycle-chip lifecycle-chip--draft">
            <Icon name="clock" /> {t("forms.builder.statuses.planned")}
          </span>
        ),
      sortValue: (r) => r.featureStatus,
    },
    {
      id: "source",
      header: t("forms.builder.source"),
      cell: (r) => <code dir="ltr">{r.sourceRef}</code>,
      sortValue: (r) => r.sourceRef,
    },
  ];
  usePageTitle(t("forms.builder.title"));
  return (
    <div className="page" data-p5-screen="form-builder">
      <PageHeader
        title={t("forms.builder.title")}
        subtitle={t("forms.builder.intro")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("forms.builder.title") }]}
      />
      <ConfigurationNote />
      <QueryState query={types}>
        {(list) => (
          <RegisterTable
            id="form-builder"
            caption={t("forms.builder.caption")}
            rows={[...list].sort((a, b) => a.ordinal - b.ordinal)}
            columns={columns}
            getRowId={(r) => r.code}
            pageSize={50}
            emptyTitle={t("forms.builder.caption")}
          />
        )}
      </QueryState>
    </div>
  );
}
