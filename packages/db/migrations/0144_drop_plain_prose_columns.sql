-- The plain prose columns go (docs/design/guided-inputs.md §4.7, change 13b).
--
-- 0.3 wrote each piece of session prose twice, as a document and as its
-- plain text, and data changes 0027 to 0032 wrote a document for everything
-- written before. This release reads only the document, so the plain columns
-- are dropped. The release before this one, still serving during a rolling
-- upgrade, read the document first and the plain column only where no
-- document existed, so it keeps working once the guard below has passed.
--
-- **The guard.** An instance may upgrade straight from 0.2 to this release
-- (docs/runbooks/upgrade.md, "How far behind you can be") and never have run
-- 0.3's data changes. Dropping then would lose that prose. So before anything
-- is dropped the migration counts what is still waiting for a document, and
-- refuses with the count per column if anything is. No backfill happens here:
-- schema changes and data changes never mix (PLAN.md §5.1). Decided 13 October
-- 2026.
--
-- The count lifts FORCE ROW LEVEL SECURITY on the five tables for this
-- transaction only, so the owner sees every workspace's rows whatever role
-- runs the migration: a guard that counted under the tenant floor would see
-- nothing and let the drop through. Each `alter table` holds its table locked
-- until the transaction ends, FORCE is restored before it does, and a refusal
-- rolls the lift back with everything else.
do $$
declare
  waiting text := '';
  n bigint;
begin
  alter table okr_sessions no force row level security;
  alter table decisions no force row level security;
  alter table management_answers no force row level security;
  alter table digests no force row level security;
  alter table cycle_revalidations no force row level security;

  select count(*) into n from okr_sessions
   where btrim(coalesce(shifts, '')) <> '' and shifts_document is null;
  if n > 0 then waiting := waiting || format(' okr_sessions.shifts (%s)', n); end if;

  select count(*) into n from okr_sessions s
   where jsonb_typeof(s.notes) = 'object'
     and exists (select 1 from jsonb_each(s.notes) e
                  where jsonb_typeof(e.value) = 'string');
  if n > 0 then waiting := waiting || format(' okr_sessions.notes (%s)', n); end if;

  select count(*) into n from decisions
   where btrim(coalesce(text, '')) <> '' and text_document is null;
  if n > 0 then waiting := waiting || format(' decisions.text (%s)', n); end if;

  select count(*) into n from management_answers
   where btrim(coalesce(body, '')) <> '' and body_document is null;
  if n > 0 then waiting := waiting || format(' management_answers.body (%s)', n); end if;

  select count(*) into n from digests
   where btrim(coalesce(note, '')) <> '' and note_document is null;
  if n > 0 then waiting := waiting || format(' digests.note (%s)', n); end if;

  select count(*) into n from cycle_revalidations
   where btrim(coalesce(change_note, '')) <> '' and change_note_document is null;
  if n > 0 then waiting := waiting || format(' cycle_revalidations.change_note (%s)', n); end if;

  select count(*) into n from cycle_revalidations
   where btrim(coalesce(focus_note, '')) <> '' and focus_note_document is null;
  if n > 0 then waiting := waiting || format(' cycle_revalidations.focus_note (%s)', n); end if;

  alter table okr_sessions force row level security;
  alter table decisions force row level security;
  alter table management_answers force row level security;
  alter table digests force row level security;
  alter table cycle_revalidations force row level security;

  if waiting <> '' then
    raise exception using message = format(
      'Session prose is still waiting to be written as a document, so nothing was dropped. Rows waiting:%s. Run `pnpm db:change` against this database, with DATABASE_ADMIN_URL set to its admin role (docs/runbooks/upgrade.md, 0.3 to 0.4), then start again.',
      waiting);
  end if;
end $$;

-- The check that kept an answer from being empty goes with its column. The
-- action refuses an answer with no words, as it did.
alter table management_answers drop constraint management_answers_body_present;

-- openokr:replaces: 0.3.1 added okr_sessions.shifts_document (migration 0140)
alter table okr_sessions drop column shifts;

-- openokr:replaces: 0.3.1 added decisions.text_document (migration 0140)
alter table decisions drop column text;

-- openokr:replaces: 0.3.1 added management_answers.body_document (migration 0141)
alter table management_answers drop column body;

-- openokr:replaces: 0.3.1 added digests.note_document (migration 0142)
alter table digests drop column note;

-- openokr:replaces: 0.3.1 added cycle_revalidations.change_note_document (migration 0143)
alter table cycle_revalidations drop column change_note;

-- openokr:replaces: 0.3.1 added cycle_revalidations.focus_note_document (migration 0143)
alter table cycle_revalidations drop column focus_note;
