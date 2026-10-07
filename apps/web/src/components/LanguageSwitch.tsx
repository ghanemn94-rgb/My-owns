// Persistent language switch (REQ-S15-007): changes <html lang dir> immediately, stores the choice in localStorage
// (pre-sign-in hint) and, when signed in, persists it with PUT /api/v1/me/preferences (If-Match on the user version;
// a 409 re-reads /me and retries once).
//
// A refused save (T-DG2-FE11, behaviour (a)): the language the user chose stays on screen in this browser (it is not
// reverted), and the "not saved" notice is shown in that language. RequireSession only re-applies the persisted
// preference when that preference itself changes, so a refused save cannot flip the page back. The notice is rendered
// from its key at render time (never a string frozen in the previous language) inside a live region that is always in
// the DOM, so it is announced once, and its lang follows the displayed language.
//
// T-DG2-FE12: the notice is a banner *below* the header (LanguageNotSavedNotice, rendered by the Shell), never inside
// the header row, so it can neither wrap the header nor squeeze the wordmark at any width. The switch reports the
// refused language to the Shell through `onRefusedChange`; the Shell holds it and renders the one live region.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "@mth/shared";
import { api, ApiError, sessionIdentityKey } from "../api/client.ts";
import { fetchMe, keys } from "../api/queries.ts";
import type { Me, User } from "../api/types.ts";
import { useLocale } from "../app/locale.ts";
import { useSessionBoundAction, type SessionBoundAction } from "../auth/sessionBound.ts";
import { rememberLocale } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";

const LANGUAGE_NAMES: Record<Locale, string> = { ar: "العربية", en: "English" };

/**
 * The language whose save was refused (null = no notice). The Shell owns it, so the notice can be shown below the
 * header while the switch stays in the header.
 */
export function useLanguageNotSaved() {
  return useState<Locale | null>(null);
}

export function LanguageSwitch({
  signedIn,
  onRefusedChange,
}: {
  signedIn: boolean;
  /** Signed in: called with the refused language after a refused save, and with null when a new switch starts. */
  onRefusedChange?: (refused: Locale | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const setRefused = (refused: Locale | null) => onRefusedChange?.(refused);
  const next: Locale = locale === "ar" ? "en" : "ar";
  // GET /me through the cache (never an out-of-band fetchMe + setQueryData): the answer is stored by the query itself,
  // so whichever identity it brings, the header follows it (F-DG2-530/570).
  const readMe = () => queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0, retry: false });

  const persist = async (target: Locale, action: SessionBoundAction, attempt = 0): Promise<void> => {
    const me = queryClient.getQueryData<Me>(keys.me) ?? (await readMe());
    if (action.stale()) return;
    try {
      const user = await api.send<User>("/api/v1/me/preferences", {
        method: "PUT",
        body: { preferredLocale: target },
        ifMatch: me.user.version,
      });
      action.setQueryData<Me>(keys.me, (old) => (old ? { ...old, user } : old));
    } catch (err) {
      if (!action.stale(err) && err instanceof ApiError && err.status === 409 && attempt === 0) {
        const fresh = await readMe();
        // F-DG2-530: a choice made under one identity (or session) is never written for the one that replaced it.
        if (action.stale() || sessionIdentityKey(fresh) !== sessionIdentityKey(me)) return;
        return persist(target, action, 1);
      }
      throw err;
    }
  };

  const onClick = async () => {
    const action = begin(); // F-DG2-530: the save and its notice belong to this session generation
    setRefused(null);
    const target = next; // captured before the language (and so `next`) changes
    rememberLocale(target);
    await i18n.changeLanguage(target);
    if (!signedIn) return;
    try {
      await persist(target, action);
    } catch (err) {
      if (action.stale(err)) return; // F-DG2-530: silent, the session state was already reset
      setRefused(target);
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
    </span>
  );
}

/**
 * The "not saved" notice, as a full-width warning banner below the header (FE12). A polite, atomic live region that is
 * always in the DOM while signed in (no role="status", so it never competes with a page's own status message):
 * inserting the notice into it is announced once. The text is translated at render time from the refused language, so
 * it is always in the language shown; the region's lang follows the displayed language.
 */
export function LanguageNotSavedNotice({ refused }: { refused: Locale | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="app-notice language-switch__live" aria-live="polite" aria-atomic="true" lang={locale}>
      {refused ? (
        <p className="banner banner--warning language-switch__notice" data-testid="language-not-saved">
          <Icon name="alert" />
          {/* Normally the chosen language is still shown. If the persisted preference was changed meanwhile (e.g. a
              409 re-read of /me brought another tab's choice) and re-applied, say so instead, in that language. */}
          {t(refused === locale ? "common.language.notSaved" : "common.language.notSavedReverted")}
        </p>
      ) : null}
    </div>
  );
}
