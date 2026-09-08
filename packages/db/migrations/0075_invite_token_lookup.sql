-- An invitation token admits its own row before a tenant is known (P6-G06b).
--
-- **Migration 0010 assumed the URL would name the workspace and it does not.**
-- Its own comment says so: "an invite URL names its workspace (by slug)
-- alongside the token, so acceptance always runs with app.workspace_id already
-- set". Nothing built the URL that way. `sendInvitation` in
-- `packages/core/src/outbox/handlers.ts` has mailed `<base>/join/<token>` since
-- P1-T07, with no slug, and the invitations card issued at P6-G06a hands out a
-- bare token for the same address. So the one thing acceptance needs to know
-- first, which workspace this is, is exactly what the token has to answer.
--
-- **The second-key policy, the sixth of its kind.** `channel_installations`
-- (P5-T02a), `api_tokens` (P5-T07a), `device_authorisations` (P5-T07c-b) and
-- the three OAuth secret tables (P5-T08a) all admit one row through a setting
-- naming a digest the caller already holds. This is the same arrangement and
-- nothing wider: somebody without the token learns nothing, including whether
-- it exists. The `with check` clause is deliberately left tenant-only, so the
-- pre-tenant key opens a read and never a write.
--
-- **The unique index moves from per-workspace to global**, which is what makes
-- the lookup unambiguous: a digest has to name one row across the instance for
-- "which workspace is this" to have an answer. `api_tokens_hash_idx` is global
-- for the same reason. Two workspaces holding one digest was already a
-- collision of 256 random bits and is now refused outright rather than
-- resolving to whichever row the planner reached first.
--
-- Forward-only and safe under a rolling upgrade. The previous release scopes
-- every one of its own queries by workspace, so a policy that admits one extra
-- row it never asks for changes nothing for it, and the narrower index it used
-- is replaced by a stricter one that satisfies the same lookups.

alter policy tenant_isolation on invite_links
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.invite_token_hash', true), '')
  );

-- Global rather than per workspace. Created before the old one is dropped, so
-- the uniqueness this depends on is never unenforced in between.
create unique index invite_links_token_digest_idx
  on invite_links (token_hash)
  where deleted_at is null;

drop index invite_links_token_hash_idx;
