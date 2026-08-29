/**
 * One message, rendered for whatever the provider can take
 * (AI-NATIVE-PLAN.md §5.2, P5-T01b-b).
 *
 * **A message is built once and degraded, never built per provider.** The rule
 * the matrix states is that no driver refuses a message it cannot render, so
 * everything below drops capability rather than raising an error. Degradation
 * runs in one direction and it is always the same:
 *
 * | Missing | What arrives |
 * |---|---|
 * | `richCards` | The text, without the blocks |
 * | `buttons` | The text, with each button appended as a labelled link |
 * | `templateOnlyOutbound`, outside the window | The registered template, and the free-form body dropped |
 *
 * The last one is the only lossy case, and it is lossy because the provider
 * says so: WhatsApp outside its conversation window will not carry free-form
 * text at all, and sending the body as a second message would be a message the
 * member never agreed to receive.
 */
import { type ChannelProviderKey, capabilitiesFor } from "./capabilities.ts";

export interface MessageButton {
  readonly label: string;
  readonly url: string;
}

/** What a caller writes, before any provider is chosen. */
export interface MessageDraft {
  readonly text: string;
  readonly subject?: string;
  /** Provider-shaped rich blocks. Dropped wherever `richCards` is false. */
  readonly blocks?: readonly Record<string, unknown>[];
  readonly buttons?: readonly MessageButton[];
  /**
   * The approved template for this message's rule key.
   *
   * Required to reach a template-only provider outside its window. Absent
   * means the message cannot go that way, which the result says rather than
   * throwing.
   */
  readonly templateKey?: string;
}

export interface BuiltMessage {
  readonly text: string;
  readonly subject?: string;
  readonly blocks?: readonly Record<string, unknown>[];
  readonly buttons?: readonly MessageButton[];
  readonly templateKey?: string;
  /**
   * What the provider could not take, in the words a log entry wants.
   *
   * Empty for a provider that took everything. Present so a support question
   * about a message that arrived plainer than it was written has an answer.
   */
  readonly degraded: readonly string[];
}

export interface BuildOptions {
  /**
   * Whether a template-only provider is inside its free-form window.
   *
   * True by default, because every provider but WhatsApp has no window at all
   * and a default that assumed the worst would degrade four providers to
   * protect one.
   */
  readonly insideConversationWindow?: boolean;
}

/**
 * The scheme a button uses when it runs a command rather than going somewhere.
 *
 * The same one the Slack blocks, the Telegram keyboard and the Teams card
 * actions read, which is what lets a message be written once and rendered three
 * ways.
 */
const COMMAND_SCHEME = "okr:";

/**
 * Text with one line per button, which is what a provider with no buttons gets.
 *
 * **A command button is not a link and must never be printed as one.** A button
 * carrying `okr:resolve abc` rendered as "Resolve: okr:resolve abc" is a line
 * somebody clicks and nothing happens. Every provider that can receive a message
 * can receive a typed command, so a command button degrades into the words to
 * type instead. Nothing passed a command button through the builder before
 * P5-T03b, so no message was ever broken by this; the escalation card reaching
 * email would have been the first.
 */
export function withLinkedButtons(draft: MessageDraft): string {
  if (!draft.buttons || draft.buttons.length === 0) {
    return draft.text;
  }
  return [
    draft.text,
    "",
    ...draft.buttons.map((button) =>
      button.url.startsWith(COMMAND_SCHEME)
        ? `${button.label}: reply "${button.url.slice(COMMAND_SCHEME.length)}"`
        : `${button.label}: ${button.url}`,
    ),
  ].join("\n");
}

export function buildMessage(
  draft: MessageDraft,
  provider: ChannelProviderKey,
  options: BuildOptions = {},
): BuiltMessage {
  const capabilities = capabilitiesFor(provider);
  const degraded: string[] = [];

  if (
    capabilities.templateOnlyOutbound &&
    options.insideConversationWindow === false
  ) {
    if (!draft.templateKey) {
      // Nothing to send: the provider will not take the body and no template
      // was registered for this message. Said plainly rather than sent as
      // something the member did not agree to receive.
      return {
        text: "",
        degraded: [
          `${provider} needs an approved template outside its conversation window, and this message has none`,
        ],
      };
    }
    return {
      text: "",
      templateKey: draft.templateKey,
      degraded: [
        `${provider} is outside its conversation window, so the approved template was sent and the body was not`,
      ],
    };
  }

  if (draft.blocks && draft.blocks.length > 0 && !capabilities.richCards) {
    degraded.push(`${provider} has no rich cards, so the blocks were dropped`);
  }

  const keepsButtons = Boolean(
    draft.buttons && draft.buttons.length > 0 && capabilities.buttons,
  );
  const linksInstead = Boolean(
    draft.buttons && draft.buttons.length > 0 && !capabilities.buttons,
  );
  if (linksInstead) {
    degraded.push(`${provider} has no buttons, so they were appended as links`);
  }

  // Email says `buttons: true` and renders them as links in its own driver, so
  // the builder hands them over intact and lets the driver decide the shape.
  // A provider with no buttons at all gets them folded into the text here,
  // because there is nowhere else for them to go.
  return {
    text: linksInstead ? withLinkedButtons(draft) : draft.text,
    ...(draft.subject ? { subject: draft.subject } : {}),
    ...(draft.blocks && capabilities.richCards ? { blocks: draft.blocks } : {}),
    ...(keepsButtons && draft.buttons ? { buttons: draft.buttons } : {}),
    ...(draft.templateKey ? { templateKey: draft.templateKey } : {}),
    degraded,
  };
}
