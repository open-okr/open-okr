import { dismissSiteMessage, liveSiteMessagesFor } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./pool";
import { requireSession } from "./session";

/**
 * What the vendor is saying, on every screen of the workspace it reaches
 * (P8-T03c).
 *
 * **A message nobody sees is not a message**, so this sits in the app shell
 * beside the workspace-state banner rather than on a screen of its own. It is
 * above the content and not around it, the same arrangement P6-G25 uses: it
 * explains, it does not block.
 *
 * Three filters decide what appears, and the domain does all three: the
 * window, the target, and whether this person has already read it. A
 * dismissal is keyed on the user rather than on a member, so somebody in
 * three workspaces dismisses an instance-wide sentence once.
 */
async function dismiss(formData: FormData): Promise<void> {
  "use server";
  const session = await requireSession();
  const messageId = String(formData.get("messageId") ?? "");
  if (messageId.length === 0) {
    return;
  }
  await dismissSiteMessage(getPool(), session.user.id, messageId);
  // The whole shell, because the banner is on every screen in it.
  revalidatePath("/", "layout");
}

const TONE: Record<string, string> = {
  info: "border-info-dot bg-info-bg text-info",
  warn: "border-warn-dot bg-warn-bg text-warn",
  bad: "border-bad-dot bg-bad-bg text-bad",
};

export async function SiteMessages({
  userId,
  workspaceId,
}: {
  readonly userId: string;
  readonly workspaceId: string;
}) {
  const messages = await liveSiteMessagesFor(getPool(), userId, workspaceId);
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="mb-4.5 flex flex-col gap-2">
      {messages.map((message) => (
        <div
          className={`flex items-start gap-3 rounded-lg border-l-4 border-y border-r px-4 py-3 ${
            TONE[message.level] ?? TONE.info
          }`}
          key={message.id}
          role={message.level === "bad" ? "alert" : "status"}
        >
          <p className="flex-1 text-sm">{message.body}</p>
          {message.dismissible ? (
            <form action={dismiss}>
              <input name="messageId" type="hidden" value={message.id} />
              {/* "Dismiss" rather than an unlabelled cross: a control whose
               * only label is an icon is one a screen reader announces as
               * "button". */}
              <button
                className="whitespace-nowrap font-medium text-sm underline"
                type="submit"
              >
                Dismiss
              </button>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}
