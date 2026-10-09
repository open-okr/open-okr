-- SAML on sso_connections (P8-T07c).
--
-- P8-T07's deliverable line read "OIDC and SAML through the authentication
-- layer". Only OIDC was built. Migration 0091 records the reason as "a native
-- SAML flow is not in Better Auth 1.x and building one outside it would
-- violate the authentication goes through Better Auth only rule". That is not
-- true: `@better-auth/sso` is a first-party plugin published against the
-- pinned `better-auth ^1.7.4`, it is MIT, and it implements SAML through
-- `samlify`. Native SAML is inside the rule.
--
-- **`sso_connections` stays the one authority, and the plugin's own
-- `ssoProvider` table is derived from it.** Agung settled that on
-- 18 September 2026; `docs/design/p8-t07c-saml.md` records why and what the
-- two alternatives cost. The short version: which identity provider a
-- workspace trusts is business data, so it belongs on a table with
-- `workspace_id` and a policy, and the plugin's table has neither.
--
-- No new table, so no new policy. These columns join a table that already
-- carries the tenant floor from 0091, the pre-tenant select policy from 0094,
-- and soft delete.

-- Which protocol this row configures. `oidc` is the default, so every row
-- that exists keeps its meaning and no backfill runs.
alter table sso_connections
  add column kind text not null default 'oidc'
    check (kind in ('oidc', 'saml'));

-- Where the browser is sent to authenticate.
alter table sso_connections add column saml_entry_point text;

-- The identity provider's entity id, which is what it calls itself in the
-- assertions it signs.
alter table sso_connections add column saml_issuer text;

-- The provider's signing certificate.
--
-- **Deliberately not encrypted.** It is a public key: every identity provider
-- publishes it in its metadata document, and treating it as a secret would
-- mean envelope-encrypting something anybody can fetch, while implying to
-- whoever reads this schema that leaking it matters. What matters is that it
-- is the *right* certificate, which is an integrity question and is answered
-- by the tenant floor above and by the admin screen that writes it.
alter table sso_connections add column saml_certificate text;

-- What this instance calls itself to the provider. Null means the instance
-- URL, which is what most providers expect.
alter table sso_connections add column saml_audience text;

-- Assertions must be signed. Stored rather than assumed, because a provider
-- that cannot sign is a provider this instance should refuse rather than
-- quietly accommodate, and a column makes that refusal visible.
alter table sso_connections
  add column saml_want_assertions_signed boolean not null default true;

-- A SAML row needs its entry point, its issuer and its certificate, and an
-- OIDC row needs none of them. The constraint states that rather than leaving
-- a half-configured provider to fail at somebody's sign-in.
--
-- `client_id` and the three secret columns stay `not null` from 0091, so a
-- SAML row carries placeholder values there. That is the one ugly consequence
-- of extending this table rather than adding a second one, and it is the right
-- trade: a second table would mean two places to look for "which providers
-- does this workspace trust", which is the question every read here asks.
alter table sso_connections
  add constraint sso_connections_saml_complete
  check (
    kind <> 'saml'
    or (saml_entry_point is not null
        and saml_issuer is not null
        and saml_certificate is not null)
  );

-- One provider id per workspace already holds from 0091. Nothing here widens
-- it: a SAML provider and an OIDC provider cannot share an id in one
-- workspace, which is what the sign-in path needs to resolve one from the
-- other.
