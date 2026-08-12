/**
 * The structural validator (docs/design/rich-text-editor.md §3-4).
 *
 * Two passes per node: attribute shape (`NODE_ATTRS_SCHEMAS`, Zod) and
 * nesting (`NESTING_RULES`, a plain lookup) — kept separate so a failure
 * names exactly which one broke, at exactly which path, rather than one
 * generic "invalid document" a caller cannot act on.
 *
 * A document that fails is refused outright: this never strips an
 * unknown node and returns the rest, which would silently drop content
 * the author is left believing they saved.
 */
import { z } from "zod";
import {
  INLINE_NODE_TYPES,
  LEAF_NODE_TYPES,
  markSchema,
  NESTING_RULES,
  NODE_ATTRS_SCHEMAS,
  type NodeType,
  RICH_TEXT_SCHEMA_VERSION,
  type RichTextDocument,
} from "./schema.ts";

export class RichTextValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "RichTextValidationError";
    this.path = path;
  }
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && value in NODE_ATTRS_SCHEMAS;
}

function validateAttrs(type: NodeType, attrs: unknown, path: string): void {
  const schema = NODE_ATTRS_SCHEMAS[type];
  const result = schema.safeParse(attrs);
  if (!result.success) {
    throw new RichTextValidationError(
      path,
      `invalid attrs for "${type}": ${z.prettifyError(result.error)}`,
    );
  }
}

function validateMarks(marks: unknown, path: string): void {
  if (marks === undefined) {
    return;
  }
  if (!Array.isArray(marks)) {
    throw new RichTextValidationError(path, "marks must be an array");
  }
  for (const [index, mark] of marks.entries()) {
    const result = markSchema.safeParse(mark);
    if (!result.success) {
      throw new RichTextValidationError(
        `${path}.marks[${index}]`,
        `not an allowed mark: ${z.prettifyError(result.error)}`,
      );
    }
  }
}

function validateTextNode(node: Record<string, unknown>, path: string): void {
  if (typeof node.text !== "string" || node.text.length === 0) {
    throw new RichTextValidationError(
      path,
      'a "text" node needs a non-empty text field',
    );
  }
  validateMarks(node.marks, path);
}

function validateChildren(
  parentType: NodeType,
  content: unknown,
  path: string,
): void {
  const rule = NESTING_RULES[parentType];
  if (rule === undefined) {
    if (
      content !== undefined &&
      !(Array.isArray(content) && content.length === 0)
    ) {
      throw new RichTextValidationError(
        path,
        `"${parentType}" may not have content`,
      );
    }
    return;
  }
  if (content === undefined) {
    // An empty paragraph/heading (a blank line) has no content at all in
    // ProseMirror's own shape. A block container (a list, a table) has no
    // such "empty but valid" state, so only "inline" parents may omit it.
    if (rule === "inline") {
      return;
    }
    throw new RichTextValidationError(
      path,
      `"${parentType}" needs at least one child`,
    );
  }
  if (!Array.isArray(content) || (content.length === 0 && rule !== "inline")) {
    throw new RichTextValidationError(
      path,
      `"${parentType}" needs at least one child`,
    );
  }
  content.forEach((child, index) => {
    const childPath = `${path}.content[${index}]`;
    if (typeof child !== "object" || child === null) {
      throw new RichTextValidationError(childPath, "not an object");
    }
    const childRecord = child as Record<string, unknown>;
    if (rule === "inline") {
      if (childRecord.type === "text") {
        validateTextNode(childRecord, childPath);
        return;
      }
      if (
        isNodeType(childRecord.type) &&
        INLINE_NODE_TYPES.has(childRecord.type)
      ) {
        validateNode(childRecord, childPath);
        return;
      }
      throw new RichTextValidationError(
        childPath,
        `"${String(childRecord.type)}" is not allowed as inline content`,
      );
    }
    if (!isNodeType(childRecord.type) || !rule.includes(childRecord.type)) {
      throw new RichTextValidationError(
        childPath,
        `"${String(childRecord.type)}" is not allowed inside "${parentType}"`,
      );
    }
    validateNode(childRecord, childPath);
  });
}

function validateCodeBlockContent(content: unknown, path: string): void {
  if (content === undefined) {
    return;
  }
  if (!Array.isArray(content)) {
    throw new RichTextValidationError(
      path,
      '"codeBlock" content must be an array',
    );
  }
  content.forEach((child, index) => {
    const childPath = `${path}.content[${index}]`;
    if (
      typeof child !== "object" ||
      child === null ||
      (child as Record<string, unknown>).type !== "text"
    ) {
      throw new RichTextValidationError(
        childPath,
        '"codeBlock" may only contain plain text',
      );
    }
    const childRecord = child as Record<string, unknown>;
    if (childRecord.marks !== undefined) {
      throw new RichTextValidationError(
        childPath,
        '"codeBlock" text may not carry marks',
      );
    }
    validateTextNode(childRecord, childPath);
  });
}

function validateNode(node: Record<string, unknown>, path: string): void {
  if (!isNodeType(node.type)) {
    throw new RichTextValidationError(
      path,
      `"${String(node.type)}" is not an allowed node type`,
    );
  }
  const type = node.type;
  validateAttrs(type, node.attrs, path);

  if (LEAF_NODE_TYPES.has(type)) {
    if (node.content !== undefined) {
      throw new RichTextValidationError(path, `"${type}" may not have content`);
    }
    return;
  }
  if (type === "codeBlock") {
    validateCodeBlockContent(node.content, path);
    return;
  }
  validateChildren(type, node.content, path);
}

/**
 * The write-boundary entry point. `version` must be a version this module
 * still knows how to read (today: only `RICH_TEXT_SCHEMA_VERSION`) — this
 * is a stricter check than `extract.ts`'s functions deliberately make,
 * because a write is a decision to persist, not a best-effort read.
 */
export function parseRichText(
  input: unknown,
  version: number,
): RichTextDocument {
  if (version !== RICH_TEXT_SCHEMA_VERSION) {
    throw new RichTextValidationError(
      "$",
      `unknown rich text schema version ${version}`,
    );
  }
  if (typeof input !== "object" || input === null) {
    throw new RichTextValidationError("$", "must be an object");
  }
  const record = input as Record<string, unknown>;
  if (record.type !== "doc") {
    throw new RichTextValidationError("$", 'top-level type must be "doc"');
  }
  validateChildren("doc", record.content, "$");
  return input as RichTextDocument;
}

/** For a caller that already knows its input is well-formed (a golden
 * fixture, a value this same module just produced) and wants a boolean
 * rather than a thrown error to branch on. */
export function isValidRichText(
  input: unknown,
  version: number,
): input is RichTextDocument {
  try {
    parseRichText(input, version);
    return true;
  } catch {
    return false;
  }
}
