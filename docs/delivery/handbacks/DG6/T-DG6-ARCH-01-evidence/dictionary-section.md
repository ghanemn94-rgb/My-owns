qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## record_sensitivity

- **Purpose:** Whether one benefit, business case or evidence item is sensitive, with the reason (REQ-S10-002; ADR-0051 §2). No row = not sensitive.
- **Migration:** `0098_p6_sensitive_records_deep_links.sql`. **API module:** `access`. **Who writes:** `sensitive_record.grant` (TO, ADM_ACCESS) through putRecordSensitivity. **Lifecycle:** one per record; created by If-Match "0"; flag switched by UPDATE (never DELETE); versioned and audited; lock 730300.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  |  |
| record_id | uuid | NOT NULL |  |  |
| is_sensitive | boolean | NOT NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `record_sensitivity_record_key` (UNIQUE): `UNIQUE (record_type, record_id)`
- `record_sensitivity_record_type` (CHECK): `CHECK ((record_type = ANY (ARRAY['benefit', 'business_case', 'evidence'])))`

**Indexes:**

- `record_sensitivity_transformation_idx`: `(transformation_id, record_type) WHERE is_sensitive`

**Triggers:**

- `record_sensitivity_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `record_sensitivity_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `record_sensitivity_guard()`
- `record_sensitivity_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `record_sensitivity_history()`
- `record_sensitivity_record_ref`: BEFORE INSERT FOR EACH ROW → `p6_sensitive_record_ref_guard()`
- `record_sensitivity_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## record_sensitivity_change

- **Purpose:** Append-only history of every version of a sensitivity flag (ADR-0051 §2).
- **Migration:** `0098_p6_sensitive_records_deep_links.sql`. **API module:** `access`. **Who writes:** the SECURITY DEFINER trigger `record_sensitivity_history` only. **Lifecycle:** append-only; one row per record_sensitivity version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| record_sensitivity_id | uuid | NOT NULL |  | FK → record_sensitivity(id) |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  | `CHECK ((record_type = ANY (ARRAY['benefit', 'business_case', 'evidence'])))` |
| record_id | uuid | NOT NULL |  |  |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| is_sensitive | boolean | NOT NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `record_sensitivity_change_version_key` (UNIQUE): `UNIQUE (record_sensitivity_id, record_version)`

**Triggers:**

- `record_sensitivity_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `record_sensitivity_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

## sensitive_record_grant

- **Purpose:** An explicit grant that admits one user to one sensitive record (REQ-S10-002; ADR-0051 §2).
- **Migration:** `0098_p6_sensitive_records_deep_links.sql`. **API module:** `access`. **Who writes:** `sensitive_record.grant` (TO, ADM_ACCESS) through createSensitiveGrant and revokeSensitiveGrant. **Lifecycle:** active -> revoked (terminal); at most one active grant per record and grantee; versioned and audited; lock 730300.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| record_type | text | NOT NULL |  |  |
| record_id | uuid | NOT NULL |  |  |
| grantee_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| status | text | NOT NULL | `'active'` |  |
| revoked_at | timestamp with time zone | NULL |  |  |
| revoked_by | uuid | NULL |  | FK → app_user(id) |
| revoke_reason | text | NULL |  | `CHECK (((revoke_reason IS NULL) OR ((char_length(revoke_reason) >= 3) AND (char_length(revoke_reason) <= 1000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `sensitive_record_grant_not_self` (CHECK): `CHECK ((grantee_user_id <> created_by))`
- `sensitive_record_grant_record_type` (CHECK): `CHECK ((record_type = ANY (ARRAY['benefit', 'business_case', 'evidence'])))`
- `sensitive_record_grant_revoke_complete` (CHECK): `CHECK ((((status = 'revoked') = (revoked_at IS NOT NULL)) AND ((revoked_at IS NULL) = (revoked_by IS NULL)) AND ((revoked_at IS NULL) = (revoke_reason IS NULL))))`
- `sensitive_record_grant_status` (CHECK): `CHECK ((status = ANY (ARRAY['active', 'revoked'])))`

**Indexes:**

- `sensitive_record_grant_grantee_idx`: `(grantee_user_id, record_type) WHERE (status = 'active')`
- `sensitive_record_grant_one_active_key`: `UNIQUE (record_type, record_id, grantee_user_id) WHERE (status = 'active')`
- `sensitive_record_grant_transformation_idx`: `(transformation_id, created_at DESC, id DESC)`

**Triggers:**

- `sensitive_record_grant_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `sensitive_record_grant_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `sensitive_record_grant_guard()`
- `sensitive_record_grant_record_ref`: BEFORE INSERT FOR EACH ROW → `p6_sensitive_record_ref_guard()`
- `sensitive_record_grant_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## upload_policy

- **Purpose:** The organization's narrowed upload allow-list and size limit (REQ-S13-011; ADR-0052 §1). No row = the default (ten types, 26214400 bytes).
- **Migration:** `0099_p6_upload_policy_content_types.sql`. **API module:** `evidence (admin)`. **Who writes:** `upload_policy.configure` (ADM_TECH) through putUploadPolicy. **Lifecycle:** one per organization; created by If-Match "0"; versioned and audited.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| allowed_types | text[] | NOT NULL |  |  |
| max_bytes | bigint | NOT NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 1000)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `upload_policy_allowed_types` (CHECK): `CHECK ((((cardinality(allowed_types) >= 1) AND (cardinality(allowed_types) <= 10)) AND (allowed_types <@ ARRAY['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'png', 'jpeg', 'gif', 'svg']) AND (array_position(allowed_types, NULL) IS NULL)))`
- `upload_policy_max_bytes` (CHECK): `CHECK (((max_bytes >= 1) AND (max_bytes <= 26214400)))`
- `upload_policy_organization_key` (UNIQUE): `UNIQUE (organization_id)`

**Triggers:**

- `upload_policy_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `upload_policy_history`: AFTER INSERT OR UPDATE FOR EACH ROW → `upload_policy_history()`
- `upload_policy_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## upload_policy_change

- **Purpose:** Append-only history of every version of an upload policy (ADR-0052 §1).
- **Migration:** `0099_p6_upload_policy_content_types.sql`. **API module:** `evidence (admin)`. **Who writes:** the SECURITY DEFINER trigger `upload_policy_history` only. **Lifecycle:** append-only; one row per upload_policy version.
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| upload_policy_id | uuid | NOT NULL |  | FK → upload_policy(id) |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| record_version | integer | NOT NULL |  | `CHECK ((record_version >= 1))` |
| allowed_types | text[] | NOT NULL |  |  |
| max_bytes | bigint | NOT NULL |  |  |
| reason | text | NOT NULL |  |  |
| changed_by | uuid | NOT NULL |  | FK → app_user(id) |
| changed_at | timestamp with time zone | NOT NULL |  |  |

**Table constraints:**

- `upload_policy_change_version_key` (UNIQUE): `UNIQUE (upload_policy_id, record_version)`

**Triggers:**

- `upload_policy_change_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `upload_policy_change_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`

