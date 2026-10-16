// The freshness policy of the shell-wide reads of T-DG5-FE-G (/me/navigation, /branding, /branding/tokens,
// /environment). A read that answered stays fresh for a minute and is then refetched by the app's session-first refocus
// (App.tsx revalidateSessionFirst), so a published branding version reaches open sessions. A read that FAILED (an older
// API, a 404 in a test stub) keeps its fallback and is never "due" again on focus or reconnect ("static"), so a refocus
// never turns into repeated failing requests (the F-DG2-530 X6 rule: "nothing when all is fresh").
export const SHELL_READ = {
  staleTime: (query: { readonly state: { readonly status: string } }) =>
    query.state.status === "error" ? ("static" as const) : 60_000,
} as const;
