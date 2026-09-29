import { ACCESS_LEVELS, parseCsv, TEMPLATES } from "@openokr/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The import template downloads (REQUIREMENTS §6, completeness review M-17).
 *
 * What the file holds, and that the importer reads it back without a
 * question, is proved against the engine in
 * `packages/core/test/import-template-files.test.ts`. What is checked here is
 * the door: a stranger is refused, a member below full is told nothing exists,
 * and a name that is not a template is not-found rather than an error.
 */

const requireWorkspace = vi.fn();
const resolveAccessLevelFor = vi.fn();

vi.mock("../lib/workspace", () => ({
  requireWorkspace: () => requireWorkspace(),
}));
vi.mock("../lib/access", () => ({
  resolveAccessLevelFor: (workspaceId: string, memberId: string) =>
    resolveAccessLevelFor(workspaceId, memberId),
}));

const { GET } = await import("../app/admin/imports/templates/[file]/route");

const fetchTemplate = (file: string) =>
  GET(
    new Request(`http://localhost/admin/imports/templates/${file}`) as never,
    {
      params: Promise.resolve({ file }),
    },
  );

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  });
  resolveAccessLevelFor.mockReset().mockResolvedValue(ACCESS_LEVELS.full);
});

describe("GET /admin/imports/templates/[file]", () => {
  it("serves every entity's CSV with the header row the importer maps", async () => {
    for (const template of TEMPLATES) {
      const response = await fetchTemplate(`${template.entity}.csv`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="openokr-${template.entity}-template.csv"`,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const table = parseCsv(await response.text());
      expect(table.headers).toEqual(
        template.columns.map((column) => column.field),
      );
    }
  });

  it("serves the workbook as a workbook", async () => {
    const response = await fetchTemplate("key-results.xlsx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    // A zip, which is what an .xlsx is, rather than text with the wrong name.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");
  });

  it("asks who the caller is in the workspace they are in", async () => {
    await fetchTemplate("goals.csv");
    expect(resolveAccessLevelFor).toHaveBeenCalledWith(
      "workspace-1",
      "member-1",
    );
  });

  it("refuses somebody with no session", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const response = await fetchTemplate("goals.csv");
    expect(response.status).toBe(401);
  });

  it("answers not-found to a member below full, as the wizard's page does", async () => {
    resolveAccessLevelFor.mockResolvedValue(ACCESS_LEVELS.edit);
    const response = await fetchTemplate("goals.csv");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("answers not-found to a name that is not a template", async () => {
    for (const file of [
      "people.csv",
      "goals.txt",
      "goals",
      ".csv",
      "goals.csv.csv",
      "../goals.csv",
    ]) {
      const response = await fetchTemplate(file);
      expect(response.status, file).toBe(404);
    }
  });
});
