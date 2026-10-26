"use server";

import { createSiteMessage } from "@openokr/core";
import { isKnownTimezone, localDateTimeInstant } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { refusalOf } from "../../../lib/refusal";

/**
 * Writing a site message, on S-47 (P8-T03c), as a server action.
 *
 * The grant is re-checked here rather than trusted from the page that
 * rendered the form, for the same reason the lifecycle control re-checks it: a
 * page rendered ten minutes ago is not evidence that the person is still an
 * operator.
 *
 * **A refusal is returned, not swallowed** (guided-inputs §5, F5). A window
 * that ended before it started left the form as it was with nothing written,
 * which read as a message that had gone out.
 */
export interface SiteMessageState {
  readonly error?: string;
  readonly done?: boolean;
}

/**
 * A time the form posted, as an instant. The control carries no zone, so the
 * form posts the operator's own browser zone beside it (guided-inputs §4.9):
 * read in the server's zone instead, a message set for 09:00 in Kuala Lumpur
 * went up at 17:00 there. With no zone, which only a page that never ran its
 * script sends, it is read as UTC rather than as wherever the server is.
 */
function instantFrom(formData: FormData, field: string): string {
  const local = String(formData.get(field) ?? "");
  const zone = String(formData.get(`${field}Zone`) ?? "");
  const instant = localDateTimeInstant(
    local,
    zone !== "" && isKnownTimezone(zone) ? zone : "UTC",
  );
  return instant ? instant.toISOString() : local;
}

export async function publishSiteMessage(
  formData: FormData,
): Promise<SiteMessageState> {
  const operator = await requireOperator();

  const targets = formData
    .getAll("target")
    .map(String)
    .filter((one) => one.length > 0);

  try {
    await createSiteMessage(getPool(), operator.userId, {
      body: String(formData.get("body") ?? ""),
      level: String(formData.get("level") ?? "info") as "info" | "warn" | "bad",
      startsAt: instantFrom(formData, "startsAt"),
      endsAt: instantFrom(formData, "endsAt"),
      targetWorkspaceIds: targets,
      dismissible: formData.get("dismissible") !== null,
    });
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal };
  }
  revalidatePath("/operator/instance");
  return { done: true };
}
