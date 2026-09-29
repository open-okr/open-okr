import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readScreen, withMessages } from "./screen-text.ts";

/**
 * An administrator invites a guest straight into one space (completeness
 * review M-22).
 *
 * What accepting makes, a guest with nothing on the workspace and `view` on
 * the one space, is proved against a real database in `packages/core`
 * (`guest-invitations.test.ts`). What is checked here is the screen: the
 * invitations page has a guest card that names a space, the action sends the
 * space and nothing that could widen the grant, the issued list says whose
 * guest each one is, and the join page tells a guest what they are agreeing
 * to before they join.
 */

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = (path: string) => readFileSync(at(path), "utf8");

const page = source("../app/admin/invitations/page.tsx");
const pageText = withMessages(
  readScreen(at("../app/admin/invitations/page.tsx")),
);
const actions = source("../app/admin/invitations/actions.ts");
const join = source("../app/join/[token]/page.tsx");
const joinText = withMessages(readScreen(at("../app/join/[token]/page.tsx")));

describe("the guest card", () => {
  test("invites one address as a guest of one chosen space", () => {
    expect(page).toContain("action={createGuestLinkAction}");
    expect(page).toContain('name="spaceId"');
    expect(page).toContain('callAction(context, "spaces.list", {})');
    expect(pageText).toContain("Invite a guest");
    expect(pageText).toContain("They see the one space you choose");
  });

  test("says so when there is no space to invite anybody to", () => {
    expect(page).toContain("spaces.length === 0");
    expect(pageText).toContain("There is no space to invite a guest to yet.");
  });

  test("names each guest invitation's space in the issued list", () => {
    expect(page).toContain('link.memberKind === "guest"');
    expect(pageText).toContain("Guest of {space}");
  });
});

describe("the action behind it", () => {
  const guest = actions.slice(
    actions.indexOf("export async function createGuestLinkAction"),
    actions.indexOf("export async function revokeLinkAction"),
  );

  test("is the ordinary personal invitation with the space named", () => {
    expect(guest).toContain('"invitations.createPersonalLink"');
    expect(guest).toContain("guestSpaceId: spaceId");
  });

  test("sends nothing that could widen what a guest reaches", () => {
    // The level is the action's to decide. A form field for it would be a way
    // for a crafted request to ask for more.
    expect(guest).not.toMatch(/level/i);
  });

  test("refuses a missing space before it asks the instance", () => {
    expect(guest.indexOf('spaceId === ""')).toBeLessThan(
      guest.indexOf("callAction("),
    );
  });
});

describe("where a guest lands", () => {
  test("the front door sends somebody who holds nothing on the workspace to their spaces", () => {
    const home = source("../app/(home)/page.tsx");
    expect(home).toMatch(
      /if \(level < ACCESS_LEVELS\.view\) \{\s*redirect\("\/spaces"\);\s*\}/,
    );
    // Before any workspace-wide read that would refuse them.
    expect(home.indexOf('redirect("/spaces")')).toBeLessThan(
      home.indexOf('"settings.readForMember"'),
    );
  });
});

describe("the join page", () => {
  test("tells a guest which space they will see, and that it is the only one", () => {
    expect(join).toContain(
      "<GuestNote spaceName={invitation.guestSpaceName} />",
    );
    expect(joinText).toContain(
      "You are invited as a guest of {space}. You will see that space and nothing else in the workspace.",
    );
  });
});
