/**
 * An import template as a file (REQUIREMENTS §6, completeness review M-17).
 *
 * `/admin/imports/templates/goals.csv`, `/admin/imports/templates/tasks.xlsx`
 * and so on: one per entity the spreadsheet importer reads, in either format it
 * reads. The bytes come from `templateFile` in `packages/core`, which builds
 * them from the same entity templates the runner maps against, so a template
 * cannot name a column the importer does not recognise.
 *
 * **Full access, which is the wizard's own bar.** The admin layout refuses a
 * member below `full` before the wizard renders, and every import action
 * requires `full` again. A route handler is not wrapped by that layout, so it
 * asks the same question itself, with the same resolver the layout uses.
 *
 * **Not-found for everything that is not a template, and for anybody below
 * full.** The same answer for a missing file and a refused one, so the route
 * is not a way to learn what an ordinary member may not see.
 */
import {
  ACCESS_LEVELS,
  ENTITIES,
  TEMPLATE_FORMATS,
  type TemplateFormat,
  templateFile,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { resolveAccessLevelFor } from "../../../../../lib/access";
import { requireWorkspace } from "../../../../../lib/workspace";

/** `goals.csv` into its entity and format, or null for anything else. */
function parseName(
  file: string,
): { entity: string; format: TemplateFormat } | null {
  const dot = file.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const entity = file.slice(0, dot);
  const format = TEMPLATE_FORMATS.find(
    (candidate) => candidate === file.slice(dot + 1),
  );
  return format && ENTITIES.includes(entity) ? { entity, format } : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  let workspaceId: string;
  let memberId: string;
  try {
    const { workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    memberId = workspace.memberId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const level = await resolveAccessLevelFor(workspaceId, memberId);
  if (level < ACCESS_LEVELS.full) {
    return new Response("Not found", { status: 404 });
  }

  const wanted = parseName(file);
  if (!wanted) {
    return new Response("Not found", { status: 404 });
  }

  const template = await templateFile(wanted.entity, wanted.format);
  return new Response(new Uint8Array(template.bytes), {
    headers: {
      "content-type": template.contentType,
      // The name is built from a fixed list, so there is nothing in it to
      // escape; quoted because the header's grammar asks for it.
      "content-disposition": `attachment; filename="${template.filename}"`,
      "content-length": String(template.bytes.byteLength),
      // Behind a session, so never a shared cache.
      "cache-control": "private, no-store",
    },
  });
}
