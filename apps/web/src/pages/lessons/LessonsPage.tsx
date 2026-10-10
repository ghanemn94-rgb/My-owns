// Lessons (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034 §8). SYNTHETIC data only in tests and demos.
//  - `/transformations/:id/lessons`: the transformation's own lessons: draft (clearly marked: not yet searchable),
//    published, archived; create, edit, publish, archive (lesson.edit).
//  - `/lessons`: REQ-S11-008 "a lesson is searchable from another transformation": full-text search over the
//    PUBLISHED lessons of every transformation in the caller's scope (lesson.search; AUD may search, read-only).
//    Lessons outside the caller's scope are never returned (no existence disclosure: the API decides).
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LESSON_STATUSES } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { useActionRunner } from "../adoption/actions.tsx";
import {
  sustainPaths,
  useLessonSearch,
  useLessons,
  usePerformanceAreas,
  type Lesson,
  type LessonSearchHit,
} from "../bau/api.ts";
import { Code, NS, StatusText, SustainSubNav } from "../bau/ui.tsx";

export function LessonsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="lessons"
      title={t("sustainP4.lessons.title")}
      subtitle={t("sustainP4.lessons.intro")}
      writePermissions={["lesson.edit"]}
    >
      <LessonsBody />
    </WorkspaceFrame>
  );
}

/** Tags as chips (LTR-neutral text). */
function Tags({ tags }: { tags: readonly string[] }) {
  const { t } = useTranslation();
  if (tags.length === 0) return <span className="muted">{t("sustainP4.none")}</span>;
  return (
    <span className="chip-row" data-tags={tags.join(",")}>
      {tags.map((x) => (
        <span key={x} className="badge">
          <bdi>{x}</bdi>
        </span>
      ))}
    </span>
  );
}

function LessonsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const list = useLessons(ws.tid, status ? { status } : {});
  const runner = useActionRunner(ws.tid, NS);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit" | "archive"; row: Lesson } | null>(null);
  const canEdit = ws.can("lesson.edit");
  const columns: RegisterColumn<Lesson>[] = [
    {
      id: "code",
      header: t("sustainP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (l) => <Code>{l.code}</Code>,
      sortValue: (l) => l.code,
    },
    {
      id: "title",
      header: t("sustainP4.lessons.lessonTitle"),
      cell: (l) => <TextCell value={l.title} />,
      sortValue: (l) => l.title,
    },
    { id: "lessonText", header: t("sustainP4.lessons.lessonText"), cell: (l) => <TextCell value={l.lessonText} /> },
    {
      id: "tags",
      header: t("sustainP4.lessons.tags"),
      cell: (l) => <Tags tags={l.tags} />,
      filterText: (l) => l.tags.join(" "),
    },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (l) => (
        <span className="block">
          <StatusText status={l.status} />
          {l.status === "draft" ? (
            <span className="block small muted">{t("sustainP4.lessons.draftNotSearchable")}</span>
          ) : null}
        </span>
      ),
      sortValue: (l) => LESSON_STATUSES.indexOf(l.status),
      filterText: (l) => t(`sustainP4.status.${l.status}`),
    },
    {
      id: "rowActions",
      header: t("sustainP4.col.actions"),
      hideable: false,
      cell: (l) =>
        canEdit && l.status !== "archived" ? (
          <span className="chip-row">
            {l.status === "draft" ? (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={runner.busy !== null}
                onClick={() => void runner.run(l.id, sustainPaths.lessonPublish(ws.tid, l.id), l.version)}
                data-publish={l.code}
              >
                <Icon name="lock" /> {t("sustainP4.lessons.publish")}
                <span className="visually-hidden"> {l.code}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setDialog({ kind: "edit", row: l })}
            >
              <Icon name="pencil" /> {t("sustainP4.edit")}
              <span className="visually-hidden"> {l.code}</span>
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setDialog({ kind: "archive", row: l })}
            >
              <Icon name="archive" /> {t("sustainP4.lessons.archive")}
              <span className="visually-hidden"> {l.code}</span>
            </button>
          </span>
        ) : null,
    },
  ];
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section
        id="lessons"
        title={t("sustainP4.lessons.tableTitle")}
        intro={
          <>
            {t("sustainP4.lessons.tableIntro")}{" "}
            <Link className="link" to="/lessons">
              {t("sustainP4.lessons.openSearch")}
            </Link>
          </>
        }
        actions={
          canEdit ? (
            <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
              <Icon name="plus" /> {t("sustainP4.lessons.create")}
            </button>
          ) : null
        }
      >
        {runner.alert}
        <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
          <div className="filters__select">
            <label htmlFor="lesson-filter-status">{t("sustainP4.col.status")}</label>
            <select id="lesson-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("sustainP4.all")}</option>
              {LESSON_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`sustainP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="lessons"
              caption={t("sustainP4.lessons.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(l) => l.id}
              emptyTitle={t("sustainP4.lessons.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {dialog?.kind === "create" ? <LessonDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <LessonDialog lesson={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "archive" ? <ArchiveDialog lesson={dialog.row} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

const splitTags = (v: string | boolean | undefined): string[] =>
  typeof v === "string"
    ? [
        ...new Set(
          v
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== ""),
        ),
      ]
    : [];

function LessonDialog({ lesson, onClose }: { lesson?: Lesson; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const areas = usePerformanceAreas(ws.tid);
  const fields: P4FieldSpec[] = [
    { name: "title", label: t("sustainP4.lessons.lessonTitle"), kind: "text", required: true, max: 300 },
    { name: "context", label: t("sustainP4.lessons.context"), kind: "textarea", max: 4000 },
    {
      name: "lessonText",
      label: t("sustainP4.lessons.lessonText"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 8000,
    },
    { name: "recommendation", label: t("sustainP4.lessons.recommendation"), kind: "textarea", max: 4000 },
    { name: "tags", label: t("sustainP4.lessons.tags"), kind: "text", hint: t("sustainP4.lessons.tagsHint"), max: 600 },
    {
      name: "performanceAreaId",
      label: t("sustainP4.handover.area"),
      kind: "select",
      options: (areas.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    },
  ];
  const initial: P4Values = lesson
    ? {
        title: lesson.title,
        context: lesson.context ?? "",
        lessonText: lesson.lessonText,
        recommendation: lesson.recommendation ?? "",
        tags: lesson.tags.join(", "),
        performanceAreaId: lesson.performanceAreaId ?? "",
      }
    : {};
  const build = (v: P4Values): Record<string, unknown> => ({
    title: v["title"],
    context: textOf(v["context"]) ?? null,
    lessonText: v["lessonText"],
    recommendation: textOf(v["recommendation"]) ?? null,
    tags: splitTags(v["tags"]),
    performanceAreaId: v["performanceAreaId"] ? v["performanceAreaId"] : null,
  });
  return (
    <P4FormDialog
      title={lesson ? t("sustainP4.lessons.editTitle", { code: lesson.code }) : t("sustainP4.lessons.create")}
      description={
        lesson?.status === "published" ? t("sustainP4.lessons.publishedEditNote") : t("sustainP4.lessons.draftNote")
      }
      fields={fields}
      initial={initial}
      submitLabel={lesson ? t("sustainP4.save") : t("sustainP4.lessons.createSubmit")}
      method={lesson ? "PATCH" : "POST"}
      url={lesson ? sustainPaths.lesson(ws.tid, lesson.id) : sustainPaths.lessons(ws.tid)}
      {...(lesson ? { version: lesson.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if ((body["tags"] as string[]).length > 10) return { fieldErrors: { tags: "validation.too_big" } };
        if (!lesson) {
          const out = Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null));
          if ((out["tags"] as string[]).length === 0) delete out["tags"];
          return out;
        }
        const before = build(initial);
        const patch = Object.fromEntries(
          Object.entries(body).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
        );
        return Object.keys(patch).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function ArchiveDialog({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("sustainP4.lessons.archiveTitle", { code: lesson.code })}
      description={t("sustainP4.lessons.archiveIntro")}
      fields={[]}
      submitLabel={t("sustainP4.lessons.archive")}
      danger
      method="PATCH"
      url={sustainPaths.lesson(ws.tid, lesson.id)}
      version={lesson.version}
      namespaces={NS}
      toBody={() => ({ status: "archived" })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** `/lessons`: search published lessons across transformations in the caller's scope (REQ-S11-008). */
export function LessonSearchPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("sustainP4.search.title"));
  const allowed = canAnywhere(me, "lesson.search");
  const [draft, setDraft] = useState({ q: "", tag: "" });
  const [query, setQuery] = useState<{ q: string; tag: string } | null>(null);
  const results = useLessonSearch(query ?? {}, allowed && query !== null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ q: draft.q.trim(), tag: draft.tag.trim() });
  };
  const columns: RegisterColumn<LessonSearchHit>[] = [
    {
      id: "lesson",
      header: t("sustainP4.lessons.lessonTitle"),
      rowHeader: true,
      hideable: false,
      cell: (h) => (
        <span className="block" data-search-hit={h.lesson.code}>
          <Code>{h.lesson.code}</Code> {h.lesson.title}
        </span>
      ),
      sortValue: (h) => h.lesson.title,
    },
    {
      id: "transformation",
      header: t("sustainP4.search.transformation"),
      cell: (h) => (
        <Link className="link" to={`/transformations/${h.lesson.transformationId}/lessons`}>
          <Code>{h.transformationCode}</Code> {h.transformationName}
        </Link>
      ),
      sortValue: (h) => h.transformationCode,
    },
    {
      id: "lessonText",
      header: t("sustainP4.lessons.lessonText"),
      cell: (h) => <TextCell value={h.lesson.lessonText} />,
    },
    {
      id: "recommendation",
      header: t("sustainP4.lessons.recommendation"),
      cell: (h) => <TextCell value={h.lesson.recommendation} />,
    },
    { id: "tags", header: t("sustainP4.lessons.tags"), cell: (h) => <Tags tags={h.lesson.tags} /> },
    {
      id: "published",
      header: t("sustainP4.search.publishedAt"),
      cell: (h) => formatDateTime(h.lesson.publishedAt, locale) ?? "—",
      sortValue: (h) => h.lesson.publishedAt,
    },
  ];
  if (!allowed)
    return (
      <div className="page" data-page="lessons">
        <NoPermissionState />
      </div>
    );
  return (
    <div className="page" data-page="lessons">
      <PageHeader title={t("sustainP4.search.title")} subtitle={t("sustainP4.search.intro")} />
      <Section id="lesson-search" title={t("sustainP4.search.formTitle")}>
        <form className="filters" role="search" aria-label={t("sustainP4.search.formTitle")} onSubmit={onSubmit}>
          <div className="filters__search">
            <label htmlFor="lesson-q">{t("sustainP4.search.q")}</label>
            <input
              id="lesson-q"
              type="search"
              maxLength={200}
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </div>
          <div className="filters__search">
            <label htmlFor="lesson-tag">{t("sustainP4.search.tag")}</label>
            <input
              id="lesson-tag"
              type="text"
              maxLength={50}
              value={draft.tag}
              onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
            />
          </div>
          <button type="submit" className="button button--primary" data-search-submit>
            {t("sustainP4.search.submit")}
          </button>
        </form>
        <p className="small muted">
          <Icon name="info" /> {t("sustainP4.search.scopeNote")}
        </p>
        {query === null ? (
          <p className="muted">{t("sustainP4.search.prompt")}</p>
        ) : (
          <QueryState query={results}>
            {(rows) => (
              <RegisterTable
                id="lesson-search"
                caption={t("sustainP4.search.resultsTitle")}
                rows={rows}
                columns={columns}
                getRowId={(h) => h.lesson.id}
                emptyTitle={t("sustainP4.search.empty")}
                emptyBody={t("sustainP4.search.emptyBody")}
                defaultSort={{ id: "published", dir: "desc" }}
              />
            )}
          </QueryState>
        )}
      </Section>
    </div>
  );
}
