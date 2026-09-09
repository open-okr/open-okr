-- A member's own language (UIUX-PLAN.md §8, TECHNICAL-PLAN.md §4.14, P6-G22a).
--
-- **The catalogue has existed since P2-T10 and the locale has been pinned to
-- `en` in the root layout ever since.** `TranslationsProvider` takes a locale,
-- `CATALOGUES` carries a stubbed `ms`, and nothing could ever select it: the
-- workspace's `language` setting is stored in `workspaces.settings` and read by
-- no renderer, and a member had no language at all. §4.14 documents "Member
-- language, theme, density" as one line; P6-G23 added the second and third and
-- said this one arrives with the task that wires the locale, which is this one.
--
-- Nullable, and null is not "unset waiting to be filled in": it is "follow the
-- workspace", which is what a member who has never chosen should get and what
-- every existing member gets today. No backfill is needed and none is done.
--
-- Forward-only in both directions. The previous release ignores a column it
-- does not know and keeps rendering `en`; this one falls back to the
-- workspace's language when the column is null. That is what a rolling upgrade
-- sees from either side.
--
-- No new policy. `workspace_members` already carries `workspace_id` and its
-- row-level security policy from migration 0002.

alter table workspace_members
  add column language text;

-- A closed set, because a locale outside it has no catalogue and
-- `translate()` raises on a missing key by design rather than falling back to
-- something that looks like content. Checked here as well as in the action,
-- because a row written by an import or a data change never passes through the
-- action. A new locale is a new catalogue plus a line here, in that order.
alter table workspace_members
  add constraint workspace_members_language_known
    check (language is null or language in ('en', 'ms'));
