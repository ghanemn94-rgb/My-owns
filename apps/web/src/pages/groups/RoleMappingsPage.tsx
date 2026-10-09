// Transformations > Role mapping (T-DG4-FE-A; ADR-0026 §2; REQ-S10-008). SYNTHETIC data only.
//  - Each governance role of the methodology (Sponsor, Business Owner, Finance, SteerCo, …) is mapped, per
//    transformation, to one person or one group. Approvals and tasks for that role go to the mapped target.
//  - An UNMAPPED role is shown as a visible routing error: an approval routed to it is refused (422
//    routing.role_unmapped) and nothing is sent. There is never a silent fallback.
//  - role_mapping.assign holders (TL, TO) map and end mappings; everyone who can read the transformation sees the table.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  p4Paths,
  useGovernanceParties,
  useGroups,
  useP4Refresh,
  useRoleMappings,
  type GovernanceParty,
  type RoleMapping,
} from "../../api/p4.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, textOf } from "../my-work/p4ui.tsx";

const NS = ["groups"] as const;

export function RoleMappingsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="role-mappings"
      title={t("groups.roleMappings.title")}
      subtitle={t("groups.roleMappings.intro")}
      writePermissions={["role_mapping.assign"]}
    >
      <Mappings />
    </WorkspaceFrame>
  );
}

/** The localized label of a governance party, with its code. */
export function partyLabel(p: GovernanceParty | undefined, code: string, locale: "ar" | "en"): string {
  if (!p) return code;
  return `${locale === "ar" ? p.labelAr : p.labelEn} (${code})`;
}

interface Row {
  readonly party: GovernanceParty;
  readonly mapping: RoleMapping | null;
}

function Mappings() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const parties = useGovernanceParties();
  const mappings = useRoleMappings(ws.tid, { status: "active" });
  const ended = useRoleMappings(ws.tid, { status: "ended" });
  const refresh = useP4Refresh(ws.tid);
  const canAssign = ws.can("role_mapping.assign");
  const [mapping, setMapping] = useState<GovernanceParty | null>(null);
  const [ending, setEnding] = useState<RoleMapping | null>(null);

  const columns: RegisterColumn<Row>[] = [
    {
      id: "party",
      header: t("groups.roleMappings.party"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block" data-party={r.party.code}>
          {locale === "ar" ? r.party.labelAr : r.party.labelEn}{" "}
          <bdi dir="ltr" className="code small">
            {r.party.code}
          </bdi>
        </span>
      ),
      sortValue: (r) => r.party.ordinal,
      filterText: (r) => `${r.party.code} ${r.party.labelEn} ${r.party.labelAr}`,
    },
    {
      id: "kind",
      header: t("groups.roleMappings.kind"),
      cell: (r) => t(`groups.roleMappings.partyKind.${r.party.kind}`),
      sortValue: (r) => r.party.kind,
    },
    {
      id: "target",
      header: t("groups.roleMappings.target"),
      cell: (r) =>
        r.mapping ? (
          <span className="block" data-mapped="true">
            {r.mapping.targetDisplayName}
            <span className="block small muted">{t(`groups.roleMappings.targetKind.${r.mapping.targetKind}`)}</span>
          </span>
        ) : (
          <span
            className="status-chip status-chip--off-track status-chip--wrap"
            data-mapped="false"
            data-routing-error="party_unmapped"
          >
            <Icon name="alert" /> <span>{t("groups.roleMappings.unmapped")}</span>
          </span>
        ),
      sortValue: (r) => (r.mapping ? 1 : 0),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (r) =>
        !canAssign ? (
          <span className="muted small">{t("common.readOnly")}</span>
        ) : r.mapping ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="end-mapping"
            onClick={() => setEnding(r.mapping)}
          >
            <Icon name="stop" /> {t("groups.roleMappings.end")}
            <span className="visually-hidden">: {r.party.code}</span>
          </button>
        ) : (
          <button
            type="button"
            className="button button--link button--small"
            data-action="map"
            onClick={() => setMapping(r.party)}
          >
            <Icon name="plus" /> {t("groups.roleMappings.map")}
            <span className="visually-hidden">: {r.party.code}</span>
          </button>
        ),
    },
  ];

  return (
    <>
      <Section
        id="role-mappings"
        title={t("groups.roleMappings.listTitle")}
        intro={t("groups.roleMappings.routingRule")}
      >
        <QueryState query={parties}>
          {(ps) => (
            <QueryState query={mappings}>
              {(ms) => {
                const rows: Row[] = ps.map((p) => ({
                  party: p,
                  mapping: ms.find((m) => m.partyCode === p.code) ?? null,
                }));
                const unmapped = rows.filter((r) => !r.mapping).length;
                return (
                  <>
                    {unmapped > 0 ? (
                      <p className="banner banner--warning" role="status" data-state="unmapped-roles">
                        <Icon name="alert" /> {t("groups.roleMappings.unmappedCount", { count: unmapped })}
                      </p>
                    ) : null}
                    <RegisterTable
                      id="p4-role-mappings"
                      caption={t("groups.roleMappings.listTitle")}
                      rows={rows}
                      columns={columns}
                      getRowId={(r) => r.party.code}
                      emptyTitle={t("groups.roleMappings.empty")}
                      defaultSort={{ id: "party", dir: "asc" }}
                      pageSize={25}
                    />
                  </>
                );
              }}
            </QueryState>
          )}
        </QueryState>
      </Section>
      <Section id="ended-mappings" title={t("groups.roleMappings.endedTitle")}>
        <QueryState query={ended}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted">{t("groups.roleMappings.endedEmpty")}</p>
            ) : (
              <ul className="plain-list">
                {rows.map((m) => (
                  <li key={m.id}>
                    <bdi dir="ltr" className="code">
                      {m.partyCode}
                    </bdi>{" "}
                    {m.targetDisplayName} · {m.endedAt ? formatDateTime(m.endedAt, locale, ws.tr.timezone) : null} ·{" "}
                    <TextCell value={m.endReason} />
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </Section>
      {mapping ? <MapDialog party={mapping} onDone={refresh} onClose={() => setMapping(null)} /> : null}
      {ending ? (
        <P4FormDialog
          title={t("groups.roleMappings.endTitle", { party: ending.partyCode })}
          description={<p>{t("groups.roleMappings.endDescription")}</p>}
          fields={[
            { name: "reason", label: t("groups.member.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
          ]}
          submitLabel={t("groups.roleMappings.end")}
          danger
          url={p4Paths.endRoleMapping(ws.tid, ending.id)}
          version={ending.version}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          namespaces={NS}
          onDone={refresh}
          onClose={() => setEnding(null)}
        />
      ) : null}
    </>
  );
}

function MapDialog({
  party,
  onDone,
  onClose,
}: {
  party: GovernanceParty;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const me = useMe();
  const { people } = usePeople(ws.tid);
  const groups = useGroups(me.user.organizationId);
  return (
    <P4FormDialog
      title={t("groups.roleMappings.mapTitle", { party: partyLabel(party, party.code, locale) })}
      description={<p>{t("groups.roleMappings.mapDescription")}</p>}
      fields={[
        {
          name: "targetKind",
          label: t("groups.roleMappings.targetKindLabel"),
          kind: "select",
          required: true,
          options: ["user", "group"].map((k) => ({ value: k, label: t(`groups.roleMappings.targetKind.${k}`) })),
        },
        {
          name: "userId",
          label: t("groups.roleMappings.person"),
          kind: "select",
          required: true,
          options: people.map((p) => ({ value: p.id, label: p.label })),
          when: (v) => v["targetKind"] === "user",
        },
        {
          name: "groupId",
          label: t("groups.roleMappings.group"),
          kind: "select",
          required: true,
          options: (groups.data ?? [])
            .filter((g) => g.status === "active")
            .map((g) => ({ value: g.id, label: `${localName(g, locale)} (${g.code})` })),
          when: (v) => v["targetKind"] === "group",
          hint: t("groups.roleMappings.groupHint"),
        },
      ]}
      initial={{ targetKind: "user" }}
      submitLabel={t("groups.roleMappings.map")}
      url={p4Paths.roleMappings(ws.tid)}
      toBody={(v) => ({
        partyCode: party.code,
        targetKind: v["targetKind"],
        ...(v["targetKind"] === "user" ? { userId: v["userId"] } : { groupId: v["groupId"] }),
      })}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
