# ADR-0049: The playbook reader (verbatim published blocks, en/ar search, block ↔ form/procedure/requirement links), the provenance statement and source foundations, element provenance and guiding-question tags, the Realize label, `GET /me/navigation`, versioned branding with a configurable product name, and the two text rules (no official-PMI claim; no DG0–DG7 in product text)

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-06), 2026-10-14.
- **Requirements (slice I of `docs/architecture/p5-plan.md`):** REQ-PB-001, REQ-PB-002, REQ-PB-011, REQ-PB-077, REQ-S01-002, REQ-S02-004, REQ-S03-007, REQ-S03-010, REQ-S15-004, REQ-S21-001.
- **Sources (quoted where a design point has one; D-142 Q5: the playbook text is rendered verbatim):**
  - B0004 "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit."
  - B0016 "Every transformation deliverable should answer one of four questions: Why change? What must become different? How will we execute? How will we prove value?"
  - B0024 "PMI/Brightline connection …"; B0124 "This phase aligns with PMI Benefits Realization Management logic: identify expected benefits, deliver/measure them during execution, and sustain benefits after transition to the business."
  - B0154–B0156 "Source Base & What Is Custom", "PMI / Brightline foundations", the table "Source | Used for"; B0157–B0162 "Custom extensions in this playbook": B0158 "The 6-phase integrated methodology …", B0159 "The 10-dimension Target Operating Model.", B0160 "The stage-gate structure and most practical templates.", B0161 "The initiative scoring model, governance cadence, 30-60-90 launch plan and health check.", B0162 "The worked roaming example and traceability chain."
  - M0077 "Working product name: Mobily Transformation Hub. Make the name configurable."; M0088 "Link source text to its operational forms."; M0089 "… do not claim that the application or entire methodology is an official PMI standard or certified product."; M0100–M0113 (the fourteen areas and their contents); M0103 "Playbook and Procedures: searchable source, guidance and executable procedures."; M0301 "Provide a Branding Settings screen for logo, approved primary/secondary colors, fonts, name and report header/footer. Changing a token updates all screens and generated output templates. … Do not depend on public font CDNs. If the official logo is missing, use a clearly provisional text wordmark instead of inventing a logo."; M0412 "product gate G6 does not imply engineering release DG7 has passed, and a demo Sponsor approval does not approve a real Mobily transformation."
- **Decisions applied:** D-141, D-142 (Q1 stable identities and version-scoped attributes; Q5 verbatim playbook text; R1 each row judged on its own acceptance text), D-143–D-148; D-088 §2, F-DG3-100, F-DG4-160.
- **Builds on:** ADR-0002 (modules), ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0009 (design tokens and accessible-shade derivation), ADR-0016 (lock registry), ADR-0039 (configuration kinds, `methodology_element`, `ConfigResolver`, the publish pipeline), ADR-0042 (procedures and their launch), ADR-0045/ADR-0046 (report templates and exporters, which read branding through a port).
- **Physical model:** `0089_p5_reader_provenance_branding.sql`, `0091_p5_reader_branding_demo_permissions.sql`. The guard probe (`docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/probe-output.txt`) tests this ADR's database claims in groups S01–S08 (seeds), T01–T04 (text rules), PB/PL (blocks, search, links), MP (profiles), MR (Studio reader namespaces), BR (branding) and AO (grants).
- **Two gate systems.** Nothing here reads or writes DG0–DG7. Reading or searching the methodology approves nothing; branding is configuration, not a business approval.

## Context

1. The playbook text exists only as `docs/source/playbook.md`. `source_element` (`0064`) holds the 80 counted source elements (labels only), and the seeded methodology version v1 (`0011`, key `playbook`) holds a `definition` summary. No table holds the 165 blocks, so nothing can be searched, linked or shown verbatim.
2. Studio (ADR-0039) versions attributes in `methodology_element` rows keyed `(methodology_version_id, element_type, stable_key)`. Element type `methodology_text` takes any stable key and the attributes `labelEn/labelAr/helpEn/helpAr/bodyEn/bodyAr`.
3. `GET /api/v1/branding/tokens` (DG1, `getBrandingTokens`) returns the static `@mth/design-tokens` set; `admin/branding.ts` says "Read-only at DG1: Branding Settings (editing) is P5". The product name is the i18n string `common.productName` ("Mobily Transformation Hub" / "منصة موبايلي للتحوّل").
4. The web shell (`apps/web/src/app/nav.ts`) shows the fourteen areas and hides Administration client-side by `ADMIN_PERMISSIONS`. `identity/navigation.ts`, `admin/environment.ts` and the methodology reader files are BE-A stubs.

## Decision

### 1. Verbatim blocks and the published reader (REQ-S03-010, REQ-S02-004)

**Entity `playbook_block`** (catalogue; `0089`; seeded by BE-Q in `0092`). Fields:
- `block_ref` `B0001`…`B0165` (PK) and `ordinal` = its number (`playbook_block_ordinal_matches`);
- `block_kind` `text` | `table`, `is_heading`, `section_block_ref` (the heading the block sits under, an earlier block: `playbook_block_section_before`), `phase_code` (the phase whose section holds it, for the Diagnose…Realize sections; null elsewhere);
- `text_en`: **verbatim** from `docs/source/playbook.md` (a table block keeps the source's Markdown rows); `text_ar`: a provisional translation, with `ar_provisional` (true at seed);
- `search_en`, `search_ar`: stored generated `tsvector`s (§3).

The verbatim text, position and section never change (`playbook_block_immutable`, as the owner too); only `text_ar`/`ar_provisional` may be corrected, by a migration. No block is ever deleted. mth_app has SELECT only.

**The reader resolves a methodology version.** Without `transformationId`, it reads the latest **published** version of kind `methodology` (key `playbook`); with `transformationId`, the transformation's pinned version (ADR-0039 §3; `transformation.read` required, else 404). The verbatim text is the same for every version, because every version is based on the playbook v1.0 source. What a version can add, through Studio and the publish pipeline only, is:
- **guidance** shown beside a block: a `methodology_text` element with stable key `block.<Bxxxx>`, attributes `bodyEn`/`bodyAr`;
- **link additions and removals** on that same element: `linksAdded`/`linksRemoved`, each `{targetKind: "template" | "procedure" | "requirement", targetKey}`;
- a **provenance note** (§5) and **profile overrides** (§2).

The database enforces these namespaces with the extra trigger `methodology_element_reader_guard` (§6); `methodology_element_guard` is not redefined.

### 2. Element provenance and guiding-question tags (REQ-PB-002, REQ-PB-011)

**Entity `methodology_element_profile`** (catalogue; `0089`, 56 rows). Fields: `element_ref` = `<element_kind>.<stable_key>`; `element_kind`; `source_element_id` (labels come from it) or own `label_en`/`label_ar` (`methodology_element_profile_label`); `provenance` `custom_extension` | `foundation_inspired`; `provenance_source_ref`; `question_tag` → `guiding_question`; `source_refs` (the blocks that define the element, B0001–B0165).

Seeded, following B0156–B0162 exactly:

| Element kind | Rows | Provenance | Source |
|---|---|---|---|
| `phase` | 6 | custom_extension | B0158 |
| `tom_dimension` | 10 | custom_extension | B0159 |
| `gate` | 6 | custom_extension | B0160 ("stage-gate structure") |
| `template` | 16 (T01–T16) | custom_extension | B0160 ("most practical templates"; REQ-PB-002 notes: all of T01–T16 unless an admin records otherwise) |
| `scoring_model` | 1 | custom_extension | B0161 |
| `forum` | 5 (governance cadence) | custom_extension | B0161 |
| `launch_window` | 3 (30-60-90 launch plan) | custom_extension | B0161 |
| `health_check` | 1 | custom_extension | B0161 |
| `roaming_example` | 1 | custom_extension | B0162 |
| `traceability_chain` | 1 | custom_extension | B0162 |
| `benefit_lifecycle_step` | 6 | foundation_inspired | B0156 ("PMI Benefits Realization Management … Benefit identification, delivery/measurement and sustainment logic") |

The kind → source mapping is a CHECK (`methodology_element_profile_kind_source`), and `foundation_inspired` exactly when the source is B0156 (`methodology_element_profile_provenance`). The two modes (B0009) are in neither list of the source and get no profile. **No element is labelled a PMI standard:** `foundation_inspired` is shown as "Inspired by {source}" and never as "PMI standard".

**Guiding questions** (`guiding_question`, 4 rows, B0016 verbatim, provisional Arabic). **Exactly one tag per template** (`methodology_element_profile_question_tag`: a template has one, any other kind none). The mapping is an analyst default, because the source gives the rule and not the mapping (REQ-PB-011 notes):
- `why_change` "Why change?": T01;
- `what_different` "What must become different?": T02, T03, T04;
- `how_execute` "How will we execute?": T05, T06, T07, T08, T11, T12, T13, T15, T16;
- `how_prove_value` "How will we prove value?": T09, T10, T14.

**Override through Studio** ("edit: ADM (versioned publish only)"): a `methodology_element` of type `methodology_text` with stable key `profile.<element_ref>` and attributes `provenance` and/or `questionTag`. The trigger refuses an unknown element, a value outside the sets, a question tag on a non-template and links on a profile key (`methodology_element_reader_profile`). The resolved profile for a version is the override when present, else the catalogue row; the API returns `overridden: true|false`.

**Badges.** The reader, Studio and every form header show the provenance badge "Custom extension (playbook v1.0)" / "امتداد مخصص (الدليل، الإصدار 1.0)" or "Inspired by PMI/Brightline/BRM foundations" / "مستوحى من أسس PMI/برايتلاين/إدارة تحقيق المنافع", and the question tag, in en and ar (render-time i18n keys `methodology.provenance.<value>`, `methodology.question.<code>`).

### 3. Search in English and Arabic (REQ-S03-010)

`search_en = to_tsvector('english', text_en)` and `search_ar = to_tsvector('arabic', text_ar)`, stored, each with a GIN index. **Verified on the pinned server:** PostgreSQL 16.13 lists the `english` and `arabic` text search configurations (`pg_ts_config`, probe S08); `to_tsvector('arabic', …)` uses the Snowball Arabic stemmer shipped with PostgreSQL. No extension and no dependency is added.

`searchMethodology` (`GET /methodology/search?q=&lang=en|ar&phase=&transformationId=&cursor=&limit=`):
- `q` 2–200 characters after the free-text rules; otherwise 400 `validation.search_query`;
- query `websearch_to_tsquery('<config>', q)` against the column of `lang` (default: the caller's UI language);
- results ordered by `ts_rank` then `block_ref`, with a plain-text snippet (`ts_headline` with private sentinel markers that the API turns into `highlights[{offset, length}]`; no HTML is ever returned) and the block's `phaseCode` and section;
- the rank itself is not returned (it is not a decimal business value).

REQ-S03-010's acceptance: searching "value pools" returns the Diagnose blocks (probe PB03 shows the stemmed English match on B0029 of the Diagnose section).

**Launch.** A result or block whose links include a procedure shows "Launch", which calls slice C's `launchProcedureInstance` (ADR-0042) with the caller's rights ("launch-procedure: roles allowed by the procedure"). The reader never launches by itself. REQ-S03-010's "the 'Launch' action on the gate-review procedure creates a procedure instance" is that call.

### 4. Block ↔ form, procedure and requirement links (REQ-S02-004)

**Entity `playbook_block_link`** (catalogue, append-only; seeded by BE-Q in `0092`): `(block_ref, target_kind, target_key)`, `ordinal`. `target_key` shape per kind (`playbook_block_link_target_shape`): a template `T01`–`T16`, a requirement `REQ-…-NNN`, a procedure code `^[a-z][a-z0-9_]{0,62}$`. The seed contains at least each template's table block → its template (T01: B0031 → `T01`, …) and each template block → the requirement IDs of its register.

**Resolved links** for a version are the seeded links, plus `linksAdded`, minus `linksRemoved` of that version's `block.<Bxxxx>` element. **Both directions:**
- `listMethodologyBlockLinks` (`GET /methodology/blocks/{blockRef}/links`) returns each link with its label and the web route that opens it: the template's register in the caller's transformation context, the procedure definition (with "Launch"), or the requirement row of the published requirement register (M0088);
- `listTemplateSourceLinks` (`GET /methodology/templates/{templateCode}/source-links`) returns the blocks that link to a template.

The T01 form header shows "Source: B0031" linking back to the reader. REQ-S02-004's acceptance: "opening block B0031 (Template 1) shows a link that opens the T01 register; the T01 form shows a source link back to B0031".

### 5. Provenance statement, source foundations and the Realize label (REQ-PB-001, REQ-PB-077)

`getMethodologyProvenance` (`GET /methodology/provenance`) returns:
- `statement`: block B0004, verbatim in English, with its provisional Arabic;
- `connectionNote`: B0024 verbatim;
- `foundations`: the three `source_foundation` rows (B0156, verbatim);
- `customExtensions`: B0157–B0162 verbatim;
- `realizeNote`: B0124 verbatim;
- `note`: the version's `provenance.note` element (`bodyEn`/`bodyAr`) or null.

**The statement itself is never edited:** an admin can add only a note, through Studio publish ("edit-text: ADM (via versioned publish)"). The reader ("About this methodology"), the About page and every generated report footer (ADR-0045/0046 templates, through BE-N's layout) show B0004 verbatim. **Realize:** the Realize phase guidance shows B0124, which contains "aligns with PMI Benefits Realization Management logic" (REQ-PB-077), and no certified/official wording (the claim rule, §7, passes on it: probe PB05, T02).

### 6. The reader namespaces in Studio (database rule)

`methodology_element_reader_guard` (BEFORE INSERT OR UPDATE on `methodology_element`) acts only on `methodology_text` rows whose key is `profile.*`, `block.*` or `provenance.note`, and on any row that uses `provenance`, `questionTag`, `linksAdded` or `linksRemoved`:
1. those attributes exist only on `methodology_text` rows of these namespaces (`methodology_element_reader_namespace`);
2. `profile.<element_ref>` names a profile row; `provenance` is in the set; `questionTag` names a guiding question and only for a template (`methodology_element_reader_profile`);
3. `block.<Bxxxx>` names a block; each link is an object of the shapes in §4; at most 50 per list (`methodology_element_reader_block`);
4. none of `labelEn`, `labelAr`, `helpEn`, `helpAr`, `bodyEn`, `bodyAr` claims official PMI status or names DG0–DG7 (`methodology_element_reader_text`, §7).

Every other `methodology_text` row (for example `help.charter`) is unaffected (probe MR12). The API mirrors these rules in `CONFIG_ELEMENT_ATTRIBUTES.methodology_text` (BE-Q extends it with the optional `provenance`, `questionTag`, `linksAdded`, `linksRemoved`) and answers 422 with the §11 codes before the database does.

### 7. The two text rules (REQ-PB-001, REQ-S21-001)

**Claim rule** (`p5_claims_official_pmi(text)`, IMMUTABLE; the TypeScript mirror is `packages/shared/src/text-scan/claims.ts`, BE-R). A text **claims** official PMI status when, after every negated mention is removed, it still matches (case-insensitive) one of:
- `official(ly)? (a|an)? PMI`;
- `PMI[ -]*(certified|certification|accredited|endorsed|approved)`;
- `certified (by|under) (the)? PMI`;
- `PMI standard (product|application|platform|tool|software)`;
- the Arabic forms `معتمد(ة) من (قبل)? PMI|معهد إدارة المشاريع`, `(معيار|معايير|منهجية) PMI … (الرسمي|الرسمية)`, `شهادة PMI …`, `PMI … (الرسمي|الرسمية|المعتمد|المعتمدة)`, `(رسمي|رسمية|رسميًا|رسمياً) من PMI|معهد إدارة المشاريع`.

A negated mention is one of those phrases preceded by `not`, `never`, `no`, `nor`, `without`, `isn't`, `aren't` (optionally plus "a/an/the") or by `ليس`, `ليست`, `لا`, `غير`, `دون` (optionally followed by one word, as in "ليس معيارًا رسميًا من PMI"). So "Not an official PMI standard." is allowed. It is a true disclaimer, and `0011`'s definition text contains it.

Probe T01–T02 show that the rule flags the nine claim samples and accepts B0004, B0124, "Official references" (B0163), the negated disclaimers in en and ar, the shipped About text `common.methodBody` in en and ar, and empty or null text.

**Engineering-gate rule** (`p5_mentions_engineering_gate(text)`): matches `DG` + optional space or hyphen + a digit 0–7 (Western or Arabic-Indic) that is not part of a longer word or number. "G6", "DG8", "DG10" and "EDG7" do not match (probe T03–T04).

**Where they apply:**
- in the database: on branding texts (§8) and on the Studio reader namespaces (§6);
- in BE-R's test scans `apps/api/test/text-scan/**`, which run both rules over:
  - (a) every string of `apps/web/src/i18n/{en,ar}/*.json`;
  - (b) every English and Arabic problem `detail` text of the API;
  - (c) the report and export templates of `packages/reporting/**` and `apps/api/src/modules/reporting/**` (literal strings, and the rendered text of one sample export per format in en and ar).

The scan fails on any claim and on any DG0–DG7 match, which is REQ-S21-001's "a text scan of UI strings and export templates finds no DG0-DG7 references". It is scoped to product text: engineering records under `docs/delivery/**` and code comments are not product text. A test asserts that the TypeScript mirror and the SQL functions agree on one corpus. **Demo approvals** are labelled "Synthetic demonstration - approves nothing real" (ADR-0050 §2).

### 8. Versioned branding and the product name (REQ-S15-004, REQ-S01-002)

**Entity `branding_version`** (append-only, audited insert). One immutable version per save, per organization, numbered 1, 2, 3 …: the version step is checked under lock 730270 (`branding_version_step`), with the unique `(organization_id, version_no)` as the backstop. Fields:
- `product_name_en`, `product_name_ar` (1–80);
- `primary_colour`, `secondary_colour` (`#RRGGBB` upper case), and `colours_provisional`, which is true exactly when no `colour_approval_reference` is recorded (`branding_version_colour_approval`). This is M0301's "approved" colours: an admin records the reference of the brand approval they hold. The platform approves nothing, and #0078FF stays provisional until then;
- `font_latin` = `IBM Plex Sans`, `font_arabic` = `IBM Plex Sans Arabic`: only the locally bundled OFL fonts (5.2.6, D-146), never a font CDN;
- `logo_png` (a PNG of 67 B–256 KiB, signature checked; no SVG, so no script content), `logo_sha256` equal to its hash, and alt texts in both languages, all or none (`branding_version_logo_complete`);
- `report_header_en/ar`, `report_footer_en/ar`, each in pairs (`branding_version_header_pair`, `branding_version_footer_pair`);
- `change_note`, `created_at`/`created_by`;
- no text claims official PMI status or names DG0–DG7 (`branding_version_no_pmi_claim`, `branding_version_no_engineering_gate`).

**Entity `branding_setting`** (one per organization, P2 guards): `current_version_no`, which always equals `version` (`branding_setting_version_matches`) and is always the latest branding version (`branding_setting_current_latest`), with a composite FK to it.

**Version 0 is the default**, when no row exists:
- the name "Mobily Transformation Hub" / "منصة موبايلي للتحوّل" (the shipped i18n texts);
- the `@mth/design-tokens` colours, `brand.primary` #0078FF and `brand.deep` #003B73 as the secondary colour, all provisional;
- the bundled fonts;
- no logo, so the shell shows the **provisional text wordmark**: the product name with the label "Provisional wordmark" / "شعار نصي مؤقت";
- no report header or footer beyond the defaults of ADR-0045.

A fresh install therefore shows "Mobily Transformation Hub" (REQ-S01-002).

**Publish** (`putBrandingSettings`, `PUT /admin/branding`, `If-Match` = the head version, `"0"` when none). In one transaction under lock 730270:
1. insert `branding_version` n+1 with its audit event;
2. insert the head (`If-Match: "0"`) or step it to n+1, with its audit event;
3. write one outbox event `branding.published {organizationId, versionNo}`.

There is no remote I/O in the transaction. The body is the complete settings object; `logo` is `{mode: "keep"}` | `{mode: "none"}` | `{mode: "set", pngBase64, altEn, altAr}`.

**Render-time reads (REQ-S15-004 "a token change updates all screens and generated output templates"):**
- `getBranding` (`GET /branding`, session) returns the current version.
- `GET /branding/tokens` (DG1, shape unchanged) now merges the current version's two colours into the token set and derives the accessible shades from them with the ADR-0009 §3 function at read time. `provenance` is `official` only when the version's colours are not provisional **and** every other token is not provisional, which no shipped token is, so it stays `provisional`.
- The web shell themes itself from these two reads after login and on the outbox-driven cache refresh: the navigation colour is `nav.background` and the action colour is derived from `brand.primary`.
- The report and export layout (BE-N) reads the version current **at generation time** through a `BrandingReadPort` (name, colours, header/footer, logo).

So the next generated PDF's header uses the new colour and name without a code change or redeploy (A20; REQ-S01-002 "the next generated report header"). An issued snapshot keeps the branding version number it was rendered with (`brandingVersionNo` in its content). Issued outputs never change.

### 9. Navigation: `GET /me/navigation` (REQ-S03-007)

`getMyNavigation` returns the areas the caller may see, in this order, each with the §3 contents (M0100–M0113). An item is visible when the caller holds its permission in at least one scope; an area is visible when at least one of its items is. Hidden areas and items are **omitted by the server**: they are not sent with a flag.

| # | Code (web id) | Items (M01xx contents) → permission |
|---|---|---|
| 1 | `my_work` (`myWork`) | assigned actions, drafts, reviews, approvals, missing updates, upcoming deadlines → session (every signed-in user) |
| 2 | `executive_overview` (`executive`) | outcomes, value, critical initiatives, adoption, blockers, decisions → `transformation.read` |
| 3 | `transformations` (`transformations`) | portfolio, transformation workspaces → `transformation.read` |
| 4 | `playbook_procedures` (`playbook`) | searchable source, guidance → session; executable procedures → `procedure.read` |
| 5 | `strategy_kpis` (`strategy`) | outcome trees, definitions, targets, actuals, performance reviews → `transformation.read` |
| 6 | `target_operating_model` (`tom`) | canvas, gaps, capabilities, processes, design decisions → `transformation.read` |
| 7 | `initiatives_roadmaps` (`initiatives`) | cases, prioritization, waves, resources, milestones, dependencies → `transformation.read` |
| 8 | `governance` (`governance`) | forums, meetings, decision rights, RACI, approvals, stage gates → `transformation.read` |
| 9 | `risks_actions` (`risks`) | integrated RAID, corrective actions, escalations → `transformation.read` |
| 10 | `benefits_finance` (`benefits`) | formulas, realization, validation, forecasts → `transformation.read` |
| 11 | `change_adoption` (`change`) | stakeholders, interventions, adoption indicators → `transformation.read` |
| 12 | `evidence_reports` (`evidence`) | native deliverables, attachments, snapshots, generated packs → `transformation.read` |
| 13 | `bau_improvement` (`bau`) | handovers, controls, lessons, improvement backlog → `transformation.read` |
| 14 | `administration` (`admin`) | methodology → `methodology.publish` or `methodology.review` or `config_review_policy.configure`; forms → `methodology.publish`; workflows → `methodology.publish`; automation → `automation.configure` or `job.read`; organization → `organization.manage` or `business_unit.manage`; access → `user.read` or `user.manage` or `access.read` or `access.assign`; branding → `branding.configure`; environment → `demo.reset` |

**Consequences of the Administration row:**
- ADM_TECH, ADM_ACCESS and ADM_METHOD see it;
- TO sees it for the Studio review page; AUD sees it read-only through `user.read`/`access.read`, the DG1 `ADMIN_PERMISSIONS` rule;
- a Workstream Lead, who holds none of these codes, does not see it (REQ-S03-007's acceptance; BE-R's test asserts WL's codes against this list).

An ADM test user holding the union of the role defaults sees all 14 areas, in en and ar. Each item carries `path` (the web route) and `availability` (`working` | `planned`); an item is `planned` only while its P5 screen is not merged, and FE tasks flip it in the same change (F-DG4-160). The response is the same for every scope of one user (no transformation parameter); scoped hiding inside an area stays with each screen's own read checks.

### 10. Authorization (permissions matrix §23)

| Operation group | Permission | Role defaults (`0091`) |
|---|---|---|
| Read blocks, search, links, provenance, element profiles, guiding questions | session ("view: all signed-in users"); with `transformationId`, also `transformation.read` there (else 404) | every signed-in user |
| Edit reader guidance, links, provenance overrides, question tags, the provenance note | `methodology.configure` + `methodology.publish` (slice A Studio; review per the seeded policy) | ADM_METHOD; review TO |
| Read branding, the logo, the tokens; `GET /me/navigation` | session | every signed-in user |
| Read and edit branding settings, versions | `branding.configure` | ADM_TECH |

AUD gets 403 on `PUT /admin/branding` and on every Studio write (AUD holds neither code). No code here is a business approval; technical administrators hold only `configure` codes (REQ-S10-003). Every mutation re-checks its permission at commit, validates, needs `If-Match` (428/409), writes one audit event per row, and does no remote I/O inside the transaction.

### 11. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 400 | `validation.search_query` | Enter a search term of 2 to 200 characters. |
| 404 | `methodology_block.not_found` | This playbook block does not exist. |
| 404 | `methodology_template.not_found` | This template does not exist. |
| 422 | `methodology_reader.invalid_override` | A provenance or question-tag override must name a seeded element, use an allowed value, and tag only a template. |
| 422 | `methodology_reader.invalid_block_link` | A block link must name an existing block and a template, procedure or requirement in the allowed format. |
| 422 | `methodology_reader.prohibited_text` | Reader text must not claim official PMI status or certification, or name an engineering delivery gate. |
| 422 | `branding.prohibited_claim` | Branding text must not claim official PMI status or certification. |
| 422 | `branding.engineering_gate_reference` | Branding text must not name an engineering delivery gate. |
| 422 | `branding.logo_invalid` | The logo must be a PNG image of at most 256 KiB, with alternative text in English and Arabic. |
| 422 | `branding.colour_invalid` | Colours must be six-digit hexadecimal values such as #0078FF. |
| 422 | `branding.font_unavailable` | Only the bundled fonts IBM Plex Sans and IBM Plex Sans Arabic can be selected. |
| 422 | `branding.text_pair_required` | Enter the report header and footer in both English and Arabic, or leave both empty. |
| 404 | `branding.logo_not_found` | No logo is configured; the provisional text wordmark is shown. |

None of these texts names DG0–DG7 or claims official status: the §7 scans cover the problem texts too. Database constraint names map to these codes in `platform/db-errors.ts` (BE-Q: `methodology_element_reader_*`; BE-R: `branding_*`).

### 12. Locks and events

- **730270** `brandingPublish`, key `<organizationId>`: taken by `branding_version_guard` and `branding_setting_guard`.
- Outbox event `branding.published` (schema_version 1) refreshes the web theme cache. The reader writes nothing and publishes nothing; its Studio edits use slice A's locks and events.

## Alternatives considered

- **New Studio element types (`reader_block`, `reader_link`, `element_profile`).** These would need a third redefinition of `methodology_element_guard()` (after `0068` and `0086`) and widening its type CHECK. The reserved key namespaces of the existing `methodology_text` type plus one extra trigger are additive and leave that function untouched. Rejected.
- **Version-scoped copies of all 165 blocks per methodology version.** The source text is the same for every version (playbook v1.0); copying it would let a draft change the verbatim text that REQ-PB-001 requires unchanged. Rejected: the text is one immutable catalogue, and versions add guidance beside it.
- **Columns `provenance`/`question_tag` on `source_element`.** The 80-row inventory counts REQ-S02-001's sets exactly. The scoring model, the health check as one element and the traceability chain are not rows there, and adding sets would change the source-coverage counts of ADR-0039 §6. Rejected for a separate profile table.
- **`pg_trgm` or an external search engine.** These would be a new extension or a new runtime service, and the stemmed `english`/`arabic` configurations already meet the acceptance. Rejected.
- **A branding head row only (mutable), with the audit trail as the history.** REQ-S15-004 says "saving publishes a new branding version", and snapshots must name the version they used. Rejected for immutable versions plus a head.
- **SVG logos.** An SVG is script-capable content (an XSS risk in the shell and in exports). Rejected; PNG only.

## Consequences

- One DG1 code path changes: the source of `GET /branding/tokens` (its shape is unchanged; §8). Its DG1 comment "Read-only at DG1" becomes untrue and is updated by BE-R (F-DG4-160).
- `apps/web/src/app/nav.ts` keeps its static list as the fallback for the unauthenticated shell. The authenticated shell renders `/me/navigation`, a FE-G change.
- Arabic block texts, guiding questions, foundations and badges are provisional translations, labelled so where the UI labels provisional translations; a Mobily Arabic editor must review them.
- Search quality in Arabic depends on the Snowball Arabic stemmer; the reader also offers browsing by phase and section.

## Verification

- Probe (`probe-output.txt`): S01–S08, T01–T04, PB01–PB11, PL01–PL04, MP01–MP06, MR01–MR13, BR01–BR22 and AO01 (the slice I part of 96/96).
- BE-Q tests: every block's `text_en` equals `docs/source/playbook.md` at its anchor (165/165); "value pools" returns the Diagnose blocks; B0031 ↔ T01 in both directions; every B0158–B0162 element returns `provenance=custom_extension` from `listMethodologyElements?provenance=custom_extension`; every template returns exactly one question tag; the four questions render verbatim in en, with ar.
- BE-R tests: the two text scans (§7) and the SQL/TypeScript agreement; a branding PUT changes `GET /branding/tokens` `brand.primary` and the next generated PDF's header colour (with BE-N's port); a fresh database returns "Mobily Transformation Hub"; `/me/navigation` gives the ADM user 14 areas and hides Administration from WL; AUD gets 403 on `PUT /admin/branding`; `If-Match` gives 428/409; one audit event per row.

## Amendment (2026-10-17, T-DG5-ARCH-R1; D-163, D-164 (i), D-166): §9 the shell renders only `GET /me/navigation`, and §8 the navigation background follows `brand.primary`

Sources: D-163 (FE-G handback §6.1, decided as option (a); the REQ-S15-004 acceptance text closed), D-164 (i) (accepted), and the T-DG5-FE-G2 handback §1 and §2. Nothing above is removed. §8 and §9 are read with this amendment.

### N1. §9: the shell renders exactly the server's answer (D-163 (a); T-DG5-FE-G2)

- **The shell.** `apps/web/src/app/Shell.tsx:42` shows exactly the areas `GET /me/navigation` returns, in the `nav.ts` order (`visibleAreaIds`, `apps/web/src/app/me-navigation.ts:48`). There is **no client-side fallback list**: a body that is not the contract's shape is a query error.
  - While the call is pending, the shell shows no area list (`aria-busy`, "Loading navigation…").
  - On a failure, it shows the error state with a retry.
  - `data-nav-state` is `loading`, `ready` or `error`.
- **Why.** REQ-S03-007 says "areas and items the user cannot access are hidden server-side", and §9 implements exactly that. The shell no longer decides visibility itself.
- **The two DG1 journey pins changed, not this ADR** (D-163). `apps/web/e2e/journeys.spec.ts` pinned what the DG1 shell showed before the server rule existed. REQ-S03-007 spans P1–P5 and closes at DG5.
  - `:207–210`: the Transformation Office sees **14** areas, including Administration. TO holds `methodology.review` for the Studio review, so the §9 Administration row applies. The DG1 pin said 13, with no Administration.
  - `:416–420`: the technical administrator `dev.admin` (ADM_ACCESS + ADM_TECH, no `transformation.read`) sees **My Work, Playbook and Administration**. The DG1 pin said 14. The administration journey still reaches its screens through Administration.
  - The DG1 gate record is not touched.
- **Acceptance.** "An ADM sees 14 areas in en and ar; a Workstream Lead does not see Administration" is proven in `apps/web/e2e/p5-navigation.spec.ts`, as §9's last paragraph says:
  - a synthetic user holding the union of the role defaults (every role of `GET /roles`, at organization scope) sees all 14 areas;
  - a synthetic Workstream Lead sees no Administration, and `/admin` gives the no-permission state.

Requirement row: REQ-S03-007.

### N2. §8: the navigation background is derived from `brand.primary` (D-163, D-164 (i); T-DG5-FE-G2)

- **The token** (`packages/design-tokens/src/tokens.json`). `nav.background` is no longer a reference to `brand.deep`. It is a **derived** token from `brand.primary`, by the function `deriveNavigationBackground(primary)` (`packages/design-tokens/src/contrast.ts:84`).
  - It is `primary` itself when white navigation text (`nav.text`, `#FFFFFF`) reaches at least 4.5:1 on it (WCAG 2.1 relative luminance).
  - Otherwise it is the **lightest** darker shade that does. The colour is darkened deterministically in HSV value steps of 0.1 %: the RGB channels are scaled towards black, so hue and saturation are kept.
  - Examples: the provisional `#0078FF` gives **`#0071F1`** (4.53:1 with white), `#FFD700` gives `#8B7500`, and `#003B73` stays itself.
- **`nav.text-muted` = `nav.text`** (a reference, white). A background guaranteed 4.5:1 only against white cannot guarantee 4.5:1 for any other text colour. Secondary navigation items differ by size, never by colour alone.
- **At render time.** `GET /branding/tokens` re-derives every `derived` token from the current branding version (§8, unchanged), and the web themes `nav.background` from it (`apps/web/src/pages/branding/api.ts` `THEMED_TOKENS`). Publishing a new primary colour therefore recolours the navigation without a code change or a redeploy.
  - So §8's "the navigation colour is `nav.background`" stays true. `nav.background` now follows `brand.primary`, not `brand.deep`.
  - The header gradient still starts at `brand.deep`.
  - The Branding Settings contrast preview checks the navigation against the derived colour, and the header against the secondary colour.
- **Contrast check.** `pnpm --filter @mth/design-tokens run check:contrast` passes 50 pairs (D-164 (i)).
- **Provisional.** Every token stays `provisional: true`. `#0078FF` and `#0071F1` are provisional brand tokens, **not** verified Mobily colours.
- **Limitation (D-164 (i)).** The Studio badge reflects the published methodology's profiles, so a draft's own override shows only after publication.

Requirement row: REQ-S15-004 ("changing brand.primary in Branding Settings changes the navigation colour …"; the navigation part). Test: `p5-navigation.spec.ts` (publishing `#C8102E` gives the computed background `rgb(200, 16, 46)`, `#FFD700` gives `rgb(139, 117, 0)`, and the default is restored afterwards).
