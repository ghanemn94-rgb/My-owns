// The 90-day launch plan of a transformation (T-DG5-FE-F; REQ-PB-086, REQ-S14-004; ADR-0048 §1-§3).
//  - No plan yet (404): the B0133/B0134 template (three windows, their objective, actions and outputs) and, for a holder
//    of launch_plan.edit, "Generate the plan" from a chosen start date (day d = start + d calendar days, D-142 Q6).
//  - The plan: its start date and progress; changing the start date re-dates every task not started (and an open
//    Day-90 test) by the same number of days and leaves completed tasks unchanged (the last shift is shown).
//  - Tasks by window, with dates (a non-working day is a warning, never a silent shift), owner, status, required output,
//    predecessors and "Blocked by" while a predecessor is incomplete. Owners, dates, status and predecessors are edited
//    here; a custom task can be added to a window.
// The B0134 texts are rendered verbatim from the seeded rows; the Arabic texts are provisional translations.
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  LAUNCH_TASK_STATUSES,
  type LaunchPlan,
  type LaunchTask,
  type LaunchTaskStatus,
  type LaunchWindow,
} from "@mth/shared/schemas";
import { ApiError } from "../../api/client.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { useTransformationTarget } from "../transformations/common.tsx";
import { Chip, StatusChip, type ChipTone } from "../automation/ui.tsx";
import type { IconName } from "../../components/Icon.tsx";
import { launchPaths, useLaunchPlan, useLaunchRefresh, useLaunchTasks, useLaunchTemplate } from "./api.ts";
import { ProvisionalTranslationNote, TransformationPicker, todayRiyadh, useFefRunner } from "./ui.tsx";

const TASK_STATUS: Record<LaunchTaskStatus, readonly [ChipTone, IconName]> = {
  not_started: ["neutral", "dot"],
  in_progress: ["warn", "clock"],
  completed: ["good", "check"],
  cancelled: ["closed", "stop"],
};

/** Navigation entry (Playbook and Procedures > 90-day launch plan): choose a transformation. */
export function LaunchPlanEntryPage() {
  const { t } = useTranslation();
  usePageTitle(t("launchHealthP5.launch.title"));
  return (
    <div className="page" data-p5-screen="launch-plan-entry">
      <PageHeader title={t("launchHealthP5.launch.title")} subtitle={t("launchHealthP5.launch.intro")} />
      <TransformationPicker segment="launch-plan" title={t("launchHealthP5.entry.chooseLaunch")} />
    </div>
  );
}

export function LaunchPlanPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("launchHealthP5.launch.title"));
  const transformation = useTransformation(id);
  const plan = useLaunchPlan(id);
  const noPlan = plan.isError && plan.error instanceof ApiError && plan.error.status === 404;
  return (
    <div className="page" data-p5-screen="launch-plan">
      <PageHeader
        title={t("launchHealthP5.launch.title")}
        subtitle={t("launchHealthP5.launch.intro")}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: t("launchHealthP5.launch.title") },
        ]}
      />
      <ProvisionalTranslationNote />
      {transformation.isError ? (
        <NoPermissionState error={transformation.error} />
      ) : noPlan ? (
        <NoPlan tid={id} />
      ) : (
        <QueryState query={plan}>{(p) => <PlanView tid={id} plan={p} />}</QueryState>
      )}
    </div>
  );
}

function useMayEdit(tid: string): boolean {
  const me = useMe();
  const transformation = useTransformation(tid);
  const target = useTransformationTarget(transformation.data);
  return target ? canOn(me, "launch_plan.edit", target) : false;
}

function windowLabel(w: LaunchWindow, locale: string) {
  return locale === "ar" ? w.labelAr : w.labelEn;
}

function NoPlan({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const template = useLaunchTemplate();
  const mayEdit = useMayEdit(tid);
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const [startDate, setStartDate] = useState(todayRiyadh());
  return (
    <>
      <section className="card" aria-labelledby="no-plan" data-state="no-plan">
        <h2 id="no-plan" className="card__title">
          {t("launchHealthP5.launch.noPlan")}
        </h2>
        <p>{t("launchHealthP5.launch.noPlanBody")}</p>
        {mayEdit ? (
          <form
            className="form form--inset"
            noValidate
            data-form="generate-plan"
            onSubmit={(e) => {
              e.preventDefault();
              void runner.run(launchPaths.plan(tid), { body: { startDate } });
            }}
          >
            {runner.alert}
            <div className="field">
              <label className="field__label" htmlFor="plan-start">
                {t("launchHealthP5.launch.startDate")}
              </label>
              <input
                id="plan-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span className="field__hint">{t("launchHealthP5.launch.calendarDays")}</span>
            </div>
            <div className="form__actions">
              <button type="submit" className="button button--primary" disabled={runner.busy || !startDate}>
                {t("launchHealthP5.launch.generate")}
              </button>
            </div>
          </form>
        ) : (
          <ReadOnlyNote />
        )}
      </section>
      <QueryState query={template}>
        {(tpl) => (
          <Section
            id="template"
            title={t("launchHealthP5.launch.templateTitle")}
            intro={t("launchHealthP5.launch.templateIntro")}
          >
            {tpl.windows.map((w) => (
              <article key={w.code} className="card" data-window={w.code}>
                <h3 className="card__title">{windowLabel(w, locale)}</h3>
                <p>
                  <strong>{t("launchHealthP5.launch.objective")}</strong>:{" "}
                  {locale === "ar" ? w.objectiveAr : w.objectiveEn}
                </p>
                <ul className="plain-list">
                  {w.items.map((i) => (
                    <li key={i.code} data-item={i.code}>
                      <span className="lifecycle-chip lifecycle-chip--draft">
                        {t(`launchHealthP5.launch.kind.${i.itemKind}`)}
                      </span>{" "}
                      {locale === "ar" ? i.textAr : i.textEn}{" "}
                      <span className="small muted">
                        ({t("launchHealthP5.launch.dayRange", { from: i.startDay, to: i.dueDay })})
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </Section>
        )}
      </QueryState>
    </>
  );
}

function PlanView({ tid, plan }: { tid: string; plan: LaunchPlan }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const mayEdit = useMayEdit(tid);
  const template = useLaunchTemplate();
  const tasks = useLaunchTasks(tid, true);
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const [startDate, setStartDate] = useState(plan.startDate);
  const [statusFilter, setStatusFilter] = useState<"" | LaunchTaskStatus>("");
  const [editing, setEditing] = useState<string | null>(null);
  const windows = useMemo(() => template.data?.windows ?? [], [template.data]);
  const textAr = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of windows) for (const i of w.items) m.set(i.code, i.textAr);
    return m;
  }, [windows]);
  const titleOf = (task: Pick<LaunchTask, "title" | "templateItemCode">) =>
    locale === "ar" && task.templateItemCode ? (textAr.get(task.templateItemCode) ?? task.title) : task.title;

  return (
    <>
      <section className="card" aria-labelledby="plan-facts" data-plan={plan.id}>
        <h2 id="plan-facts" className="card__title">
          {t("launchHealthP5.launch.planTitle")}
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("launchHealthP5.launch.startDate")}</dt>
          <dd data-start-date={plan.startDate}>{formatBusinessDate(plan.startDate, locale)}</dd>
          <dt>{t("launchHealthP5.launch.progress")}</dt>
          <dd data-progress={`${plan.completedCount}/${plan.taskCount}`}>
            {t("launchHealthP5.launch.progressValue", { done: plan.completedCount, total: plan.taskCount })}
          </dd>
          <dt>{t("launchHealthP5.launch.lastShift")}</dt>
          <dd data-last-shift={plan.lastShiftDays ?? ""}>
            {plan.lastShiftDays === null
              ? t("launchHealthP5.launch.noShift")
              : t("launchHealthP5.launch.shiftDays", { days: plan.lastShiftDays })}
          </dd>
          <dt>{t("launchHealthP5.launch.generatedVia")}</dt>
          <dd>{t(`launchHealthP5.launch.via.${plan.generatedVia}`)}</dd>
        </dl>
        <p>
          <Link className="link" to={`/transformations/${tid}/day-90-test`}>
            {t("launchHealthP5.day90.title")}
          </Link>
        </p>
        {mayEdit ? (
          <form
            className="form form--inset"
            noValidate
            data-form="redate-plan"
            onSubmit={(e) => {
              e.preventDefault();
              void runner.run(launchPaths.plan(tid), { method: "PATCH", body: { startDate }, ifMatch: plan.version });
            }}
          >
            {runner.alert}
            <div className="field">
              <label className="field__label" htmlFor="plan-redate">
                {t("launchHealthP5.launch.changeStart")}
              </label>
              <input id="plan-redate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <span className="field__hint">{t("launchHealthP5.launch.redateHint")}</span>
            </div>
            <div className="form__actions">
              <button
                type="submit"
                className="button"
                disabled={runner.busy || !startDate || startDate === plan.startDate}
              >
                {t("launchHealthP5.launch.redate")}
              </button>
            </div>
          </form>
        ) : (
          <ReadOnlyNote />
        )}
      </section>
      <QueryState query={tasks}>
        {(all) => {
          const sorted = [...all].sort((a, b) => a.ordinal - b.ordinal);
          const shown = statusFilter ? sorted.filter((x) => x.status === statusFilter) : sorted;
          const codes = windows.length > 0 ? windows.map((w) => w.code) : [...new Set(sorted.map((x) => x.windowCode))];
          const editingTask = sorted.find((x) => x.id === editing) ?? null;
          return (
            <>
              <div className="toolbar" role="group" aria-label={t("launchHealthP5.launch.filters")}>
                <label className="field__label" htmlFor="task-status-filter">
                  {t("launchHealthP5.field.status")}
                </label>{" "}
                <select
                  id="task-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "" | LaunchTaskStatus)}
                >
                  <option value="">{t("launchHealthP5.launch.allStatuses")}</option>
                  {LAUNCH_TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`launchHealthP5.launch.status.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              {codes.map((code) => {
                const w = windows.find((x) => x.code === code);
                const rows = shown.filter((x) => x.windowCode === code);
                const title = w ? windowLabel(w, locale) : t(`launchHealthP5.launch.window.${code}`);
                return (
                  <Section
                    key={code}
                    id={`window-${code}`}
                    title={title}
                    intro={w ? (locale === "ar" ? w.objectiveAr : w.objectiveEn) : undefined}
                  >
                    {rows.length === 0 ? (
                      <p className="muted">{t("launchHealthP5.launch.noTasks")}</p>
                    ) : (
                      <TaskTable
                        tid={tid}
                        rows={rows}
                        all={sorted}
                        titleOf={titleOf}
                        mayEdit={mayEdit}
                        onEdit={setEditing}
                        caption={title}
                      />
                    )}
                  </Section>
                );
              })}
              {mayEdit && editingTask ? (
                <TaskEditor
                  key={`${editingTask.id}:${editingTask.version}`}
                  tid={tid}
                  task={editingTask}
                  all={sorted}
                  titleOf={titleOf}
                  onClose={() => setEditing(null)}
                />
              ) : null}
              {mayEdit ? <AddTask tid={tid} windows={windows} /> : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function TaskTable({
  tid,
  rows,
  all,
  titleOf,
  mayEdit,
  onEdit,
  caption,
}: {
  tid: string;
  rows: readonly LaunchTask[];
  all: readonly LaunchTask[];
  titleOf: (task: Pick<LaunchTask, "title" | "templateItemCode">) => string;
  mayEdit: boolean;
  onEdit: (id: string) => void;
  caption: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const people = usePeople(tid);
  // A predecessor's title in the reader's language (the reference carries the stored, English title).
  const refTitle = (b: { taskId: string; title: string }) => {
    const task = all.find((x) => x.id === b.taskId);
    return task ? titleOf(task) : b.title;
  };
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table" data-table="launch-tasks">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t("launchHealthP5.launch.task")}</th>
            <th scope="col">{t("launchHealthP5.launch.start")}</th>
            <th scope="col">{t("launchHealthP5.launch.due")}</th>
            <th scope="col">{t("launchHealthP5.launch.owner")}</th>
            <th scope="col">{t("launchHealthP5.field.status")}</th>
            <th scope="col">{t("launchHealthP5.launch.dependencies")}</th>
            <th scope="col">{t("launchHealthP5.launch.output")}</th>
            {mayEdit ? <th scope="col">{t("launchHealthP5.actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((task) => (
            <tr key={task.id} data-task={task.templateItemCode ?? task.id} data-task-status={task.status}>
              <td>{task.ordinal}</td>
              <th scope="row">
                <span className="lifecycle-chip lifecycle-chip--draft">
                  {t(`launchHealthP5.launch.kind.${task.taskKind}`)}
                </span>{" "}
                {task.taskKind === "day_ninety_test" ? (
                  <Link className="link" to={`/transformations/${tid}/day-90-test`}>
                    {titleOf(task)}
                  </Link>
                ) : (
                  titleOf(task)
                )}
                {task.notes ? <span className="block small muted">{task.notes}</span> : null}
              </th>
              <td data-start={task.startDate}>{formatBusinessDate(task.startDate, locale)}</td>
              <td data-due={task.dueDate}>
                {formatBusinessDate(task.dueDate, locale)}
                {task.nonWorkingDay ? (
                  <span className="block">
                    <Chip
                      tone="warn"
                      icon="alert"
                      label={t("launchHealthP5.launch.nonWorkingDay")}
                      data="non-working-day"
                    />
                  </span>
                ) : null}
              </td>
              <td>
                {task.ownerUserId
                  ? (people.byId.get(task.ownerUserId)?.label ?? t("common.value.notVisible"))
                  : t("common.value.notAssigned")}
              </td>
              <td>
                <StatusChip value={task.status} table={TASK_STATUS} labelKey="launchHealthP5.launch.status" />
              </td>
              <td>
                {task.blockedBy.length > 0 ? (
                  <span
                    className="status-chip status-chip--at-risk status-chip--wrap"
                    data-blocked-by={task.blockedBy.map((b) => b.ordinal).join(",")}
                  >
                    <Icon name="lock" />{" "}
                    <span>
                      {t("launchHealthP5.launch.blockedBy", {
                        tasks: task.blockedBy.map((b) => `#${b.ordinal} ${refTitle(b)}`).join("; "),
                      })}
                    </span>
                  </span>
                ) : task.predecessors.length > 0 ? (
                  <span className="small">
                    {t("launchHealthP5.launch.after", {
                      tasks: task.predecessors.map((b) => `#${b.ordinal}`).join(", "),
                    })}
                  </span>
                ) : (
                  <span className="muted">{t("launchHealthP5.launch.noDependencies")}</span>
                )}
              </td>
              <td>
                {task.outputRecordType ? (
                  <span>
                    {t(`launchHealthP5.launch.outputType.${task.outputRecordType}`)}
                    <span className="block small muted">
                      {task.outputRecordId
                        ? t("launchHealthP5.launch.outputLinked")
                        : t("launchHealthP5.launch.outputMissing")}
                    </span>
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              {mayEdit ? (
                <td>
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => onEdit(task.id)}
                    disabled={task.status === "cancelled"}
                  >
                    {t("launchHealthP5.edit")}
                    <span className="visually-hidden"> #{task.ordinal}</span>
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskEditor({
  tid,
  task,
  all,
  titleOf,
  onClose,
}: {
  tid: string;
  task: LaunchTask;
  all: readonly LaunchTask[];
  titleOf: (task: Pick<LaunchTask, "title" | "templateItemCode">) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const people = usePeople(tid);
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const preds = useFefRunner(refresh);
  const [status, setStatus] = useState<LaunchTaskStatus>(task.status);
  const [owner, setOwner] = useState(task.ownerUserId ?? "");
  const [start, setStart] = useState(task.startDate);
  const [due, setDue] = useState(task.dueDate);
  const [chosen, setChosen] = useState<string[]>(task.predecessors.map((p) => p.taskId));
  const save = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (status !== task.status) body["status"] = status;
    if ((owner || null) !== task.ownerUserId) body["ownerUserId"] = owner || null;
    if (start !== task.startDate) body["startDate"] = start;
    if (due !== task.dueDate) body["dueDate"] = due;
    if (Object.keys(body).length === 0) return;
    void runner.run(launchPaths.task(tid, task.id), { method: "PATCH", body, ifMatch: task.version });
  };
  return (
    <Section id="edit-task" title={t("launchHealthP5.launch.editTask", { n: task.ordinal })} intro={titleOf(task)}>
      <form className="form form--inset" noValidate data-form="edit-task" onSubmit={save}>
        {runner.alert}
        <div className="field">
          <label className="field__label" htmlFor="task-status">
            {t("launchHealthP5.field.status")}
          </label>
          <select id="task-status" value={status} onChange={(e) => setStatus(e.target.value as LaunchTaskStatus)}>
            {LAUNCH_TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`launchHealthP5.launch.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="task-owner">
            {t("launchHealthP5.launch.owner")}
          </label>
          <select id="task-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t("common.value.notAssigned")}</option>
            {people.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="task-start">
            {t("launchHealthP5.launch.start")}
          </label>
          <input id="task-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="task-due">
            {t("launchHealthP5.launch.due")}
          </label>
          <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("launchHealthP5.launch.saveTask")}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {t("launchHealthP5.close")}
          </button>
        </div>
      </form>
      <form
        className="form form--inset"
        noValidate
        data-form="task-predecessors"
        onSubmit={(e) => {
          e.preventDefault();
          void preds.run(launchPaths.predecessors(tid, task.id), {
            method: "PUT",
            body: { predecessorTaskIds: chosen },
            ifMatch: task.version,
          });
        }}
      >
        {preds.alert}
        <fieldset className="field">
          <legend className="field__label">{t("launchHealthP5.launch.predecessors")}</legend>
          <div
            className="checkbox-list"
            role="group"
            tabIndex={0}
            aria-label={t("launchHealthP5.launch.predecessors")}
            style={{ maxHeight: "16rem", overflowY: "auto" }}
          >
            {all
              .filter((x) => x.id !== task.id && x.status !== "cancelled")
              .map((x) => (
                <label key={x.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={chosen.includes(x.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, x.id] : c.filter((y) => y !== x.id)))}
                  />{" "}
                  #{x.ordinal} {titleOf(x)}
                </label>
              ))}
          </div>
        </fieldset>
        <div className="form__actions">
          <button type="submit" className="button" disabled={preds.busy}>
            {t("launchHealthP5.launch.savePredecessors")}
          </button>
        </div>
      </form>
    </Section>
  );
}

function AddTask({ tid, windows }: { tid: string; windows: readonly LaunchWindow[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const [windowCode, setWindowCode] = useState(windows[0]?.code ?? "days_0_30");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(todayRiyadh());
  const [due, setDue] = useState(todayRiyadh());
  return (
    <Section id="add-task" title={t("launchHealthP5.launch.addTask")} intro={t("launchHealthP5.launch.addTaskIntro")}>
      <form
        className="form form--inset"
        noValidate
        data-form="add-task"
        onSubmit={(e) => {
          e.preventDefault();
          void runner
            .run(launchPaths.tasks(tid), { body: { windowCode, title: title.trim(), startDate: start, dueDate: due } })
            .then((r) => {
              if (r) setTitle("");
            });
        }}
      >
        {runner.alert}
        <div className="field">
          <label className="field__label" htmlFor="new-task-window">
            {t("launchHealthP5.launch.windowLabel")}
          </label>
          <select
            id="new-task-window"
            value={windowCode}
            onChange={(e) => setWindowCode(e.target.value as typeof windowCode)}
          >
            {windows.map((w) => (
              <option key={w.code} value={w.code}>
                {windowLabel(w, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="new-task-title">
            {t("launchHealthP5.launch.task")}
          </label>
          <input id="new-task-title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="new-task-start">
            {t("launchHealthP5.launch.start")}
          </label>
          <input id="new-task-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="new-task-due">
            {t("launchHealthP5.launch.due")}
          </label>
          <input id="new-task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="form__actions">
          <button type="submit" className="button" disabled={runner.busy || title.trim() === ""}>
            {t("launchHealthP5.launch.addTaskSubmit")}
          </button>
        </div>
      </form>
    </Section>
  );
}
