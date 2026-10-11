// The traceability panel selection, kept in the URL. Shared by TraceabilityPage.tsx and TracePanels.tsx; moved out of
// TraceabilityPage.tsx unchanged so that the page and its panels do not import each other (F-DG4-102: no import cycle).
import { useSearchParams } from "react-router";

/** The panel selection kept in the URL (`?root=type:id&impact=type:id&alloc=type:id`), so a view can be shared. */
export function useTraceSelection() {
  const [params, setParams] = useSearchParams();
  const parse = (name: string) => {
    const v = params.get(name);
    if (!v) return null;
    const [type, id] = v.split(":", 2);
    return type && id ? { type, id } : null;
  };
  const set = (name: string, value: { type: string; id: string } | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(name, `${value.type}:${value.id}`);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  return { root: parse("root"), impact: parse("impact"), alloc: parse("alloc"), set };
}
