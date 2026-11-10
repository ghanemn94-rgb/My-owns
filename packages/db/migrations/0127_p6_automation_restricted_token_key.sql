-- 0127 P6 DG6 round-10 repair: the key that binds a restricted condition token to its issuing rule-version row
-- (T-DG6-BE-Z15; F-DG6-640; D-233, extending D-226, D-228 (1) and D-231; ADR-0051 §2 amendment D-231 part A).
-- Authored by backend-workflow-engineer. Runs as mth_owner inside one transaction opened by `mth-db migrate`.
-- Forward-only: never edit once merged. SQL floor: PostgreSQL 16. Id: the next above the highest shipped file on this
-- branch (0126, D-196 item 2); the orchestrator renumbers at merge if another task shipped a higher id first.
--
-- A condition literal naming a record the reader is not admitted to is shown as `[restricted:<tag>:<k>]`
-- (apps/api automation/versions.ts). <tag> is the first 96 bits (24 hex digits) of
-- HMAC-SHA256(restricted_token_key, "mth.automation.restricted-token.v1" LF <row id> LF <row version>), so a token names
-- the ROW it was issued from and its revision, not only a small per-row counter that every row shares (F-DG6-640). A
-- save resolves a token only when its tag is the tag of the row being replaced at the If-Match version.
--
--   * automation_rule_version.restricted_token_key bytea: 32 bytes drawn from PostgreSQL's strong random source (two
--     gen_random_uuid() values, 244 random bits; core since PostgreSQL 13, no extension) when the row is inserted.
--     ADD COLUMN with a volatile default evaluates it once per existing row, so every existing version gets its own
--     key. Never served by the API, never audited (the version audit diff covers the content columns only), never
--     logged, never copied into a new version (each row draws its own). Without the key a tag cannot be computed
--     or checked offline; with it, a tag still discloses neither the row id nor any condition literal (HMAC).
--   * Immutable after insert (automation_rule_version_token_key_immutable): a changed key would turn every token the
--     row ever issued stale. No API path writes it.
-- Every existing token (`[restricted:<version>:<k>]`, D-231) becomes stale on deploy: the API refuses it 422
-- automation_rule.restricted_token_stale and the editor asks the author to reload and re-apply (no stored value
-- changes). No existing row changes except the new column. Nothing here approves anything (no business approval,
-- G1-G6), and nothing reads or writes DG0-DG7.

ALTER TABLE automation_rule_version
  ADD COLUMN restricted_token_key bytea NOT NULL
    DEFAULT (uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
    CONSTRAINT automation_rule_version_token_key_length CHECK (octet_length(restricted_token_key) = 32);

COMMENT ON COLUMN automation_rule_version.restricted_token_key IS
  'T-DG6-BE-Z15 (D-233): per-row secret HMAC key of the restricted condition token tag. Never served, audited or logged; immutable.';

CREATE FUNCTION automation_rule_version_token_key_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.restricted_token_key IS DISTINCT FROM OLD.restricted_token_key THEN
    RAISE EXCEPTION 'automation_rule_version: restricted_token_key is set when the version is created and never changes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'automation_rule_version_token_key_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automation_rule_version_token_key_immutable BEFORE UPDATE ON automation_rule_version
  FOR EACH ROW EXECUTE FUNCTION automation_rule_version_token_key_immutable();
