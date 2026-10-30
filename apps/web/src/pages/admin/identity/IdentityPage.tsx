// Administration > Identity (T-DG6-FE-B; ADR-0054 §1; REQ-S16-007): the sign-in settings, read-only
// (getIdentitySettings, identity.read). The client secret is never in the response; the page shows only whether one is
// configured. The live corporate identity provider and the SAML broker are configured by Mobily IT: the page says so and
// claims no live connection (p6-work-split §2 rule 14). The response type is written from docs/api/openapi.yaml
// 1.5.0-p6 (`IdentitySettings`).
import { useTranslation } from "react-i18next";
import { useIdentitySettings } from "../../../api/p6.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { QueryState } from "../../../components/States.tsx";
import { Chip } from "../../automation/ui.tsx";
import { adminCrumbs, Code, Fact } from "../security/shared.tsx";

export interface IdentitySettings {
  readonly authMode: "oidc" | "dev";
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly clientSecretConfigured: boolean;
  readonly scopes: readonly string[];
  readonly expectedAudience: string | null;
  readonly pkceMethod: "S256" | null;
  readonly claimMapping: { readonly subject: string; readonly email: string; readonly displayName: string };
  readonly samlBrokerDocument: string;
}

export function IdentityPage() {
  const { t } = useTranslation();
  const title = t("nav.p6.identity.title");
  usePageTitle(title);
  const settings = useIdentitySettings<IdentitySettings>();
  const orNotConfigured = (v: string | null) => (v ? <Code>{v}</Code> : t("adminP6.common.notConfigured"));
  return (
    <div className="page" data-p6-screen="identity">
      <PageHeader title={title} subtitle={t("nav.p6.identity.summary")} crumbs={adminCrumbs(t, { label: title })} />
      <p className="banner banner--info" role="note" data-state="read-only">
        <Icon name="info" /> {t("adminP6.identity.readOnlyNote")}
      </p>
      <QueryState query={settings}>
        {(s) => (
          <section className="card" aria-labelledby="identity-settings" data-auth-mode={s.authMode}>
            <h2 id="identity-settings" className="card__title">
              {t("adminP6.identity.title")}
            </h2>
            <dl className="workspace-header__grid">
              <Fact label={t("adminP6.identity.authMode")}>
                {s.authMode === "dev" ? (
                  <Chip tone="warn" icon="alert" label={t("adminP6.identity.authModeValue.dev")} data="dev" />
                ) : (
                  t("adminP6.identity.authModeValue.oidc")
                )}
              </Fact>
              <Fact label={t("adminP6.identity.issuer")}>
                {orNotConfigured(s.issuer)}
                <span className="block small muted">{t("adminP6.identity.issuerHint")}</span>
              </Fact>
              <Fact label={t("adminP6.identity.clientId")}>{orNotConfigured(s.clientId)}</Fact>
              <Fact label={t("adminP6.identity.clientSecret")}>
                <span data-client-secret={s.clientSecretConfigured ? "configured" : "missing"}>
                  <Icon name="lock" />{" "}
                  {s.clientSecretConfigured
                    ? t("adminP6.identity.secretConfigured")
                    : t("adminP6.identity.secretMissing")}
                </span>
              </Fact>
              <Fact label={t("adminP6.identity.audience")}>{orNotConfigured(s.expectedAudience)}</Fact>
              <Fact label={t("adminP6.identity.scopes")}>
                {s.scopes.length ? <Code>{s.scopes.join(" ")}</Code> : t("adminP6.common.notConfigured")}
              </Fact>
              <Fact label={t("adminP6.identity.pkce")}>{orNotConfigured(s.pkceMethod)}</Fact>
              <Fact label={t("adminP6.identity.claims")}>
                <ul className="plain-list">
                  <li>
                    {t("adminP6.identity.claimSubject")}: <Code>{s.claimMapping.subject}</Code>
                  </li>
                  <li>
                    {t("adminP6.identity.claimEmail")}: <Code>{s.claimMapping.email}</Code>
                  </li>
                  <li>
                    {t("adminP6.identity.claimName")}: <Code>{s.claimMapping.displayName}</Code>
                  </li>
                </ul>
              </Fact>
              <Fact label={t("adminP6.identity.saml")}>
                {t("adminP6.identity.samlDoc")}: <Code>{s.samlBrokerDocument}</Code>
              </Fact>
            </dl>
            <p className="small muted" data-state="residual">
              <Icon name="info" /> {t("adminP6.identity.residual")}
            </p>
          </section>
        )}
      </QueryState>
    </div>
  );
}
