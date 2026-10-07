// F-DG2-530 / F-DG2-580 (T-DG2-FE15): every effect of a user action belongs to the session generation the action
// started under. The API client already refuses to RETURN an answer to a request sent under a previous generation
// (api/client.ts SessionChangedError). That does not cover what a handler does after a FURTHER await: e.g. the create
// page takes its 201 under A, then awaits a GET /me (F-DG1-210) that returns B; it must not then navigate B to A's new
// record with A's code and name in the router state.
//
// THE CONVENTION (enforced by eslint.config.js `no-restricted-imports` / `no-restricted-syntax` for apps/web/src, and by
// auth/session-bound.test.ts, which scans every source file):
//  - app code never calls the raw router `navigate` (useNavigate, router.navigate) nor `queryClient.setQueryData` /
//    `setQueriesData`. It calls `begin()` from useSessionBoundAction() at the START of a user action, and then
//    `action.navigate(...)` / `action.setQueryData(...)`, which silently do nothing once the session generation moved.
//    A form or dialog that neither navigates nor writes the cache uses `const action = beginSessionGuard()` instead;
//  - after every `await` in a handler, `if (action.stale()) return;` (or `action.stale(err)` in a catch) before any
//    other render effect: a notice, an error banner, closing a dialog, a conflict panel. A component's own state lives
//    in the signed-in subtree keyed by the person (auth/session.tsx), so another person's subtree is a new one anyway;
//    the check also covers a new session of the same person;
//  - a navigation in a plain click handler (Cancel) uses useSessionNavigate(), bound at the click;
//  - only the session transitions themselves may use the raw navigate, each with a justified eslint-disable comment:
//    the session-end redirect (auth/session.tsx), signing out here (app/Shell.tsx) and signing in (pages/LoginPage.tsx).
//    Those navigate BECAUSE the generation moved.
import { useQueryClient, type QueryClient, type QueryKey, type Updater } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router";
import { getSessionGeneration, isSessionChangedError } from "../api/client.ts";

/** One user action's guard: the session generation it started under. */
export interface SessionGuard {
  /** The generation captured when the action began. */
  readonly generation: number;
  /** True while the session generation is still the one the action began under. */
  current(): boolean;
  /**
   * True when the action's effects must be dropped: the generation moved since it began, or `err` is the API client's
   * SessionChangedError (an answer to a request of a previous generation). Use after every await: `if (a.stale()) return;`.
   */
  stale(err?: unknown): boolean;
  /** Runs `effect` only while the action is current; returns whether it ran. */
  run(effect: () => void): boolean;
}

/** One user action, bound to the session generation it started under, with its navigation and cache writes. */
export interface SessionBoundAction extends SessionGuard {
  /** Navigates only while the action is current (router state included); returns whether it navigated. */
  navigate(to: To, options?: NavigateOptions): boolean;
  /** Writes into the query cache only while the action is current; returns whether it wrote. */
  setQueryData<T>(key: QueryKey, updater: Updater<T | undefined, T | undefined>): boolean;
}

export type RawNavigate = (to: To, options?: NavigateOptions) => void | Promise<void>;

/**
 * Begins a guarded action under the CURRENT session generation (or `generation`). For forms and dialogs whose only
 * effects are their own state (they never navigate nor write the cache): no router or query client needed.
 */
export function beginSessionGuard(generation: number = getSessionGeneration()): SessionGuard {
  const current = () => getSessionGeneration() === generation;
  return {
    generation,
    current,
    stale: (err?: unknown) => !current() || isSessionChangedError(err),
    run: (effect) => {
      if (!current()) return false;
      effect();
      return true;
    },
  };
}

/** Binds an action to the CURRENT session generation (or `generation`). Non-hook form, for tests and helpers. */
export function bindToSession(
  deps: { readonly navigate: RawNavigate; readonly queryClient: QueryClient },
  generation: number = getSessionGeneration(),
): SessionBoundAction {
  const guard = beginSessionGuard(generation);
  const { current } = guard;
  return {
    ...guard,
    navigate: (to, options) => {
      if (!current()) return false;
      void deps.navigate(to, options);
      return true;
    },
    setQueryData: <T>(key: QueryKey, updater: Updater<T | undefined, T | undefined>) => {
      if (!current()) return false;
      deps.queryClient.setQueryData<T>(key, updater);
      return true;
    },
  };
}

/** Returns `begin()`: call it at the start of every user action (before its first await). */
export function useSessionBoundAction(): () => SessionBoundAction {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(() => bindToSession({ navigate, queryClient }), [navigate, queryClient]);
}

/** A navigation from a plain (synchronous) click handler, bound to the session at the click. */
export function useSessionNavigate(): (to: To, options?: NavigateOptions) => boolean {
  const begin = useSessionBoundAction();
  return useCallback((to: To, options?: NavigateOptions) => begin().navigate(to, options), [begin]);
}
