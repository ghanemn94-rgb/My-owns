// The deep-link landing `/l/:token` (T-DG6-FE-B; ADR-0051 §3; REQ-S12-024). A notification link carries an opaque
// token, never a credential: the signed-in user's access is checked again by resolveDeepLink, and only then does the page
// navigate to the in-app path the server returns (safeInternalPath: never another site). A 403 `deep_link.forbidden`
// shows exactly its translated text, with no title, type or id of the target: the body is the same for a sensitive
// target, a target in another transformation and a deleted one, and this page adds nothing to it. A malformed token is
// never sent.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { DEEP_LINK_TOKEN, safeInternalPath, useDeepLink } from "../../api/p6.ts";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ErrorState, LoadingState } from "../../components/States.tsx";
import { problemText } from "../../lib/problem.ts";

function Refusal({ title, body, state }: { title: string; body: string; state: string }) {
  const { t } = useTranslation();
  return (
    <div className="state state--no-permission" role="alert" data-state={state}>
      <Icon name="lock" />
      <div>
        <p className="state__title">{title}</p>
        <p className="state__body">{body}</p>
        <p>
          <Link className="link" to="/my-work">
            {t("adminP6.deepLink.goMyWork")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export function DeepLinkPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const title = t("nav.p6.deepLink.title");
  usePageTitle(title);
  const wellFormed = Boolean(token && DEEP_LINK_TOKEN.test(token));
  const link = useDeepLink(token);
  const navigate = useSessionNavigate();
  const target = link.data ? safeInternalPath(link.data.linkPath) : null;
  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target, navigate]);

  let body;
  if (!wellFormed) {
    body = (
      <Refusal
        state="deep-link-malformed"
        title={t("adminP6.deepLink.malformedTitle")}
        body={t("adminP6.deepLink.malformedBody")}
      />
    );
  } else if (link.isPending) {
    body = <LoadingState label={t("adminP6.deepLink.checking")} />;
  } else if (link.isError) {
    const e = link.error;
    body =
      e instanceof ApiError && (e.status === 403 || e.status === 404) ? (
        <Refusal
          state="deep-link-forbidden"
          title={t("adminP6.deepLink.forbiddenTitle")}
          body={problemText(t, e.status === 403 ? (e.code ?? "deep_link.forbidden") : "deep_link.forbidden")}
        />
      ) : (
        <ErrorState error={e} onRetry={() => void link.refetch()} />
      );
  } else if (!target) {
    body = (
      <Refusal
        state="deep-link-unsafe"
        title={t("adminP6.deepLink.unsafeTitle")}
        body={t("adminP6.deepLink.unsafeBody")}
      />
    );
  } else {
    body = <LoadingState label={t("adminP6.deepLink.opening")} />;
  }
  return (
    <div className="page" data-p6-screen="deep-link">
      <PageHeader title={title} subtitle={t("nav.p6.deepLink.summary")} />
      {body}
    </div>
  );
}
