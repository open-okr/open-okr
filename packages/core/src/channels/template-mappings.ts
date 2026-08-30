/**
 * Which template answers which reminder (P5-T04b-b).
 *
 * **The count is checked when the mapping is saved, not when a nudge is due.**
 * Meta refuses a send whose parameter count does not match the template, and the
 * only two moments that check could happen are "an administrator is looking at
 * the screen" and "it is seven in the morning and a reminder did not arrive".
 * This picks the first.
 *
 * **A withdrawn template keeps its mapping.** Meta removing a template does not
 * remove the administrator's decision about which reminder it answered; the
 * mapping simply stops resolving until the template comes back or another is
 * chosen, and the screen says which.
 */
import {
  activeOnly,
  type WorkspaceTx,
  whatsappTemplateMappings,
  whatsappTemplates,
} from "@openokr/db";
import { and, eq, isNull } from "drizzle-orm";
import { isBindingSource } from "./template-bindings.ts";

export interface TemplateMapping {
  readonly id: string;
  readonly ruleKey: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly templateStatus: string;
  /** True when Meta no longer lists the template this points at. */
  readonly withdrawn: boolean;
  readonly bindings: readonly string[];
}

/** Every mapping this workspace has, with the template each points at. */
export async function listMappings(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<readonly TemplateMapping[]> {
  const rows = await tx
    .select({
      id: whatsappTemplateMappings.id,
      ruleKey: whatsappTemplateMappings.ruleKey,
      templateId: whatsappTemplateMappings.templateId,
      bindings: whatsappTemplateMappings.bindings,
      name: whatsappTemplates.name,
      language: whatsappTemplates.language,
      status: whatsappTemplates.status,
      deletedAt: whatsappTemplates.deletedAt,
    })
    .from(whatsappTemplateMappings)
    .innerJoin(
      whatsappTemplates,
      eq(whatsappTemplates.id, whatsappTemplateMappings.templateId),
    )
    .where(
      activeOnly(
        whatsappTemplateMappings,
        eq(whatsappTemplateMappings.workspaceId, workspaceId),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    ruleKey: row.ruleKey,
    templateId: row.templateId,
    templateName: row.name,
    templateLanguage: row.language,
    templateStatus: row.status,
    withdrawn: row.deletedAt !== null,
    bindings: row.bindings,
  }));
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly id: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Points one rule key at one template, with a source per placeholder.
 *
 * Refuses rather than throws, because every refusal here is something an
 * administrator can fix on the screen they are looking at, and a sentence beside
 * the form is a better answer than an error page.
 */
export async function saveMapping(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly ruleKey: string;
    readonly templateId: string;
    readonly bindings: readonly string[];
    readonly now: Date;
  },
): Promise<SaveOutcome> {
  const [template] = await tx
    .select({
      id: whatsappTemplates.id,
      name: whatsappTemplates.name,
      status: whatsappTemplates.status,
      variables: whatsappTemplates.variables,
    })
    .from(whatsappTemplates)
    .where(
      activeOnly(
        whatsappTemplates,
        eq(whatsappTemplates.workspaceId, input.workspaceId),
        eq(whatsappTemplates.id, input.templateId),
      ),
    )
    .limit(1);

  if (!template) {
    return {
      kind: "refused",
      reason:
        "That template is not one this workspace has. Sync and try again.",
    };
  }
  if (template.status.toUpperCase() !== "APPROVED") {
    return {
      kind: "refused",
      // Meta would refuse it at send time, which is a refusal nobody sees.
      reason: `Meta has not approved "${template.name}" yet, so a reminder using it would not arrive.`,
    };
  }
  if (input.bindings.length !== template.variables) {
    return {
      kind: "refused",
      reason:
        template.variables === 0
          ? `"${template.name}" takes no variables, so it needs no sources.`
          : `"${template.name}" takes ${template.variables} variable${template.variables === 1 ? "" : "s"}, and ${input.bindings.length} ${input.bindings.length === 1 ? "was" : "were"} chosen.`,
    };
  }
  const unknown = input.bindings.find((source) => !isBindingSource(source));
  if (unknown !== undefined) {
    return {
      kind: "refused",
      reason: `"${unknown}" is not something this product can fill in.`,
    };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [existing] = await tx
    .select({ id: whatsappTemplateMappings.id })
    .from(whatsappTemplateMappings)
    .where(
      activeOnly(
        whatsappTemplateMappings,
        eq(whatsappTemplateMappings.workspaceId, input.workspaceId),
        eq(whatsappTemplateMappings.ruleKey, input.ruleKey),
      ),
    )
    .limit(1);

  if (existing) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(whatsappTemplateMappings)
      .set({
        templateId: input.templateId,
        bindings: [...input.bindings],
        updatedAt: input.now,
      })
      .where(
        activeOnly(
          whatsappTemplateMappings,
          eq(whatsappTemplateMappings.id, existing.id),
        ),
      );
    return { kind: "saved", id: existing.id };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [created] = await tx
    .insert(whatsappTemplateMappings)
    .values({
      workspaceId: input.workspaceId,
      ruleKey: input.ruleKey,
      templateId: input.templateId,
      bindings: [...input.bindings],
    })
    .returning({ id: whatsappTemplateMappings.id });

  return created
    ? { kind: "saved", id: created.id }
    : { kind: "refused", reason: "That mapping could not be saved." };
}

/** Forgets a mapping, so the rule has no template again. */
export async function removeMapping(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly ruleKey: string;
    readonly now: Date;
  },
): Promise<boolean> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  const removed = await tx
    .update(whatsappTemplateMappings)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        whatsappTemplateMappings,
        eq(whatsappTemplateMappings.workspaceId, input.workspaceId),
        eq(whatsappTemplateMappings.ruleKey, input.ruleKey),
      ),
    )
    .returning({ id: whatsappTemplateMappings.id });
  return removed.length > 0;
}

/** What a nudge needs to send a template: its name and its sources. */
export interface ResolvedMapping {
  readonly templateName: string;
  readonly language: string;
  readonly bindings: readonly string[];
}

/**
 * The template one rule key uses, or null.
 *
 * Null for a rule with no mapping, and for one whose template Meta has since
 * withdrawn or un-approved. Both mean the same thing to a sender: there is
 * nothing here it may send outside the window.
 */
export async function mappingFor(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly ruleKey: string },
): Promise<ResolvedMapping | null> {
  const [row] = await tx
    .select({
      name: whatsappTemplates.name,
      language: whatsappTemplates.language,
      status: whatsappTemplates.status,
      bindings: whatsappTemplateMappings.bindings,
    })
    .from(whatsappTemplateMappings)
    .innerJoin(
      whatsappTemplates,
      and(
        eq(whatsappTemplates.id, whatsappTemplateMappings.templateId),
        isNull(whatsappTemplates.deletedAt),
      ),
    )
    .where(
      activeOnly(
        whatsappTemplateMappings,
        eq(whatsappTemplateMappings.workspaceId, input.workspaceId),
        eq(whatsappTemplateMappings.ruleKey, input.ruleKey),
      ),
    )
    .limit(1);

  if (row?.status.toUpperCase() !== "APPROVED") {
    return null;
  }
  return {
    templateName: row.name,
    language: row.language,
    bindings: row.bindings,
  };
}
