// The configuration pins of one transformation (T-DG5-FE-B; REQ-S06-008; ADR-0039 §3): which version of each
// configuration kind the transformation renders, and the history of pin moves — each one made by an executed
// migration, never by publishing. A kind never pinned shows version 1 of its default key ("not pinned").
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useConfigPinHistory, useConfigPins } from "../../api/p5.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useUserNames } from "../my-work/p4ui.tsx";

export function ConfigPinsPage() {
  const { id: tid = "" } = useParams();
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("studio.pins.title"));
  const transformation = useTransformation(tid);
  const pins = useConfigPins(tid);
  const history = useConfigPinHistory(tid);
  const names = useUserNames((history.data ?? []).map((h) => h.createdBy));
  const name = transformation.data ? `${transformation.data.code} · ${transformation.data.name}` : "";
  return (
    <div className="page" data-p5-screen="config-pins">
      <PageHeader
        title={t("studio.pins.title")}
        subtitle={name}
        crumbs={[
          ...(name ? [{ label: name, to: `/transformations/${tid}` }] : []),
          { label: t("nav.p5.methodologyMigrations.title"), to: `/transformations/${tid}/methodology-migrations` },
          { label: t("studio.pins.title") },
        ]}
      />
      <p className="muted">{t("studio.pins.intro")}</p>
      <Section id="pins" title={t("studio.pins.current")}>
        <QueryState
          query={pins}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title={t("studio.pins.empty")} />}
        >
          {(rows) => (
            <div className="table-wrap">
              <table className="table" data-table="pins">
                <caption className="visually-hidden">{t("studio.pins.current")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("studio.field.kind")}</th>
                    <th scope="col">{t("studio.field.versionNo")}</th>
                    <th scope="col">{t("studio.pins.pinned")}</th>
                    <th scope="col">{t("studio.pins.pinnedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.kind} data-pin={p.kind}>
                      <th scope="row">{t(`studio.kind.${p.kind}`)}</th>
                      <td>
                        <Link className="link" to={`/admin/studio/versions/${p.versionId}`}>
                          <bdi dir="ltr">
                            {p.key} v{p.versionNo}
                          </bdi>
                        </Link>
                      </td>
                      <td>{p.pinned ? t("studio.pins.yes") : t("studio.pins.notPinned")}</td>
                      <td>
                        {p.pinnedAt ? (
                          formatDateTime(p.pinnedAt, locale)
                        ) : (
                          <span className="muted">{t("common.value.none")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      <Section id="history" title={t("studio.pins.history")}>
        <QueryState
          query={history}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title={t("studio.pins.historyEmpty")} />}
        >
          {(rows) => (
            <div className="table-wrap">
              <table className="table" data-table="pin-history">
                <caption className="visually-hidden">{t("studio.pins.history")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("studio.migration.createdAt")}</th>
                    <th scope="col">{t("studio.field.kind")}</th>
                    <th scope="col">{t("studio.pins.migration")}</th>
                    <th scope="col">{t("studio.pins.by")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <th scope="row">{formatDateTime(h.createdAt, locale)}</th>
                      <td>{t(`studio.kind.${h.kind}`, { defaultValue: h.kind })}</td>
                      <td>
                        <Link className="link" to={`/transformations/${tid}/methodology-migrations/${h.migrationId}`}>
                          {t("studio.pins.openMigration")}
                        </Link>
                      </td>
                      <td>{names(h.createdBy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
    </div>
  );
}
