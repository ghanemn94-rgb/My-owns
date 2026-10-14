# T-DG5-ARCH-06: appends the slice I and J operations (ADR-0049, ADR-0050) to docs/api/openapi.yaml (info.version stays
# 1.4.0-p5). Every P1-P4 path and every slice A-H path stays byte-stable, except one additive enum extension: the
# PermissionCode enum gains branding.configure and demo.reset (the slice A-H precedent). GET /api/v1/branding/tokens
# (DG1) is unchanged. The helper functions are copied from the T-DG5-ARCH-05 generator.
# Run once from the repository root: python3 -I docs/delivery/handbacks/DG5/T-DG5-ARCH-06-evidence/openapi-p5-arch06.py
F = "docs/api/openapi.yaml"
s = open(F).read()
assert s.count("\n  version: 1.4.0-p5\n") == 1
assert "/api/v1/methodology/search:" not in s, "already applied"

R = lambda name: f'{{ $ref: "#/components/responses/{name}" }}'
NAMES = {400: "ValidationError", 401: "Unauthenticated", 403: "Forbidden", 404: "NotFound", 409: "VersionConflict",
         422: "BusinessRule", 428: "PreconditionRequired", 429: "RateLimited"}
def resp(codes):
    out = ""
    for c in codes:
        if isinstance(c, tuple):
            out += f'        "{c[0]}": {R(c[1])}\n'
        else:
            out += f'        "{c}": {R(NAMES[c])}\n'
    return out
def key(c):
    return int(c[0]) if isinstance(c, tuple) else c

def op(method, tag, opid, summary, *, params=(), body=None, ok=200, okdesc="OK.", schema=None, etag=False, created=False,
       ifmatch=None, codes=(400, 401, 403, 404, 422, 429), write=True, png=False):
    out = f"    {method}:\n      tags: [{tag}]\n      operationId: {opid}\n      summary: \"{summary}\"\n"
    if write:
        out += "      security:\n        - sessionCookie: []\n          csrfToken: []\n"
    ps = list(params) + ([ifmatch] if ifmatch else [])
    if ps:
        out += "      parameters:\n" + "".join(f'        - $ref: "#/components/parameters/{p}"\n' for p in ps)
    if body:
        out += f'      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: {{ $ref: "#/components/schemas/{body}" }}\n'
    out += f'      responses:\n        "{ok}":\n          description: "{okdesc}"\n'
    hdr = []
    if created:
        hdr.append('            Location: { $ref: "#/components/headers/Location" }\n')
    if etag:
        hdr.append('            ETag: { $ref: "#/components/headers/ETag" }\n')
    if hdr:
        out += "          headers:\n" + "".join(hdr)
    out += "          content:\n"
    if png:
        out += "            image/png:\n              schema: { type: string, contentMediaType: image/png }\n"
    else:
        out += f'            application/json:\n              schema: {{ $ref: "#/components/schemas/{schema}" }}\n'
    cs = list(codes)
    if ifmatch:
        have = {key(c) for c in cs}
        for c in (409, 428):
            if c not in have:
                cs.append(c)
    cs.sort(key=key)
    return out + resp(cs)

def path(p, params, *ops):
    out = f"  {p}:\n"
    if params:
        out += "    parameters:\n" + "".join(f'      - $ref: "#/components/parameters/{x}"\n' for x in params)
    return out + "".join(ops)

RD = (400, 401, 403, 404, 429)
PUB = (400, 401, 429)
paths = []

# ---------------------------------------------------------------- slice I: the reader (ADR-0049 §1-§6)
RQ = ["MethodologyTransformationQuery"]
paths.append(path("/api/v1/methodology/blocks", [],
  op("get", "methodology-reader", "listMethodologyBlocks", "The 165 playbook blocks in source order, English verbatim with the provisional Arabic, and the guidance and link count of the resolved methodology version: the latest published one, or the transformation's pinned one with transformationId (session; with transformationId also transformation.read, else 404; REQ-S03-010).", params=RQ + ["MethodologyPhaseQuery", "Cursor", "Limit"], schema="MethodologyBlockPage", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/blocks/{blockRef}", ["MethodologyBlockRef"],
  op("get", "methodology-reader", "getMethodologyBlock", "One playbook block (verbatim) with the resolved version's guidance (session; REQ-S03-010). 404 methodology_block.not_found.", params=RQ, schema="MethodologyBlock", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/blocks/{blockRef}/links", ["MethodologyBlockRef"],
  op("get", "methodology-reader", "listMethodologyBlockLinks", "The resolved links of a block to the native forms (templates), procedures (with Launch) and requirement IDs that implement it: the seeded links plus the version's additions minus its removals (session; REQ-S02-004). 404 methodology_block.not_found.", params=RQ, schema="MethodologyLinkList", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/templates/{templateCode}/source-links", ["MethodologyTemplateCode"],
  op("get", "methodology-reader", "listTemplateSourceLinks", "The playbook blocks that link to a template, for the form's source link back to its playbook text (session; REQ-S02-004; T01 -> B0031). 404 methodology_template.not_found.", params=RQ, schema="TemplateSourceLinkList", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/search", [],
  op("get", "methodology-reader", "searchMethodology", "Full-text search of the published methodology text in English or Arabic (PostgreSQL 'english' and 'arabic' configurations), ordered by relevance, with plain-text snippets and highlight offsets; no HTML (session; REQ-S03-010). 400 validation.search_query.", params=["MethodologySearchQuery", "MethodologySearchLangQuery"] + RQ + ["MethodologyPhaseQuery", "Cursor", "Limit"], schema="MethodologySearchPage", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/provenance", [],
  op("get", "methodology-reader", "getMethodologyProvenance", "The provenance statement (B0004 verbatim), the PMI/Brightline connection (B0024), the source-foundations table (B0156), the custom extensions (B0157-B0162), the Realize note (B0124) and the version's optional note; never an official-PMI or certification claim (session; REQ-PB-001, REQ-PB-077).", params=RQ, schema="MethodologyProvenance", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/elements", [],
  op("get", "methodology-reader", "listMethodologyElements", "The seeded methodology elements with their resolved provenance (custom_extension or foundation_inspired, with the B0156-B0162 source) and, for templates, their one guiding-question tag (session; REQ-PB-002, REQ-PB-011).", params=["MethodologyProvenanceQuery", "MethodologyElementKindQuery"] + RQ, schema="MethodologyElementProfileList", write=False, codes=RD)))
paths.append(path("/api/v1/methodology/guiding-questions", [],
  op("get", "methodology-reader", "listGuidingQuestions", "The four guiding questions of B0016, verbatim in English with provisional Arabic (session; REQ-PB-011).", schema="GuidingQuestionList", write=False, codes=PUB)))

# ---------------------------------------------------------------- slice I: navigation (ADR-0049 §9)
paths.append(path("/api/v1/me/navigation", [],
  op("get", "navigation", "getMyNavigation", "The primary navigation areas (up to 14) and their M0100-M0113 contents the caller may see; areas and items without a permitted item are omitted by the server (session; REQ-S03-007).", schema="Navigation", write=False, codes=PUB)))

# ---------------------------------------------------------------- slice I: branding (ADR-0049 §8)
paths.append(path("/api/v1/branding", [],
  op("get", "branding", "getBranding", "The current published branding read at render time: product name (en, ar), colours with their provisional flag, bundled fonts, logo or the provisional text wordmark, report header and footer; version 0 = the defaults (session; REQ-S15-004, REQ-S01-002).", schema="Branding", write=False, codes=PUB)))
paths.append(path("/api/v1/branding/logo", [],
  op("get", "branding", "getBrandingLogo", "The current logo (PNG). 404 branding.logo_not_found when none is configured; the shell then shows the provisional text wordmark (session; M0301).", write=False, png=True, codes=(400, 401, 404, 429))))
paths.append(path("/api/v1/admin/branding", [],
  op("get", "branding", "getBrandingSettings", "The organization's branding settings with their head version (ETag \\\"0\\\" when never saved) and the colour approval reference (branding.configure; ADM_TECH; REQ-S15-004).", schema="BrandingSettings", etag=True, write=False, codes=(400, 401, 403, 429)),
  op("put", "branding", "putBrandingSettings", "Save and publish a new branding version (complete settings; If-Match the head version, \\\"0\\\" for the first save). Screens and report/export templates read it at render time; issued outputs never change (branding.configure; ADM_TECH; REQ-S15-004, REQ-S01-002). 422 branding.prohibited_claim, .engineering_gate_reference, .logo_invalid, .colour_invalid, .font_unavailable, .text_pair_required.", body="BrandingSettingsPut", schema="BrandingSettings", etag=True, ifmatch="IfMatchOrZero", codes=(400, 401, 403, 409, 422, 428, 429))))
paths.append(path("/api/v1/admin/branding/versions", [],
  op("get", "branding", "listBrandingVersions", "The organization's branding versions, newest first; immutable (branding.configure).", params=["Cursor", "Limit"], schema="BrandingVersionPage", write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/branding/versions/{versionNo}", ["BrandingVersionNo"],
  op("get", "branding", "getBrandingVersion", "One immutable branding version (branding.configure).", schema="BrandingVersion", write=False, codes=RD)))

# ---------------------------------------------------------------- slice J: environment, demo reset, walkthrough (ADR-0050)
paths.append(path("/api/v1/environment", [],
  op("get", "environment", "getEnvironment", "The deployment environment: production or demo; in a demo database every record and number is synthetic and every approval approves nothing real (session; REQ-S18-001, REQ-PB-089, REQ-S21-001).", schema="EnvironmentInfo", write=False, codes=PUB)))
paths.append(path("/api/v1/admin/environment", [],
  op("get", "environment", "getDemoEnvironmentStatus", "The environment kind, the latest demo dataset run (record counts, checksum, seed coverage) and whether an in-app reset is configured; ETag = the latest run number, \\\"0\\\" when none (demo.reset; ADM_TECH; REQ-S18-001, REQ-S18-002).", schema="DemoEnvironmentStatus", etag=True, write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/environment/demo-resets", [],
  op("post", "environment", "requestDemoReset", "Request a reset of the demo database to its seeded state: the worker re-creates the demo database and re-seeds it deterministically (identical counts and checksum). Refused outside a demo database (demo.reset; ADM_TECH; REQ-S18-001). 409 environment.not_demo, demo_reset.in_progress, demo_reset.not_configured.", ok=202, okdesc="Accepted (queued).", schema="DemoResetRequest", ifmatch="IfMatchOrZero", codes=(400, 401, 403, 409, 428, 429))))
paths.append(path("/api/v1/demo/walkthrough", [],
  op("get", "environment", "getDemoWalkthrough", "The twelve M0349 walkthrough steps with their area, route and completion evaluated from the persisted records of the given transformation; the guide writes nothing (session; demo database only; REQ-S18-004). 409 environment.not_demo.", params=["DemoWalkthroughTransformationQuery"], schema="DemoWalkthrough", write=False, codes=(400, 401, 403, 404, 409, 429))))

old_enum = "        - health_check.assess\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - health_check.assess\n        - branding.configure\n        - demo.reset\n    RoleCode:\n", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: methodology-reader
    description: The playbook reader with verbatim source blocks, English and Arabic search, block links, provenance, element provenance and guiding-question tags (P5, ADR-0049).
  - name: navigation
    description: The primary navigation areas the caller may see, hidden server-side (P5, ADR-0049).
  - name: branding
    description: Versioned branding settings and the configurable product name, read by screens and report templates at render time (P5, ADR-0049).
  - name: environment
    description: The deployment environment, the isolated and resettable demo environment and the guided walkthrough; demo data is synthetic (P5, ADR-0050).
"""
old_tags_end = "\nsecurity:\n  - sessionCookie: []\npaths:\n"
assert s.count(old_tags_end) == 1
s = s.replace(old_tags_end, "\n" + tags + "security:\n  - sessionCookie: []\npaths:\n", 1)

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
STR = "{ type: string }"
NSTR = '{ type: [string, "null"] }'
INT = "{ type: integer }"
INT0 = "{ type: integer, minimum: 0 }"
BOOL = "{ type: boolean }"
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
REF = lambda n: f'{{ $ref: "#/components/schemas/{n}" }}'
ARR = lambda n, mx=None: f'{{ type: array{", maxItems: " + str(mx) if mx else ""}, items: {{ $ref: "#/components/schemas/{n}" }} }}'
ENUM = lambda *v: "{ type: string, enum: [" + ", ".join(v) + "] }"
NENUM = lambda *v: '{ type: [string, "null"], enum: [' + ", ".join(v) + ", null] }"
SHA = "{ type: string, pattern: '^[0-9a-f]{64}$' }"
BLOCKREF = "{ type: string, pattern: '^B0[0-9]{3}$' }"
COLOUR = "{ type: string, pattern: '^#[0-9A-F]{6}$' }"
PHASE = ENUM("diagnose", "define", "design", "mobilize", "transform", "realize")
NPHASE = NENUM("diagnose", "define", "design", "mobilize", "transform", "realize")
PROV = ENUM("custom_extension", "foundation_inspired")
QTAG = ENUM("why_change", "what_different", "how_execute", "how_prove_value")
KINDS = ("phase", "gate", "tom_dimension", "template", "scoring_model", "forum", "launch_window", "health_check", "roaming_example", "traceability_chain", "benefit_lifecycle_step")
AREAS = ("my_work", "executive_overview", "transformations", "playbook_procedures", "strategy_kpis", "target_operating_model", "initiatives_roadmaps",
         "governance", "risks_actions", "benefits_finance", "change_adoption", "evidence_reports", "bau_improvement", "administration")
INTMAP = "{ type: object, additionalProperties: { type: integer, minimum: 0 } }"

def pparam(name, pname, schema, where="path", required=True, desc=None):
    out = f"    {name}:\n      name: {pname}\n      in: {where}\n      required: {'true' if required else 'false'}\n"
    if desc:
        out += f'      description: "{desc}"\n'
    return out + f"      schema: {schema}\n"
params = "".join([
  pparam("MethodologyBlockRef", "blockRef", BLOCKREF, desc="Playbook block anchor B0001-B0165."),
  pparam("MethodologyTemplateCode", "templateCode", "{ type: string, pattern: '^T(0[1-9]|1[0-6])$' }", desc="Template T01-T16."),
  pparam("MethodologyTransformationQuery", "transformationId", U, where="query", required=False, desc="Resolve the transformation's pinned methodology version instead of the latest published one (needs transformation.read there, else 404)."),
  pparam("MethodologyPhaseQuery", "phase", PHASE, where="query", required=False),
  pparam("MethodologySearchQuery", "q", TXT(2, 200), where="query", desc="Search term, 2-200 characters after the free-text rules."),
  pparam("MethodologySearchLangQuery", "lang", ENUM("en", "ar"), where="query", required=False, desc="Text to search; defaults to the caller's interface language."),
  pparam("MethodologyProvenanceQuery", "provenance", PROV, where="query", required=False),
  pparam("MethodologyElementKindQuery", "kind", ENUM(*KINDS), where="query", required=False),
  pparam("BrandingVersionNo", "versionNo", "{ type: integer, minimum: 1 }"),
  pparam("DemoWalkthroughTransformationQuery", "transformationId", U, where="query", required=False, desc="The transformation created in step 1; without it only step 1 is evaluated (not completed)."),
])
anchor = "\n  parameters:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + params, 1)

def obj(name, desc, props, required=None, extra=""):
    req = required if required is not None else [k for k, _ in props]
    out = f"    {name}:\n      type: object\n"
    if desc:
        out += f'      description: "{desc}"\n'
    out += f"      required: [{', '.join(req)}]\n" if req else ""
    out += extra
    out += "      additionalProperties: false\n      properties:\n" + "".join(f"        {k}: {v}\n" for k, v in props)
    return out
def page(name, item):
    return obj(name, None, [("items", ARR(item)), ("nextCursor", NSTR)])

schemas = []
# reader
schemas.append(obj("MethodologyVersionRef", "The methodology version the reader resolved (latest published, or the transformation's pin).", [("versionId", U), ("key", STR), ("versionNo", INT)]))
schemas.append(obj("MethodologyBlock", "textEn is verbatim docs/source/playbook.md; textAr is a provisional translation when arProvisional. guidanceEn/guidanceAr come from the version's block.<ref> element.", [
  ("blockRef", BLOCKREF), ("ordinal", INT), ("blockKind", ENUM("text", "table")), ("isHeading", BOOL), ("sectionBlockRef", NSTR), ("phaseCode", NPHASE),
  ("textEn", STR), ("textAr", STR), ("arProvisional", BOOL), ("guidanceEn", NSTR), ("guidanceAr", NSTR), ("linkCount", INT0),
  ("methodologyVersion", REF("MethodologyVersionRef"))]))
schemas.append(page("MethodologyBlockPage", "MethodologyBlock"))
schemas.append(obj("MethodologyLink", "route is the web route that opens the target; launchable is true for a procedure the caller may launch (launchProcedureInstance).", [
  ("targetKind", ENUM("template", "procedure", "requirement")), ("targetKey", STR), ("labelEn", STR), ("labelAr", STR), ("route", STR),
  ("origin", ENUM("seed", "version")), ("launchable", BOOL)]))
schemas.append(obj("MethodologyLinkList", None, [("blockRef", BLOCKREF), ("methodologyVersion", REF("MethodologyVersionRef")), ("items", ARR("MethodologyLink", 100))]))
schemas.append(obj("TemplateSourceLink", None, [("blockRef", BLOCKREF), ("ordinal", INT), ("phaseCode", NPHASE), ("excerptEn", STR), ("excerptAr", STR)]))
schemas.append(obj("TemplateSourceLinkList", None, [("templateCode", STR), ("methodologyVersion", REF("MethodologyVersionRef")), ("items", ARR("TemplateSourceLink", 50))]))
schemas.append(obj("SearchHighlight", "A match inside snippet: offset and length in UTF-16 code units.", [("offset", INT0), ("length", "{ type: integer, minimum: 1 }")]))
schemas.append(obj("MethodologySearchHit", "Plain text only (never HTML).", [("blockRef", BLOCKREF), ("phaseCode", NPHASE), ("sectionBlockRef", NSTR), ("lang", ENUM("en", "ar")),
  ("snippet", STR), ("highlights", ARR("SearchHighlight", 50))]))
schemas.append(obj("MethodologySearchPage", None, [("items", ARR("MethodologySearchHit")), ("nextCursor", NSTR), ("methodologyVersion", REF("MethodologyVersionRef"))]))
schemas.append(obj("SourceBlockText", None, [("blockRef", BLOCKREF), ("textEn", STR), ("textAr", STR), ("arProvisional", BOOL)]))
schemas.append(obj("SourceFoundation", "A row of the B0156 table (Source / Used for), verbatim; Arabic provisional.", [("code", STR), ("ordinal", INT), ("sourceEn", STR), ("sourceAr", STR),
  ("usedForEn", STR), ("usedForAr", STR), ("sourceRef", STR)]))
schemas.append(obj("ProvenanceNote", "An explanatory note published through Studio; the B0004 statement itself is never edited.", [("bodyEn", NSTR), ("bodyAr", NSTR)]))
schemas.append(obj("MethodologyProvenance", "A practical synthesis inspired by PMI/Brightline/BRM with custom extensions; never an official PMI standard or certified product (M0089).", [
  ("statement", REF("SourceBlockText")), ("connectionNote", REF("SourceBlockText")), ("foundations", ARR("SourceFoundation", 3)),
  ("customExtensions", ARR("SourceBlockText", 6)), ("realizeNote", REF("SourceBlockText")),
  ("note", '{ oneOf: [{ $ref: "#/components/schemas/ProvenanceNote" }, { type: "null" }] }'), ("methodologyVersion", REF("MethodologyVersionRef"))]))
schemas.append(obj("MethodologyElementProfile", "provenance follows B0156-B0162; overridden is true when the resolved version overrides the seeded default through Studio.", [
  ("elementRef", STR), ("kind", ENUM(*KINDS)), ("stableKey", STR), ("ordinal", INT), ("labelEn", STR), ("labelAr", STR), ("provenance", PROV),
  ("provenanceSourceRef", ENUM("B0156", "B0158", "B0159", "B0160", "B0161", "B0162")), ("questionTag", NENUM("why_change", "what_different", "how_execute", "how_prove_value")),
  ("sourceRefs", "{ type: array, maxItems: 10, items: " + BLOCKREF + " }"), ("overridden", BOOL)]))
schemas.append(obj("MethodologyElementProfileList", None, [("methodologyVersion", REF("MethodologyVersionRef")), ("items", ARR("MethodologyElementProfile", 100))]))
schemas.append(obj("GuidingQuestion", None, [("code", QTAG), ("ordinal", INT), ("textEn", STR), ("textAr", STR), ("sourceRef", STR)]))
schemas.append(obj("GuidingQuestionList", "The four B0016 questions, English verbatim; Arabic provisional.", [("items", ARR("GuidingQuestion", 4))]))
# navigation
schemas.append(obj("NavigationItem", "availability is planned only while the item's P5 screen is not delivered (F-DG4-160).", [("code", STR), ("labelKey", STR), ("path", STR), ("availability", ENUM("working", "planned"))]))
schemas.append(obj("NavigationArea", None, [("code", ENUM(*AREAS)), ("webId", STR), ("labelKey", STR), ("path", STR), ("items", ARR("NavigationItem", 20))]))
schemas.append(obj("Navigation", "Only the areas and items the caller may see; hidden ones are omitted.", [("areas", ARR("NavigationArea", 14))]))
# branding
schemas.append(obj("BrandingLogo", None, [("sha256", SHA), ("altEn", STR), ("altAr", STR), ("url", STR)]))
BR_PROPS = [("versionNo", INT0), ("source", ENUM("default", "configured")), ("productNameEn", STR), ("productNameAr", STR), ("primaryColour", COLOUR), ("secondaryColour", COLOUR),
  ("coloursProvisional", BOOL), ("fontLatin", ENUM("IBM Plex Sans")), ("fontArabic", ENUM("IBM Plex Sans Arabic")),
  ("logo", '{ oneOf: [{ $ref: "#/components/schemas/BrandingLogo" }, { type: "null" }] }'), ("wordmarkProvisional", BOOL),
  ("reportHeaderEn", NSTR), ("reportHeaderAr", NSTR), ("reportFooterEn", NSTR), ("reportFooterAr", NSTR)]
schemas.append(obj("Branding", "Version 0 (source default) is the shipped default: 'Mobily Transformation Hub', the provisional design-token colours (#0078FF is provisional, not a verified Mobily colour) and the provisional text wordmark.", BR_PROPS))
schemas.append(obj("BrandingSettings", None, BR_PROPS + [("colourApprovalReference", NSTR), ("version", INT0), ("updatedAt", NTS), ("updatedBy", NU)]))
schemas.append(obj("BrandingLogoKeep", None, [("mode", ENUM("keep"))]))
schemas.append(obj("BrandingLogoNone", None, [("mode", ENUM("none"))]))
schemas.append(obj("BrandingLogoSet", "A PNG of at most 256 KiB, base64-encoded; SVG is not accepted.", [("mode", ENUM("set")), ("pngBase64", "{ type: string, minLength: 92, maxLength: 349528, contentEncoding: base64, contentMediaType: image/png }"),
  ("altEn", TXT(1, 200)), ("altAr", TXT(1, 200))]))
schemas.append(obj("BrandingSettingsPut", "The complete settings; colours count as approved only with colourApprovalReference, otherwise they stay provisional.", [
  ("productNameEn", TXT(1, 80)), ("productNameAr", TXT(1, 80)), ("primaryColour", COLOUR), ("secondaryColour", COLOUR), ("colourApprovalReference", NTXT(1, 300)),
  ("fontLatin", ENUM("IBM Plex Sans")), ("fontArabic", ENUM("IBM Plex Sans Arabic")),
  ("logo", '{ oneOf: [{ $ref: "#/components/schemas/BrandingLogoKeep" }, { $ref: "#/components/schemas/BrandingLogoNone" }, { $ref: "#/components/schemas/BrandingLogoSet" }] }'),
  ("reportHeaderEn", NTXT(1, 300)), ("reportHeaderAr", NTXT(1, 300)), ("reportFooterEn", NTXT(1, 300)), ("reportFooterAr", NTXT(1, 300)), ("changeNote", NTXT(1, 1000))],
  required=["productNameEn", "productNameAr", "primaryColour", "secondaryColour", "fontLatin", "fontArabic", "logo"]))
schemas.append(obj("BrandingVersion", "An immutable branding version.", [("versionNo", "{ type: integer, minimum: 1 }"), ("productNameEn", STR), ("productNameAr", STR), ("primaryColour", COLOUR),
  ("secondaryColour", COLOUR), ("coloursProvisional", BOOL), ("colourApprovalReference", NSTR), ("fontLatin", STR), ("fontArabic", STR),
  ("logo", '{ oneOf: [{ $ref: "#/components/schemas/BrandingLogo" }, { type: "null" }] }'), ("reportHeaderEn", NSTR), ("reportHeaderAr", NSTR),
  ("reportFooterEn", NSTR), ("reportFooterAr", NSTR), ("changeNote", NSTR), ("createdAt", TS), ("createdBy", U)]))
schemas.append(page("BrandingVersionPage", "BrandingVersion"))
# environment and demo
schemas.append(obj("EnvironmentInfo", "synthetic is true exactly in a demo database: every record and number there is an illustrative example, not Mobily actual performance, and every approval approves nothing real.", [
  ("kind", ENUM("production", "demo")), ("synthetic", BOOL), ("datasetCode", NSTR), ("datasetVersion", NSTR), ("syntheticClockAt", NTS)]))
schemas.append(obj("DemoDatasetRun", "recordCounts: rows per public table (demo_dataset_run excluded); checksum: SHA-256 over the registered demo records (ADR-0050 §4); coverage: the REQ-S18-002 conditions with their counts.", [
  ("runNo", "{ type: integer, minimum: 1 }"), ("runKind", ENUM("seed", "reset")), ("requestedVia", ENUM("cli", "api")), ("requestedBy", NU), ("datasetCode", STR),
  ("datasetVersion", STR), ("syntheticClockAt", TS), ("recordCounts", INTMAP), ("checksumSha256", SHA), ("coverage", INTMAP), ("coverageComplete", BOOL), ("completedAt", TS)]))
schemas.append(obj("DemoEnvironmentStatus", None, [("kind", ENUM("production", "demo")), ("latestRun", '{ oneOf: [{ $ref: "#/components/schemas/DemoDatasetRun" }, { type: "null" }] }'),
  ("resetConfigured", BOOL), ("version", INT0)]))
schemas.append(obj("DemoResetRequest", None, [("status", ENUM("queued")), ("requestedAt", TS), ("requestedBy", U)]))
schemas.append(obj("DemoWalkthroughStep", None, [("code", STR), ("ordinal", "{ type: integer, minimum: 1, maximum: 12 }"), ("titleEn", STR), ("titleAr", STR),
  ("areaCode", ENUM(*AREAS)), ("route", STR), ("completed", BOOL)]))
schemas.append(obj("DemoWalkthrough", "The twelve M0349 steps; completion is evaluated from persisted records, never stored by the guide.", [("transformationId", NU),
  ("steps", ARR("DemoWalkthroughStep", 12)), ("completedCount", INT0), ("total", "{ type: integer, const: 12 }")]))

anchor = "\n  schemas:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "".join(schemas), 1)
open(F, "w").write(s)
print("operations added:", sum(p.count("operationId:") for p in paths))
