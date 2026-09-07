import {
  INLINE_NODE_TYPES,
  isAllowedLinkHref,
  type Mark,
  NESTING_RULES,
  RICH_TEXT_SCHEMA_VERSION,
  type RichTextDocument,
  type RichTextNode,
} from "./schema.ts";
import { parseRichText } from "./validate.ts";

/**
 * HTML into an editor document (P6-T04b).
 *
 * FlowyTeam stores every piece of prose as CKEditor HTML, so importing a task
 * comment means converting untrusted markup written years ago in another
 * product. The rule in CLAUDE.md is that imported content is untrusted and
 * that one module parses, validates and renders it, so the conversion lives
 * beside the validator rather than in the importer.
 *
 * **This is an allow-list, not a sanitiser.** A sanitiser starts from the
 * input and removes what it recognises as dangerous, which fails whenever
 * somebody finds a construct it did not think of. This starts from the eleven
 * block types and five marks the schema has and produces nothing else: a tag
 * it does not know either contributes its children or is discarded whole, and
 * an attribute it does not know never survives, because attributes are read
 * only where the schema has somewhere to put them. The result then goes
 * through `parseRichText`, so the converter cannot emit a document the write
 * boundary would refuse.
 *
 * No HTML parser dependency. A general parser builds a DOM faithful to the
 * input, including the parts to be thrown away, and this needs the opposite:
 * a tokeniser that recognises the small set of tags the schema has and treats
 * everything else as noise. Adding a runtime dependency to be less strict
 * would be a poor trade.
 */

/** How the schema's containers map onto tag names. */
const BLOCK_TAGS: Readonly<Record<string, string>> = {
  p: "paragraph",
  div: "paragraph",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  // A source document's h4 is somebody's fourth level, and this schema has
  // three. Flattening to the deepest one keeps it subordinate to what is
  // above it, which is the only part of "fourth level" that survives.
  h4: "heading",
  h5: "heading",
  h6: "heading",
  ul: "bulletList",
  ol: "orderedList",
  li: "listItem",
  blockquote: "blockquote",
  pre: "codeBlock",
  table: "table",
  thead: "unwrap",
  tbody: "unwrap",
  tfoot: "unwrap",
  tr: "tableRow",
  td: "tableCell",
  th: "tableHeader",
};

const HEADING_LEVELS: Readonly<Record<string, 1 | 2 | 3>> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 3,
  h5: 3,
  h6: 3,
};

/** Tags that add a mark to the text inside them. `link` is not here: it takes
 * an address, and `<a>` is handled where the address can be checked. */
const MARK_TAGS: Readonly<Record<string, Exclude<Mark["type"], "link">>> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  code: "code",
  s: "strike",
  strike: "strike",
  del: "strike",
};

/** Discarded with everything inside them. Anything else unknown is unwrapped
 * instead, because a `<span style=…>` around a sentence holds the sentence. */
const DROPPED_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "svg",
  "math",
  "noscript",
  "template",
  "head",
  "title",
  "link",
  "meta",
  "audio",
  "video",
  "canvas",
]);

/** Tags whose content is text and never markup, so `<` inside them is data.
 * Their content is dropped along with them, which is the point. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "textarea",
  "title",
]);

const VOID_TAGS: ReadonlySet<string> = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "source",
  "track",
  "area",
  "base",
  "col",
  "embed",
  "param",
  "wbr",
]);

/**
 * What an `<img>` becomes, decided by the caller.
 *
 * The schema has no image node: a picture in this product is an `attachment`
 * pointing at a blob. A converter cannot create a blob, so it hands the
 * source address out and takes back whatever node the caller can make, or
 * nothing. Returning nothing drops the image, which is what a surface with no
 * blob store should do.
 */
export type ImageHandler = (image: {
  readonly src: string;
  readonly alt: string;
}) => RichTextNode | undefined;

export interface FromHtmlOptions {
  readonly onImage?: ImageHandler;
  /**
   * Called once per construct the conversion could not keep, so an importer
   * can put it in its report instead of losing it silently.
   */
  readonly onDropped?: (what: string) => void;
}

// ── Tokenising ────────────────────────────────────────────────────────

interface TextToken {
  readonly kind: "text";
  readonly text: string;
}

interface TagToken {
  readonly kind: "open" | "close";
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** `<br />` and friends: an open tag that closes itself. */
  readonly selfClosing: boolean;
}

type Token = TextToken | TagToken;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
  times: "×",
  divide: "÷",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (all, ref) => {
      const body = String(ref);
      if (body.startsWith("#")) {
        const digits = body.slice(1);
        const code =
          digits.startsWith("x") || digits.startsWith("X")
            ? Number.parseInt(digits.slice(1), 16)
            : Number.parseInt(digits, 10);
        // A lone surrogate or an out-of-range code point would corrupt the
        // string, so an unreadable reference stays the text it already was.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return all;
        }
        if (code >= 0xd800 && code <= 0xdfff) {
          return all;
        }
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? all;
    },
  );
}

const ATTR_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'<>`]+))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_PATTERN.lastIndex = 0;
  let match = ATTR_PATTERN.exec(source);
  while (match) {
    const name = String(match[1]).toLowerCase();
    const raw = match[2];
    let value = raw ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attrs[name] = decodeEntities(value);
    match = ATTR_PATTERN.exec(source);
  }
  return attrs;
}

function tokenise(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let text = "";

  const flushText = () => {
    if (text !== "") {
      tokens.push({ kind: "text", text: decodeEntities(text) });
      text = "";
    }
  };

  while (index < html.length) {
    const next = html.indexOf("<", index);
    if (next === -1) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, next);

    // A comment, a doctype or a CDATA block: skipped whole.
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = html.indexOf(">", next);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const tag = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)\s*>/.exec(
      html.slice(next),
    );
    if (!tag) {
      // A `<` that starts nothing is a `<` somebody typed.
      text += "<";
      index = next + 1;
      continue;
    }

    flushText();
    const closing = tag[1] === "/";
    const name = String(tag[2]).toLowerCase();
    const attrs = closing ? {} : parseAttrs(String(tag[3] ?? ""));
    const selfClosing = tag[4] === "/" || VOID_TAGS.has(name);
    index = next + tag[0].length;

    if (!closing && RAW_TEXT_TAGS.has(name)) {
      // Everything up to the matching close tag is data, not markup. Skipping
      // it here is what stops `<script>if (a < b) {}</script>` from leaking
      // its body as text.
      const closePattern = new RegExp(`<\\s*/\\s*${name}\\s*>`, "i");
      const rest = html.slice(index);
      const match = closePattern.exec(rest);
      index += match ? match.index + match[0].length : rest.length;
      tokens.push({ kind: "open", name, attrs, selfClosing: true });
      continue;
    }

    tokens.push({ kind: closing ? "close" : "open", name, attrs, selfClosing });
  }
  flushText();
  return tokens;
}

// ── Building ──────────────────────────────────────────────────────────

/** A container being filled. `tag` is what opened it, so a close tag can find
 * the frame it belongs to without trusting the input to be well nested. */
interface Frame {
  readonly tag: string;
  readonly type: string | undefined;
  readonly attrs: Record<string, unknown> | undefined;
  readonly children: RichTextNode[];
  readonly marks: readonly Mark[];
  /** Inside a `<pre>`: whitespace is content, not layout. Inherited, because
   * CKEditor writes `<pre><code>` and the `<code>` carries no type of its
   * own. */
  readonly raw: boolean;
}

/** Where inline content is legal. Everything else takes blocks. */
const INLINE_CONTAINERS: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "codeBlock",
]);

export function richTextFromHtml(
  html: string,
  options: FromHtmlOptions = {},
): RichTextDocument {
  const tokens = tokenise(html);
  const root: Frame = {
    tag: "",
    type: "doc",
    attrs: undefined,
    children: [],
    marks: [],
    raw: false,
  };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1] as Frame;

  const closeTo = (tag: string) => {
    // Find the innermost frame this tag opened. Nothing matching means a
    // stray close tag, which is ignored rather than allowed to unwind.
    for (let depth = stack.length - 1; depth > 0; depth -= 1) {
      if ((stack[depth] as Frame).tag === tag) {
        while (stack.length > depth) {
          const frame = stack.pop() as Frame;
          place(stack[stack.length - 1] as Frame, frame);
        }
        return;
      }
    }
  };

  for (const token of tokens) {
    if (token.kind === "text") {
      addText(top(), token.text);
      continue;
    }
    if (token.kind === "close") {
      closeTo(token.name);
      continue;
    }
    openTag(stack, token, options);
  }

  // Unclosed tags are ordinary in hand-edited HTML: close them in order.
  while (stack.length > 1) {
    const frame = stack.pop() as Frame;
    place(stack[stack.length - 1] as Frame, frame);
  }

  const content = normalise("doc", root.children);
  return parseRichText(
    // A document needs a child, and markup that said nothing still has to
    // produce one. The caller decides whether an empty comment is worth
    // storing; the converter is not the place to refuse it.
    {
      type: "doc",
      content:
        content.length > 0 ? content : [{ type: "paragraph", content: [] }],
    },
    RICH_TEXT_SCHEMA_VERSION,
  );
}

function openTag(
  stack: Frame[],
  token: TagToken,
  options: FromHtmlOptions,
): void {
  const parent = stack[stack.length - 1] as Frame;
  const name = token.name;

  if (DROPPED_TAGS.has(name)) {
    options.onDropped?.(`<${name}>`);
    return;
  }
  if (name === "br") {
    parent.children.push({ type: "hardBreak" });
    return;
  }
  if (name === "hr") {
    parent.children.push({ type: "horizontalRule" });
    return;
  }
  if (name === "img") {
    const node = options.onImage?.({
      src: token.attrs.src ?? "",
      alt: token.attrs.alt ?? "",
    });
    if (node) {
      parent.children.push(node);
    } else {
      options.onDropped?.("an image");
    }
    return;
  }

  const markType = MARK_TAGS[name];
  if (markType) {
    // `<code>` inside `<pre>` is the code block's own wrapper, not a mark on
    // its text: CKEditor writes `<pre><code>…</code></pre>` for one block.
    if (markType === "code" && parent.type === "codeBlock") {
      stack.push({
        tag: name,
        type: undefined,
        attrs: undefined,
        children: [],
        marks: parent.marks,
        raw: parent.raw,
      });
      return;
    }
    stack.push({
      tag: name,
      type: undefined,
      attrs: undefined,
      children: [],
      marks: addMark(parent.marks, { type: markType }),
      raw: parent.raw,
    });
    return;
  }

  if (name === "a") {
    const href = token.attrs.href ?? "";
    if (!isAllowedLinkHref(href)) {
      // The text stays; only the address goes. A `javascript:` anchor is a
      // sentence somebody wrote with an attack attached to it.
      if (href !== "") {
        options.onDropped?.(`a link to ${href}`);
      }
      stack.push({
        tag: name,
        type: undefined,
        attrs: undefined,
        children: [],
        marks: parent.marks,
        raw: parent.raw,
      });
      return;
    }
    stack.push({
      tag: name,
      type: undefined,
      attrs: undefined,
      children: [],
      marks: addMark(parent.marks, { type: "link", attrs: { href } }),
      raw: parent.raw,
    });
    return;
  }

  const block = BLOCK_TAGS[name];
  if (!block || block === "unwrap") {
    // A `<span>`, a `<font>`, a `<section>`: the tag means nothing here and
    // its children mean everything.
    stack.push({
      tag: name,
      type: undefined,
      attrs: undefined,
      children: [],
      marks: parent.marks,
      raw: parent.raw,
    });
    return;
  }

  // A block cannot open inside a paragraph. CKEditor emits `<p><div>…` often
  // enough that closing the paragraph first is the only reading that keeps
  // the text.
  if (parent.type && INLINE_CONTAINERS.has(parent.type)) {
    const frame = stack.pop() as Frame;
    place(stack[stack.length - 1] as Frame, frame);
  }

  const level = HEADING_LEVELS[name];
  stack.push({
    tag: name,
    type: block,
    attrs: block === "heading" && level ? { level } : undefined,
    children: [],
    marks: token.selfClosing ? parent.marks : [],
    raw: parent.raw || block === "codeBlock",
  });
  if (token.selfClosing) {
    const frame = stack.pop() as Frame;
    place(stack[stack.length - 1] as Frame, frame);
  }
}

function addMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  if (marks.some((existing) => existing.type === mark.type)) {
    return marks;
  }
  return [...marks, mark];
}

function addText(frame: Frame, text: string): void {
  if (text === "") {
    return;
  }
  // A code block keeps its whitespace; everywhere else HTML collapses runs of
  // it, and keeping them would turn an indented source into ragged prose.
  const inCode = frame.raw;
  const value = inCode ? text : text.replace(/\s+/g, " ");
  if (value.trim() === "" && !inCode) {
    // Whitespace between two blocks is layout, not content. Between two runs
    // of text it is a space, and there is text either side to prove it.
    if (frame.children.length === 0 || value === "") {
      return;
    }
    const last = frame.children[frame.children.length - 1];
    if (last?.type !== "text") {
      return;
    }
  }
  frame.children.push(
    frame.marks.length > 0
      ? { type: "text", text: value, marks: [...frame.marks] }
      : { type: "text", text: value },
  );
}

/** Put a finished frame into its parent, either as a node or, when the tag
 * carried no meaning, as its children. */
function place(parent: Frame, frame: Frame): void {
  if (frame.type === undefined) {
    parent.children.push(...frame.children);
    return;
  }
  const content = normalise(frame.type, frame.children);
  if (content.length === 0) {
    // An empty paragraph, an empty list, an empty cell: whitespace the source
    // used for layout. A horizontal rule and a hard break are not frames and
    // never reach here, so nothing meaningful is lost.
    return;
  }
  parent.children.push(
    frame.attrs
      ? { type: frame.type as never, attrs: frame.attrs, content }
      : { type: frame.type as never, content },
  );
}

const isInline = (node: RichTextNode): boolean =>
  node.type === "text" ||
  node.type === "mention" ||
  node.type === "entityLink" ||
  node.type === "attachment" ||
  node.type === "hardBreak";

/**
 * Make a run of children legal for the container about to hold them.
 *
 * The tokeniser produces what the source said; `NESTING_RULES` decides what
 * may sit where, and this reads that map rather than repeating it. Reading it
 * is the point: hand-written cases covered five of the shapes 7223 live
 * comments contain and missed eight more, among them `<ul><ul><li>`, a table
 * nested in a table cell and a quoted email inside a quoted email.
 *
 * Three repairs, tried in order, and never a drop:
 *
 * 1. The child is allowed here. Keep it.
 * 2. Something this container accepts would accept the child. Build it. A
 *    stray `<li>` under `doc` gets the `<ul>` the source forgot.
 * 3. Nothing here can hold it. Keep its children and lose its shape, which
 *    is what a browser shows anyway.
 */
function normalise(
  type: string,
  children: readonly RichTextNode[],
): RichTextNode[] {
  const kept = children.filter(
    (child) => !(child.type === "text" && child.text === ""),
  );

  // A code block holds plain text and nothing else: no marks, no nodes.
  if (type === "codeBlock") {
    const text = kept.map(plainTextOf).join("");
    return text === "" ? [] : [{ type: "text", text }];
  }

  const rule = NESTING_RULES[type];
  if (rule === "inline") {
    return trimEdges(
      kept.flatMap((child) =>
        isInline(child) ? [child] : flattenToInline(child),
      ),
    );
  }

  const allowed: readonly string[] = rule ?? [];
  const holder =
    allowed.find((candidate) => NESTING_RULES[candidate] === "inline") ??
    allowed[0];
  const out: RichTextNode[] = [];
  let run: RichTextNode[] = [];
  const flushRun = () => {
    if (run.length === 0 || holder === undefined) {
      run = [];
      return;
    }
    const content = normalise(holder, run);
    if (content.length > 0) {
      out.push({ type: holder as never, content });
    }
    run = [];
  };

  for (const child of kept) {
    if (allowed.includes(child.type)) {
      flushRun();
      out.push(child);
      continue;
    }
    if (isInline(child)) {
      run.push(child);
      continue;
    }
    const wrapper = allowed.find((candidate) => accepts(candidate, child.type));
    if (wrapper !== undefined) {
      flushRun();
      const content = normalise(wrapper, [child]);
      if (content.length > 0) {
        out.push({ type: wrapper as never, content });
      }
      continue;
    }
    const inner =
      (child as { content?: readonly RichTextNode[] }).content ?? [];
    if (inner.length > 0) {
      flushRun();
      out.push(...normalise(type, inner));
    }
  }
  flushRun();
  return out;
}

/** True when a container of this type may hold a child of that one. */
function accepts(container: string, child: string): boolean {
  const rule = NESTING_RULES[container];
  if (rule === "inline") {
    return (
      child === "text" || (INLINE_NODE_TYPES as ReadonlySet<string>).has(child)
    );
  }
  return rule?.includes(child as never) ?? false;
}

/** Everything a node says, with none of its marks or shape. */
function plainTextOf(node: RichTextNode): string {
  if (node.type === "text") {
    return node.text;
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  const content = (node as { content?: readonly RichTextNode[] }).content ?? [];
  return content.map(plainTextOf).join("");
}

/** A block that ended up somewhere only inline content is legal: keep its
 * words, lose its shape. */
function flattenToInline(node: RichTextNode): RichTextNode[] {
  if (node.type === "text") {
    return [node];
  }
  if (isInline(node)) {
    return [node];
  }
  const content = (node as { content?: readonly RichTextNode[] }).content ?? [];
  return content.flatMap(flattenToInline);
}

/** Leading and trailing spaces on a paragraph are the source's indentation. */
function trimEdges(nodes: readonly RichTextNode[]): RichTextNode[] {
  const out = [...nodes];
  while (out.length > 0) {
    const first = out[0] as RichTextNode;
    if (first.type === "text" && first.text.trim() === "") {
      out.shift();
      continue;
    }
    if (first.type === "hardBreak") {
      out.shift();
      continue;
    }
    break;
  }
  while (out.length > 0) {
    const last = out[out.length - 1] as RichTextNode;
    if (last.type === "text" && last.text.trim() === "") {
      out.pop();
      continue;
    }
    if (last.type === "hardBreak") {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Wrap loose inline content in paragraphs so a block container is legal.
 *
 * Exported because the importer builds documents from several sources at once
 * (a description, then the file links under it) and has the same problem.
 */
export function asBlocks(nodes: readonly RichTextNode[]): RichTextNode[] {
  const out: RichTextNode[] = [];
  let run: RichTextNode[] = [];
  const flush = () => {
    const content = trimEdges(run);
    if (content.length > 0) {
      out.push({ type: "paragraph", content });
    }
    run = [];
  };
  for (const node of nodes) {
    if (isInline(node)) {
      run.push(node);
    } else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}
