-- An invitation can make a guest of one space (TECHNICAL-PLAN §4.1,
-- completeness review M-22).
--
-- **A guest could only be made by converting a member.** So inviting somebody
-- from outside the organisation meant making them a full member first, with
-- `edit` on the whole workspace, and then taking it away again. For the time in
-- between they could read everything.
--
-- **`member_kind` says what accepting makes.** `human` is every invitation
-- issued before this migration and every one issued since without asking for a
-- guest. `guest` makes a `workspace_members` row of kind `guest` with no binding
-- on the workspace's own context, the same state `people.convertToGuest`
-- leaves, and then puts it in the one space `space_id` names.
--
-- **The check ties the two together both ways.** A guest invitation names its
-- space, because a guest who reaches nothing is not an invitation anybody meant
-- to send. A member invitation names none, because a member reaches every space
-- through the workspace's standard group already.
--
-- Additive, with a default, so the previous release inserts rows the check
-- accepts and reads the table unchanged. `invite_links` already carries its
-- tenant policy from migration 0010 and its second-key policy from 0075, and a
-- new column inherits both.
alter table invite_links
  add column member_kind text not null default 'human'
    check (member_kind in ('human', 'guest')),
  add column space_id uuid references spaces (id);

alter table invite_links
  add constraint invite_links_guest_names_a_space check (
    (member_kind = 'guest' and space_id is not null) or
    (member_kind = 'human' and space_id is null)
  );
