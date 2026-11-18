-- The copilot's reads join the agent surface's record (docs/design/
-- copilot-live-data.md section 3.6, decision D6, plan 0.9.0 L3).
--
-- `ai_tool_calls` recorded external agents only: `source` was checked in
-- ('mcp') and every row named a grant or a token. The copilot now reads live
-- records as the asking member, and what it looked at, for whom and when
-- belongs in the same trail. A copilot row carries the member and neither a
-- grant nor a token, because there is no connection: the member is asking in
-- the browser.
--
-- No new column (decision W2-Q). The line under a copilot answer is rebuilt
-- from these rows by member and time.
--
-- The same rule as before still holds for every row: no argument value, no
-- result and no refusal sentence is stored (agent-tool-calls.md D2).
--
-- Forward-only and safe for a rolling upgrade: both checks gain a value the
-- previous release never writes, every existing row (all `mcp`, each with
-- exactly one connection) still satisfies them, and no row changes. Widening
-- a check the way migration 0151 did: drop it by name, add it again.
alter table ai_tool_calls
  drop constraint if exists ai_tool_calls_source_check;

alter table ai_tool_calls
  add constraint ai_tool_calls_source_check
  check (source in ('mcp', 'copilot'));

alter table ai_tool_calls
  drop constraint if exists ai_tool_calls_one_connection;

-- An agent call has exactly one connection, as before. A copilot read has
-- none: the member asked in the browser.
alter table ai_tool_calls
  add constraint ai_tool_calls_one_connection
  check (
    (source = 'mcp' and (grant_id is null) <> (token_id is null))
    or (source = 'copilot' and grant_id is null and token_id is null)
  );
