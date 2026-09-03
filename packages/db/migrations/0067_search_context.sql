-- The search index gains the column that lets it filter in SQL (P5-T13).
--
-- `search_documents` has existed since 0003 and nothing has ever written to it:
-- only the Postgres driver and the driver's own test have touched the table.
-- P5-T13 is what fills it, and this is the one column it was missing.
--
-- **`context_id` is the whole reason a search can be fast and correct at once.**
-- Retrieval over `embeddings` asks the access getter once per candidate, which
-- is right for a handful of passages and wrong for a search box: a query that
-- fetched a hundred rows and discarded ninety would be slow and would still
-- under-return for the narrowest reader. With the context on the row, the same
-- `EXISTS` clause every list read composes filters in the query, and a member
-- who loses a space stops seeing its rows on the next search with no reindex.
--
-- The work-layer design's §5.2 records this as the known better shape, and adds
-- that retrieval should adopt it if search proves it out. That backport is its
-- own row rather than this one.
--
-- Nullable, and a null row is invisible to every member. The index is a
-- projection with no rows in it yet, so there is nothing to backfill; a row
-- written without a context would be a row nobody can find, which is the safe
-- direction for a mistake to fall.
alter table search_documents add column context_id uuid;

-- The search query's own shape: this workspace, this context, ranked.
create index search_documents_context_idx
  on search_documents (workspace_id, context_id);
