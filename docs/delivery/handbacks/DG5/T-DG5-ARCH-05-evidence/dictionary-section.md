qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit; server_encoding UTF8, lc_collate C, lc_ctype C
## kpi_restatement

- **Purpose:** A retrospective restatement of selected closed periods of a KPI with an approved version, a reason, the decision and its recorded authority (REQ-S07-016, M0163; ADR-0047 §2).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `kpi`. **Who writes:** `kpi_restatement.request` (create, submit, withdraw), `kpi_restatement.approve` (decide; never the requester), the worker (applied). **Lifecycle:** draft → submitted | withdrawn; submitted → approved | rejected | withdrawn; approved → applied; one in progress per KPI; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| kpi_definition_id | uuid | NOT NULL |  |  |
| kpi_version_id | uuid | NOT NULL |  |  |
| change_request_id | uuid | NULL |  |  |
| reason | text | NOT NULL |  | `CHECK (((char_length(reason) >= 3) AND (char_length(reason) <= 2000)))` |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'applied'])))` |
| requested_by | uuid | NOT NULL |  | FK → app_user(id) |
| submitted_at | timestamp with time zone | NULL |  |  |
| period_count | smallint | NOT NULL | `0` | `CHECK (((period_count >= 0) AND (period_count <= 24)))` |
| reconciliation_count | integer | NOT NULL | `0` | `CHECK ((reconciliation_count >= 0))` |
| decided_by | uuid | NULL |  | FK → app_user(id) |
| decided_at | timestamp with time zone | NULL |  |  |
| decision_note | text | NULL |  | `CHECK (((decision_note IS NULL) OR ((char_length(decision_note) >= 1) AND (char_length(decision_note) <= 2000))))` |
| authority_permission | text | NULL |  | `CHECK (((authority_permission IS NULL) OR (authority_permission = 'kpi_restatement.approve')))` |
| authority_role_code | text | NULL |  | FK → role(code) |
| calculation_run_id | uuid | NULL |  |  |
| applied_at | timestamp with time zone | NULL |  |  |
| withdrawn_at | timestamp with time zone | NULL |  |  |
| withdrawn_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `kpi_restatement_applied_complete` (CHECK): `CHECK ((((status = 'applied') = (applied_at IS NOT NULL)) AND ((applied_at IS NULL) = (calculation_run_id IS NULL))))`
- `kpi_restatement_change_request_fkey` (FK): `FOREIGN KEY (transformation_id, change_request_id) REFERENCES change_request(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_decision_complete` (CHECK): `CHECK ((((status = ANY (ARRAY['approved', 'rejected', 'applied'])) = (decided_by IS NOT NULL)) AND ((decided_by IS NULL) = (decided_at IS NULL)) AND ((decided_by IS NULL) = (authority_permission IS NULL)) AND ((decided_by IS NULL) = (authority_role_code IS NULL))))`
- `kpi_restatement_kpi_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_definition_id) REFERENCES kpi_definition(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_reject_note` (CHECK): `CHECK (((status <> 'rejected') OR (decision_note IS NOT NULL)))`
- `kpi_restatement_run_fkey` (FK): `FOREIGN KEY (transformation_id, calculation_run_id) REFERENCES calculation_run(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_sod` (CHECK): `CHECK (((decided_by IS NULL) OR (decided_by <> requested_by)))`
- `kpi_restatement_submitted_stamp` (CHECK): `CHECK ((((status = 'draft') AND (submitted_at IS NULL)) OR ((status = ANY (ARRAY['submitted', 'approved', 'rejected', 'applied'])) AND (submitted_at IS NOT NULL)) OR (status = 'withdrawn')))`
- `kpi_restatement_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `kpi_restatement_version_fkey` (FK): `FOREIGN KEY (transformation_id, kpi_version_id) REFERENCES kpi_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_withdrawn_complete` (CHECK): `CHECK ((((status = 'withdrawn') = (withdrawn_at IS NOT NULL)) AND ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))))`

**Indexes:**

- `kpi_restatement_kpi_idx`: `(transformation_id, kpi_definition_id, created_at DESC, id DESC)`
- `kpi_restatement_one_open_key`: `UNIQUE (kpi_definition_id) WHERE (status = ANY (ARRAY['draft', 'submitted', 'approved']))`

**Triggers:**

- `kpi_restatement_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `kpi_restatement_complete`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `kpi_restatement_complete()`
- `kpi_restatement_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `kpi_restatement_guard()`
- `kpi_restatement_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_restatement_period

- **Purpose:** The explicitly selected closed reporting periods of a restatement (REQ-S07-016 'explicit period selection'; ADR-0047 §2).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `kpi`. **Who writes:** the restatement's create transaction (draft only). **Lifecycle:** append-only (covered by the kpi_restatement audit event).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| restatement_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| period_label | text | NOT NULL |  | `CHECK (((char_length(period_label) >= 1) AND (char_length(period_label) <= 32)))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `kpi_restatement_period_key` (UNIQUE): `UNIQUE (restatement_id, reporting_period_id)`
- `kpi_restatement_period_parent_fkey` (FK): `FOREIGN KEY (transformation_id, restatement_id) REFERENCES kpi_restatement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_period_period_fkey` (FK): `FOREIGN KEY (organization_id, reporting_period_id) REFERENCES reporting_period(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `kpi_restatement_period_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_restatement_period_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_restatement_period_complete`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `kpi_restatement_complete()`
- `kpi_restatement_period_guard`: BEFORE INSERT FOR EACH ROW → `kpi_restatement_period_guard()`
- `kpi_restatement_period_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_restatement_reconciliation

- **Purpose:** The retained reconciliation: per period, scope and basis the value, status, RAG, target and version before and after, and the difference (M0163 'a retained reconciliation'; ADR-0047 §2).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `kpi`. **Who writes:** the submitting transaction only. **Lifecycle:** append-only (covered by kpi_restatement.submit).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| restatement_id | uuid | NOT NULL |  |  |
| reporting_period_id | uuid | NOT NULL |  |  |
| scope_kind | text | NOT NULL |  | `CHECK ((scope_kind = ANY (ARRAY['transformation', 'business_unit', 'initiative'])))` |
| scope_id | uuid | NOT NULL |  |  |
| value_basis | text | NOT NULL |  | `CHECK ((value_basis = ANY (ARRAY['period', 'cumulative'])))` |
| before_evaluation_id | uuid | NULL |  | FK → kpi_evaluation(id) |
| before_kpi_version_id | uuid | NULL |  |  |
| before_value | numeric(24,6) | NULL |  |  |
| before_value_status | text | NOT NULL |  | `CHECK ((before_value_status = ANY (ARRAY['ok', 'unknown', 'stale', 'not_computable', 'none'])))` |
| before_rag | text | NOT NULL |  | `CHECK ((before_rag = ANY (ARRAY['green', 'amber', 'red', 'unknown', 'stale', 'not_computable', 'none'])))` |
| before_target | numeric(24,6) | NULL |  |  |
| after_value | numeric(24,6) | NULL |  |  |
| after_value_status | text | NOT NULL |  | `CHECK ((after_value_status = ANY (ARRAY['ok', 'unknown', 'stale', 'not_computable'])))` |
| after_rag | text | NOT NULL |  | `CHECK ((after_rag = ANY (ARRAY['green', 'amber', 'red', 'unknown', 'stale', 'not_computable'])))` |
| after_target | numeric(24,6) | NULL |  |  |
| difference | numeric(24,6) | NULL |  |  |
| currency | character(3) | NULL |  | `CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$')))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `kpi_restatement_reconciliation_after` (CHECK): `CHECK (((after_value IS NOT NULL) = (after_value_status = ANY (ARRAY['ok', 'stale']))))`
- `kpi_restatement_reconciliation_before` (CHECK): `CHECK ((((before_value IS NOT NULL) = (before_value_status = ANY (ARRAY['ok', 'stale']))) AND ((before_value_status = 'none') = (before_evaluation_id IS NULL)) AND ((before_value_status = 'none') = (before_rag = 'none')) AND ((before_evaluation_id IS NULL) = (before_kpi_version_id IS NULL))))`
- `kpi_restatement_reconciliation_difference` (CHECK): `CHECK ((((difference IS NULL) = ((before_value_status <> 'ok') OR (after_value_status <> 'ok'))) AND ((difference IS NULL) OR (difference = (after_value - before_value)))))`
- `kpi_restatement_reconciliation_parent_fkey` (FK): `FOREIGN KEY (transformation_id, restatement_id) REFERENCES kpi_restatement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_reconciliation_period_fkey` (FK): `FOREIGN KEY (restatement_id, reporting_period_id) REFERENCES kpi_restatement_period(restatement_id, reporting_period_id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_reconciliation_slot_key` (UNIQUE): `UNIQUE (restatement_id, reporting_period_id, scope_kind, scope_id, value_basis)`
- `kpi_restatement_reconciliation_version_fkey` (FK): `FOREIGN KEY (transformation_id, before_kpi_version_id) REFERENCES kpi_version(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `kpi_restatement_reconciliation_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_restatement_reconciliation_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_restatement_reconciliation_complete`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `kpi_restatement_complete()`
- `kpi_restatement_reconciliation_guard`: BEFORE INSERT FOR EACH ROW → `kpi_restatement_reconciliation_guard()`
- `kpi_restatement_reconciliation_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## kpi_restatement_reissue_offer

- **Purpose:** An issued report snapshot that showed the restated KPI for a restated period, offered for reissue once (REQ-S07-016 automation; ADR-0047 §3).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `kpi`. **Who writes:** the worker after approval. **Lifecycle:** append-only; one per restatement and snapshot.
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| restatement_id | uuid | NOT NULL |  |  |
| snapshot_id | uuid | NOT NULL |  |  |
| series_id | uuid | NOT NULL |  |  |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `kpi_restatement_reissue_offer_key` (UNIQUE): `UNIQUE (restatement_id, snapshot_id)`
- `kpi_restatement_reissue_offer_parent_fkey` (FK): `FOREIGN KEY (transformation_id, restatement_id) REFERENCES kpi_restatement(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `kpi_restatement_reissue_offer_snapshot_fkey` (FK): `FOREIGN KEY (transformation_id, snapshot_id) REFERENCES report_snapshot(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `kpi_restatement_reissue_offer_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `kpi_restatement_reissue_offer_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `kpi_restatement_reissue_offer_guard`: BEFORE INSERT FOR EACH ROW → `kpi_restatement_reissue_offer_guard()`
- `kpi_restatement_reissue_offer_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## financial_metric_setting

- **Purpose:** The organization's optional NPV/ROI/payback extension: on/off (off by default) and the explicit methodology, timing, period-basis and discount-rate assumptions (REQ-S08-019, M0174; ADR-0047 §5).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `benefits`. **Who writes:** `financial_metrics.enable` (on/off), `financial_metrics.define` (assumptions). **Lifecycle:** one row per organization, created on first write; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| enabled | boolean | NOT NULL | `false` |  |
| methodology | text | NOT NULL | `'discounted_net_cash_flow'` | `CHECK ((methodology = 'discounted_net_cash_flow'))` |
| methodology_note | text | NULL |  | `CHECK (((methodology_note IS NULL) OR ((char_length(methodology_note) >= 3) AND (char_length(methodology_note) <= 2000))))` |
| timing | text | NULL |  | `CHECK (((timing IS NULL) OR (timing = ANY (ARRAY['end_of_period', 'beginning_of_period']))))` |
| period_basis | text | NULL |  | `CHECK (((period_basis IS NULL) OR (period_basis = ANY (ARRAY['annual', 'quarterly', 'monthly']))))` |
| discount_rate | numeric(9,6) | NULL |  | `CHECK (((discount_rate IS NULL) OR ((discount_rate >= (0)::numeric) AND (discount_rate <= (1)::numeric))))` |
| assumptions_set_by | uuid | NULL |  | FK → app_user(id) |
| assumptions_set_at | timestamp with time zone | NULL |  |  |
| enabled_changed_by | uuid | NULL |  | FK → app_user(id) |
| enabled_changed_at | timestamp with time zone | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `financial_metric_setting_assumptions_complete` (CHECK): `CHECK ((((methodology_note IS NULL) = (timing IS NULL)) AND ((timing IS NULL) = (period_basis IS NULL)) AND ((timing IS NULL) = (assumptions_set_at IS NULL)) AND ((assumptions_set_at IS NULL) = (assumptions_set_by IS NULL)) AND ((discount_rate IS NULL) OR (timing IS NOT NULL))))`
- `financial_metric_setting_enabled_stamp` (CHECK): `CHECK (((enabled_changed_at IS NULL) = (enabled_changed_by IS NULL)))`
- `financial_metric_setting_org_key` (UNIQUE): `UNIQUE (organization_id)`

**Triggers:**

- `financial_metric_setting_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `financial_metric_setting_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## financial_cash_flow_set

- **Purpose:** The cash-flow set of one business case that NPV, ROI and payback are computed from; replaced as a whole by a new revision (ADR-0047 §5).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `benefits`. **Who writes:** `financial_metrics.define`. **Lifecycle:** revision 1, 2, …; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| business_case_id | uuid | NOT NULL |  |  |
| currency | character(3) | NOT NULL |  | `CHECK ((currency ~ '^[A-Z]{3}$'))` |
| revision | integer | NOT NULL | `1` | `CHECK ((revision >= 1))` |
| line_count | smallint | NOT NULL |  | `CHECK (((line_count >= 1) AND (line_count <= 121)))` |
| basis_note | text | NULL |  | `CHECK (((basis_note IS NULL) OR ((char_length(basis_note) >= 1) AND (char_length(basis_note) <= 2000))))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `financial_cash_flow_set_case_fkey` (FK): `FOREIGN KEY (transformation_id, business_case_id) REFERENCES business_case(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `financial_cash_flow_set_case_key` (UNIQUE): `UNIQUE (business_case_id)`
- `financial_cash_flow_set_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `financial_cash_flow_set_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `financial_cash_flow_set_complete`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `financial_cash_flow_set_complete()`
- `financial_cash_flow_set_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `financial_cash_flow_set_guard()`
- `financial_cash_flow_set_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## financial_cash_flow

- **Purpose:** Outflow and inflow per period index of one revision of a cash-flow set (ADR-0047 §5).
- **Migration:** `0085_p5_kpi_restatements_financial_metrics.sql`. **API module:** `benefits`. **Who writes:** the set's create/replace transaction. **Lifecycle:** append-only (earlier revisions kept as history).
- **`mth_app` privileges:** INSERT, SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| set_id | uuid | NOT NULL |  |  |
| revision | integer | NOT NULL |  | `CHECK ((revision >= 1))` |
| period_index | smallint | NOT NULL |  | `CHECK (((period_index >= 0) AND (period_index <= 120)))` |
| outflow | numeric(20,4) | NOT NULL |  | `CHECK ((outflow >= (0)::numeric))` |
| inflow | numeric(20,4) | NOT NULL |  | `CHECK ((inflow >= (0)::numeric))` |
| note | text | NULL |  | `CHECK (((note IS NULL) OR ((char_length(note) >= 1) AND (char_length(note) <= 500))))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |

**Table constraints:**

- `financial_cash_flow_period_key` (UNIQUE): `UNIQUE (set_id, revision, period_index)`
- `financial_cash_flow_set_fkey` (FK): `FOREIGN KEY (transformation_id, set_id) REFERENCES financial_cash_flow_set(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `financial_cash_flow_append_only`: BEFORE DELETE OR UPDATE FOR EACH ROW → `p2_append_only()`
- `financial_cash_flow_append_only_truncate`: BEFORE TRUNCATE FOR EACH STATEMENT → `p2_append_only()`
- `financial_cash_flow_complete`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `financial_cash_flow_set_complete()`
- `financial_cash_flow_guard`: BEFORE INSERT FOR EACH ROW → `financial_cash_flow_guard()`
- `financial_cash_flow_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## launch_window

- **Purpose:** The three B0134 windows with objective, actions and outputs verbatim and their day ranges (REQ-PB-086; ADR-0048 §1).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (3 rows).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code = ANY (ARRAY['days_0_30', 'days_31_60', 'days_61_90'])))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 3)))` |
| start_day | smallint | NOT NULL |  | `CHECK (((start_day >= 0) AND (start_day <= 90)))` |
| end_day | smallint | NOT NULL |  | `CHECK (((end_day >= 0) AND (end_day <= 90)))` |
| label_en | text | NOT NULL |  | `CHECK (((char_length(label_en) >= 1) AND (char_length(label_en) <= 40)))` |
| label_ar | text | NOT NULL |  | `CHECK (((char_length(label_ar) >= 1) AND (char_length(label_ar) <= 80)))` |
| objective_en | text | NOT NULL |  | `CHECK (((char_length(objective_en) >= 1) AND (char_length(objective_en) <= 100)))` |
| objective_ar | text | NOT NULL |  | `CHECK (((char_length(objective_ar) >= 1) AND (char_length(objective_ar) <= 200)))` |
| actions_source_en | text | NOT NULL |  | `CHECK (((char_length(actions_source_en) >= 1) AND (char_length(actions_source_en) <= 500)))` |
| outputs_source_en | text | NOT NULL |  | `CHECK (((char_length(outputs_source_en) >= 1) AND (char_length(outputs_source_en) <= 500)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = 'B0134'))` |

**Table constraints:**

- `launch_window_days` (CHECK): `CHECK ((start_day <= end_day))`
- `launch_window_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`

## launch_template_item

- **Purpose:** The B0134 actions and outputs (split at ';', verbatim) and the Day-90 test, each with its window, day offsets and required output record type (REQ-PB-086; ADR-0048 §1).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (33 rows).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^(w[1-3]_(a|o)[1-9]|day_ninety_test)$'))`; PK |
| window_code | text | NOT NULL |  | FK → launch_window(code) |
| item_kind | text | NOT NULL |  | `CHECK ((item_kind = ANY (ARRAY['action', 'output', 'day_ninety_test'])))` |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 99)))` |
| text_en | text | NOT NULL |  | `CHECK (((char_length(text_en) >= 1) AND (char_length(text_en) <= 200)))` |
| text_ar | text | NOT NULL |  | `CHECK (((char_length(text_ar) >= 1) AND (char_length(text_ar) <= 300)))` |
| output_record_type | text | NULL |  | `CHECK (((output_record_type IS NULL) OR (output_record_type = ANY (ARRAY['charter', 'diagnostic_item', 'baseline', 'north_star', 'kpi_definition', 'tom_canvas_cell', 'initiative', 'business_case', 'roadmap_wave', 'benefit', 'evidence', 'meeting_series']))))` |
| start_day | smallint | NOT NULL |  | `CHECK (((start_day >= 0) AND (start_day <= 90)))` |
| due_day | smallint | NOT NULL |  | `CHECK (((due_day >= 0) AND (due_day <= 90)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref = ANY (ARRAY['B0134', 'B0135'])))` |

**Table constraints:**

- `launch_template_item_days` (CHECK): `CHECK ((start_day <= due_day))`
- `launch_template_item_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`
- `launch_template_item_output` (CHECK): `CHECK (((output_record_type IS NULL) OR (item_kind = 'output')))`

## day_ninety_question

- **Purpose:** The six Day-90 leadership test questions verbatim (B0136-B0141) and the record types used to pre-fill evidence (REQ-PB-087; ADR-0048 §4).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** migrations only. **Lifecycle:** seeded catalogue (6 rows).
- **`mth_app` privileges:** SELECT.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| code | text | NOT NULL |  | `CHECK ((code ~ '^q[1-6]$'))`; PK |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 6)))` |
| text_en | text | NOT NULL |  | `CHECK (((char_length(text_en) >= 1) AND (char_length(text_en) <= 300)))` |
| text_ar | text | NOT NULL |  | `CHECK (((char_length(text_ar) >= 1) AND (char_length(text_ar) <= 400)))` |
| source_ref | text | NOT NULL |  | `CHECK ((source_ref ~ '^B01(3[6-9]|4[01])$'))` |
| evidence_record_types | text[] | NOT NULL |  | `CHECK (((cardinality(evidence_record_types) >= 1) AND (cardinality(evidence_record_types) <= 5)))` |

**Table constraints:**

- `day_ninety_question_ordinal_key` (UNIQUE): `UNIQUE (ordinal)`
- `day_ninety_question_source_ref_key` (UNIQUE): `UNIQUE (source_ref)`

## launch_plan

- **Purpose:** The 90-day launch plan of a transformation, generated once from a start date (REQ-PB-086, REQ-S14-004; ADR-0048 §1-§2).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** `launch_plan.edit` (generate, change the start date), the S12-004 port. **Lifecycle:** one per transformation; start-date shifts recorded; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| start_date | date | NOT NULL |  |  |
| template_ref | text | NOT NULL | `'B0134'` | `CHECK ((template_ref = 'B0134'))` |
| generated_via | text | NOT NULL |  | `CHECK ((generated_via = ANY (ARRAY['request', 'automation'])))` |
| idempotency_key | text | NOT NULL |  |  |
| last_shift_days | integer | NULL |  | `CHECK (((last_shift_days IS NULL) OR (last_shift_days <> 0)))` |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `launch_plan_idempotency_key` (UNIQUE): `UNIQUE (idempotency_key)`
- `launch_plan_idempotency_shape` (CHECK): `CHECK ((idempotency_key = ('launch_plan:' || (transformation_id))))`
- `launch_plan_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`
- `launch_plan_transformation_key` (UNIQUE): `UNIQUE (transformation_id)`

**Triggers:**

- `launch_plan_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `launch_plan_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `launch_plan_guard()`
- `launch_plan_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## launch_task

- **Purpose:** One editable scheduled task of a plan with owner, dates, status and required output record (REQ-S14-004; ADR-0048 §2).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** `launch_plan.edit`. **Lifecycle:** not_started → in_progress | completed | cancelled; in_progress → not_started | completed | cancelled; completed → in_progress; completed dates fixed; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| plan_id | uuid | NOT NULL |  |  |
| ordinal | smallint | NOT NULL |  | `CHECK (((ordinal >= 1) AND (ordinal <= 999)))` |
| template_item_code | text | NULL |  | FK → launch_template_item(code) |
| window_code | text | NOT NULL |  | FK → launch_window(code) |
| task_kind | text | NOT NULL |  | `CHECK ((task_kind = ANY (ARRAY['action', 'output', 'day_ninety_test', 'custom'])))` |
| title | text | NOT NULL |  | `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)))` |
| notes | text | NULL |  | `CHECK (((notes IS NULL) OR ((char_length(notes) >= 1) AND (char_length(notes) <= 4000))))` |
| start_date | date | NOT NULL |  |  |
| due_date | date | NOT NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'not_started'` | `CHECK ((status = ANY (ARRAY['not_started', 'in_progress', 'completed', 'cancelled'])))` |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| output_record_type | text | NULL |  | `CHECK (((output_record_type IS NULL) OR (output_record_type = ANY (ARRAY['charter', 'diagnostic_item', 'baseline', 'north_star', 'kpi_definition', 'tom_canvas_cell', 'initiative', 'business_case', 'roadmap_wave', 'benefit', 'evidence', 'meeting_series']))))` |
| output_record_id | uuid | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `launch_task_completed_stamps` (CHECK): `CHECK ((((status = 'completed') = (completed_at IS NOT NULL)) AND ((completed_at IS NULL) = (completed_by IS NULL))))`
- `launch_task_dates` (CHECK): `CHECK ((due_date >= start_date))`
- `launch_task_kind_template` (CHECK): `CHECK (((task_kind = 'custom') = (template_item_code IS NULL)))`
- `launch_task_ordinal_key` (UNIQUE): `UNIQUE (plan_id, ordinal)`
- `launch_task_output_link` (CHECK): `CHECK (((output_record_id IS NULL) OR (output_record_type IS NOT NULL)))`
- `launch_task_plan_fkey` (FK): `FOREIGN KEY (transformation_id, plan_id) REFERENCES launch_plan(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `launch_task_template_key` (UNIQUE): `UNIQUE (plan_id, template_item_code)`
- `launch_task_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `launch_task_plan_idx`: `(plan_id, due_date, ordinal)`

**Triggers:**

- `launch_task_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `launch_task_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `launch_task_guard()`
- `launch_task_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## launch_task_predecessor

- **Purpose:** A predecessor link between two tasks of the same plan; 'blocked by' is derived from it (REQ-S14-004; ADR-0048 §3).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** `launch_plan.edit`. **Lifecycle:** active → removed (stamped, never deleted); no cycles; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| task_id | uuid | NOT NULL |  |  |
| predecessor_task_id | uuid | NOT NULL |  |  |
| removed_at | timestamp with time zone | NULL |  |  |
| removed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `launch_task_predecessor_not_self` (CHECK): `CHECK ((task_id <> predecessor_task_id))`
- `launch_task_predecessor_pred_fkey` (FK): `FOREIGN KEY (transformation_id, predecessor_task_id) REFERENCES launch_task(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `launch_task_predecessor_removed_complete` (CHECK): `CHECK (((removed_at IS NULL) = (removed_by IS NULL)))`
- `launch_task_predecessor_task_fkey` (FK): `FOREIGN KEY (transformation_id, task_id) REFERENCES launch_task(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Indexes:**

- `launch_task_predecessor_active_key`: `UNIQUE (task_id, predecessor_task_id) WHERE (removed_at IS NULL)`

**Triggers:**

- `launch_task_predecessor_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `launch_task_predecessor_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `launch_task_predecessor_guard()`
- `launch_task_predecessor_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## day_ninety_test

- **Purpose:** The Day-90 leadership test of a plan, scheduled on day 90 (REQ-PB-087; ADR-0048 §4).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** the plan's generation, `day_ninety_test.respond` (complete). **Lifecycle:** open → completed (all six answered); versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| plan_id | uuid | NOT NULL |  |  |
| scheduled_date | date | NOT NULL |  |  |
| status | text | NOT NULL | `'open'` | `CHECK ((status = ANY (ARRAY['open', 'completed'])))` |
| answered_count | smallint | NOT NULL | `0` | `CHECK (((answered_count >= 0) AND (answered_count <= 6)))` |
| completed_at | timestamp with time zone | NULL |  |  |
| completed_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `day_ninety_test_completed_complete` (CHECK): `CHECK ((((status = 'completed') = (completed_at IS NOT NULL)) AND ((completed_at IS NULL) = (completed_by IS NULL)) AND ((status <> 'completed') OR (answered_count = 6))))`
- `day_ninety_test_plan_fkey` (FK): `FOREIGN KEY (transformation_id, plan_id) REFERENCES launch_plan(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `day_ninety_test_plan_key` (UNIQUE): `UNIQUE (plan_id)`
- `day_ninety_test_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Triggers:**

- `day_ninety_test_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `day_ninety_test_counted`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `day_ninety_test_counted()`
- `day_ninety_test_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `day_ninety_test_guard()`
- `day_ninety_test_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## day_ninety_response

- **Purpose:** A leader's response (yes/no) to one Day-90 question, with comment and evidence (REQ-PB-087; ADR-0048 §4).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `launch`. **Who writes:** `day_ninety_test.respond`. **Lifecycle:** written while the test is open; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| test_id | uuid | NOT NULL |  |  |
| question_code | text | NOT NULL |  | FK → day_ninety_question(code) |
| answer | text | NOT NULL |  | `CHECK ((answer = ANY (ARRAY['yes', 'no'])))` |
| comment | text | NULL |  | `CHECK (((comment IS NULL) OR ((char_length(comment) >= 1) AND (char_length(comment) <= 2000))))` |
| evidence_id | uuid | NULL |  |  |
| responded_by | uuid | NOT NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `day_ninety_response_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `day_ninety_response_key` (UNIQUE): `UNIQUE (test_id, question_code)`
- `day_ninety_response_test_fkey` (FK): `FOREIGN KEY (transformation_id, test_id) REFERENCES day_ninety_test(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `day_ninety_response_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `day_ninety_response_counted`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `day_ninety_test_counted()`
- `day_ninety_response_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `day_ninety_response_guard()`
- `day_ninety_response_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## health_assessment

- **Purpose:** HealthAssessment (REQ-S16-021): one 25-question Transformation Health Check under a fixed scoring scheme version, with score, band and reassessment chain (REQ-PB-091, REQ-PB-092, REQ-S14-001..003; ADR-0048 §5).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `health`. **Who writes:** `health_check.assess`. **Lifecycle:** draft → submitted (final; score and band recomputed and checked by the database); one draft per transformation; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| sequence_no | smallint | NOT NULL |  | `CHECK (((sequence_no >= 1) AND (sequence_no <= 9999)))` |
| scheme_version_id | uuid | NOT NULL |  | FK → methodology_version(id) |
| assessment_date | date | NOT NULL |  |  |
| owner_user_id | uuid | NOT NULL |  | FK → app_user(id) |
| status | text | NOT NULL | `'draft'` | `CHECK ((status = ANY (ARRAY['draft', 'submitted'])))` |
| answered_count | smallint | NOT NULL | `0` | `CHECK (((answered_count >= 0) AND (answered_count <= 25)))` |
| score | numeric(7,2) | NULL |  | `CHECK (((score IS NULL) OR (score >= (0)::numeric)))` |
| score_max | numeric(7,2) | NULL |  | `CHECK (((score_max IS NULL) OR (score_max = ANY (ARRAY[(25)::numeric, (100)::numeric]))))` |
| band_key | text | NULL |  | `CHECK (((band_key IS NULL) OR (band_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$')))` |
| previous_assessment_id | uuid | NULL |  |  |
| submitted_at | timestamp with time zone | NULL |  |  |
| submitted_by | uuid | NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `health_assessment_previous_fkey` (FK): `FOREIGN KEY (transformation_id, previous_assessment_id) REFERENCES health_assessment(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `health_assessment_sequence_key` (UNIQUE): `UNIQUE (transformation_id, sequence_no)`
- `health_assessment_submitted_complete` (CHECK): `CHECK ((((status = 'submitted') = (submitted_at IS NOT NULL)) AND ((submitted_at IS NULL) = (submitted_by IS NULL)) AND ((status = 'submitted') = (score IS NOT NULL)) AND ((score IS NULL) = (score_max IS NULL)) AND ((score IS NULL) = (band_key IS NULL)) AND ((status <> 'submitted') OR (answered_count = 25)) AND ((score IS NULL) OR (score <= score_max))))`
- `health_assessment_transformation_id_id_key` (UNIQUE): `UNIQUE (transformation_id, id)`

**Indexes:**

- `health_assessment_one_draft_key`: `UNIQUE (transformation_id) WHERE (status = 'draft')`

**Triggers:**

- `health_assessment_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `health_assessment_counted`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `health_assessment_counted()`
- `health_assessment_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `health_assessment_guard()`
- `health_assessment_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## health_assessment_answer

- **Purpose:** The response, evidence, owner and action of one question of an assessment (M0262; ADR-0048 §5).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `health`. **Who writes:** `health_check.assess`. **Lifecycle:** written while the assessment is a draft; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| assessment_id | uuid | NOT NULL |  |  |
| question_code | text | NOT NULL |  | `CHECK ((question_code ~ '^q(0[1-9]|1[0-9]|2[0-5])$'))` |
| response | text | NOT NULL |  | `CHECK ((response = ANY (ARRAY['yes', 'no', 'partial', 'na'])))` |
| evidence_note | text | NULL |  | `CHECK (((evidence_note IS NULL) OR ((char_length(evidence_note) >= 1) AND (char_length(evidence_note) <= 2000))))` |
| evidence_id | uuid | NULL |  |  |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| action_note | text | NULL |  | `CHECK (((action_note IS NULL) OR ((char_length(action_note) >= 1) AND (char_length(action_note) <= 1000))))` |
| answered_by | uuid | NOT NULL |  | FK → app_user(id) |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `health_assessment_answer_evidence_fkey` (FK): `FOREIGN KEY (transformation_id, evidence_id) REFERENCES evidence(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `health_assessment_answer_key` (UNIQUE): `UNIQUE (assessment_id, question_code)`
- `health_assessment_answer_parent_fkey` (FK): `FOREIGN KEY (transformation_id, assessment_id) REFERENCES health_assessment(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`

**Triggers:**

- `health_assessment_answer_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `health_assessment_answer_counted`: CONSTRAINT AFTER INSERT DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `health_assessment_counted()`
- `health_assessment_answer_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `health_assessment_answer_guard()`
- `health_assessment_answer_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

## health_assessment_action

- **Purpose:** The top 3 improvement actions of an assessment (B0150, M0288; ADR-0048 §5).
- **Migration:** `0086_p5_launch_plans_health_checks.sql`. **API module:** `health`. **Who writes:** `health_check.assess`. **Lifecycle:** ranks 1-3; written while the assessment is a draft; versioned.
- **`mth_app` privileges:** INSERT, SELECT, UPDATE.

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| organization_id | uuid | NOT NULL |  | FK → organization(id) |
| transformation_id | uuid | NOT NULL |  | FK → transformation(id) |
| assessment_id | uuid | NOT NULL |  |  |
| rank | smallint | NOT NULL |  | `CHECK (((rank >= 1) AND (rank <= 3)))` |
| action_text | text | NOT NULL |  | `CHECK (((char_length(action_text) >= 1) AND (char_length(action_text) <= 1000)))` |
| owner_user_id | uuid | NULL |  | FK → app_user(id) |
| due_date | date | NULL |  |  |
| improvement_item_id | uuid | NULL |  |  |
| version | integer | NOT NULL | `1` | `CHECK ((version >= 1))` |
| created_at | timestamp with time zone | NOT NULL | `now()` |  |
| created_by | uuid | NOT NULL |  | FK → app_user(id) |
| updated_at | timestamp with time zone | NOT NULL | `now()` |  |
| updated_by | uuid | NOT NULL |  | FK → app_user(id) |

**Table constraints:**

- `health_assessment_action_improvement_fkey` (FK): `FOREIGN KEY (transformation_id, improvement_item_id) REFERENCES improvement_item(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `health_assessment_action_parent_fkey` (FK): `FOREIGN KEY (transformation_id, assessment_id) REFERENCES health_assessment(transformation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT`
- `health_assessment_action_rank_key` (UNIQUE): `UNIQUE (assessment_id, rank)`

**Triggers:**

- `health_assessment_action_audit_required`: CONSTRAINT AFTER INSERT OR UPDATE DEFERRABLE INITIALLY DEFERRED FOR EACH ROW → `p2_audit_required()`
- `health_assessment_action_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `health_assessment_action_guard()`
- `health_assessment_action_row_guard`: BEFORE INSERT OR UPDATE FOR EACH ROW → `p2_row_guard()`

