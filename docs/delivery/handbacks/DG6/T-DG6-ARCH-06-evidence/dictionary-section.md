### branding_contrast_report

- **Purpose:** The WCAG 2.x AA contrast report of one published branding version: the rule set, the SHA-256 of the token source it was computed from and the number of declared pairs (REQ-S15-003; ADR-0061 §1-§2). At most one per version.
- **Migration:** `0113_p6_branding_contrast_reports.sql`. **API module:** `admin (branding)`. **Who writes:** the branding publish (putBrandingSettings, ADM_TECH holding `branding.configure`), in the transaction that inserts the version, under lock 730270 (BE-W). **Lifecycle:** append-only; audited (record id); exactly pair_count pairs at COMMIT.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| branding_version_no | integer | NOT NULL |  | `CHECK ((branding_version_no >= 1))` |
| rules | text | NOT NULL |  | `CHECK ((rules = 'wcag2x-aa-v1'))` |
| token_source_sha256 | text | NOT NULL |  | `CHECK ((token_source_sha256 ~ '^[0-9a-f]{64}$'))` |
| pair_count | integer | NOT NULL |  | `CHECK (((pair_count >= 1) AND (pair_count <= 500)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `branding_contrast_report_version_fkey` (FK): `FOREIGN KEY (organization_id, branding_version_no) REFERENCES branding_version(organization_id, version_no) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `branding_contrast_report_version_key` (UNIQUE): `UNIQUE (organization_id, branding_version_no)`

**Triggers:**

- `branding_contrast_report_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `branding_contrast_report_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `branding_contrast_report_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `branding_contrast_report_pairs_complete`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `branding_contrast_report_pairs_complete()`
- `branding_contrast_report_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

### branding_contrast_pair

- **Purpose:** One evaluated token pair of a contrast report: foreground and background token names and colours, the use (text, large-text, ui), the ratio rounded down to two decimals and the threshold (4.5 or 3.0). A stored pair always passes (ADR-0061 §2).
- **Migration:** `0113_p6_branding_contrast_reports.sql`. **API module:** `admin (branding)`. **Who writes:** the branding publish, with its report (BE-W). **Lifecycle:** append-only; covered by its report's audit event.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| report_id | uuid | NOT NULL |  | FK → branding_contrast_report(id) |
| ordinal | integer | NOT NULL |  | `CHECK ((ordinal >= 1))` |
| fg_token | text | NOT NULL |  | `CHECK (((char_length(fg_token) <= 80) AND (fg_token ~ '^[a-z]+(\.[a-z0-9-]+)+$')))` |
| bg_token | text | NOT NULL |  | `CHECK (((char_length(bg_token) <= 80) AND (bg_token ~ '^[a-z]+(\.[a-z0-9-]+)+$')))` |
| use | text | NOT NULL |  | `CHECK ((use = ANY (ARRAY['text', 'large-text', 'ui'])))` |
| fg_hex | text | NOT NULL |  | `CHECK ((fg_hex ~ '^#[0-9A-F]{6}$'))` |
| bg_hex | text | NOT NULL |  | `CHECK ((bg_hex ~ '^#[0-9A-F]{6}$'))` |
| ratio | numeric(4,2) | NOT NULL |  | `CHECK (((ratio >= (1)::numeric) AND (ratio <= (21)::numeric)))` |
| threshold | numeric(2,1) | NOT NULL |  |  |
| usage_note | text | NOT NULL |  | `CHECK (((char_length(usage_note) >= 1) AND (char_length(usage_note) <= 200)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `branding_contrast_pair_ordinal_key` (UNIQUE): `UNIQUE (report_id, ordinal)`
- `branding_contrast_pair_pair_key` (UNIQUE): `UNIQUE (report_id, fg_token, bg_token, use)`
- `branding_contrast_pair_passes` (CHECK): `CHECK ((ratio >= threshold))`
- `branding_contrast_pair_threshold_for_use` (CHECK): `CHECK ((((use = 'text') AND (threshold = 4.5)) OR ((use = ANY (ARRAY['large-text', 'ui'])) AND (threshold = 3.0))))`

**Triggers:**

- `branding_contrast_pair_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `branding_contrast_pair_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `branding_contrast_pair_report_complete`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `branding_contrast_report_pairs_complete()`

