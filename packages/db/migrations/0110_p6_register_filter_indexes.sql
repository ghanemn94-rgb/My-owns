-- 0110 P6 slices H and G: the indexes behind the server-side register filters and sorts and the search feed
-- (T-DG6-ARCH-04; ADR-0057 §5, ADR-0058 §6 "index plan", first part). Authored by solution-architect. Runs as mth_owner
-- inside one transaction opened by `mth-db migrate`. Forward-only: never edit once merged. SQL floor: PostgreSQL 16.
--
-- Plain btree indexes only: no table, column, constraint, trigger, grant or row changes, so every DG1-DG5 response is
-- unchanged (probe G04). Each index serves a named query of ADR-0057 §5 or §2:
--   initiative_owner_idx, initiative_lead_idx   listInitiatives ?executiveOwnerUserId= / ?workstreamLeadUserId=
--   initiative_code_sort_idx                    listInitiatives ?sort=code / -code (keyset: code, id)
--   initiative_name_sort_idx                    listInitiatives ?sort=name / -name (keyset: lower(name), id)
--   initiative_planned_end_sort_idx             listInitiatives ?sort=plannedEnd / -plannedEnd (keyset: planned_end, id)
--   transformation_code_sort_idx                listTransformations ?sort=code / -code
--   transformation_updated_sort_idx             listTransformations ?sort=-updatedAt / updatedAt
--   audit_event_feed_idx                        the search index feed: audit events of the 12 indexed record types in
--                                               sequence order after a consumed sequence (ADR-0057 §2).
-- Further indexes found necessary by the load run (DO-F's report) are BE-S's, in a later migration (ADR-0058 §6).
CREATE INDEX initiative_owner_idx ON initiative (transformation_id, executive_owner_user_id)
  WHERE executive_owner_user_id IS NOT NULL;
CREATE INDEX initiative_lead_idx ON initiative (transformation_id, workstream_lead_user_id)
  WHERE workstream_lead_user_id IS NOT NULL;
CREATE INDEX initiative_code_sort_idx ON initiative (transformation_id, code, id);
CREATE INDEX initiative_name_sort_idx ON initiative (transformation_id, lower(name), id);
CREATE INDEX initiative_planned_end_sort_idx ON initiative (transformation_id, planned_end, id);
CREATE INDEX transformation_code_sort_idx ON transformation (organization_id, code, id);
CREATE INDEX transformation_updated_sort_idx ON transformation (organization_id, updated_at, id);
CREATE INDEX audit_event_feed_idx ON audit_event (seq)
  INCLUDE (record_type, record_id)
  WHERE record_type IN ('transformation', 'initiative', 'kpi_definition', 'benefit', 'raid_entry', 'dependency', 'decision',
                        'deliverable', 'evidence', 'business_case', 'lesson', 'change_request');
