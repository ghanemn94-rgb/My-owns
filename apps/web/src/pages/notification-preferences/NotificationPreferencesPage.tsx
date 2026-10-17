// My Work > Notification preferences (T-DG5-FE-D; REQ-S12-025; ADR-0044 §5; D-142 Q11): four separate settings —
// business-day timing (the organization policy), quiet hours, the digest (in-app, once or twice a day) and the
// urgent-escalation policy (urgent notifications are always delivered at once). My own quiet hours and digest
// override the organization defaults; with none, every notification is delivered at once (the DG4 behaviour). A held
// notification never hides its work item: My Work shows the item at once. There is no per-kind opt-out in P5 (D-155 a).
// The technical administrator (notification_policy.configure) also sets the organization policy here. The auditor
// reads but cannot save (403).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Field } from "../../components/Form.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { renderMessage } from "../my-work/messages.ts";
import {
  fedPaths,
  useFedRefresh,
  useMyDigest,
  useMyPreferences,
  useNotificationPolicy,
  type NotificationPolicy,
  type NotificationPreferences,
} from "../automation/api.ts";
import { useRunner } from "../automation/ui.tsx";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : "");

function QuietHours({ start, end }: { start: string | null; end: string | null }) {
  const { t } = useTranslation();
  if (!start || !end) return <span data-quiet="none">{t("workflowsP5.prefs.noQuietHours")}</span>;
  return (
    <span data-quiet={`${hhmm(start)}-${hhmm(end)}`}>
      <bdi dir="ltr">
        {hhmm(start)}–{hhmm(end)}
      </bdi>
    </span>
  );
}

export function NotificationPreferencesPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("nav.p5.notificationPreferences.title"));
  const prefs = useMyPreferences();
  const canPolicy = canAnywhere(me, "notification_policy.configure");
  const policy = useNotificationPolicy(canPolicy);
  return (
    <div className="page" data-p5-screen="notification-preferences">
      <PageHeader
        demoBadge
        title={t("nav.p5.notificationPreferences.title")}
        subtitle={t("nav.p5.notificationPreferences.summary")}
        crumbs={[
          { label: t("nav.areas.myWork.label"), to: "/my-work" },
          { label: t("nav.p5.notificationPreferences.title") },
        ]}
      />
      <p className="banner banner--info" role="note" data-state="urgent-policy">
        {t("workflowsP5.prefs.urgentNote")}
      </p>
      <QueryState query={prefs}>{(p) => <PreferencesView prefs={p} />}</QueryState>
      {canPolicy ? <QueryState query={policy}>{(p) => <PolicyForm policy={p} />}</QueryState> : null}
    </div>
  );
}

function PreferencesView({ prefs: p }: { prefs: NotificationPreferences }) {
  const { t } = useTranslation();
  const me = useMe();
  const canEdit = canAnywhere(me, "notification.preferences");
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const own = p.own;
  const [quiet, setQuiet] = useState(Boolean(own?.quietHoursStart));
  const [start, setStart] = useState(hhmm(own?.quietHoursStart ?? p.effective.quietHoursStart) || "21:00");
  const [end, setEnd] = useState(hhmm(own?.quietHoursEnd ?? p.effective.quietHoursEnd) || "07:00");
  const [timezone, setTimezone] = useState(own?.timezone ?? p.effective.timezone);
  const [digestMode, setDigestMode] = useState<"off" | "daily" | "twice_daily">(
    own?.digestMode ?? p.effective.digestMode,
  );
  const [digestTime, setDigestTime] = useState(hhmm(own?.digestTime ?? p.effective.digestTime) || "08:00");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Section
        id="effective"
        title={t("workflowsP5.prefs.effectiveTitle")}
        intro={t("workflowsP5.prefs.effectiveIntro")}
      >
        <dl className="workspace-header__grid" data-effective-digest={p.effective.digestMode}>
          <dt>{t("workflowsP5.prefs.source")}</dt>
          <dd data-own={own ? "true" : "false"}>
            {own ? t("workflowsP5.prefs.sourceOwn") : t("workflowsP5.prefs.sourceDefault")}
          </dd>
          <dt>{t("workflowsP5.prefs.quietHours")}</dt>
          <dd>
            <QuietHours start={p.effective.quietHoursStart} end={p.effective.quietHoursEnd} />
          </dd>
          <dt>{t("workflowsP5.prefs.timezone")}</dt>
          <dd>
            <bdi dir="ltr">{p.effective.timezone}</bdi>
          </dd>
          <dt>{t("workflowsP5.prefs.digest")}</dt>
          <dd>
            {t(`workflowsP5.digestMode.${p.effective.digestMode}`)}
            {p.effective.digestMode !== "off" ? <bdi dir="ltr"> · {hhmm(p.effective.digestTime)}</bdi> : null}
          </dd>
        </dl>
      </Section>
      <Section id="mine" title={t("workflowsP5.prefs.mineTitle")}>
        {!canEdit ? <ReadOnlyNote body={t("workflowsP5.prefs.readOnly")} /> : null}
        <form
          className="form"
          noValidate
          data-form="notification-preferences"
          onSubmit={(e) => {
            e.preventDefault();
            const errs: Record<string, string> = {};
            if (quiet && !TIME.test(start)) errs["start"] = t("workflowsP5.prefs.timeInvalid");
            if (quiet && !TIME.test(end)) errs["end"] = t("workflowsP5.prefs.timeInvalid");
            if (digestMode !== "off" && !TIME.test(digestTime)) errs["digestTime"] = t("workflowsP5.prefs.timeInvalid");
            setErrors(errs);
            if (Object.keys(errs).length > 0) return;
            setSaved(false);
            void runner
              .run(fedPaths.myPreferences, {
                method: "PUT",
                body: {
                  quietHoursStart: quiet ? start : null,
                  quietHoursEnd: quiet ? end : null,
                  timezone: timezone.trim(),
                  digestMode,
                  ...(digestMode !== "off" ? { digestTime } : {}),
                },
                ifMatch: p.version,
              })
              .then((r) => setSaved(r !== null));
          }}
        >
          {runner.alert}
          {saved ? (
            <p className="banner banner--info" role="status" data-state="saved">
              {t("workflowsP5.prefs.saved")}
            </p>
          ) : null}
          <fieldset disabled={!canEdit}>
            <legend>{t("workflowsP5.prefs.quietHours")}</legend>
            <div className="field">
              <label className="checkbox" htmlFor="quiet-on">
                <input id="quiet-on" type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />{" "}
                {t("workflowsP5.prefs.quietOn")}
              </label>
            </div>
            {quiet ? (
              <div className="grid grid--2">
                <Field
                  label={t("workflowsP5.prefs.quietStart")}
                  hint={t("workflowsP5.prefs.quietHint")}
                  error={errors["start"]}
                  required
                >
                  {(c) => (
                    <input {...c} type="time" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} />
                  )}
                </Field>
                <Field label={t("workflowsP5.prefs.quietEnd")} error={errors["end"]} required>
                  {(c) => <input {...c} type="time" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} />}
                </Field>
              </div>
            ) : null}
            <Field label={t("workflowsP5.prefs.timezone")} hint={t("workflowsP5.prefs.timezoneHint")}>
              {(c) => (
                <input {...c} dir="ltr" maxLength={64} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              )}
            </Field>
          </fieldset>
          <fieldset disabled={!canEdit}>
            <legend>{t("workflowsP5.prefs.digest")}</legend>
            <Field label={t("workflowsP5.prefs.digestMode")} hint={t("workflowsP5.prefs.digestHint")}>
              {(c) => (
                <select {...c} value={digestMode} onChange={(e) => setDigestMode(e.target.value as typeof digestMode)}>
                  {(["off", "daily", "twice_daily"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`workflowsP5.digestMode.${m}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {digestMode !== "off" ? (
              <Field label={t("workflowsP5.prefs.digestTime")} error={errors["digestTime"]} required>
                {(c) => (
                  <input
                    {...c}
                    type="time"
                    dir="ltr"
                    value={digestTime}
                    onChange={(e) => setDigestTime(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </fieldset>
          {canEdit ? (
            <div className="form__actions">
              <button type="submit" className="button button--primary" disabled={runner.busy}>
                {t("workflowsP5.prefs.save")}
              </button>
            </div>
          ) : null}
        </form>
      </Section>
    </>
  );
}

function PolicyForm({ policy: p }: { policy: NotificationPolicy }) {
  const { t } = useTranslation();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const [workingDays, setWorkingDays] = useState(p.nonUrgentWorkingDaysOnly);
  const [quiet, setQuiet] = useState(Boolean(p.defaultQuietHoursStart));
  const [start, setStart] = useState(hhmm(p.defaultQuietHoursStart) || "21:00");
  const [end, setEnd] = useState(hhmm(p.defaultQuietHoursEnd) || "07:00");
  const [digestMode, setDigestMode] = useState(p.defaultDigestMode);
  return (
    <Section id="policy" title={t("workflowsP5.prefs.policyTitle")} intro={t("workflowsP5.prefs.policyIntro")}>
      <form
        className="form"
        noValidate
        data-form="notification-policy"
        onSubmit={(e) => {
          e.preventDefault();
          void runner.run(fedPaths.policy, {
            method: "PUT",
            body: {
              nonUrgentWorkingDaysOnly: workingDays,
              defaultQuietHoursStart: quiet ? start : null,
              defaultQuietHoursEnd: quiet ? end : null,
              defaultDigestMode: digestMode,
            },
            ifMatch: p.version,
          });
        }}
      >
        {runner.alert}
        <div className="field">
          <label className="checkbox" htmlFor="policy-working-days">
            <input
              id="policy-working-days"
              type="checkbox"
              checked={workingDays}
              onChange={(e) => setWorkingDays(e.target.checked)}
            />{" "}
            {t("workflowsP5.prefs.workingDaysOnly")}
          </label>
        </div>
        <div className="field">
          <label className="checkbox" htmlFor="policy-quiet">
            <input id="policy-quiet" type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />{" "}
            {t("workflowsP5.prefs.defaultQuiet")}
          </label>
        </div>
        {quiet ? (
          <div className="grid grid--2">
            <Field label={t("workflowsP5.prefs.quietStart")}>
              {(c) => <input {...c} type="time" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
            <Field label={t("workflowsP5.prefs.quietEnd")}>
              {(c) => <input {...c} type="time" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} />}
            </Field>
          </div>
        ) : null}
        <Field label={t("workflowsP5.prefs.defaultDigest")}>
          {(c) => (
            <select {...c} value={digestMode} onChange={(e) => setDigestMode(e.target.value as typeof digestMode)}>
              {(["off", "daily", "twice_daily"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`workflowsP5.digestMode.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="small muted">
          {t("workflowsP5.prefs.urgentKinds")}{" "}
          {p.urgentKinds.map((k) => t(`myWork.kind.${k}`, { defaultValue: k })).join(" · ")}
        </p>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("workflowsP5.prefs.savePolicy")}
          </button>
        </div>
      </form>
    </Section>
  );
}

/** One in-app digest (the link of a digest notification): the held notifications it delivered. */
export function DigestPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { digestId } = useParams();
  usePageTitle(t("workflowsP5.prefs.digestTitle"));
  const digest = useMyDigest(digestId);
  return (
    <div className="page" data-p5-screen="notification-digest">
      <PageHeader
        title={t("workflowsP5.prefs.digestTitle")}
        crumbs={[{ label: t("nav.areas.myWork.label"), to: "/my-work" }, { label: t("workflowsP5.prefs.digestTitle") }]}
      />
      <QueryState query={digest}>
        {(d) => (
          <Section
            id="digest"
            title={t("workflowsP5.prefs.digestWindow", {
              start: formatDateTime(d.windowStart, locale),
              end: formatDateTime(d.windowEnd, locale),
            })}
          >
            <ul className="plain-list" data-digest-count={d.count}>
              {d.items.map((i) => (
                <li key={i.notificationId}>
                  <Link className="link" to={i.linkPath}>
                    {renderMessage(
                      t,
                      locale,
                      i.messageKey,
                      i.messageParams as Record<string, string | number | boolean | null>,
                    )}
                  </Link>{" "}
                  <span className="small muted">{formatDateTime(i.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </QueryState>
    </div>
  );
}
