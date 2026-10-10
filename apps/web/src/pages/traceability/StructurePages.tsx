// Portfolios and workstreams (T-DG4-FE-G2; p4-work-split §J+K JK.7; ADR-0038 §9-§12; BE-M3; REQ-S03-001).
// SYNTHETIC data only in tests and demos.
//  - A portfolio groups transformations of one organization; a transformation sits in at most one active portfolio
//    (422 portfolio.transformation_already_placed). A portfolio's membership list shows only the transformations the
//    caller may read (the server filters; BE-M3 §2.3). Writes need `portfolio.manage` at organization level (a
//    business-unit-scoped Transformation Office user gets 403, shown translated).
//  - A workstream groups initiatives inside one transformation, coded WS-nn by the server; an initiative sits in at
//    most one active workstream (422 workstream.initiative_already_assigned). Writes need `workstream.manage`.
//  - Archived portfolios and workstreams are read-only (422); memberships are removed with a reason and never deleted.
//  Neither grants access and neither is a business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useP4KeyRefresh, useP4Refresh } from "../../api/p4.ts";
import { useAllUsers } from "../../api/queries.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { isNoPermission } from "../../lib/problem.ts";
import { P4FormDialog, ReadOnlyNote, textOf, useUserNames, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  portfolioKeys,
  tracePaths,
  useInitiativeOptions,
  usePortfolio,
  usePortfolios,
  usePortfolioTransformations,
  useReadableTransformations,
  useWorkstream,
  useWorkstreamInitiatives,
  useWorkstreams,
  type Portfolio,
  type PortfolioTransformation,
  type Workstream,
  type WorkstreamInitiative,
} from "./api.ts";
import { NS, ReasonAction, StatusTag, TraceSubNav } from "./ui.tsx";

const Code = ({ children }: { children: string }) => (
  <bdi dir="ltr" className="code">
    {children}
  </bdi>
);

function StructureStatus({ status }: { status: "active" | "archived" | "removed" }) {
  const { t } = useTranslation();
  return (
    <StatusTag tone={status === "active" ? "ok" : "info"}>{t(`traceability.structure.status.${status}`)}</StatusTag>
  );
}

/** Edit fields shared by portfolios and workstreams; `status: archived` needs a reason (ADR-0038 §9). */
function archiveFields(t: (k: string) => string): P4FieldSpec[] {
  return [
    { name: "archive", label: t("traceability.structure.archive"), kind: "checkbox" },
    {
      name: "archiveReason",
      label: t("traceability.structure.archiveReason"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 1000,
      when: (v) => v["archive"] === true,
    },
  ];
}

/** The PATCH body of an edit: only changed fields; an archive adds `status` and its reason. */
function patchOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  v: P4Values,
): Record<string, unknown> | { fieldErrors: Record<string, string> } {
  const patch: Record<string, unknown> = Object.fromEntries(
    Object.entries(after).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
  );
  if (v["archive"] === true) {
    patch["status"] = "archived";
    patch["archiveReason"] = v["archiveReason"];
  }
  return Object.keys(patch).length === 0 ? { fieldErrors: { name: "validation.empty_patch" } } : patch;
}

// ------------------------------------------------------------------------------------------------ workstreams

export function WorkstreamsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="workstreams"
      title={t("traceability.workstreams.title")}
      subtitle={t("traceability.workstreams.intro")}
      writePermissions={["workstream.manage"]}
    >
      <WorkstreamsBody />
    </WorkspaceFrame>
  );
}

function WorkstreamsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = useWorkstreams(ws.tid, includeArchived);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; row: Workstream } | null>(null);
  const canManage = ws.can("workstream.manage");
  const columns: RegisterColumn<Workstream>[] = [
    {
      id: "code",
      header: t("traceability.structure.code"),
      rowHeader: true,
      hideable: false,
      cell: (w) => (
        <Link className="link" to={`/transformations/${ws.tid}/workstreams/${w.id}`} data-workstream={w.code}>
          <Code>{w.code}</Code>
        </Link>
      ),
      sortValue: (w) => w.id,
      filterText: (w) => w.code,
    },
    { id: "name", header: t("traceability.structure.name"), cell: (w) => w.name, sortValue: (w) => w.name },
    {
      id: "lead",
      header: t("traceability.workstreams.lead"),
      cell: (w) =>
        w.leadUserId ? (
          <PersonName id={w.leadUserId} people={byId} />
        ) : (
          <span className="muted">{t("common.value.notAssigned")}</span>
        ),
    },
    {
      id: "status",
      header: t("traceability.col.status"),
      cell: (w) => <StructureStatus status={w.status} />,
      sortValue: (w) => w.status,
      filterText: (w) => t(`traceability.structure.status.${w.status}`),
    },
    {
      id: "rowActions",
      header: t("traceability.col.actions"),
      hideable: false,
      cell: (w) => (
        <span className="chip-row">
          <Link className="link" to={`/transformations/${ws.tid}/workstreams/${w.id}/dashboard`}>
            {t("traceability.workstreams.dashboard")}
            <span className="visually-hidden"> {w.code}</span>
          </Link>
          {canManage && w.status === "active" ? (
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="edit-workstream"
              onClick={() => setDialog({ kind: "edit", row: w })}
            >
              <Icon name="pencil" /> {t("traceability.edit")}
              <span className="visually-hidden"> {w.code}</span>
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <TraceSubNav tid={ws.tid} />
      <Section
        id="workstreams"
        title={t("traceability.workstreams.tableTitle")}
        actions={
          canManage ? (
            <button
              type="button"
              className="button button--primary"
              data-action="create-workstream"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Icon name="plus" /> {t("traceability.workstreams.create")}
            </button>
          ) : null
        }
      >
        <label className="checkbox">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />{" "}
          {t("traceability.structure.includeArchived")}
        </label>
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="workstreams"
              caption={t("traceability.workstreams.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(w) => w.id}
              emptyTitle={t("traceability.workstreams.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {dialog?.kind === "create" ? <WorkstreamDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <WorkstreamDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function WorkstreamDialog({ row, onClose }: { row?: Workstream; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const fields: P4FieldSpec[] = [
    { name: "name", label: t("traceability.structure.name"), kind: "text", required: true, max: 300 },
    { name: "description", label: t("traceability.structure.description"), kind: "textarea", max: 4000 },
    {
      name: "leadUserId",
      label: t("traceability.workstreams.lead"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    ...(row ? archiveFields(t) : []),
  ];
  const initial: P4Values = row
    ? { name: row.name, description: row.description ?? "", leadUserId: row.leadUserId ?? "", archive: false }
    : {};
  const build = (v: P4Values) => ({
    name: v["name"],
    description: textOf(v["description"]) ?? null,
    leadUserId: v["leadUserId"] ? v["leadUserId"] : null,
  });
  return (
    <P4FormDialog
      title={row ? t("traceability.workstreams.editTitle", { code: row.code }) : t("traceability.workstreams.create")}
      note={row ? null : <p className="small muted">{t("traceability.workstreams.codeNote")}</p>}
      fields={fields}
      initial={initial}
      submitLabel={row ? t("traceability.save") : t("traceability.workstreams.createSubmit")}
      method={row ? "PATCH" : "POST"}
      url={row ? tracePaths.workstream(ws.tid, row.id) : tracePaths.workstreams(ws.tid)}
      {...(row ? { version: row.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!row) return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null));
        return patchOf(build(initial), body, v);
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

export function WorkstreamPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="workstreams"
      title={t("traceability.workstreams.detailTitle")}
      writePermissions={["workstream.manage"]}
    >
      <WorkstreamBody />
    </WorkspaceFrame>
  );
}

function WorkstreamBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { workstreamId = "" } = useParams();
  const one = useWorkstream(ws.tid, workstreamId);
  const refresh = useP4Refresh(ws.tid);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const members = useWorkstreamInitiatives(ws.tid, workstreamId, includeRemoved);
  const initiatives = useInitiativeOptions(ws.tid);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkstreamInitiative | null>(null);
  const [editing, setEditing] = useState<Workstream | null>(null);
  return (
    <>
      <TraceSubNav tid={ws.tid} />
      <QueryState query={one}>
        {(w) => {
          const writable = ws.can("workstream.manage") && w.status === "active";
          const columns: RegisterColumn<WorkstreamInitiative>[] = [
            {
              id: "initiative",
              header: t("traceability.workstreams.initiative"),
              rowHeader: true,
              hideable: false,
              cell: (m) => (
                <Link className="link" to={`/transformations/${ws.tid}/initiatives/${m.initiativeId}`}>
                  <Code>{m.initiativeCode}</Code> {m.initiativeName}
                </Link>
              ),
              sortValue: (m) => m.initiativeCode,
              filterText: (m) => `${m.initiativeCode} ${m.initiativeName}`,
            },
            {
              id: "status",
              header: t("traceability.col.status"),
              cell: (m) => (
                <span className="block">
                  <StructureStatus status={m.status} />
                  {m.removeReason ? <span className="block small">{m.removeReason}</span> : null}
                </span>
              ),
              sortValue: (m) => m.status,
            },
            {
              id: "rowActions",
              header: t("traceability.col.actions"),
              hideable: false,
              cell: (m) =>
                writable && m.status === "active" ? (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    data-action="remove-initiative"
                    onClick={() => setRemoving(m)}
                  >
                    <Icon name="archive" /> {t("traceability.structure.remove")}
                    <span className="visually-hidden"> {m.initiativeCode}</span>
                  </button>
                ) : null,
            },
          ];
          return (
            <>
              <Section
                id="workstream-detail"
                title={`${w.code} · ${w.name}`}
                actions={
                  <span className="chip-row">
                    <Link className="link" to={`/transformations/${ws.tid}/workstreams/${w.id}/dashboard`}>
                      {t("traceability.workstreams.dashboard")}
                    </Link>
                    {writable ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        data-action="edit-workstream"
                        onClick={() => setEditing(w)}
                      >
                        <Icon name="pencil" /> {t("traceability.edit")}
                      </button>
                    ) : null}
                  </span>
                }
              >
                <p data-workstream-code={w.code}>
                  <StructureStatus status={w.status} /> <TextCell value={w.description} />
                </p>
                {w.status === "archived" ? (
                  <ReadOnlyNote
                    body={t("traceability.structure.archivedReadOnly", { reason: w.archiveReason ?? "" })}
                  />
                ) : null}
              </Section>
              <Section
                id="workstream-initiatives"
                title={t("traceability.workstreams.initiatives")}
                intro={t("traceability.workstreams.oneWorkstream")}
                actions={
                  writable ? (
                    <button
                      type="button"
                      className="button button--primary"
                      data-action="add-initiative"
                      onClick={() => setAdding(true)}
                    >
                      <Icon name="plus" /> {t("traceability.workstreams.addInitiative")}
                    </button>
                  ) : null
                }
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={includeRemoved}
                    onChange={(e) => setIncludeRemoved(e.target.checked)}
                  />{" "}
                  {t("traceability.structure.includeRemoved")}
                </label>
                <QueryState query={members}>
                  {(rows) => (
                    <RegisterTable
                      id="workstream-initiatives"
                      caption={t("traceability.workstreams.initiatives")}
                      rows={rows}
                      columns={columns}
                      getRowId={(m) => m.id}
                      emptyTitle={t("traceability.workstreams.noInitiatives")}
                    />
                  )}
                </QueryState>
              </Section>
              {editing ? <WorkstreamDialog row={editing} onClose={() => setEditing(null)} /> : null}
              {adding ? (
                <P4FormDialog
                  title={t("traceability.workstreams.addInitiative")}
                  fields={[
                    {
                      name: "initiativeId",
                      label: t("traceability.workstreams.initiative"),
                      kind: "select",
                      required: true,
                      options: (initiatives.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })),
                    },
                  ]}
                  submitLabel={t("traceability.workstreams.addSubmit")}
                  method="POST"
                  url={tracePaths.workstreamInitiatives(ws.tid, w.id)}
                  namespaces={NS}
                  toBody={(v) => ({ initiativeId: v["initiativeId"] })}
                  onDone={refresh}
                  onClose={() => setAdding(false)}
                />
              ) : null}
              {removing ? (
                <ReasonAction
                  title={t("traceability.workstreams.removeTitle", { code: removing.initiativeCode })}
                  description={t("traceability.structure.removeBody")}
                  submitLabel={t("traceability.structure.remove")}
                  url={tracePaths.removeWorkstreamInitiative(ws.tid, w.id, removing.id)}
                  version={removing.version}
                  onDone={refresh}
                  onClose={() => setRemoving(null)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ portfolios

function useOrgPeople(): { id: string; label: string }[] {
  const me = useMe();
  const canRead = canAnywhere(me, "user.read");
  const users = useAllUsers(me.user.organizationId, canRead);
  if (!canRead) return [{ id: me.user.id, label: me.user.displayName }];
  return (users.data ?? []).filter((u) => u.status === "active").map((u) => ({ id: u.id, label: u.displayName }));
}

/** `portfolio.manage` is decided on the organization target (BE-M3 §2.3 item 1). UI hint only. */
function useCanManagePortfolios(): boolean {
  const me = useMe();
  return canOn(me, "portfolio.manage", { level: "organization", organizationId: me.user.organizationId });
}

export function PortfoliosPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("traceability.portfolios.title"));
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = usePortfolios(me.user.organizationId, includeArchived);
  const canManage = useCanManagePortfolios();
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; row: Portfolio } | null>(null);
  const nameOf = useUserNames((list.data ?? []).map((p) => p.ownerUserId));
  if (list.isError && isNoPermission(list.error))
    return (
      <div className="page">
        <NoPermissionState error={list.error} />
      </div>
    );
  const columns: RegisterColumn<Portfolio>[] = [
    {
      id: "code",
      header: t("traceability.structure.code"),
      rowHeader: true,
      hideable: false,
      cell: (p) => (
        <Link className="link" to={`/portfolios/${p.id}`} data-portfolio={p.code}>
          <Code>{p.code}</Code>
        </Link>
      ),
      sortValue: (p) => p.code,
    },
    { id: "name", header: t("traceability.structure.name"), cell: (p) => p.name, sortValue: (p) => p.name },
    {
      id: "owner",
      header: t("traceability.portfolios.owner"),
      cell: (p) =>
        p.ownerUserId ? nameOf(p.ownerUserId) : <span className="muted">{t("common.value.notAssigned")}</span>,
    },
    {
      id: "status",
      header: t("traceability.col.status"),
      cell: (p) => <StructureStatus status={p.status} />,
      sortValue: (p) => p.status,
      filterText: (p) => t(`traceability.structure.status.${p.status}`),
    },
    {
      id: "rowActions",
      header: t("traceability.col.actions"),
      hideable: false,
      cell: (p) =>
        canManage && p.status === "active" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            data-action="edit-portfolio"
            onClick={() => setDialog({ kind: "edit", row: p })}
          >
            <Icon name="pencil" /> {t("traceability.edit")}
            <span className="visually-hidden"> {p.code}</span>
          </button>
        ) : null,
    },
  ];
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: t("traceability.portfolios.title") }]}
        title={t("traceability.portfolios.title")}
        subtitle={t("traceability.portfolios.intro")}
        actions={
          canManage ? (
            <button
              type="button"
              className="button button--primary"
              data-action="create-portfolio"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Icon name="plus" /> {t("traceability.portfolios.create")}
            </button>
          ) : null
        }
      />
      {!canManage ? <ReadOnlyNote body={t("traceability.portfolios.readOnly")} /> : null}
      <Section id="portfolios" title={t("traceability.portfolios.tableTitle")}>
        <label className="checkbox">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />{" "}
          {t("traceability.structure.includeArchived")}
        </label>
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="portfolios"
              caption={t("traceability.portfolios.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(p) => p.id}
              emptyTitle={t("traceability.portfolios.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {dialog?.kind === "create" ? <PortfolioDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <PortfolioDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function PortfolioDialog({ row, onClose }: { row?: Portfolio; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const refresh = useP4KeyRefresh();
  const people = useOrgPeople();
  const fields: P4FieldSpec[] = [
    {
      name: "code",
      label: t("traceability.structure.code"),
      hint: t("traceability.portfolios.codeHint"),
      kind: "text",
      required: true,
      max: 40,
      ltr: true,
    },
    { name: "name", label: t("traceability.structure.name"), kind: "text", required: true, max: 300 },
    { name: "description", label: t("traceability.structure.description"), kind: "textarea", max: 4000 },
    {
      name: "ownerUserId",
      label: t("traceability.portfolios.owner"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    ...(row ? archiveFields(t) : []),
  ];
  const initial: P4Values = row
    ? {
        code: row.code,
        name: row.name,
        description: row.description ?? "",
        ownerUserId: row.ownerUserId ?? "",
        archive: false,
      }
    : {};
  const build = (v: P4Values) => ({
    code: v["code"],
    name: v["name"],
    description: textOf(v["description"]) ?? null,
    ownerUserId: v["ownerUserId"] ? v["ownerUserId"] : null,
  });
  return (
    <P4FormDialog
      title={row ? t("traceability.portfolios.editTitle", { code: row.code }) : t("traceability.portfolios.create")}
      fields={fields}
      initial={initial}
      submitLabel={row ? t("traceability.save") : t("traceability.portfolios.createSubmit")}
      method={row ? "PATCH" : "POST"}
      url={row ? tracePaths.portfolio(row.id) : tracePaths.portfolios(me.user.organizationId)}
      {...(row ? { version: row.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!row) return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null));
        return patchOf(build(initial), body, v);
      }}
      onDone={() => refresh(portfolioKeys.list(me.user.organizationId))}
      onClose={onClose}
    />
  );
}

export function PortfolioDetailPage() {
  const { t } = useTranslation();
  const me = useMe();
  const orgId = me.user.organizationId;
  const { portfolioId = "" } = useParams();
  const one = usePortfolio(orgId, portfolioId);
  usePageTitle(
    one.data ? `${one.data.code} · ${t("traceability.portfolios.title")}` : t("traceability.portfolios.title"),
  );
  const canManage = useCanManagePortfolios();
  const refresh = useP4KeyRefresh();
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const members = usePortfolioTransformations(orgId, portfolioId, includeRemoved);
  const readable = useReadableTransformations(orgId, canManage);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Portfolio | null>(null);
  const [removing, setRemoving] = useState<PortfolioTransformation | null>(null);
  const done = () => refresh(portfolioKeys.list(orgId));
  if (one.isError && isNoPermission(one.error))
    return (
      <div className="page">
        <NoPermissionState error={one.error} />
      </div>
    );
  return (
    <div className="page">
      <QueryState query={one}>
        {(p) => {
          const writable = canManage && p.status === "active";
          const columns: RegisterColumn<PortfolioTransformation>[] = [
            {
              id: "transformation",
              header: t("traceability.portfolios.transformation"),
              rowHeader: true,
              hideable: false,
              cell: (m) => (
                <Link className="link" to={`/transformations/${m.transformationId}`}>
                  <Code>{m.transformationCode}</Code> {m.transformationName}
                </Link>
              ),
              sortValue: (m) => m.transformationCode,
              filterText: (m) => `${m.transformationCode} ${m.transformationName}`,
            },
            {
              id: "status",
              header: t("traceability.col.status"),
              cell: (m) => (
                <span className="block">
                  <StructureStatus status={m.status} />
                  {m.removeReason ? <span className="block small">{m.removeReason}</span> : null}
                </span>
              ),
              sortValue: (m) => m.status,
            },
            {
              id: "rowActions",
              header: t("traceability.col.actions"),
              hideable: false,
              cell: (m) =>
                writable && m.status === "active" ? (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    data-action="remove-transformation"
                    onClick={() => setRemoving(m)}
                  >
                    <Icon name="archive" /> {t("traceability.structure.remove")}
                    <span className="visually-hidden"> {m.transformationCode}</span>
                  </button>
                ) : null,
            },
          ];
          return (
            <>
              <PageHeader
                crumbs={[{ label: t("traceability.portfolios.title"), to: "/portfolios" }, { label: p.code }]}
                title={`${p.code} · ${p.name}`}
                subtitle={<StructureStatus status={p.status} />}
                actions={
                  writable ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      data-action="edit-portfolio"
                      onClick={() => setEditing(p)}
                    >
                      <Icon name="pencil" /> {t("traceability.edit")}
                    </button>
                  ) : null
                }
              />
              {p.status === "archived" ? (
                <ReadOnlyNote body={t("traceability.structure.archivedReadOnly", { reason: p.archiveReason ?? "" })} />
              ) : null}
              <Section id="portfolio-about" title={t("traceability.structure.description")}>
                <TextCell value={p.description} />
              </Section>
              <Section
                id="portfolio-transformations"
                title={t("traceability.portfolios.transformations")}
                intro={t("traceability.portfolios.membersIntro")}
                actions={
                  writable ? (
                    <button
                      type="button"
                      className="button button--primary"
                      data-action="add-transformation"
                      onClick={() => setAdding(true)}
                    >
                      <Icon name="plus" /> {t("traceability.portfolios.addTransformation")}
                    </button>
                  ) : null
                }
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={includeRemoved}
                    onChange={(e) => setIncludeRemoved(e.target.checked)}
                  />{" "}
                  {t("traceability.structure.includeRemoved")}
                </label>
                <QueryState query={members}>
                  {(rows) => (
                    <RegisterTable
                      id="portfolio-transformations"
                      caption={t("traceability.portfolios.transformations")}
                      rows={rows}
                      columns={columns}
                      getRowId={(m) => m.id}
                      emptyTitle={t("traceability.portfolios.noMembers")}
                    />
                  )}
                </QueryState>
              </Section>
              {editing ? <PortfolioDialog row={editing} onClose={() => setEditing(null)} /> : null}
              {adding ? (
                <P4FormDialog
                  title={t("traceability.portfolios.addTransformation")}
                  description={t("traceability.portfolios.onePortfolio")}
                  fields={[
                    {
                      name: "transformationId",
                      label: t("traceability.portfolios.transformation"),
                      kind: "select",
                      required: true,
                      options: (readable.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                    },
                  ]}
                  submitLabel={t("traceability.portfolios.addSubmit")}
                  method="POST"
                  url={tracePaths.portfolioTransformations(p.id)}
                  namespaces={NS}
                  toBody={(v) => ({ transformationId: v["transformationId"] })}
                  onDone={done}
                  onClose={() => setAdding(false)}
                />
              ) : null}
              {removing ? (
                <ReasonAction
                  title={t("traceability.portfolios.removeTitle", { code: removing.transformationCode })}
                  description={t("traceability.structure.removeBody")}
                  submitLabel={t("traceability.structure.remove")}
                  url={tracePaths.removePortfolioTransformation(p.id, removing.id)}
                  version={removing.version}
                  onDone={done}
                  onClose={() => setRemoving(null)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
