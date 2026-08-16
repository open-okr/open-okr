-- Embeddings for semantic retrieval (AI-NATIVE-PLAN.md §9, P4-T13).
--
-- pgvector is optional. The extension is created if available; the table
-- works without it (the vector column stays null and retrieval falls back
-- to the full-text index on search_documents). This keeps the product
-- whole on a Postgres without the extension installed.
--
-- The content_hash column skips re-embedding when content has not changed.
-- The subject columns link each chunk to the entity it was derived from,
-- so access filtering and cascade deletes work through the same paths.

-- Try to create the extension. A Postgres without pgvector installed will
-- skip this statement and the vector column stays unused.
do $$
begin
  create extension if not exists vector;
exception
  when others then
    raise notice 'pgvector is not available (%), semantic search will use full-text fallback', sqlerrm;
end
$$;

-- openokr:hard-delete: an embedding is derived, never authored. A soft-deleted
-- chunk would still sit in the vector index and still come back from a nearest
-- neighbour search unless every query remembered to filter it, so a stale row
-- here is worse than a missing one. When the source changes the chunk is
-- replaced; when the source goes, the cascade takes it.
create table embeddings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  chunk_index integer not null default 0,
  content text not null,
  content_hash text not null,
  model text,
  dimensions integer,
  -- The vector column uses a text type as fallback when pgvector is absent.
  -- When pgvector is present, the alter below changes it to the vector type.
  embedding text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If pgvector is available, alter the column to the native vector type.
-- The cosine-distance index uses hnsw rather than ivfflat because hnsw does
-- not require a training set and works on an empty table.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter table embeddings alter column embedding type vector using embedding::vector';
    execute 'create index embeddings_vector_idx on embeddings using hnsw (embedding vector_cosine_ops)';
  end if;
end
$$;

create unique index embeddings_entity_chunk_idx
  on embeddings (workspace_id, entity_type, entity_id, chunk_index);

create index embeddings_content_hash_idx
  on embeddings (workspace_id, entity_type, entity_id, content_hash);

-- RLS: tenant floor
alter table embeddings enable row level security;
-- Without FORCE the table owner bypasses the policy, and the owner is the role
-- migrations run as. `enable` alone is not the tenant floor. A retrieval index
-- that leaked across workspaces would be the worst table in the product to get
-- this wrong on: it holds the text of everything.
alter table embeddings force row level security;

-- `with check` as well as `using`, so a write cannot carry another workspace's
-- id, and the missing_ok form of `current_setting` so an unscoped request
-- returns nothing rather than raising.
create policy embeddings_tenant on embeddings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
