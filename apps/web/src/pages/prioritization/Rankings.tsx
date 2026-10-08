// Ranking snapshots and history (REQ-S09-005; ADR-0022 §4). A snapshot is a PROPOSED ranking: it never selects and
// never funds. Cause labels are rendered by the web from the cause CODES and their detail (never the server's English
// `causeLabels`): 'weight version {n}', 'score change ({criteria})', 'override: {reason}', new, relative, removed.
import type { RankingEntry, RankingOverride, RankingSnapshot } from "@mth/shared/schemas";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, Field, isBlankText } from "../../components/Form.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { prioritizationUrls, useRankingHistory, useRankingSnapshot, useRankingSnapshots } from "./api.ts";
import { FormAlert, TableRegion, codeText, p3ErrorMessage, useDecimal } from "./p3ui.tsx";

/** The translated cause labels of one ranking entry. */
export function causeTexts(
  t: TFunction,
  entry: Pick<RankingEntry, "causes" | "causeDetail" | "overrideId">,
  overrides: readonly RankingOverride[],
): string[] {
  const detail = entry.causeDetail as {
    weightSetVersionNo?: number;
    changedCriteria?: string[];
    overrideId?: string;
  };
  return entry.causes.map((c) => {
    if (c === "weight") return t("prioritization.cause.weight", { n: detail.weightSetVersionNo ?? "?" });
    if (c === "score")
      return t("prioritization.cause.score", {
        criteria: (detail.changedCriteria ?? [])
          .map((x) => t(`prioritization.criterion.${x}`, { defaultValue: x }))
          .join(t("prioritization.shared.listSeparator")),
      });
    if (c === "override") {
      const id = entry.overrideId ?? detail.overrideId;
      const o = overrides.find((x) => x.id === id);
      return o ? t("prioritization.cause.override", { reason: o.reason }) : t("prioritization.cause.overrideNoReason");
    }
    return t(`prioritization.cause.${c}`);
  });
}

export function RankingsSection({
  names,
  overrides,
}: {
  names: ReadonlyMap<string, { code: string; name: string }>;
  overrides: readonly RankingOverride[];
}) {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const locale = useLocale();
  const snapshots = useRankingSnapshots(tid);
  const history = useRankingHistory(tid);
  const [creating, setCreating] = useState(false);
  const refresh = useP3Refresh(tid);
  const label = (id: string) => {
    const n = names.get(id);
    return n ? `${n.code} · ${n.name}` : t("common.value.notVisible");
  };

  return (
    <Section
      id="rankings"
      title={t("prioritization.rankings.title")}
      intro={t("prioritization.rankings.intro")}
      actions={
        can("prioritization.edit") ? (
          <button type="button" className="button button--secondary" onClick={() => setCreating(true)}>
            {t("prioritization.rankings.create")}
          </button>
        ) : null
      }
    >
      <QueryState query={snapshots}>
        {(items) => {
          const current = items.find((s) => s.status === "current") ?? null;
          return current ? (
            <CurrentSnapshot snapshot={current} label={label} overrides={overrides} />
          ) : (
            <EmptyState title={t("prioritization.rankings.noneTitle")} body={t("prioritization.rankings.noneBody")} />
          );
        }}
      </QueryState>
      <h3>{t("prioritization.rankings.historyTitle")}</h3>
      <QueryState query={history}>
        {(changes) =>
          changes.length === 0 ? (
            <p className="muted">{t("prioritization.rankings.historyEmpty")}</p>
          ) : (
            <TableRegion label={t("prioritization.rankings.historyCaption")}>
              <table className="table table--compact" data-testid="ranking-history">
                <caption>{t("prioritization.rankings.historyCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("prioritization.rankings.snapshot")}</th>
                    <th scope="col">{t("prioritization.rankings.when")}</th>
                    <th scope="col">{t("prioritization.ranked.initiative")}</th>
                    <th scope="col">{t("prioritization.rankings.previousRank")}</th>
                    <th scope="col">{t("prioritization.ranked.rank")}</th>
                    <th scope="col">{t("prioritization.rankings.causes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={`${c.snapshotNo}-${c.entry.initiativeId}-${i}`}>
                      <td>{t("prioritization.rankings.snapshotN", { n: c.snapshotNo })}</td>
                      <td>{formatDateTime(c.proposedAt, locale)}</td>
                      <td>{label(c.entry.initiativeId)}</td>
                      <td>{c.entry.previousRank ?? <span className="muted">—</span>}</td>
                      <td>
                        {c.entry.rank ?? (
                          <span className="muted">
                            {c.entry.completeness === "removed"
                              ? t("prioritization.cause.removed")
                              : t("prioritization.ranked.unranked")}
                          </span>
                        )}
                      </td>
                      <td>
                        <ul className="plain-list" data-testid="causes">
                          {causeTexts(t, c.entry, overrides).map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )
        }
      </QueryState>
      {creating ? (
        <CreateSnapshotDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            if (!(await refresh())) return;
            setCreating(false);
          }}
        />
      ) : null}
    </Section>
  );
}

function CurrentSnapshot({
  snapshot,
  label,
  overrides,
}: {
  snapshot: RankingSnapshot;
  label: (id: string) => string;
  overrides: readonly RankingOverride[];
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const locale = useLocale();
  const fmt = useDecimal();
  const view = useRankingSnapshot(tid, snapshot.snapshotNo);
  return (
    <>
      <p>
        <strong>
          {t("prioritization.rankings.current", { n: snapshot.snapshotNo, v: snapshot.weightSetVersionNo })}
        </strong>{" "}
        <span className="muted">{formatDateTime(snapshot.proposedAt, locale)}</span>
      </p>
      <QueryState query={view}>
        {(v) => (
          <TableRegion label={t("prioritization.rankings.currentCaption")}>
            <table className="table table--compact" data-testid="current-ranking">
              <caption>{t("prioritization.rankings.currentCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("prioritization.ranked.rank")}</th>
                  <th scope="col">{t("prioritization.ranked.initiative")}</th>
                  <th scope="col">{t("prioritization.ranked.score")}</th>
                  <th scope="col">{t("prioritization.rankings.previousRank")}</th>
                  <th scope="col">{t("prioritization.rankings.causes")}</th>
                </tr>
              </thead>
              <tbody>
                {v.entries.map((e) => (
                  <tr key={e.initiativeId}>
                    <td>{e.rank ?? <span className="muted">{t("prioritization.ranked.unranked")}</span>}</td>
                    <td>{label(e.initiativeId)}</td>
                    <td>
                      {e.weightedScore === null ? (
                        <span className="status-chip status-chip--unknown">
                          {e.completeness === "removed"
                            ? t("prioritization.cause.removed")
                            : t("prioritization.incomplete")}
                        </span>
                      ) : (
                        <bdi>{fmt(e.weightedScore, 2, 2)}</bdi>
                      )}
                    </td>
                    <td>{e.previousRank ?? <span className="muted">—</span>}</td>
                    <td>{causeTexts(t, e, overrides).join(t("prioritization.shared.listSeparator"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </QueryState>
    </>
  );
}

function CreateSnapshotDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setServerError(null);
    if (isBlankText(note)) {
      setNoteError(codeText(t, "validation.blank") ?? undefined);
      return;
    }
    setNoteError(undefined);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(prioritizationUrls.rankings(tid), { method: "POST", body: note ? { note } : {} });
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("prioritization.rankings.createTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.rankings.createConfirm")}
          </button>
        </>
      }
    >
      <p>{t("prioritization.rankings.createBody")}</p>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <Field label={t("prioritization.shared.noteOptional")} error={noteError}>
        {(control) => (
          <textarea {...control} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        )}
      </Field>
    </Dialog>
  );
}
