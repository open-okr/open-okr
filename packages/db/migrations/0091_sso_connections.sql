-- SSO connections: per-workspace OIDC provider configuration (P8-T07).
--
-- Each row is one identity provider configured for one workspace. The
-- client secret is envelope-encrypted with the instance's root key,
-- following the same pattern as ai_credentials and channel_connections.
--
-- Better Auth's genericOAuth plugin is configured at boot from these
-- rows. A new connection takes effect on the next restart. This is a
-- documented limitation rather than a feature: the alternative is
-- rebuilding the auth instance on every sign-in, which puts a database
-- read on the hot path of every request.
--
-- SAML is supported through SAML-to-OIDC bridges (Keycloak, Auth0,
-- Okta, Azure AD). A native SAML flow is not in Better Auth 1.x and
-- building one outside it would violate the "authentication goes
-- through Better Auth only" rule.

create table sso_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- A short slug used in the sign-in URL and as the genericOAuth provider id.
  -- Unique per workspace so two providers cannot collide on callback URLs.
  provider_id text not null,
  -- Human-readable name shown on the SSO button (e.g., "Sign in with Okta").
  display_name text not null,
  -- OIDC discovery URL. When set, authorization, token and userinfo endpoints
  -- are fetched from it and the three explicit URL columns are ignored.
  discovery_url text,
  -- Explicit endpoints, used when there is no discovery URL.
  authorization_url text,
  token_url text,
  user_info_url text,
  -- OAuth client credentials. client_id is plaintext; client_secret is
  -- envelope-encrypted with the instance root key.
  client_id text not null,
  -- The three envelope-encryption columns, same shape as ai_credentials.
  secret_ciphertext text not null,
  secret_data_key text not null,
  secret_key_id text not null,
  -- OAuth scopes, space-separated. Defaults to "openid email profile".
  scopes text not null default 'openid email profile',
  -- When true, members of this workspace must sign in through this provider.
  -- Password and passkey sign-in are refused for email domains that match.
  enforce boolean not null default false,
  -- Email domains this connection applies to. A comma-separated list (e.g.,
  -- "acme.com,acme.org"). When non-empty, only users whose email matches
  -- one of these domains see the SSO button and are subject to enforcement.
  -- When empty, the connection applies to every member of the workspace.
  email_domains text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint sso_connections_provider_unique
    unique (workspace_id, provider_id)
    -- Soft-delete aware: a deleted connection frees its provider_id.
    -- The partial index below is what actually enforces this.
);

-- The real uniqueness constraint, respecting soft delete.
create unique index sso_connections_provider_live_idx
  on sso_connections (workspace_id, provider_id)
  where deleted_at is null;

-- Tenant floor: row-level security.
alter table sso_connections enable row level security;
alter table sso_connections force row level security;

create policy sso_connections_tenant
  on sso_connections
  using (workspace_id = current_setting('app.workspace_id', true)::uuid);
