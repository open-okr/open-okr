import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentTypeFor,
  decodeDataUri,
  digestOf,
  filenameForInline,
  findSourceFile,
  isFound,
} from "../src/flowyteam/files.ts";

/**
 * Finding a file and reading a data URI (P6-T04c).
 *
 * No database and no MySQL: this is the part that only touches a directory,
 * and the part where a hashed name out of somebody else's database is treated
 * as input rather than as a path.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openokr-files-unit-"));
  await mkdir(join(root, "storage", "app", "task-files", "42"), {
    recursive: true,
  });
  await writeFile(join(root, "flat.pdf"), Buffer.from("flat"));
  await writeFile(
    join(root, "storage", "app", "task-files", "deep.pdf"),
    Buffer.from("deep"),
  );
  await writeFile(
    join(root, "storage", "app", "task-files", "42", "per-task.pdf"),
    Buffer.from("per task"),
  );
  await mkdir(join(root, "adirectory.pdf"), { recursive: true });
});

afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("findSourceFile", () => {
  it("finds a file sitting flat under the root", async () => {
    const found = await findSourceFile(root, {
      taskId: 1,
      filename: "brief.pdf",
      hashname: "flat.pdf",
    });
    expect(isFound(found)).toBe(true);
    if (isFound(found)) {
      expect(found.bytes.toString()).toBe("flat");
      expect(found.at).toBe("flat.pdf");
      expect(found.contentType).toBe("application/pdf");
      expect(found.digest).toBe(digestOf(Buffer.from("flat")));
    }
  });

  it("finds a file in the Laravel storage layout", async () => {
    const found = await findSourceFile(root, {
      taskId: 1,
      filename: "brief.pdf",
      hashname: "deep.pdf",
    });
    expect(isFound(found) && found.at).toBe("storage/app/task-files/deep.pdf");
  });

  it("finds a file in a folder named after its task", async () => {
    const found = await findSourceFile(root, {
      taskId: 42,
      filename: "brief.pdf",
      hashname: "per-task.pdf",
    });
    expect(isFound(found) && found.at).toBe(
      "storage/app/task-files/42/per-task.pdf",
    );
  });

  it("steps past a directory with the name it was looking for", async () => {
    const found = await findSourceFile(root, {
      taskId: 1,
      filename: "brief.pdf",
      hashname: "adirectory.pdf",
    });
    expect(isFound(found)).toBe(false);
  });

  it("names every path it tried when nothing matches", async () => {
    const found = await findSourceFile(root, {
      taskId: 7,
      filename: "brief.pdf",
      hashname: "nowhere.pdf",
    });
    expect(isFound(found)).toBe(false);
    if (!isFound(found)) {
      expect(found.tried.length).toBeGreaterThan(5);
      expect(found.tried).toContain("nowhere.pdf");
      expect(found.tried).toContain("storage/app/task-files/7/nowhere.pdf");
    }
  });

  /**
   * A hashed name comes out of a database somebody else administers, so it is
   * input. None of these reads anything, and none of them reports a path it
   * looked at, because it never looked.
   */
  it.each([
    "../../../etc/passwd",
    "..\\..\\windows\\system32\\config\\sam",
    "sub/dir/file.pdf",
    "..",
    ".",
    "",
  ])("refuses %j as a name on disk", async (hashname) => {
    const found = await findSourceFile(root, {
      taskId: 1,
      filename: "brief.pdf",
      hashname,
    });
    expect(isFound(found)).toBe(false);
    expect(isFound(found) ? [] : found.tried).toEqual([]);
  });
});

describe("contentTypeFor", () => {
  it("reads the extension and falls back to octet-stream", () => {
    expect(contentTypeFor("a.PDF")).toBe("application/pdf");
    expect(contentTypeFor("a.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("a.unknown")).toBe("application/octet-stream");
    expect(contentTypeFor("noextension")).toBe("application/octet-stream");
  });
});

describe("decodeDataUri", () => {
  it("decodes a base64 image", () => {
    const decoded = decodeDataUri("data:image/png;base64,aGVsbG8=");
    expect(decoded?.contentType).toBe("image/png");
    expect(decoded?.bytes.toString()).toBe("hello");
    expect(decoded?.digest).toBe(digestOf(Buffer.from("hello")));
  });

  it("decodes a percent-encoded one", () => {
    expect(decodeDataUri("data:text/plain,a%20b")?.bytes.toString()).toBe(
      "a b",
    );
  });

  it("takes the type as the source wrote it, whatever the case", () => {
    expect(decodeDataUri("data:IMAGE/PNG;BASE64,aGk=")?.contentType).toBe(
      "image/png",
    );
  });

  it("refuses anything that is not a data URI it can read", () => {
    expect(decodeDataUri("https://example.com/a.png")).toBeUndefined();
    expect(decodeDataUri("data:image/png;base64,")).toBeUndefined();
    expect(decodeDataUri("")).toBeUndefined();
    expect(decodeDataUri("data:")).toBeUndefined();
  });
});

describe("filenameForInline", () => {
  it("names an image that arrived with no name", () => {
    expect(filenameForInline(4, 0, "image/png")).toBe("comment-4-image-0.png");
    expect(filenameForInline(9, 2, "image/jpeg")).toBe("comment-9-image-2.jpg");
    expect(filenameForInline(1, 0, "application/x-odd")).toBe(
      "comment-1-image-0.bin",
    );
  });
});
