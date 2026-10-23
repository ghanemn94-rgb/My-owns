// Configuration review policies (T-DG5-FE-B; REQ-S06-007, REQ-S06-010, REQ-S12-018; ADR-0039 §7, §9): per
// configuration kind (and the S12-018 benefit-formula routing row), whether a review is required before publish and
// which role reviews. The Transformation Office (config_review_policy.configure) may change it; the methodology
// administrator and every other reader see it read-only (the API answers 403). A policy is configuration, not a
// business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { p5Paths, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote } from "../my-work/p4ui.tsx";
import { ROLE_CODE_PATTERN, STUDIO_NS, useReviewPolicies, type ConfigReviewPolicy } from "./api.ts";
import { ConfigurationNote } from "./ui.tsx";

export function ReviewPoliciesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("studio.policies.title"));
  const policies = useReviewPolicies();
  const refresh = useStudioRefresh();
  const canConfigure = canAnywhere(me, "config_review_policy.configure");
  const [editing, setEditing] = useState<ConfigReviewPolicy | null>(null);
  return (
    <div className="page" data-p5-screen="review-policies">
      <PageHeader
        title={t("studio.policies.title")}
        subtitle={t("studio.policies.summary")}
        crumbs={[{ label: t("nav.p5.studio.title"), to: "/admin/studio" }, { label: t("studio.policies.title") }]}
      />
      <ConfigurationNote />
      {!canConfigure ? <ReadOnlyNote body={t("studio.policies.readOnly")} /> : null}
      <QueryState
        query={policies}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("studio.policies.empty")} />}
      >
        {(rows) => (
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t("common.table.scrollRegion", { caption: t("studio.policies.title") })}
          >
            <table className="table" data-table="policies">
              <caption className="visually-hidden">{t("studio.policies.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.field.kind")}</th>
                  <th scope="col">{t("studio.policies.required")}</th>
                  <th scope="col">{t("studio.reviews.reviewerRole")}</th>
                  <th scope="col">{t("studio.policies.updatedAt")}</th>
                  {canConfigure ? <th scope="col">{t("studio.elements.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.configKind} data-policy={p.configKind}>
                    <th scope="row">{t(`studio.kind.${p.configKind}`, { defaultValue: p.configKind })}</th>
                    <td>{p.reviewRequired ? t("studio.policies.yes") : t("studio.policies.no")}</td>
                    <td>
                      <bdi dir="ltr">{p.reviewerRoleCode}</bdi>
                    </td>
                    <td>{formatDateTime(p.updatedAt, locale)}</td>
                    {canConfigure ? (
                      <td>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          aria-label={`${t("studio.policies.edit")} ${t(`studio.kind.${p.configKind}`, { defaultValue: p.configKind })}`}
                          onClick={() => setEditing(p)}
                        >
                          {t("studio.policies.edit")}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {editing ? (
        <P4FormDialog
          title={t("studio.policies.editTitle", {
            kind: t(`studio.kind.${editing.configKind}`, { defaultValue: editing.configKind }),
          })}
          fields={[
            { name: "reviewRequired", label: t("studio.policies.required"), kind: "checkbox" },
            {
              name: "reviewerRoleCode",
              label: t("studio.reviews.reviewerRole"),
              hint: t("studio.elements.roleHint"),
              kind: "text",
              required: true,
              max: 32,
              ltr: true,
            },
          ]}
          initial={{ reviewRequired: editing.reviewRequired, reviewerRoleCode: editing.reviewerRoleCode }}
          submitLabel={t("studio.elements.save")}
          method="PATCH"
          url={p5Paths.reviewPolicy(editing.configKind)}
          version={editing.version}
          namespaces={STUDIO_NS}
          toBody={(v) => {
            const code = String(v["reviewerRoleCode"] ?? "").trim();
            if (!ROLE_CODE_PATTERN.test(code)) return { fieldErrors: { reviewerRoleCode: "validation.code" } };
            return { reviewRequired: v["reviewRequired"] === true, reviewerRoleCode: code };
          }}
          onDone={refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
