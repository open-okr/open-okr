-- Ten codes from the locale registry (docs/design/languages.md §7).
-- No "if exists": a wrong name must fail the migration, not pass silently.
alter table workspace_members
  drop constraint workspace_members_language_known;

alter table workspace_members
  add constraint workspace_members_language_known
    check (language is null or language in
      ('en', 'ms', 'zh-Hans', 'es', 'ar', 'de', 'pt', 'fr', 'it', 'id'))
    not valid;

alter table workspace_members
  validate constraint workspace_members_language_known;
