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

create policy embeddings_tenant on embeddings
  using (workspace_id = current_setting('app.workspace_id')::uuid);
