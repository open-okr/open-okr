/**
 * What may leave for an AI provider, enforced where every call passes
 * (AI-NATIVE-PLAN §1.6 and §4, completeness review M-10).
 *
 * "Nothing leaves silently. An admin controls what context may reach a
 * non-local provider, personal-data redaction, an egress allow-list and
 * no-training headers." The privacy card said so in words and nothing in the
 * call path did any of it: every assist, the copilot and the search index sent
 * whatever they assembled to whichever host the provider named.
 *
 * **Here, because this is the one place no caller can step around.**
 * `createAIProvider` is the only way anything outside this package reaches a
 * driver, the boundary gate refuses a driver import from anywhere else, and
 * every provider it returns is wrapped in `EgressGuardedProvider`. A feature
 * that assembles its prompt somewhere new still sends it through this class.
 *
 * | Control | What it does here |
 * |---|---|
 * | Allow-list | A host not on a non-empty list gets nothing |
 * | Context level | `assists` withholds retrieval; `none` withholds everything |
 * | Redaction | Email addresses and phone numbers become placeholders |
 * | No training | Applied by `createAIProvider`, as a request field OpenRouter reads |
 *
 * **A local target is exempt from all four**, because nothing sent to it
 * leaves the network: that is the zero-egress configuration REQUIREMENTS
 * promises. "Local" is decided narrowly (`localhost`, a loopback address or a
 * private address written as an address), so a name that merely looks
 * internal is still governed. Treating a public host as local would be a leak;
 * treating a private one as public only costs a line in the allow-list.
 *
 * **What was withheld is reported, never what it was.** The callback receives
 * a host, a purpose and counts. The text itself is not in the event, and the
 * refusal's message names the host and the rule, not the prompt.
 */
import { isIP } from "node:net";
import type {
  AIProvider,
  AIPurpose,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  ModelCapabilities,
  ToolDefinition,
} from "../ports/ai.ts";
import { isBlockedAddress } from "./guard.ts";

/**
 * How much may reach a provider off the network.
 *
 * | Level | Assists | Retrieval (copilot passages, search index) |
 * |---|---|---|
 * | `all` | Sent | Sent |
 * | `assists` | Sent | Withheld |
 * | `none` | Withheld | Withheld |
 */
export const AI_CONTEXT_EGRESS_LEVELS = ["all", "assists", "none"] as const;

export type AIContextEgress = (typeof AI_CONTEXT_EGRESS_LEVELS)[number];

/** A workspace's four egress controls, as its settings resolve them. */
export interface AIEgressPolicy {
  readonly contextEgress: AIContextEgress;
  readonly redactPersonalData: boolean;
  readonly noTraining: boolean;
  /** Hosts a non-local call may reach. Empty means any. */
  readonly allowedHosts: readonly string[];
}

/** Where a driver's requests go. */
export interface AIEgressTarget {
  /** The host, or null when the driver talks to nothing. */
  readonly host: string | null;
  /** Whether nothing sent there leaves this machine or its private network. */
  readonly local: boolean;
}

export type AIEgressRefusal = "host_not_allowed" | "context_withheld";

/** What a control did to one request. Never carries the request's text. */
export interface AIEgressEvent {
  readonly provider: string;
  readonly host: string;
  readonly purpose: AIPurpose;
  readonly outcome: "refused" | "redacted";
  /** Set when the whole request was refused. */
  readonly reason?: AIEgressRefusal;
  readonly emails: number;
  readonly phones: number;
}

/**
 * Thrown when a control withholds a whole request.
 *
 * Every caller already treats a provider error as "no draft" and keeps the
 * deterministic answer, so this degrades a feature rather than breaking it.
 */
export class AIEgressRefusedError extends Error {
  readonly reason: AIEgressRefusal;

  constructor(reason: AIEgressRefusal, host: string | null) {
    super(
      reason === "host_not_allowed"
        ? `${host ?? "This provider"} is not on this workspace's AI egress allow-list.`
        : `This workspace's AI egress level does not let this request reach ${host ?? "the provider"}.`,
    );
    this.name = "AIEgressRefusedError";
    this.reason = reason;
  }
}

/**
 * Whether a host is this machine or a private network, written as such.
 *
 * Deliberately narrow. A name like `ollama` or `llm.internal` may well be
 * private, but only a resolver knows, and a resolver's answer can change
 * after this check. Those stay governed, and an administrator lists them.
 */
export function isLocalAIHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost")) {
    return true;
  }
  // The outbound guard's list of addresses a server must never be talked
  // into reaching is exactly the list of addresses that are not the public
  // internet, which is the question here asked the other way round.
  return isIP(value) !== 0 && isBlockedAddress(value);
}

/** The target a base URL names. An address that does not parse is not local. */
export function aiEgressTargetFromUrl(baseUrl: string | null): AIEgressTarget {
  if (baseUrl === null) {
    return { host: null, local: false };
  }
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return { host: baseUrl, local: false };
  }
  return { host, local: isLocalAIHost(host) };
}

/** A host as the allow-list stores it: lower case, no brackets, no port. */
function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

/**
 * Whether this policy lets a request of this purpose reach this target, or
 * which rule refuses it.
 *
 * One function, used by the guard to enforce and by the host to decide
 * whether to offer a feature at all, so the two cannot disagree.
 */
export function aiEgressRefusal(
  policy: AIEgressPolicy,
  target: AIEgressTarget,
  purpose: AIPurpose,
): AIEgressRefusal | null {
  if (target.local) {
    return null;
  }
  if (policy.allowedHosts.length > 0) {
    const listed = policy.allowedHosts.map(normaliseHost);
    if (target.host === null || !listed.includes(normaliseHost(target.host))) {
      return "host_not_allowed";
    }
  }
  if (policy.contextEgress === "none") {
    return "context_withheld";
  }
  if (policy.contextEgress === "assists" && purpose !== "assist") {
    return "context_withheld";
  }
  return null;
}

// --- Redaction -------------------------------------------------------------
//
// **Scanned by index rather than matched by one pattern.** The obvious
// expressions for an address or a number carry an unbounded run before a
// fixed character, which backtracks across every start position of a long
// run with no `@` in it. CodeQL reports that shape as a polynomial denial of
// service (js/polynomial-redos), and the input here is whatever a member
// wrote. The loops below each look at a character a bounded number of times.

const EMAIL_PLACEHOLDER = "[email]";
const PHONE_PLACEHOLDER = "[phone]";

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9";

const isLetter = (char: string | undefined): boolean =>
  char !== undefined &&
  ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));

const isLocalPartChar = (char: string | undefined): boolean =>
  isLetter(char) ||
  isDigit(char) ||
  char === "." ||
  char === "_" ||
  char === "%" ||
  char === "+" ||
  char === "-";

const isDomainChar = (char: string | undefined): boolean =>
  isLetter(char) || isDigit(char) || char === "." || char === "-";

/** RFC 5321's own limits, which also bound how far a scan can run. */
const MAX_LOCAL_PART = 64;
const MAX_DOMAIN = 253;

/** Every email address in the text, as [start, end) spans in order. */
function emailSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let at = text.indexOf("@");
  while (at !== -1) {
    let start = at;
    while (
      start > 0 &&
      at - start < MAX_LOCAL_PART &&
      isLocalPartChar(text[start - 1])
    ) {
      start -= 1;
    }
    // A local part does not begin with a dot, and a sentence's full stop
    // before an address is not part of it.
    while (start < at && text[start] === ".") {
      start += 1;
    }

    let end = at + 1;
    while (
      end < text.length &&
      end - at - 1 < MAX_DOMAIN &&
      isDomainChar(text[end])
    ) {
      end += 1;
    }
    // "Write to jane@example.com." ends a sentence, not a domain.
    while (end > at + 1 && (text[end - 1] === "." || text[end - 1] === "-")) {
      end -= 1;
    }

    const domain = text.slice(at + 1, end);
    const dot = domain.lastIndexOf(".");
    const topLevel = dot > 0 ? domain.slice(dot + 1) : "";
    const isAddress =
      start < at &&
      topLevel.length >= 2 &&
      [...topLevel].every((char) => isLetter(char));

    if (isAddress) {
      spans.push([start, end]);
      at = text.indexOf("@", end);
    } else {
      at = text.indexOf("@", at + 1);
    }
  }
  return spans;
}

/** Characters a phone number is written with between its digits. */
const isPhoneSeparator = (char: string | undefined): boolean =>
  char === " " || char === "-" || char === "." || char === "(" || char === ")";

/**
 * Whether one run of digits and separators is a phone number.
 *
 * Two shapes, both chosen to leave a key result's numbers alone, because a
 * number an assist cannot see is a number it cannot narrate, and the digest
 * and trend narrations are dropped when one goes missing:
 *
 * - International: `+` and 8 to 15 digits, which is E.164's own range.
 * - National: a leading `0` trunk prefix, 9 to 11 digits, grouped the way a
 *   number is written (`012-345 6789`, `(03) 2345 6789`, `020 7946 0958`) or
 *   written solid. A date, a decimal, a percentage and a list of small numbers
 *   all fail one of those.
 */
function isPhoneRun(run: string): boolean {
  const groups: string[] = [];
  let current = "";
  let usesDot = false;
  for (const char of run) {
    if (isDigit(char)) {
      current += char;
      continue;
    }
    if (char === ".") {
      usesDot = true;
    }
    if (current !== "") {
      groups.push(current);
      current = "";
    }
  }
  if (current !== "") {
    groups.push(current);
  }
  const digits = groups.reduce((sum, group) => sum + group.length, 0);

  if (run.startsWith("+")) {
    return digits >= 8 && digits <= 15 && groups.length <= 6;
  }

  const [first, ...rest] = groups;
  if (first === undefined || !first.startsWith("0") || usesDot) {
    return false;
  }
  if (digits < 9 || digits > 11) {
    return false;
  }
  if (groups.length === 1) {
    return true;
  }
  return (
    groups.length <= 4 &&
    first.length >= 2 &&
    rest.every((group) => group.length >= 3)
  );
}

/** Every phone number in the text, as [start, end) spans in order. */
function phoneSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const previous = text[index - 1];
    const startsRun =
      (char === "+" && isDigit(text[index + 1])) ||
      (char === "(" && isDigit(text[index + 1])) ||
      isDigit(char);
    // Not the middle of a word or a number: "Q3" is not the start of "3 2026".
    const boundary =
      index === 0 ||
      !(isLetter(previous) || isDigit(previous) || previous === "+");
    if (!(startsRun && boundary)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    let separators = 0;
    while (end < text.length) {
      const next = text[end];
      if (isDigit(next)) {
        separators = 0;
      } else if (isPhoneSeparator(next) && separators < 2) {
        separators += 1;
      } else {
        break;
      }
      end += 1;
    }
    // A run ends on its last digit, and the closing bracket of "(03)" alone
    // is not a number.
    while (end > index && !isDigit(text[end - 1])) {
      end -= 1;
    }
    // A number running straight into a letter is a code, not a phone.
    const runsIntoWord = isLetter(text[end]);

    if (end > index && !runsIntoWord && isPhoneRun(text.slice(index, end))) {
      spans.push([index, end]);
    }
    index = Math.max(end, index + 1);
  }
  return spans;
}

function replaceSpans(
  text: string,
  spans: readonly [number, number][],
  placeholder: string,
): string {
  let out = "";
  let from = 0;
  for (const [start, end] of spans) {
    out += text.slice(from, start) + placeholder;
    from = end;
  }
  return out + text.slice(from);
}

export interface Redacted {
  readonly text: string;
  readonly emails: number;
  readonly phones: number;
}

/**
 * Email addresses and phone numbers replaced with a placeholder.
 *
 * Names are left as written. A member's name is personal data too, but
 * recognising one needs the workspace's member list, and a model shown
 * "[person]" in a check-in about Priya's team drafts a worse check-in about
 * nobody. That is a separate decision, not a pattern to guess at here.
 */
export function redactPersonalData(text: string): Redacted {
  const emails = emailSpans(text);
  const withoutEmails = replaceSpans(text, emails, EMAIL_PLACEHOLDER);
  const phones = phoneSpans(withoutEmails);
  return {
    text: replaceSpans(withoutEmails, phones, PHONE_PLACEHOLDER),
    emails: emails.length,
    phones: phones.length,
  };
}

// --- The guard -------------------------------------------------------------

export interface EgressGuardOptions {
  /** The provider's name, for the event. */
  readonly provider: string;
  readonly target: AIEgressTarget;
  readonly policy: AIEgressPolicy;
  /**
   * Told whenever a control withholds or replaces anything, before the
   * request goes. A failure here does not undo the control: the request is
   * still refused or still redacted.
   */
  readonly onWithheld?: (event: AIEgressEvent) => void | Promise<void>;
}

/**
 * A provider every call to which passes the workspace's egress controls.
 *
 * `permits` answers the question a host asks before offering a feature, from
 * the same function the guard enforces with: a workspace whose level withholds
 * everything should not see an assist button that can only ever fail.
 */
export class EgressGuardedProvider implements AIProvider {
  readonly #inner: AIProvider;
  readonly #options: EgressGuardOptions;

  constructor(inner: AIProvider, options: EgressGuardOptions) {
    this.#inner = inner;
    this.#options = options;
  }

  /** Where this provider's requests go. */
  get target(): AIEgressTarget {
    return this.#options.target;
  }

  /** Whether a request of this purpose would be let through at all. */
  permits(purpose: AIPurpose): boolean {
    return (
      aiEgressRefusal(this.#options.policy, this.#options.target, purpose) ===
      null
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.#inner.chat(await this.#admitChat(request));
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    yield* this.#inner.stream(await this.#admitChat(request));
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    return this.#inner.chatWithTools(await this.#admitChat(request));
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    return this.#inner.extract(await this.#admitChat(request));
  }

  /** Always retrieval: an embedding is the search index being built. */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const input = await this.#admit("retrieval", request.input);
    return this.#inner.embed({ ...request, input });
  }

  capabilities(model: string): ModelCapabilities {
    return this.#inner.capabilities(model);
  }

  stop(): Promise<void> {
    return this.#inner.stop();
  }

  async #admitChat<T extends ChatRequest>(request: T): Promise<T> {
    // A request that does not say what it carries is treated as the wider
    // kind, so a new call site is withheld under a narrow level rather than
    // let through by omission.
    const purpose = request.purpose ?? "retrieval";
    const contents = await this.#admit(
      purpose,
      request.messages.map((message) => message.content),
    );
    const messages: ChatMessage[] = request.messages.map((message, index) => ({
      ...message,
      content: contents[index] ?? message.content,
    }));
    return { ...request, messages };
  }

  /** The texts that may be sent, or a refusal. */
  async #admit(
    purpose: AIPurpose,
    texts: readonly string[],
  ): Promise<readonly string[]> {
    const { policy, target } = this.#options;
    if (target.local) {
      return texts;
    }

    const refusal = aiEgressRefusal(policy, target, purpose);
    if (refusal !== null) {
      await this.#report({
        purpose,
        outcome: "refused",
        reason: refusal,
        emails: 0,
        phones: 0,
      });
      throw new AIEgressRefusedError(refusal, target.host);
    }

    if (!policy.redactPersonalData) {
      return texts;
    }
    let emails = 0;
    let phones = 0;
    const redacted = texts.map((text) => {
      const result = redactPersonalData(text);
      emails += result.emails;
      phones += result.phones;
      return result.text;
    });
    if (emails + phones > 0) {
      await this.#report({ purpose, outcome: "redacted", emails, phones });
    }
    return redacted;
  }

  async #report(
    event: Omit<AIEgressEvent, "provider" | "host">,
  ): Promise<void> {
    const { onWithheld, provider, target } = this.#options;
    if (!onWithheld) {
      return;
    }
    try {
      await onWithheld({ provider, host: target.host ?? "", ...event });
    } catch {
      // The control has already acted: the request is refused or redacted
      // whether or not the record of it could be written, and a failed
      // record must not become a reason to send the original.
    }
  }
}
