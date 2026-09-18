-- The SSO plugin's own table, derived from sso_connections (P8-T07c-a).
--
-- `@better-auth/sso` reads its providers from a table it owns, the way the
-- passkey and two-factor plugins do. This is that table.
--
-- **It is derived, and sso_connections is the authority.** Agung settled that
-- on 18 September 2026; `docs/design/p8-t07c-saml.md` records the three
-- options and what the other two cost. Nothing in the product reads this
-- table to answer a question: every read goes to sso_connections. A row here
-- that has drifted makes a sign-in fail, which is loud, rather than making an
-- answer wrong, which is not.

-- openokr:not-tenant-scoped: a Better Auth table, beside `users`, `sessions`,
-- `passkeys` and `two_factors`. Better Auth owns its shape and its writes, and
-- this product feeds it. The workspace a row belongs to is not stored here at
-- all: it is on the `sso_connections` row this one is derived from, which does
-- carry the tenant floor. Adding a column Better Auth does not know about
-- would be a column nothing maintains.
--
-- openokr:hard-delete: a derived row has no history worth keeping. When the
-- `sso_connections` row behind it is disabled or soft-deleted, this one is
-- removed outright, which is what stops a provider that the product considers
-- gone from still answering a sign-in.
create table sso_providers (
  id text primary key,

  -- **Namespaced, not the bare `provider_id`.** The plugin requires this to be
  -- unique across the whole instance, while a provider id in this product is
  -- unique per workspace: two workspaces may both call their provider "okta"
  -- and both are right. `loadSSOConnections` has built `sso-<id>-<workspace
  -- prefix>` since P8-T07 for exactly that reason, and SAML uses the same
  -- scheme rather than inventing a second one. The name somebody reads is
  -- `display_name` on the authority table, which is unaffected.
  provider_id text not null unique,

  -- The identity provider's entity id.
  issuer text not null,

  -- The domain the plugin matches an email against. Fed from
  -- `sso_connections.email_domains`, first entry, or the issuer's host when
  -- there is none.
  domain text not null,

  -- Better Auth serialises its own configuration into these. The product does
  -- not read them; it writes them through the plugin's own endpoints, so the
  -- shape stays the plugin's business across upgrades.
  oidc_config text,
  saml_config text,

  -- Who registered it, when a person did. Null for a row the sync wrote.
  user_id text references users(id) on delete cascade,

  -- Better Auth's organization plugin, which this product does not use. The
  -- column exists because the plugin's schema declares it and the adapter
  -- looks it up; it stays null.
  organization_id text
);

create index sso_providers_issuer_idx on sso_providers (issuer);
create index sso_providers_domain_idx on sso_providers (domain);
