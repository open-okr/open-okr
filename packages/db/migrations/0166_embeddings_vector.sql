-- The embedding column becomes a vector when pgvector arrived after 0031
-- (plan 0.8.0 H5, docs/design/pgvector-migration.md §3.5, H5-Q2, approved by
-- Akmal on 11 November 2026).
--
-- 0031 makes `embeddings.embedding` a vector only when the extension exists as
-- it runs. pgvector is not a trusted extension, so a migrator that is not a
-- superuser cannot create it, and an instance where nobody had created it
-- first kept a text column. Adding the extension afterwards changes nothing,
-- and until the column is a vector retrieval keeps to full text, because it
-- reads the column rather than the extension.
--
-- This converts the column when the extension exists now and the column is
-- still text, and does nothing otherwise: no extension, or a column 0031
-- already converted. Every value the product wrote to the text column is a
-- vector literal or null, so the cast holds. No index, for 0031's reason: an
-- index needs a fixed size, and the size belongs to the embedding model.
--
-- An operator who adds the extension after this has run uses the same
-- statement by hand (docs/runbooks/upgrade.md, 0.7 to 0.8).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector')
     and exists (
       select 1 from pg_attribute
        where attrelid = 'embeddings'::regclass
          and attname = 'embedding'
          and not attisdropped
          and format_type(atttypid, atttypmod) = 'text'
     ) then
    execute 'alter table embeddings alter column embedding type vector using embedding::vector';
  end if;
end
$$;
