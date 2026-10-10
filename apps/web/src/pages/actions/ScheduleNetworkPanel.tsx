// The schedule network and the critical path of the transformation, shown on an initiative page (T-DG4-FE-D2;
// p4-work-split §E.5, E.8 item 8; ADR-0031 §8-§11; REQ-S09-009 UI half). SYNTHETIC data only in tests and demos.
//  - Computed (`status: "computed"`): the project duration, the critical paths (codes in path order), and per
//    initiative its duration, earliest/latest start and finish, total float and "Critical" / "Not critical" (label and
//    icon, never colour alone); per dependency whether it is critical.
//  - Not computable (`missing_durations`, `no_initiatives`, `cycle`): the reason and the initiatives without a
//    duration. NOTHING is styled or labelled critical then: no critical column, no offsets, no path (E.8 item 8: "the
//    UI must not highlight anything then").
//  - The initiative's own planned duration (working days): recorded with createInitiativeSchedule and changed with
//    updateInitiativeSchedule (`roadmap.edit`; TL, WL, TO). The network read carries no record version, so the panel
//    sends the version it learned from its own create/update answers, from a 409's `currentVersion`, or the create
//    version 1. A stale version answers 409: nothing is saved, the network is re-read and the dialog shows the current
//    value before the user saves again (never a silent retry). Contract need: a version on `ScheduleNode` or a GET of
//    the schedule (handback §5).
//  - The AUD user (no `roadmap.edit`) sees the panel read-only.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { initiativeScheduleCreate } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { BLANK_CODE, Dialog, Field, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { FormAlert, textOf } from "../my-work/p4ui.tsx";
import {
  EXECUTION_NS,
  executionPaths,
  useScheduleNetwork,
  type InitiativeSchedule,
  type ScheduleNetwork,
} from "./executionApi.ts";

type Node = ScheduleNetwork["nodes"][number];
type Edge = ScheduleNetwork["edges"][number];

export function ScheduleNetworkPanel({ initiativeId }: { initiativeId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const query = useScheduleNetwork(ws.tid);
  return (
    <Section id="schedule-network" title={t("executionP4.network.title")} intro={t("executionP4.network.intro")}>
      <QueryState query={query}>{(n) => <NetworkBody network={n} initiativeId={initiativeId} />}</QueryState>
    </Section>
  );
}

function NetworkBody({ network: n, initiativeId }: { network: ScheduleNetwork; initiativeId: string }) {
  const { t } = useTranslation();
  const computed = n.status === "computed";
  const codeOf = new Map(n.nodes.map((x) => [x.initiativeId, x.code] as const));
  return (
    <div data-network-status={n.status} data-network-reason={n.reason ?? ""}>
      <OwnDuration network={n} initiativeId={initiativeId} />
      {computed ? (
        <p className="banner banner--info" role="note" data-state="network-computed">
          <Icon name="info" /> {t("executionP4.network.computed", { n: n.projectDurationWorkingDays ?? 0 })}
        </p>
      ) : (
        <div className="banner banner--warning" role="note" data-state="network-not-computable">
          <p>
            <Icon name="question" /> <strong>{t("executionP4.network.notComputable")}</strong>
          </p>
          {n.reason ? <p data-reason={n.reason}>{t(`executionP4.network.reason.${n.reason}`)}</p> : null}
        </div>
      )}
      {!computed && n.missingDurations.length > 0 ? (
        <>
          <h3>{t("executionP4.network.missingTitle")}</h3>
          <ul className="plain-list" data-missing-durations={n.missingDurations.length}>
            {n.missingDurations.map((m) => (
              <li key={m.initiativeId} data-missing={m.code}>
                <InitiativeLink
                  id={m.initiativeId}
                  code={m.code}
                  name={m.name}
                  current={m.initiativeId === initiativeId}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {computed && n.criticalPaths.length > 0 ? (
        <>
          <h3>{t("executionP4.network.paths")}</h3>
          <ol className="plain-list" data-critical-paths={n.criticalPaths.length}>
            {n.criticalPaths.map((path, i) => (
              <li key={path.join(">")} data-critical-path={path.map((id) => codeOf.get(id) ?? id).join(">")}>
                <span className="visually-hidden">{t("executionP4.network.pathLabel", { n: i + 1 })}: </span>
                <Icon name="alert" />{" "}
                <bdi dir="ltr" className="code">
                  {path.map((id) => codeOf.get(id) ?? id).join(" → ")}
                </bdi>
              </li>
            ))}
          </ol>
          {n.truncated ? <p className="small">{t("executionP4.network.truncated")}</p> : null}
        </>
      ) : null}
      <NodesTable network={n} initiativeId={initiativeId} />
      <EdgesTable network={n} />
    </div>
  );
}

function InitiativeLink({ id, code, name, current }: { id: string; code: string; name: string; current: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <>
      <Link className="link" to={`/transformations/${ws.tid}/initiatives/${id}`}>
        <bdi dir="ltr" className="code">
          {code}
        </bdi>{" "}
        {name}
      </Link>
      {current ? (
        <span className="small muted" data-this-initiative>
          {" "}
          ({t("executionP4.network.thisInitiative")})
        </span>
      ) : null}
    </>
  );
}

/** A working-day offset or float of a computed network (never shown when the network is not computable). */
const offset = (v: number | null) => (v === null ? <Unknown /> : <span data-offset={v}>{v}</span>);

function NodesTable({ network: n, initiativeId }: { network: ScheduleNetwork; initiativeId: string }) {
  const { t } = useTranslation();
  const computed = n.status === "computed";
  const base: RegisterColumn<Node>[] = [
    {
      id: "initiative",
      header: t("executionP4.network.col.initiative"),
      cell: (x) => (
        <InitiativeLink id={x.initiativeId} code={x.code} name={x.name} current={x.initiativeId === initiativeId} />
      ),
      sortValue: (x) => x.code,
      filterText: (x) => `${x.code} ${x.name}`,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "duration",
      header: t("executionP4.network.col.duration"),
      cell: (x) =>
        x.durationWorkingDays === null ? (
          <span data-duration="none">
            <Unknown hint={t("executionP4.network.noDuration")} />
          </span>
        ) : (
          <span data-duration={x.durationWorkingDays}>{x.durationWorkingDays}</span>
        ),
      sortValue: (x) => x.durationWorkingDays,
    },
  ];
  // E.8 item 8: the critical column and the offsets exist only for a computed network (critical first, so it stays
  // visible on narrow screens).
  const computedColumns: RegisterColumn<Node>[] = computed
    ? [
        {
          id: "critical",
          header: t("executionP4.network.col.critical"),
          cell: (x) => <CriticalLabel value={x.critical} />,
          sortValue: (x) => (x.critical === null ? null : x.critical ? 0 : 1),
          filterText: (x) =>
            x.critical === null
              ? ""
              : x.critical
                ? t("executionP4.network.critical")
                : t("executionP4.network.notCritical"),
        },
        ...(
          [
            ["es", "earliestStart"],
            ["ef", "earliestFinish"],
            ["ls", "latestStart"],
            ["lf", "latestFinish"],
            ["float", "totalFloat"],
          ] as const
        ).map(
          ([id, key]): RegisterColumn<Node> => ({
            id,
            header: t(`executionP4.network.col.${id}`),
            cell: (x) => offset(x[key]),
            sortValue: (x) => x[key],
          }),
        ),
      ]
    : [];
  return (
    <>
      <h3>{t("executionP4.network.nodesTitle")}</h3>
      {computed ? <p className="small muted">{t("executionP4.network.offsetsNote")}</p> : null}
      <RegisterTable
        id={computed ? "schedule-nodes" : "schedule-nodes-not-computable"}
        caption={t("executionP4.network.nodesTitle")}
        rows={n.nodes}
        columns={[...base, ...computedColumns]}
        getRowId={(x) => x.initiativeId}
        emptyTitle={t("executionP4.network.reason.no_initiatives")}
        defaultSort={{ id: computed ? "es" : "initiative", dir: "asc" }}
      />
    </>
  );
}

/** "Critical" (label + icon) / "Not critical": only rendered for a computed network; null stays Unknown. */
function CriticalLabel({ value }: { value: boolean | null }) {
  const { t } = useTranslation();
  if (value === null) return <Unknown />;
  return value ? (
    <span className="lifecycle-chip" data-critical="true">
      <Icon name="alert" /> {t("executionP4.network.critical")}
    </span>
  ) : (
    <span data-critical="false">{t("executionP4.network.notCritical")}</span>
  );
}

function EdgesTable({ network: n }: { network: ScheduleNetwork }) {
  const { t } = useTranslation();
  const computed = n.status === "computed";
  const codeOf = new Map(n.nodes.map((x) => [x.initiativeId, x.code] as const));
  const code = (id: string) => (
    <bdi dir="ltr" className="code">
      {codeOf.get(id) ?? id}
    </bdi>
  );
  const columns: RegisterColumn<Edge>[] = [
    {
      id: "dependency",
      header: t("executionP4.network.col.dependency"),
      cell: (e) => (
        <bdi dir="ltr" className="code">
          {e.code}
        </bdi>
      ),
      sortValue: (e) => e.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "from",
      header: t("executionP4.network.col.from"),
      cell: (e) => code(e.fromInitiativeId),
      sortValue: (e) => codeOf.get(e.fromInitiativeId),
    },
    {
      id: "to",
      header: t("executionP4.network.col.to"),
      cell: (e) => code(e.toInitiativeId),
      sortValue: (e) => codeOf.get(e.toInitiativeId),
    },
    ...(computed
      ? [
          {
            id: "critical",
            header: t("executionP4.network.col.critical"),
            cell: (e: Edge) => <CriticalLabel value={e.critical} />,
            sortValue: (e: Edge) => (e.critical === null ? null : e.critical ? 0 : 1),
          } satisfies RegisterColumn<Edge>,
        ]
      : []),
  ];
  return (
    <>
      <h3>{t("executionP4.network.edgesTitle")}</h3>
      <RegisterTable
        id={computed ? "schedule-edges" : "schedule-edges-not-computable"}
        caption={t("executionP4.network.edgesTitle")}
        rows={n.edges}
        columns={columns}
        getRowId={(e) => e.dependencyId}
        emptyTitle={t("executionP4.network.noEdges")}
        defaultSort={{ id: "dependency", dir: "asc" }}
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ own duration

function OwnDuration({ network: n, initiativeId }: { network: ScheduleNetwork; initiativeId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const node = n.nodes.find((x) => x.initiativeId === initiativeId) ?? null;
  // What this panel knows about the schedule row: whether one exists and the version to send as If-Match.
  const [known, setKnown] = useState<{ exists: boolean; version: number | null }>({ exists: false, version: null });
  const [open, setOpen] = useState(false);
  const duration = node?.durationWorkingDays ?? null;
  const exists = known.exists || duration !== null;
  const canEdit = ws.can("roadmap.edit");
  return (
    <div className="own-duration" data-own-duration={duration ?? "none"}>
      <h3>{t("executionP4.network.duration.title")}</h3>
      <p>
        {duration === null ? (
          <>
            <Unknown hint={t("executionP4.network.noDuration")} /> {t("executionP4.network.duration.none")}
          </>
        ) : (
          t("executionP4.network.duration.current", { n: duration })
        )}{" "}
        {canEdit && node ? (
          <button
            type="button"
            className="button button--secondary button--small"
            data-action={exists ? "change-duration" : "set-duration"}
            onClick={() => setOpen(true)}
          >
            {exists ? t("executionP4.network.duration.change") : t("executionP4.network.duration.set")}
          </button>
        ) : null}
      </p>
      {canEdit ? null : (
        <p className="banner banner--info" role="note" data-state="panel-read-only">
          <Icon name="lock" /> {t("executionP4.readOnly")}
        </p>
      )}
      {open ? (
        <DurationDialog
          initiativeId={initiativeId}
          current={duration}
          exists={exists}
          version={known.version ?? 1}
          versionKnown={known.version !== null}
          onLearned={(next) =>
            setKnown((k) => ({ exists: next.exists ?? k.exists, version: next.version ?? k.version }))
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

const DURATION_INPUT = /^\d{1,4}$/;

function DurationDialog({
  initiativeId,
  current,
  exists,
  version,
  versionKnown,
  onLearned,
  onClose,
}: {
  initiativeId: string;
  /** The duration of the latest network read (updates after a 409 re-read). */
  current: number | null;
  exists: boolean;
  version: number;
  versionKnown: boolean;
  onLearned: (next: { exists?: boolean; version?: number }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);

  const submit = async () => {
    setServerError(null);
    const s = value.trim();
    if (s !== "" && (!DURATION_INPUT.test(s) || Number(s) > 2600)) {
      setFieldError("validation.duration_working_days");
      focusInvalid();
      return;
    }
    if (note !== "" && !textOf(note)) {
      setFieldError(BLANK_CODE);
      focusInvalid();
      return;
    }
    const durationWorkingDays = s === "" ? null : Number(s);
    const body: Record<string, unknown> = { durationWorkingDays };
    if (textOf(note)) body["note"] = note;
    if (!exists && !initiativeScheduleCreate.safeParse(body).success) {
      setFieldError("validation.duration_working_days");
      focusInvalid();
      return;
    }
    setFieldError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const saved = await api.send<InitiativeSchedule>(executionPaths.schedule(initiativeId), {
        method: exists ? "PATCH" : "POST",
        body,
        ...(exists ? { ifMatch: version } : {}),
      });
      if (action.stale()) return;
      onLearned({ exists: true, version: saved.version });
      if (!(await refresh())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
      if (e instanceof ApiError && e.status === 409) {
        // Nothing was saved. A stale version tells the current one; an existing row switches the dialog to a change.
        if (e.code === "initiative_schedule.exists") onLearned({ exists: true });
        else if (e.currentVersion !== null) onLearned({ exists: true, version: e.currentVersion });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldText = fieldError
    ? fieldError === "validation.duration_working_days"
      ? t("executionP4.network.duration.fieldHint")
      : fieldErrorMessage(t, fieldError)
    : undefined;

  return (
    <Dialog
      title={exists ? t("executionP4.network.duration.changeTitle") : t("executionP4.network.duration.setTitle")}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            data-action="submit"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? t("common.state.saving") : t("common.action.save")}
          </button>
        </>
      }
    >
      <p data-current-duration={current ?? "none"}>
        {current === null
          ? t("executionP4.network.duration.none")
          : t("executionP4.network.duration.current", { n: current })}
      </p>
      {exists && !versionKnown ? (
        <p className="small muted" data-version-baseline={version}>
          {t("executionP4.network.duration.versionUnknown", { version })}
        </p>
      ) : null}
      <FormAlert error={serverError} namespaces={EXECUTION_NS} />
      <Field
        label={t("executionP4.network.duration.field")}
        hint={t("executionP4.network.duration.fieldHint")}
        error={fieldError && fieldError !== BLANK_CODE ? fieldText : undefined}
      >
        {(control) => (
          <input
            {...control}
            type="number"
            inputMode="numeric"
            min={0}
            max={2600}
            step={1}
            dir="ltr"
            data-field="durationWorkingDays"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("executionP4.network.duration.note")} error={fieldError === BLANK_CODE ? fieldText : undefined}>
        {(control) => (
          <textarea
            {...control}
            rows={2}
            maxLength={2000}
            data-field="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
