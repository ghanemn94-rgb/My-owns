// Persistent language switch (REQ-S15-007): changes <html lang dir> immediately, stores the choice in localStorage
// (pre-sign-in hint) and, when signed in, persists it with PUT /api/v1/me/preferences (If-Match on the user version;
// a 409 re-reads /me and retries once).
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "@mth/shared";
import { ApiError, api } from "../api/client.ts";
import { fetchMe, keys } from "../api/queries.ts";
import type { Me, User } from "../api/types.ts";
import { useLocale } from "../app/locale.ts";
import { rememberLocale } from "../i18n/index.ts";

const LANGUAGE_NAMES: Record<Locale, string> = { ar: "العربية", en: "English" };

export function LanguageSwitch({ signedIn }: { signedIn: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const next: Locale = locale === "ar" ? "en" : "ar";

  const persist = async (target: Locale, attempt = 0): Promise<void> => {
    const me = queryClient.getQueryData<Me>(keys.me) ?? (await fetchMe());
    try {
      const user = await api.send<User>("/api/v1/me/preferences", {
        method: "PUT",
        body: { preferredLocale: target },
        ifMatch: me.user.version,
      });
      queryClient.setQueryData<Me>(keys.me, (old) => (old ? { ...old, user } : old));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && attempt === 0) {
        const fresh = await fetchMe();
        queryClient.setQueryData(keys.me, fresh);
        return persist(target, 1);
      }
      throw err;
    }
  };

  const onClick = async () => {
    setNotice(null);
    rememberLocale(next);
    await i18n.changeLanguage(next);
    if (!signedIn) return;
    try {
      await persist(next);
    } catch {
      setNotice(t("common.language.notSaved"));
    }
  };

  return (
    <span className="language-switch">
      <button
        type="button"
        className="button button--ghost-inverse button--small"
        lang={next}
        onClick={() => void onClick()}
        aria-label={t("common.language.switchTo", { language: LANGUAGE_NAMES[next] })}
      >
        {LANGUAGE_NAMES[next]}
      </button>
      {notice ? (
        <span role="status" className="language-switch__notice">
          {notice}
        </span>
      ) : null}
    </span>
  );
}
