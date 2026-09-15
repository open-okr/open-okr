-- Site messages, and who has dismissed one (P8-T03c).
--
-- Design: docs/design/p8-t01b-operator-console.md §4, which this migration
-- corrects on two points, both recorded below.
--
-- A site message is what the vendor says to everybody, or to a named set of
-- workspaces: a maintenance window, an incident, a deprecation. It sits above
-- the tenant floor because one row can be shown in many workspaces, and a
-- copy per workspace would be the same sentence written a thousand times.

-- openokr:instance-scope: one message is shown across many workspaces, so it
-- belongs above the floor rather than beneath one. `target_workspace_ids`
-- names which, and is null for everybody.
-- openokr:hard-delete: an operator removing a message removes it. There is no
-- authorship to preserve and no audit value in a soft-deleted banner; the
-- audit trail records that it was created and removed.
CREATE TABLE site_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- **Plain text, not editor JSON.** The design left this open and it is
  -- settled here: a site message has the widest audience in the product, and
  -- rich text would add a sanitising surface at the one place a mistake
  -- reaches every customer at once. An operator writing a maintenance notice
  -- needs a sentence, not a heading level.
  body          text NOT NULL CHECK (length(btrim(body)) > 0),
  level         text NOT NULL DEFAULT 'info'
                CHECK (level IN ('info', 'warn', 'bad')),
  -- **The window is required, not optional.** A site message with no end is a
  -- banner everybody learns to ignore, and the next one is ignored with it.
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  CONSTRAINT site_messages_window CHECK (ends_at > starts_at),
  -- Null is everybody. A list names the workspaces it reaches.
  target_workspace_ids uuid[],
  CONSTRAINT site_messages_target_not_empty
    CHECK (target_workspace_ids IS NULL OR cardinality(target_workspace_ids) > 0),
  dismissible   boolean NOT NULL DEFAULT true,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_messages_window_idx ON site_messages (starts_at, ends_at);

ALTER TABLE site_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_messages FORCE ROW LEVEL SECURITY;

-- Anybody signed in may read a live message. That is the point of one: it is
-- the vendor talking to every customer, so there is nothing to scope. Whether
-- a given reader is targeted is decided by the query rather than the policy,
-- because the policy cannot see which workspace the reader is looking at.
CREATE POLICY site_messages_read ON site_messages
  FOR SELECT
  USING (true);

-- Writing is instance administration, the same bar `system_settings` sets.
-- The operator console sets it on purpose and no request handler does.
CREATE POLICY site_messages_admin ON site_messages
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- Who has dismissed what.
--
-- **Keyed on the user, not the member, and that corrects the design.** §4 said
-- "a dismissal is per member and lives in the member's own settings". A
-- member is per workspace, so somebody in three workspaces would meet the
-- same instance-wide sentence three times and have to dismiss it three times.
-- Dismissing is a fact about a person having read something, which is a fact
-- about the person.
-- openokr:instance-scope: a dismissal belongs to a user across every
-- workspace they are in, for the reason above.
-- openokr:hard-delete: removing the message removes these with it. A
-- dismissal of a message that no longer exists is not a record of anything.
CREATE TABLE site_message_dismissals (
  message_id uuid NOT NULL REFERENCES site_messages(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE site_message_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_message_dismissals FORCE ROW LEVEL SECURITY;

-- A person reads and writes their own dismissals and nobody else's, through
-- the `app.user_id` key the workspace switcher already uses.
CREATE POLICY site_message_dismissals_own ON site_message_dismissals
  USING (user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''));
