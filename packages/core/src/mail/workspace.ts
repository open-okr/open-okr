import {
  activeOnly,
  type WorkspaceSettings,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { withoutTrailingSlashes } from "../urls.ts";
import type { EmailFrame } from "./render.ts";
import {
  type MailLocale,
  type MailWords,
  mailLocale,
  mailWords,
} from "./words.ts";

/**
 * Who a workspace mail is from: the workspace's name, its colour and its
 * language (docs/design/email-templates.md §10, docs/design/languages.md §13).
 * Read when the mail is built, rendering in the recipient's resolved language
 * when known, or the workspace language for workspace-wide messages and invitations.
 */
export interface WorkspaceMail {
  readonly name: string;
  readonly color: string | null;
  readonly locale: MailLocale;
  readonly words: MailWords;
}

export async function workspaceMailInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  recipientMemberId?: string | null,
): Promise<WorkspaceMail> {
  const [row] = await tx
    .select({ name: workspaces.name, settings: workspaces.settings })
    // openokr:allow-raw-read: the sender's identity on a mail the system
    // sends, read by the relay or the nudge delivery under this workspace's
    // tenant setting, not a read on any member's behalf. The recipient was
    // authorised when the mail was queued.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
    .limit(1);
  const settings = (row?.settings ?? {}) as WorkspaceSettings & {
    readonly language?: string;
    readonly branding?: { readonly primaryColor?: string | null };
  };

  let recipientLanguage: string | undefined;
  if (recipientMemberId) {
    const [memberRow] = await tx
      .select({ language: workspaceMembers.language })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.id, recipientMemberId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (memberRow?.language) {
      recipientLanguage = memberRow.language;
    }
  }

  const locale = mailLocale(recipientLanguage ?? settings.language);
  return {
    name: row?.name ?? "",
    color: settings.branding?.primaryColor ?? null,
    locale,
    words: mailWords(locale),
  };
}

export function workspaceMail(
  pool: Pool,
  workspaceId: string,
  recipientMemberId?: string | null,
): Promise<WorkspaceMail> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, (tx) =>
    workspaceMailInTx(tx, workspaceId, recipientMemberId),
  );
}

/**
 * The frame every workspace mail shares: the workspace's mark, its language,
 * and a footer that says why the mail came and links where to change it.
 */
export function workspaceFrame(
  mail: WorkspaceMail,
  input: {
    readonly baseUrl: string;
    readonly preheader?: string;
    readonly footer: string;
    /** Where the footer's link goes, from the base url. */
    readonly settingsPath?: string;
    readonly settingsLabel?: string;
  },
): EmailFrame {
  return {
    lang: mail.locale,
    brand: { name: mail.name, color: mail.color },
    ...(input.preheader ? { preheader: input.preheader } : {}),
    footer: [input.footer],
    ...(input.settingsPath
      ? {
          footerLink: {
            label: input.settingsLabel ?? mail.words("changeWhatYouReceive"),
            href: `${withoutTrailingSlashes(input.baseUrl)}${input.settingsPath}`,
          },
        }
      : {}),
    labels: { linkFallback: mail.words("linkFallback") },
  };
}
