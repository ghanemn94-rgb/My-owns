// T-DG5-FE-G2 (REQ-S03-007, ADR-0049 §9; D-163 option (a)): the shell's area filter is the server's answer, with no
// client-side fallback. SYNTHETIC answers.
import { describe, expect, it } from "vitest";
import { visibleAreaIds, type MeNavigation } from "./me-navigation.ts";
import { NAV_AREAS } from "./nav.ts";

const area = (webId: string) => ({ code: webId, webId, labelKey: `nav.areas.${webId}.label`, path: "/", items: [] });

describe("visibleAreaIds", () => {
  it("is null while there is no answer (pending or failed): the shell then shows no area list", () => {
    expect(visibleAreaIds(undefined)).toBeNull();
    expect(visibleAreaIds({ items: [] } as unknown as MeNavigation)).toBeNull();
  });

  it("is exactly the web ids the server returned, and filters NAV_AREAS in nav.ts order", () => {
    const ids = visibleAreaIds({ areas: [area("admin"), area("myWork"), area("playbook")] })!;
    expect([...ids].sort()).toEqual(["admin", "myWork", "playbook"]);
    expect(NAV_AREAS.filter((a) => ids.has(a.id)).map((a) => a.id)).toEqual(["myWork", "playbook", "admin"]);
  });

  it("an empty answer is an empty set, never all areas", () => {
    expect(visibleAreaIds({ areas: [] })!.size).toBe(0);
  });
});
