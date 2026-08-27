/**
 * The chat command surface (AI-NATIVE-PLAN.md §5.3, P5-T06a).
 *
 * **One definition, four renderings.** A command is declared once here with the
 * registry action it means and the arguments it takes. Each driver renders it as
 * its own idiom, a slash command on Slack, a bot command on Telegram, a
 * free-form intent on WhatsApp, and none of them decides what an action does.
 * A driver that interpreted commands would be the fourth copy of this table by
 * the time the other three providers land.
 *
 * **Every command names exactly one registry action**, and a test walks this
 * table against `ACTION_MAP` so a renamed action breaks the build rather than
 * the product. The access level is not declared here either: the action already
 * declares it, `can()` enforces it, and a second number in this file would be
 * a second answer to "who may do this".
 *
 * **Nothing here interprets the message as an instruction.** The text somebody
 * typed is matched against a fixed verb list and its arguments are parsed by
 * shape. A message whose body looks like a prompt is a string in a payload.
 *
 * **`checkin` is the one command that is a conversation.** The router hands it
 * to the check-in flow, which asks METHOD.md §3.2's questions in order across
 * turns and opens a modal where the provider has one (P5-T06b, P5-T02b).
 *
 * **`blocker` and `commit` are one line each, and that is a decision** made at
 * P5-T06c. Both could have been conversations: the machine exists. A blocker's
 * type is one word out of five and its next action is a sentence, and somebody
 * raising a blocker is doing it *during a session*, on a phone, while a room
 * waits. Three exchanges to say one thing is worse there than one line that
 * needs the words in order.
 */

/** What one command needs from the person who typed it. */
interface CommandArgument {
  readonly name: string;
  /** Shown in the help reply, so it has to read like a person would say it. */
  readonly hint: string;
  readonly required: boolean;
}

export interface ChatCommand {
  /** The verb somebody types. Lowercase, one word. */
  readonly verb: string;
  /** The one registry action this means. */
  readonly action: string;
  /** One line, for the help reply. */
  readonly summary: string;
  readonly args: readonly CommandArgument[];
  /**
   * Turns the parsed arguments into the action's own input.
   *
   * Declared per command rather than inferred, because a registry action's
   * input schema is richer than a line of chat can carry: what this decides is
   * which of its fields a chat message is allowed to set.
   *
   * `now` is passed in rather than read here. Nothing in this product reads a
   * clock inside its own logic, which is what makes a fortnight testable in a
   * second, and "snooze for 48 hours" is arithmetic on a moment somebody else
   * supplies.
   */
  readonly toInput: (
    args: Readonly<Record<string, string>>,
    now: Date,
  ) => Record<string, unknown>;
}

/** §5.3's seven commands. */
export const CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    /**
     * The one command that is a conversation rather than a line (P5-T06b).
     *
     * `toInput` is never called for it: the router hands it to the check-in
     * flow, which asks §3.2's questions in order and runs the two registry
     * actions once every answer is in. It is in this table anyway so the help
     * reply lists it and the catalogue-versus-registry test covers it.
     */
    verb: "checkin",
    action: "goals.startCheckIn",
    summary: "Check in on a goal you champion, one question at a time.",
    args: [{ name: "goal", hint: "the goal's identifier", required: true }],
    toInput: (args) => ({ goalId: args.goal }),
  },
  {
    /**
     * The session lookup is the router's, not this table's (P5-T06c).
     *
     * `toInput` is pure by design: parsed arguments and a moment, nothing that
     * reads a database. A blocker needs the running session in the named key
     * result's space, which is a query, so the router resolves it and this
     * carries only what the sender typed.
     */
    verb: "blocker",
    action: "sessions.createBlocker",
    summary: "Raise a blocker on a key result, in the session that is running.",
    args: [
      {
        name: "keyResult",
        hint: "the key result's identifier",
        required: true,
      },
      {
        name: "type",
        hint: "one of resource, dependency, clarity, priority_conflict, external",
        required: true,
      },
      { name: "nextAction", hint: "what happens next", required: true },
    ],
    toInput: (args) => ({
      keyResultId: args.keyResult,
      type: args.type,
      nextAction: args.nextAction,
    }),
  },
  {
    verb: "commit",
    action: "sessions.setCommitments",
    summary: "Add one commitment to the session that is running.",
    args: [
      { name: "text", hint: "what you are committing to", required: true },
    ],
    toInput: (args) => ({ text: args.text }),
  },
  {
    verb: "status",
    action: "goals.read",
    summary: "The health, progress and next check-in of one goal.",
    args: [{ name: "goal", hint: "the goal's identifier", required: true }],
    toInput: (args) => ({ id: args.goal }),
  },
  {
    verb: "ask",
    action: "copilot.ask",
    summary: "Ask a question about this workspace.",
    args: [{ name: "question", hint: "what you want to know", required: true }],
    toInput: (args) => ({ question: args.question }),
  },
  {
    verb: "ack",
    action: "goals.acknowledgeCheckIn",
    summary: "Acknowledge a check-in you are the reviewer of.",
    args: [
      { name: "checkIn", hint: "the check-in's identifier", required: true },
    ],
    toInput: (args) => ({ id: args.checkIn }),
  },
  {
    verb: "snooze",
    action: "nudges.snooze",
    summary: "Stop being messaged about one thing for a while.",
    args: [
      { name: "nudge", hint: "the nudge's identifier", required: true },
      { name: "hours", hint: "how long, in hours", required: false },
    ],
    toInput: (args, now) => {
      // A day by default. §11 bounds noise rather than obligations, and a
      // snooze with no stated length is somebody asking for quiet today, not
      // forever.
      const hours = Number(args.hours);
      const window = Number.isFinite(hours) && hours > 0 ? hours : 24;
      return {
        nudgeId: args.nudge,
        until: new Date(now.getTime() + window * 3_600_000).toISOString(),
      };
    },
  },
];

const BY_VERB = new Map(
  CHAT_COMMANDS.map((command) => [command.verb, command]),
);

export type ParsedCommand =
  | {
      readonly kind: "command";
      readonly command: ChatCommand;
      readonly args: Readonly<Record<string, string>>;
    }
  | { readonly kind: "help" }
  /** Not a command this surface has. The reply names what it does have. */
  | { readonly kind: "unknown"; readonly verb: string }
  /** A command whose required arguments are not all there. */
  | {
      readonly kind: "incomplete";
      readonly command: ChatCommand;
      readonly missing: readonly string[];
    };

/**
 * One line of chat as a command, or as a refusal that says why.
 *
 * The provider's own prefix is stripped first: Slack sends `/okr status g-1`,
 * Telegram sends `/status g-1`, WhatsApp sends `status g-1`. Everything after
 * the verb is positional, in the order the command declares, and the last
 * declared argument takes the rest of the line so a question can contain
 * spaces.
 */
export function parseCommand(text: string): ParsedCommand {
  const words = text
    .trim()
    .replace(/^\/(okr|openokr)\b/i, "")
    .trim()
    .replace(/^\//, "")
    .split(/\s+/)
    .filter((word) => word !== "");

  const verb = (words[0] ?? "").toLowerCase();
  if (verb === "" || verb === "help") {
    return { kind: "help" };
  }

  const command = BY_VERB.get(verb);
  if (!command) {
    return { kind: "unknown", verb };
  }

  const rest = words.slice(1);
  const args: Record<string, string> = {};
  for (const [index, argument] of command.args.entries()) {
    const last = index === command.args.length - 1;
    const value = last ? rest.slice(index).join(" ") : (rest[index] ?? "");
    if (value !== "") {
      args[argument.name] = value;
    }
  }

  const missing = command.args
    .filter((argument) => argument.required && !args[argument.name])
    .map((argument) => argument.name);
  if (missing.length > 0) {
    return { kind: "incomplete", command, missing };
  }

  return { kind: "command", command, args };
}

/**
 * The help reply, rendered from the catalogue.
 *
 * Generated rather than written, so a command added above appears here and a
 * command removed disappears. A hand-written help text is a second catalogue
 * that drifts.
 */
export function helpText(prefix = "/okr"): string {
  return [
    "What I can do:",
    ...CHAT_COMMANDS.map((command) => {
      const args = command.args
        .map((argument) =>
          argument.required ? `<${argument.name}>` : `[${argument.name}]`,
        )
        .join(" ");
      return `  ${prefix} ${command.verb} ${args}`.trimEnd();
    }),
    "",
    ...CHAT_COMMANDS.map((command) => `${command.verb}: ${command.summary}`),
  ].join("\n");
}

/** What to say when a required argument is missing. */
export function incompleteText(
  command: ChatCommand,
  missing: readonly string[],
  prefix = "/okr",
): string {
  const named = command.args.filter((argument) =>
    missing.includes(argument.name),
  );
  return [
    `${command.verb} needs ${named.map((argument) => argument.hint).join(" and ")}.`,
    `Try: ${prefix} ${command.verb} ${command.args
      .map((argument) =>
        argument.required ? `<${argument.name}>` : `[${argument.name}]`,
      )
      .join(" ")}`.trimEnd(),
  ].join("\n");
}
