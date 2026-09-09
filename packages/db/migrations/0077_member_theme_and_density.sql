-- A member's theme and density follow them (UIUX-PLAN.md §9, P6-G23).
--
-- **The provider has exposed `setTheme` and `setDensity` since P2-T10 and
-- nothing has ever called them.** Both preferences lived in `localStorage`
-- only, which means they were a property of a browser rather than of a person:
-- signing in on a second machine, or in a private window, put a member back on
-- the default. UIUX-PLAN §9 asks every interface task to verify both themes and
-- both densities, and neither state was reachable from the product at all.
--
-- Nullable, and null is not "unset waiting to be filled in": it is "follow the
-- system", which is what the theme provider already does with no stored value.
-- A member who has never chosen keeps the behaviour they have today, so no
-- backfill is needed and none is done here.
--
-- Forward-only in both directions. The previous release ignores columns it does
-- not know, and this one falls back to the browser's own stored value when the
-- column is null, which is exactly what a rolling upgrade sees.
--
-- No new policy. `workspace_members` already carries `workspace_id` and its
-- row-level security policy from migration 0002.

alter table workspace_members
  add column theme text,
  add column density text;

-- Both are small closed sets, and a value outside them would put the shell into
-- a state the design system has no tokens for. Checked here as well as in the
-- action, because a row written by an import or a data change never passes
-- through the action.
alter table workspace_members
  add constraint workspace_members_theme_known
    check (theme is null or theme in ('light', 'dark', 'system')),
  add constraint workspace_members_density_known
    check (density is null or density in ('comfortable', 'compact'));
