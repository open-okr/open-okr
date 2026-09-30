-- A person whose address a workspace trusts can find that workspace
-- (completeness review M-34).
--
-- **Trusted-domain joining could never happen.** An administrator saves
-- `trustedEmailDomains` on the general card and `invitations.joinByTrustedDomain`
-- checks it, but the action needs to be told which workspace to run in, and
-- which workspace trusts a domain is exactly what a person who belongs to none
-- of them cannot ask. Under the tenant floor that question answers nothing, so
-- nothing ever called the action and the setting changed nothing.
--
-- **Another pre-tenant key, and a narrow one.** `app.trusted_email_domain`
-- names one domain, and the policy admits the `workspaces` rows whose own
-- `settings.trustedEmailDomains` holds exactly that domain. A domain no
-- workspace trusts reaches nothing, a parent or child domain is not a match,
-- and no other table names this setting. `withTrustedEmailDomain` in
-- packages/db is the one place that sets it, and its one caller in
-- packages/core reads the id and the name and never the settings.
--
-- **Only when no workspace is scoped**, the rule migration 0008 set for
-- `own_workspaces`: inside a tenant transaction the tenant policy is the whole
-- truth and nothing may widen it. SELECT only, so it opens a read and never a
-- write. A deleted workspace is not admitted at all.
--
-- The domain it is set to is the part of the signed-in person's own address
-- after the @, read from their account row rather than from anything a request
-- sends. It is not a secret the way a token digest is, which is why the policy
-- reveals so little: a workspace's id and name, to somebody the workspace has
-- already said may join it.
--
-- Additive and forward-only. The previous release never sets the key, so the
-- policy admits nothing for it and changes none of its reads.

create policy workspaces_trusted_domain on workspaces
  for select
  using (
    nullif(current_setting('app.workspace_id', true), '') is null
    and deleted_at is null
    -- An array, because `?` also matches an object's keys and a bare string,
    -- and the setting is a list of domains or it is nothing.
    and jsonb_typeof(settings -> 'trustedEmailDomains') = 'array'
    and (settings -> 'trustedEmailDomains')
      ? nullif(current_setting('app.trusted_email_domain', true), '')
  );
