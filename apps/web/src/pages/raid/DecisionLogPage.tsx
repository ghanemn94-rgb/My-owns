// Risks and Actions > Integrated RAID + decision log (T-DG4-FE-D; p4-work-split §E.5; ADR-0031 §2, REQ-PB-078).
// SYNTHETIC data only. One list of open RAID entries and open design (T04) and executive (T16) decisions, each read
// from its canonical record (`getRaidDecisionLog`): a Dependency is the T08 row, a decision is the shared decision
// model. Nothing here is a copy; each row links to the register that owns it.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate } from "../my-work/p4ui.tsx";
import { useRaidDecisionLog, type RaidDecisionLogItem } from "./api.ts";
import { Code, RaidSubNav } from "./ui.tsx";

function ownerPath(tid: string, item: RaidDecisionLogItem): string {
  if (item.kind === "executive") return `/transformations/${tid}/executive-decisions/${item.id}`;
  if (item.kind === "design") return `/transformations/${tid}/decisions`;
  if (item.kind === "dependency") return `/transformations/${tid}/dependencies`;
  return `/transformations/${tid}/raid`;
}

export function RaidDecisionLogPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="raid" title={t("raidP4.log.title")} subtitle={t("raidP4.log.intro")} writePermissions={[]}>
      <LogBody />
    </WorkspaceFrame>
  );
}

function LogBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const log = useRaidDecisionLog(ws.tid);
  const { byId } = usePeople(ws.tid);
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <Section id="raid-decision-log" title={t("raidP4.log.tableTitle")} intro={t("raidP4.log.tableIntro")}>
        <QueryState query={log}>
          {(rows) => (
            <RegisterTable
              id="raid-decision-log"
              caption={t("raidP4.log.tableTitle")}
              rows={rows}
              getRowId={(r) => `${r.itemKind}:${r.id}`}
              emptyTitle={t("raidP4.log.empty")}
              defaultSort={{ id: "due", dir: "asc" }}
              columns={[
                {
                  id: "item",
                  header: t("raidP4.log.col.item"),
                  rowHeader: true,
                  hideable: false,
                  cell: (r) => (
                    <Link className="link" to={ownerPath(ws.tid, r)} data-log-item={r.code}>
                      <Code>{r.code}</Code> {r.title}
                    </Link>
                  ),
                  sortValue: (r) => r.code,
                  filterText: (r) => `${r.code} ${r.title}`,
                },
                {
                  id: "kind",
                  header: t("raidP4.log.col.kind"),
                  cell: (r) => <span data-kind={r.kind}>{t(`raidP4.log.kind.${r.kind}`)}</span>,
                  sortValue: (r) => r.kind,
                  filterText: (r) => t(`raidP4.log.kind.${r.kind}`),
                },
                {
                  id: "owner",
                  header: t("raidP4.col.owner"),
                  cell: (r) => <PersonName id={r.ownerUserId} people={byId} />,
                },
                {
                  id: "due",
                  header: t("raidP4.col.due"),
                  cell: (r) =>
                    r.dueDate ? <DueDate date={r.dueDate} /> : <span className="muted">{t("raidP4.noDueDate")}</span>,
                  sortValue: (r) => r.dueDate,
                },
                {
                  id: "status",
                  header: t("raidP4.col.status"),
                  cell: (r) => t(`raidP4.status.${r.status}`, { defaultValue: r.status.replace(/_/g, " ") }),
                  sortValue: (r) => r.status,
                },
              ]}
            />
          )}
        </QueryState>
      </Section>
    </>
  );
}
