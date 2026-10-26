# domain-reviewer DG5 round 2: evidence for F-DG5-120 and F-DG5-121 (clone at 660f40c)

## F-DG5-120: seeded scoring_weight attributes carry sourceLabelEn + labelAr, no labelEn
468:   '{"weightPercent": "25.00", "sourceLabelEn": "Strategic fit", "labelAr": "الملاءمة الاستراتيجية", "sourceRef": "B0076"}'),
470:   '{"weightPercent": "25.00", "sourceLabelEn": "Financial value", "labelAr": "القيمة المالية", "sourceRef": "B0076"}'),
472:   '{"weightPercent": "20.00", "sourceLabelEn": "Customer impact", "labelAr": "الأثر على العملاء", "sourceRef": "B0076"}'),
474:   '{"weightPercent": "15.00", "sourceLabelEn": "Feasibility", "labelAr": "قابلية التنفيذ", "sourceRef": "B0076"}'),
476:   '{"weightPercent": "15.00", "sourceLabelEn": "Time-to-value", "labelAr": "سرعة تحقيق القيمة", "sourceRef": "B0076"}'),

## apps/web/src/pages/studio/api.ts elementLabel (reads labelEn/labelAr only; falls back to the other language)
export function elementLabel(
  e: Pick<ConfigElement, "attributes" | "catalogueAttributes" | "stableKey">,
  locale: "ar" | "en",
): string {
  const mine = attrText(e, locale === "ar" ? "labelAr" : "labelEn");
  if (mine) return mine;
  const other = attrText(e, locale === "ar" ? "labelEn" : "labelAr");
  return other || e.stableKey;
}

## ElementsSection.tsx label + change column
              <tbody>
                {rows.map((e) => {
                  const label = elementLabel(e, locale);
                  return (
                    <tr key={`${e.elementType}/${e.stableKey}`} data-element={`${e.elementType}:${e.stableKey}`}>
                      <th scope="row">
                        <bdi dir="ltr" className="code">
                          {e.stableKey}
                        </bdi>
                        {e.sourceRef ? (
                          <span className="block small muted">
                            <bdi dir="ltr">{e.sourceRef}</bdi>
                          </span>
                        ) : null}
                      </th>
                      <td>
                        {label}
                        {(() => {
                          const profile = profileOf(e);
                          return profile ? (
                            <span className="block" data-element-provenance={profile.elementRef}>
                              <ProvenanceBadge provenance={profile.provenance} overridden={profile.overridden} />
                            </span>
                          ) : null;
                        })()}
                        {e.elementType === "approver_route" ? <RouteSummary element={e} /> : null}
                      </td>
                      <td>
                        <TextCell value={attrText(e, locale === "ar" ? "helpAr" : "helpEn")} />
                      </td>
                      <td>
                        {e.removed
                          ? t("studio.elements.removed")
                          : e.overridden
                            ? t("studio.elements.overridden")
                            : e.origin === "admin"
                              ? t("studio.elements.added")

## i18n en studio.elements.overridden
146:    "overridden": "Changed",

## Screens: screens/en/dom-p3-published.png, screens/en/dom-p3b-95-publish-refused.png (EN Label column shows Arabic; all five weights 'Changed' while the diff lists two/one; the rubric diff shows raw JSON); screens/ar/dom-p3-published.png (AR, same page)
