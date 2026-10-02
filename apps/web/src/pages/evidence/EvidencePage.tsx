// Evidence (REQ-S13-010…013, REQ-DLV-034): upload a file revision, record a note, an external link or a bare
// filename reference; link evidence to P2 records; and review it (verify or reject, with explicit accessibility).
// Only VERIFIED evidence counts toward a gate criterion: a bare filename or an inaccessible link never does, and every
// item that is not verified is labelled Unverified. A new file revision resets verification (server side).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EVIDENCE_TYPES, evidenceCreate, evidenceLinkCreate, evidenceUpdate } from "@mth/shared/schemas";
import { ApiError, api, newIdempotencyKey } from "../../api/client.ts";
import { useCharter, useDecisions, useNorthStar, useP2Refresh, useRegister, useTomCanvas } from "../../api/queries.ts";
import type { Evidence, EvidenceLink } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Dialog, Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { EvidenceStateChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction, NoteDecisionDialog } from "../../components/RowActions.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { diagnosticDimensionLabel, pick, tomDimensionLabel } from "../../lib/methodology.ts";
import { errorMessage } from "../../lib/problem.ts";

/** Upload limit of one revision (apps/api evidence store: 25 MiB); checked before sending, re-checked by the server. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
type Kind = "file" | "note" | "external_link" | "file_reference";
const KINDS: readonly Kind[] = ["file", "note", "external_link", "file_reference"];

export function EvidencePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="evidence"
      title={t("evidence.title")}
      subtitle={t("evidence.intro")}
      writePermissions={["evidence.create", "evidence.review"]}
    >
      <EvidenceRegister />
    </WorkspaceFrame>
  );
}

function EvidenceRegister() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const evidence = useRegister<Evidence>(ws.tid, "evidence");
  const links = useRegister<EvidenceLink>(ws.tid, "evidence-links");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [creating, setCreating] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<Evidence | null>(null);
  const [uploading, setUploading] = useState<Evidence | null>(null);
  const [reviewing, setReviewing] = useState<Evidence | null>(null);
  const [linking, setLinking] = useState<Evidence | null>(null);
  const canCreate = ws.can("evidence.create");
  const canReview = ws.can("evidence.review");
  const base = `/api/v1/transformations/${ws.tid}/evidence`;

  const fieldsFor = (kind: Kind): FieldSpec[] => [
    { name: "title", kind: "text", label: t("evidence.field.title"), required: true, maxLength: 300 },
    { name: "description", kind: "textarea", label: t("common.field.description") },
    {
      name: "evidenceType",
      kind: "select",
      label: t("evidence.field.type"),
      options: EVIDENCE_TYPES.map((e) => ({ value: e, label: t(`evidence.types.${e}`) })),
    },
    { name: "source", kind: "text", label: t("evidence.field.source"), maxLength: 500 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner"), required: true },
    { name: "observationStart", kind: "date", label: t("evidence.field.observationStart") },
    { name: "observationEnd", kind: "date", label: t("evidence.field.observationEnd") },
    ...(kind === "note"
      ? [{ name: "noteBody", kind: "textarea" as const, label: t("evidence.field.noteBody"), required: true, rows: 6 }]
      : []),
    ...(kind === "external_link"
      ? [
          {
            name: "url",
            kind: "url" as const,
            label: t("evidence.field.url"),
            required: true,
            hint: t("evidence.field.urlHint"),
          },
        ]
      : []),
    ...(kind === "file_reference"
      ? [
          {
            name: "fileName",
            kind: "text" as const,
            label: t("evidence.field.fileName"),
            required: true,
            hint: t("evidence.field.fileNameHint"),
            maxLength: 255,
          },
        ]
      : []),
  ];

  const linkCount = (id: string) =>
    (links.data ?? []).filter((l) => l.evidenceId === id && l.status === "active").length;

  const columns: RegisterColumn<Evidence>[] = [
    {
      id: "title",
      header: t("evidence.field.title"),
      cell: (e) => (
        <span id={`ev-${e.id}`}>
          {e.title}
          {e.kind === "file" && e.fileName ? (
            <span className="block small muted">
              <bdi>{e.fileName}</bdi>
            </span>
          ) : null}
        </span>
      ),
      sortValue: (e) => e.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "kind",
      header: t("evidence.field.kind"),
      cell: (e) => t(`evidence.kinds.${e.kind}`),
      sortValue: (e) => e.kind,
    },
    {
      id: "type",
      header: t("evidence.field.type"),
      cell: (e) => t(`evidence.types.${e.evidenceType}`),
      sortValue: (e) => e.evidenceType,
    },
    {
      id: "review",
      header: t("evidence.review.label"),
      cell: (e) => (
        <span>
          <EvidenceStateChip reviewStatus={e.reviewStatus} />
          <span className="block small">{t(`evidence.accessibility.${e.accessibilityStatus}`)}</span>
          {e.kind === "file_reference" ? (
            <span className="block small muted">{t("evidence.review.filenameNeverVerified")}</span>
          ) : null}
          {e.kind === "file" && e.currentContentId === null ? (
            <span className="block small muted">{t("evidence.noContentYet")}</span>
          ) : null}
          {e.reviewedAt ? (
            <span className="block small muted">
              {formatDateTime(e.reviewedAt, locale, ws.tr.timezone)} · <PersonName id={e.reviewedBy} people={byId} />
            </span>
          ) : null}
        </span>
      ),
      sortValue: (e) => e.reviewStatus,
    },
    {
      id: "observation",
      header: t("evidence.field.observation"),
      cell: (e) =>
        e.observationStart || e.observationEnd ? (
          `${formatBusinessDate(e.observationStart, locale) ?? "…"} – ${formatBusinessDate(e.observationEnd, locale) ?? "…"}`
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (e) => e.observationStart,
    },
    { id: "owner", header: t("common.field.owner"), cell: (e) => <PersonName id={e.ownerUserId} people={byId} /> },
    {
      id: "links",
      header: t("evidence.links.title"),
      cell: (e) => <bdi dir="ltr">{linkCount(e.id)}</bdi>,
      sortValue: (e) => linkCount(e.id),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (e) => (
        <span className="row-actions">
          {e.kind === "file" && e.currentContentId ? (
            <a className="button button--link button--small" href={`${base}/${e.id}/content`} download>
              <Icon name="chevronDown" /> {t("evidence.download")}
              <span className="visually-hidden">: {e.title}</span>
            </a>
          ) : null}
          {e.kind === "external_link" && e.url ? (
            <a
              className="button button--link button--small"
              href={e.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("evidence.openLink")}
              <span className="visually-hidden">
                : {e.title} ({t("evidence.opensNewTab")})
              </span>
            </a>
          ) : null}
          {canCreate && e.kind === "file" ? (
            <button type="button" className="button button--link button--small" onClick={() => setUploading(e)}>
              <Icon name="plus" /> {t("evidence.upload.action")}
              <span className="visually-hidden">: {e.title}</span>
            </button>
          ) : null}
          {canCreate ? (
            <>
              <button type="button" className="button button--link button--small" onClick={() => setLinking(e)}>
                <Icon name="plus" /> {t("evidence.links.add")}
                <span className="visually-hidden">: {e.title}</span>
              </button>
              <button type="button" className="button button--link button--small" onClick={() => setEditing(e)}>
                <Icon name="pencil" /> {t("common.action.edit")}
                <span className="visually-hidden">: {e.title}</span>
              </button>
            </>
          ) : null}
          {canReview && e.createdBy !== ws.meId ? (
            <button type="button" className="button button--link button--small" onClick={() => setReviewing(e)}>
              <Icon name="check" /> {t("evidence.review.action")}
              <span className="visually-hidden">: {e.title}</span>
            </button>
          ) : null}
          {canReview && e.createdBy === ws.meId ? (
            <span className="muted small">{t("evidence.review.notOwn")}</span>
          ) : null}
          {canCreate ? (
            <ArchiveAction url={`${base}/${e.id}`} version={e.version} name={e.title} onDone={refresh} />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <Section
        id="evidence"
        title={t("evidence.register")}
        intro={t("evidence.registerIntro")}
        actions={
          canCreate ? (
            <span className="section__actions" role="group" aria-label={t("evidence.add")}>
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => setCreating(k)}
                >
                  <Icon name="plus" /> {t(`evidence.addKind.${k}`)}
                </button>
              ))}
            </span>
          ) : null
        }
      >
        <QueryState query={evidence}>
          {(list) => (
            <RegisterTable
              id="evidence"
              caption={t("evidence.register")}
              rows={list.filter((e) => e.status !== "archived")}
              columns={columns}
              getRowId={(e) => e.id}
              emptyTitle={t("evidence.empty")}
              emptyBody={t("evidence.emptyBody")}
            />
          )}
        </QueryState>
      </Section>
      <LinksSection evidence={evidence.data ?? []} links={links.data ?? []} />

      {creating ? (
        <RecordDialog<Evidence>
          title={t(`evidence.addKind.${creating}`)}
          description={
            creating === "file"
              ? t("evidence.fileCreateNote")
              : creating === "file_reference"
                ? t("evidence.review.filenameNeverVerified")
                : undefined
          }
          fields={fieldsFor(creating)}
          record={null}
          defaults={{ ownerUserId: ws.meId, evidenceType: "document" }}
          extra={{ kind: creating }}
          createSchema={evidenceCreate}
          createUrl={base}
          people={people}
          submitLabel={t("common.action.create")}
          onSaved={async (saved) => {
            await refresh();
            const kind = creating;
            setCreating(null);
            if (kind === "file") setUploading(saved as Evidence);
          }}
          onCancel={() => setCreating(null)}
        />
      ) : null}
      {editing ? (
        <RecordDialog<Evidence>
          title={t("evidence.editTitle")}
          fields={fieldsFor(editing.kind)}
          record={editing}
          updateSchema={evidenceUpdate}
          updateUrl={(r) => `${base}/${r.id}`}
          people={people}
          submitLabel={t("common.action.save")}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {uploading ? <UploadDialog item={uploading} onClose={() => setUploading(null)} /> : null}
      {reviewing ? (
        <NoteDecisionDialog
          title={t("evidence.review.title", { title: reviewing.title })}
          description={
            reviewing.kind === "file_reference"
              ? t("evidence.review.filenameNeverVerified")
              : t("evidence.review.description")
          }
          choiceLabel={t("evidence.review.result")}
          choices={[
            ...(reviewing.kind === "file_reference"
              ? []
              : [{ value: "verified", label: t("evidence.review.state.verified") }]),
            { value: "rejected", label: t("evidence.review.state.rejected") },
          ]}
          extra={{
            label: t("evidence.review.accessibility"),
            choices: [
              { value: "accessible", label: t("evidence.accessibility.accessible") },
              { value: "inaccessible", label: t("evidence.accessibility.inaccessible") },
            ],
          }}
          noteLabel={t("evidence.review.note")}
          noteRequired
          confirmLabel={t("evidence.review.record")}
          url={`${base}/${reviewing.id}/review`}
          version={reviewing.version}
          toBody={({ choice, note, extra }) => ({ result: choice, accessibilityStatus: extra, note })}
          onDone={refresh}
          onClose={() => setReviewing(null)}
        />
      ) : null}
      {linking ? <LinkDialog item={linking} onClose={() => setLinking(null)} /> : null}
    </>
  );
}

/** Uploads one file revision as application/octet-stream with X-File-Name (percent-encoded) and If-Match. */
function UploadDialog({ item, onClose }: { item: Evidence; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setLocalError(t("problems.validation__required"));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(t("problems.evidence__too_large"));
      return;
    }
    setLocalError(undefined);
    setError(null);
    setBusy(true);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/evidence/${item.id}/content`, {
        method: "POST",
        rawBody: file,
        contentType: "application/octet-stream",
        headers: { "X-File-Name": encodeURIComponent(file.name) },
        ifMatch: item.version,
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("evidence.upload.title", { title: item.title })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void upload()} disabled={busy}>
            {busy ? t("evidence.upload.uploading") : t("evidence.upload.confirm")}
          </button>
        </>
      }
    >
      <p>{t("evidence.upload.description")}</p>
      {error ? (
        <p className="banner banner--error" role="alert" data-state="error">
          <Icon name="alert" /> {errorMessage(t, error)}
        </p>
      ) : null}
      <Field label={t("evidence.upload.file")} hint={t("evidence.upload.hint")} error={localError} required>
        {(control) => <input {...control} ref={input} type="file" />}
      </Field>
    </Dialog>
  );
}

const LINK_TYPES = [
  "diagnostic_item",
  "diagnostic_finding",
  "baseline",
  "value_pool",
  "charter",
  "north_star",
  "outcome",
  "kpi_definition",
  "outcome_kpi",
  "strategic_guardrail",
  "tom_canvas_cell",
  "tom_gap",
  "capability",
  "journey",
  "decision",
] as const;
type LinkType = (typeof LINK_TYPES)[number];

/** Candidate records of one type, with readable labels. */
function useLinkCandidates(type: LinkType | ""): { value: string; label: string }[] {
  const locale = useLocale();
  const ws = useWorkspace();
  const resource: Partial<Record<LinkType, string>> = {
    diagnostic_item: "diagnostic-items",
    diagnostic_finding: "diagnostic-findings",
    baseline: "baselines",
    value_pool: "value-pools",
    outcome: "outcomes",
    kpi_definition: "kpi-definitions",
    outcome_kpi: "outcome-kpis",
    strategic_guardrail: "strategic-guardrails",
    tom_gap: "tom-gaps",
    capability: "capability-heatmap",
    journey: "journeys",
  };
  const path = type ? resource[type] : undefined;
  const reg = useRegister<Record<string, unknown>>(ws.tid, path ?? "none", {}, Boolean(path));
  const charter = useCharter(ws.tid);
  const northStar = useNorthStar(ws.tid);
  const canvas = useTomCanvas(ws.tid);
  const decisions = useDecisions(ws.tid, "design");
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (type === "charter")
    return charter.data
      ? [{ value: charter.data.charter.id, label: s(charter.data.charter.transformationName) || ws.tr.name }]
      : [];
  if (type === "north_star")
    return northStar.data ? [{ value: northStar.data.id, label: northStar.data.statement }] : [];
  if (type === "tom_canvas_cell")
    return (canvas.data?.cells ?? []).map((c) => ({
      value: c.cell.id,
      label: pick(locale, c.dimension.labelEn, c.dimension.labelAr),
    }));
  if (type === "decision") return (decisions.data ?? []).map((d) => ({ value: d.id, label: `${d.code} ${d.title}` }));
  return (reg.data ?? [])
    .filter((r) => r["status"] !== "archived")
    .map((r) => {
      const id = s(r["id"]);
      let label =
        s(r["metric"]) || s(r["name"]) || s(r["title"]) || s(r["statement"]) || s(r["gap"]) || s(r["description"]);
      if (type === "diagnostic_item")
        label = diagnosticDimensionLabel(ws.methodology, s(r["dimensionCode"]), locale) ?? label;
      if (type === "tom_gap")
        label = `${tomDimensionLabel(ws.methodology, s(r["dimensionCode"]), locale) ?? ""}: ${label}`;
      return { value: id, label: label || id };
    });
}

function LinkDialog({ item, onClose }: { item: Evidence; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const [type, setType] = useState<LinkType | "">("");
  const [recordId, setRecordId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const candidates = useLinkCandidates(type);
  const save = async () => {
    const parsed = evidenceLinkCreate.safeParse({ evidenceId: item.id, recordType: type, recordId });
    if (!parsed.success) {
      setLocalError({
        ...(type ? {} : { type: t("problems.validation__required") }),
        ...(recordId ? {} : { record: t("problems.validation__required") }),
      });
      return;
    }
    setLocalError({});
    setBusy(true);
    setError(null);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/evidence-links`, {
        method: "POST",
        body: parsed.data,
        idempotencyKey: key.current,
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("evidence.links.addTitle", { title: item.title })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("common.state.saving") : t("evidence.links.add")}
          </button>
        </>
      }
    >
      <p>{t("evidence.links.description")}</p>
      {error ? (
        <p className="banner banner--error" role="alert" data-state="error">
          <Icon name="alert" /> {errorMessage(t, error)}
        </p>
      ) : null}
      <Field label={t("evidence.links.recordType")} error={localError["type"]} required>
        {(control) => (
          <select
            {...control}
            value={type}
            onChange={(e) => {
              setType(e.target.value as LinkType | "");
              setRecordId("");
            }}
          >
            <option value="">{t("common.form.choose")}</option>
            {LINK_TYPES.map((lt) => (
              <option key={lt} value={lt}>
                {t(`evidence.recordTypes.${lt}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("evidence.links.record")} error={localError["record"]} required>
        {(control) => (
          <select {...control} value={recordId} onChange={(e) => setRecordId(e.target.value)} disabled={!type}>
            <option value="">
              {type && candidates.length === 0 ? t("evidence.links.noCandidates") : t("common.form.choose")}
            </option>
            {candidates.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    </Dialog>
  );
}

function LinksSection({ evidence, links }: { evidence: readonly Evidence[]; links: readonly EvidenceLink[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const [removing, setRemoving] = useState<EvidenceLink | null>(null);
  const canCreate = ws.can("evidence.create");
  const active = links.filter((l) => l.status === "active");
  const columns: RegisterColumn<EvidenceLink>[] = [
    {
      id: "evidence",
      header: t("evidence.field.title"),
      cell: (l) => evidence.find((e) => e.id === l.evidenceId)?.title ?? t("evidence.itemNotVisible"),
      sortValue: (l) => evidence.find((e) => e.id === l.evidenceId)?.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "state",
      header: t("evidence.review.label"),
      cell: (l) => (
        <EvidenceStateChip reviewStatus={evidence.find((e) => e.id === l.evidenceId)?.reviewStatus ?? "unverified"} />
      ),
    },
    {
      id: "type",
      header: t("evidence.links.recordType"),
      cell: (l) => t(`evidence.recordTypes.${l.recordType}`),
      sortValue: (l) => l.recordType,
    },
    {
      id: "when",
      header: t("evidence.links.linkedAt"),
      cell: (l) => formatDateTime(l.createdAt, locale, ws.tr.timezone),
      sortValue: (l) => l.createdAt,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (l) =>
        canCreate ? (
          <button type="button" className="button button--link button--small" onClick={() => setRemoving(l)}>
            <Icon name="cross" /> {t("evidence.links.remove")}
          </button>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <Section id="evidence-links" title={t("evidence.links.title")} intro={t("evidence.links.intro")}>
      <RegisterTable
        id="evidence-links"
        caption={t("evidence.links.title")}
        rows={active}
        columns={columns}
        getRowId={(l) => l.id}
        emptyTitle={t("evidence.links.empty")}
      />
      {removing ? (
        <ReasonDialog
          title={t("evidence.links.removeTitle")}
          description={t("evidence.links.removeDescription")}
          confirmLabel={t("evidence.links.remove")}
          onConfirm={async (reason) => {
            await api.send(`/api/v1/transformations/${ws.tid}/evidence-links/${removing.id}/remove`, {
              method: "POST",
              body: { reason },
              ifMatch: removing.version,
            });
            await refresh();
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      <p className="muted small">
        <TextCell value={t("evidence.links.note")} />
      </p>
    </Section>
  );
}
