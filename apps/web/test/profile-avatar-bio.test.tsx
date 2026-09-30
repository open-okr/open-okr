import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AvatarForm } from "../app/people/[id]/avatar-form.tsx";
import { readScreen, withMessages } from "./screen-text.ts";

/**
 * A member edits their own picture and bio (completeness review M-22, screen
 * S-33).
 *
 * The rules, that an avatar is an image the member could open and is shared
 * with the workspace only while it is one, and that a bio is validated rich
 * text, are proved against a real database in `packages/core`
 * (`profile-avatar-bio.test.ts`). What is checked here is the screen: both
 * controls exist on your own profile and only there, the picture goes through
 * the one upload path, and the bio is written in the shared editor and sent
 * only when it changed.
 */

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = (path: string) => readFileSync(at(path), "utf8");

const page = source("../app/people/[id]/page.tsx");
const form = source("../app/people/[id]/profile-form.tsx");
const formText = withMessages(
  readScreen(at("../app/people/[id]/profile-form.tsx")),
);
const actions = source("../app/people/actions.ts");

const avatarForm = (avatarUrl: string | null) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">
      <AvatarForm
        name="Priya Raman"
        avatarUrl={avatarUrl}
        uploadAvatar={async () => ({ ok: true, message: "" })}
        removeAvatar={async () => ({ ok: true, message: "" })}
      />
    </TranslationsProvider>,
  );

describe("the picture", () => {
  test("offers only the image types the upload path keeps", () => {
    const html = avatarForm(null);
    expect(html).toContain('type="file"');
    expect(html).toContain(
      'accept="image/png,image/jpeg,image/gif,image/webp"',
    );
    expect(html).toContain("Use this picture");
    // Nothing to remove until there is a picture.
    expect(html).not.toContain("Remove picture");
  });

  test("can be removed once there is one, and says who sees it", () => {
    const html = avatarForm("/api/blobs/abc/thumbnail");
    expect(html).toContain("Remove picture");
    expect(html).toContain("Everybody in this workspace sees it");
  });

  test("goes through storeUpload and then the member's own profile action", () => {
    const upload = actions.slice(
      actions.indexOf("export async function uploadAvatar"),
    );
    // The type is refused before anything is stored.
    expect(upload.indexOf("IMAGE_CONTENT_TYPES.has(file.type)")).toBeLessThan(
      upload.indexOf("storeUpload("),
    );
    expect(upload.indexOf("storeUpload(")).toBeLessThan(
      upload.indexOf('"people.updateOwnProfile"'),
    );
    expect(upload).toContain("avatarBlobId: stored.blobId");
    expect(actions).toContain("avatarBlobId: null");
  });

  test("is drawn in the header through the thumbnail route", () => {
    expect(page).toContain("`/api/blobs/");
    expect(page).toContain("member.avatarBlobId}/thumbnail`");
    expect(page).toContain("src={avatarUrl}");
  });
});

describe("the bio", () => {
  test("is written in the shared rich text editor", () => {
    expect(form).toContain("<RichTextEditor");
    expect(form).toContain("content={bio ?? null}");
    expect(formText).toContain("Empty it and save to remove your bio.");
  });

  test("is sent only once it has been edited, so a timezone change versions nothing", () => {
    expect(form).toContain(
      "onUpdate={(json) => setEditedBio(JSON.stringify(json))}",
    );
    expect(form).toMatch(
      /editedBio === null \? null : \(\s*<input type="hidden" name="bio"/,
    );
  });
});

describe("whose profile", () => {
  test("offers the picture and the bio on your own profile only", () => {
    const self = page.indexOf("{isSelf ? (\n        <AvatarForm");
    expect(self).toBeGreaterThan(0);
    expect(page).toMatch(
      /\{isSelf \? \(\s*<ProfileForm[\s\S]*?bio=\{member\.bio\}/,
    );
    // An administrator's card on somebody else's profile edits the org
    // fields, and never the picture or the bio.
    const admin = page.slice(page.indexOf("{isAdmin && !isSelf ? ("));
    const adminCard = admin.slice(0, admin.indexOf("</Card>"));
    expect(adminCard).toContain('name="title"');
    expect(adminCard).not.toContain("bio");
    expect(adminCard).not.toContain("avatar");
  });
});
