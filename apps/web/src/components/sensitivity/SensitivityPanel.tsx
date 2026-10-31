// The access-restriction panel of a sensitive-capable record (T-DG6-FE-B; ADR-0051 §2; REQ-S10-002; D-195 Q3), mounted
// by one named line on the benefit, business-case and evidence detail views. It reads getRecordSensitivity (the record
// must be readable, else 404, and the panel shows nothing), shows whether the record is sensitive, and for a holder of
// `sensitive_record.grant` (`canManage`: the Transformation Office or an access administrator) offers:
//  - mark / remove the restriction, with a reason (putRecordSensitivity, If-Match the flag's version, "0" creates it);
//  - the active grants of this record (listSensitiveGrants), each revocable with a reason (revokeSensitiveGrant);
//  - a new grant to one team member, with a reason (createSensitiveGrant).
// Everyone else (the auditor included) sees the status read-only. Marking never changes the record's own version
// (probe G04). A grant is an access decision, never a business approval.
import type { RecordSensitivity, SensitiveGrant } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  p6Paths,
  useP6SensitivityRefresh,
  useRecordSensitivity,
  useSensitiveGrants,
  type SensitiveRecordType,
} from "../../api/p6.ts";
import { useMe } from "../../auth/session.tsx";
import { Chip, useRunner } from "../../pages/automation/ui.tsx";
import { isValidReason, ReasonField } from "../../pages/admin/security/shared.tsx";
import { Icon } from "../Icon.tsx";
import { usePeople } from "../People.tsx";
import { ReasonDialog } from "../ReasonDialog.tsx";
import { api } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { ApiError } from "../../api/client.ts";

export function SensitivityStatus({ isSensitive }: { isSensitive: boolean }) {
  const { t } = useTranslation();
  return isSensitive ? (
    <Chip tone="draft" icon="lock" label={t("adminP6.sensitivity.sensitive")} data="sensitive" />
  ) : (
    <Chip tone="neutral" icon="dot" label={t("adminP6.sensitivity.notSensitive")} data="not-sensitive" />
  );
}

function RecordGrants({ s }: { s: RecordSensitivity }) {
  const { t } = useTranslation();
  const me = useMe();
  const people = usePeople(s.transformationId);
  const refresh = useP6SensitivityRefresh(s.transformationId);
  const runner = useRunner(refresh);
  const grants = useSensitiveGrants<SensitiveGrant>({
    transformationId: s.transformationId,
    recordType: s.recordType,
    recordId: s.recordId,
    status: "active",
  });
  const [grantee, setGrantee] = useState("");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<{ grantee?: boolean; reason?: boolean }>({});
  const [revoking, setRevoking] = useState<SensitiveGrant | null>(null);
  const [granted, setGranted] = useState(false);
  const holders = new Set((grants.data?.items ?? []).map((g) => g.granteeUserId));
  const candidates = people.people.filter((p) => p.id !== me.user.id && !holders.has(p.id));
  const submit = async () => {
    setGranted(false);
    const next = { grantee: !grantee, reason: !isValidReason(reason) };
    setInvalid(next);
    if (next.grantee || next.reason) return;
    const result = await runner.run<SensitiveGrant>(p6Paths.sensitiveGrants, {
      body: {
        transformationId: s.transformationId,
        recordType: s.recordType,
        recordId: s.recordId,
        granteeUserId: grantee,
        reason,
      },
    });
    if (result) {
      setGrantee("");
      setReason("");
      setGranted(true);
    }
  };
  return (
    <div data-sensitivity-grants={s.recordId}>
      <h3 className="card__subtitle">{t("adminP6.sensitivity.grantsTitle")}</h3>
      {grants.isPending ? null : grants.isError ? null : grants.data.items.length === 0 ? (
        <p className="muted small">{t("adminP6.sensitivity.noGrants")}</p>
      ) : (
        <ul className="plain-list" data-list="record-grants">
          {grants.data.items.map((g) => (
            <li key={g.id} data-grant={g.id}>
              {g.granteeDisplayName ?? people.byId.get(g.granteeUserId)?.label ?? t("adminP6.grants.unknownPerson")}
              <span className="small muted"> · {g.reason}</span>{" "}
              <button
                type="button"
                className="button button--link button--small"
                disabled={runner.busy}
                onClick={() => setRevoking(g)}
              >
                {t("adminP6.grants.revoke")}
                <span className="visually-hidden">: {g.granteeDisplayName ?? g.granteeUserId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="form form--inset"
        noValidate
        data-form="sensitive-grant"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="card__subtitle">{t("adminP6.sensitivity.grantTitle")}</h3>
        {runner.alert}
        {granted ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> {t("adminP6.sensitivity.granted")}
          </p>
        ) : null}
        <div className={`field${invalid.grantee ? " field--invalid" : ""}`}>
          <label className="field__label" htmlFor={`grantee-${s.recordId}`}>
            {t("adminP6.sensitivity.grantee")}
            <span className="field__required"> ({t("common.form.required")})</span>
          </label>
          <select
            id={`grantee-${s.recordId}`}
            value={grantee}
            aria-required
            aria-invalid={invalid.grantee || undefined}
            aria-describedby={invalid.grantee ? `grantee-${s.recordId}-error` : undefined}
            onChange={(e) => setGrantee(e.target.value)}
          >
            <option value="">{t("adminP6.sensitivity.chooseGrantee")}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {invalid.grantee ? (
            <p id={`grantee-${s.recordId}-error`} className="field__error">
              <Icon name="alert" /> {t("adminP6.sensitivity.granteeRequired")}
            </p>
          ) : null}
        </div>
        <ReasonField
          id={`grant-reason-${s.recordId}`}
          value={reason}
          onChange={setReason}
          invalid={Boolean(invalid.reason)}
        />
        <p className="small muted">
          <Icon name="info" /> {t("adminP6.grants.notApproval")}
        </p>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("adminP6.sensitivity.grant")}
          </button>
          <Link
            className="link small"
            to={`/admin/sensitive-grants?transformationId=${encodeURIComponent(s.transformationId)}`}
          >
            {t("adminP6.sensitivity.allGrants")}
          </Link>
        </div>
      </form>
      {revoking ? (
        <ReasonDialog
          title={t("adminP6.grants.revokeTitle")}
          description={t("adminP6.grants.revokeDescription")}
          confirmLabel={t("adminP6.grants.revoke")}
          onClose={() => setRevoking(null)}
          onConfirm={async (r) => {
            await api.send(p6Paths.revokeSensitiveGrant(revoking.id), {
              method: "POST",
              body: { reason: r },
              ifMatch: revoking.version,
            });
            setRevoking(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** The panel. `recordId` undefined renders nothing (the record is not loaded yet). */
export function SensitivityPanel({
  tid,
  recordType,
  recordId,
}: {
  tid: string;
  recordType: SensitiveRecordType;
  recordId: string | undefined;
}) {
  const { t } = useTranslation();
  const sensitivity = useRecordSensitivity<RecordSensitivity>(tid, recordType, recordId);
  const refresh = useP6SensitivityRefresh(tid);
  const [changing, setChanging] = useState(false);
  // The record's own page already handles its 403/404: a failing flag read shows nothing more here.
  if (!sensitivity.data) return null;
  const s = sensitivity.data;
  return (
    <section
      className="card"
      aria-labelledby={`sensitivity-${s.recordId}`}
      data-sensitivity={s.isSensitive ? "sensitive" : "not-sensitive"}
    >
      <h2 id={`sensitivity-${s.recordId}`} className="card__title">
        {t("adminP6.sensitivity.title")}
      </h2>
      <p className="muted small">{t("adminP6.sensitivity.intro")}</p>
      <p>
        <SensitivityStatus isSensitive={s.isSensitive} />
      </p>
      {s.reason && s.canManage ? (
        <p className="small">
          {t("adminP6.sensitivity.reasonShown")}: {s.reason}
        </p>
      ) : null}
      {s.canManage ? (
        <>
          <div className="form__actions">
            <button
              type="button"
              className={`button ${s.isSensitive ? "button--secondary" : "button--primary"}`}
              data-action={s.isSensitive ? "unmark-sensitive" : "mark-sensitive"}
              onClick={() => setChanging(true)}
            >
              <Icon name="lock" /> {s.isSensitive ? t("adminP6.sensitivity.unmark") : t("adminP6.sensitivity.mark")}
            </button>
          </div>
          {s.isSensitive ? (
            <RecordGrants s={s} />
          ) : (
            <p className="small muted">{t("adminP6.sensitivity.notMarkedForGrant")}</p>
          )}
        </>
      ) : (
        // Its own marker: `data-state="read-only"` is the page's one read-only banner (Workspace), which a record page
        // must show exactly once; this note only explains who may change the restriction.
        <p className="small muted" data-state="sensitivity-read-only">
          <Icon name="info" /> {t("adminP6.sensitivity.cannotManage")}
        </p>
      )}
      {changing ? (
        <ReasonDialog
          title={s.isSensitive ? t("adminP6.sensitivity.unmarkTitle") : t("adminP6.sensitivity.markTitle")}
          description={
            s.isSensitive ? t("adminP6.sensitivity.unmarkDescription") : t("adminP6.sensitivity.markDescription")
          }
          confirmLabel={s.isSensitive ? t("adminP6.sensitivity.unmark") : t("adminP6.sensitivity.mark")}
          onClose={() => setChanging(false)}
          onConfirm={async (reason) => {
            const guard = beginSessionGuard();
            try {
              await api.send(p6Paths.recordSensitivity(tid, recordType, s.recordId), {
                method: "PUT",
                body: { isSensitive: !s.isSensitive, reason },
                ifMatch: s.version,
              });
            } catch (e) {
              // A 409 (someone changed the flag meanwhile): reload, then show the conflict in the dialog.
              if (!guard.stale(e) && e instanceof ApiError && e.status === 409) await refresh();
              throw e;
            }
            if (guard.stale()) return;
            setChanging(false);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}
