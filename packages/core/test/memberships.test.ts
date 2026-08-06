import { describe, expect, it } from "vitest";
import {
  type Membership,
  resolveActiveWorkspace,
} from "../src/workspaces/memberships.ts";

/**
 * Choosing which workspace a request is scoped to.
 *
 * The active workspace arrives as a cookie, which is client-controlled and
 * therefore a hint and nothing more. Every one of these cases is really the
 * same case: the answer comes from the membership list, and the cookie only
 * ever picks between entries that are already there.
 */

const membership = (workspaceId: string, slug: string): Membership => ({
  workspaceId,
  memberId: `member-${slug}`,
  name: slug,
  slug,
});

const ALPHA = membership("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "alpha");
const BETA = membership("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "beta");

describe("resolveActiveWorkspace", () => {
  it("honours the cookie when it names a workspace the member belongs to", () => {
    expect(resolveActiveWorkspace([ALPHA, BETA], BETA.workspaceId)).toEqual(
      BETA,
    );
  });

  it("ignores a cookie naming a workspace the member does not belong to", () => {
    // The whole point: a member who edits their cookie to somebody else's
    // workspace id gets their own workspace, not an error and not a leak.
    expect(
      resolveActiveWorkspace([ALPHA], "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    ).toEqual(ALPHA);
  });

  it("ignores a cookie that is not even a workspace id", () => {
    expect(
      resolveActiveWorkspace([ALPHA], "'; drop table workspaces; --"),
    ).toEqual(ALPHA);
    expect(resolveActiveWorkspace([ALPHA], "")).toEqual(ALPHA);
  });

  it("falls back to the first membership when there is no cookie", () => {
    expect(resolveActiveWorkspace([ALPHA, BETA], undefined)).toEqual(ALPHA);
  });

  it("returns nothing when the member belongs to no workspace", () => {
    // The signed-in-but-unprovisioned state. The caller repairs it rather than
    // rendering a shell with no workspace.
    expect(resolveActiveWorkspace([], undefined)).toBeUndefined();
    expect(resolveActiveWorkspace([], ALPHA.workspaceId)).toBeUndefined();
  });
});
