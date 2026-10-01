-- 0007 bind each OIDC login state to the browser that started the login (T-DG1-BE3, F-DG1-103; RFC 6749 §10.12,
-- OIDC Core §3.1.2.1, ADR-0005 §1). GET /auth/login sets a random, short-lived, HttpOnly, SameSite=Lax pre-session
-- cookie (__Host- prefixed and Secure on https) and stores ONLY its SHA-256 here; GET /auth/callback consumes the
-- state only when the presenting browser's cookie hashes to the stored value. A callback URL captured from one
-- browser therefore cannot sign a different browser in.
-- Forward-only. In-flight login states (at most LOGIN_STATE_TTL_MINUTES = 10 minutes old) carry no binding and would
-- be refused by the new callback anyway, so they are removed; the affected users simply start the login again.
DELETE FROM oidc_login_state;

ALTER TABLE oidc_login_state
  ADD COLUMN browser_binding_hash bytea NOT NULL
    CONSTRAINT oidc_login_state_browser_binding_hash_len CHECK (octet_length(browser_binding_hash) = 32);
