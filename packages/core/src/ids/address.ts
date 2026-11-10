/**
 * An address: what a caller names one of the eight addressable aggregates by
 * (TECHNICAL-PLAN §3, docs/design/short-ids.md S4 and S5).
 *
 * **Either form, everywhere.** From 0.7.0 every registry input that names a
 * cycle, a goal, a key result, an initiative, a task, a document or a session
 * takes its UUID or its short identifier. The input says so by using one of
 * the schemas below instead of `z.uuid()`, and the action builders turn a
 * short identifier into the UUID before the handler runs, so not one handler
 * had to change and no surface can accept one form and refuse the other.
 *
 * **The format is not an oracle.** A value that is neither a UUID nor the
 * short identifier of something the caller can see answers not-found, in the
 * same words whether it is malformed, unknown or somebody else's. That is why
 * the schemas take any short string rather than refusing a malformed one with
 * a validation error, which would tell a caller which values are worth trying.
 */
import {
  activeOnly,
  includeDeleted,
  okrSessions,
  spaceMembers,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { type ZodType, z } from "zod";
import { getAccessScoped, getParentAccessScoped } from "../access/reads.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import {
  type AddressKind,
  isShortId,
  isUuid,
  SHORT_ID_TABLES,
} from "./short.ts";

// ── The schemas ──────────────────────────────────────────────────────────

/** What an address field resolves by: one kind, or the kind a sibling names. */
type AddressMeta =
  | { readonly kind: AddressKind }
  | { readonly subjectTypeField: string };

/**
 * Which schemas are addresses. A registry rather than identity, because
 * `.optional()` wraps a schema and `.describe()` clones it: a clone inherits
 * its parent's entry, and the walk below unwraps the wrappers.
 */
const ADDRESSES = z.registry<AddressMeta>();

/**
 * Long enough for a UUID with room to spare, short enough that a pasted
 * paragraph is refused at the boundary rather than looked up.
 */
const ADDRESS_MAX_LENGTH = 64;

const addressString = () => z.string().trim().min(1).max(ADDRESS_MAX_LENGTH);

/** A field that names one kind of thing, by UUID or short identifier. */
function addressOf(kind: AddressKind): z.ZodString {
  const schema = addressString();
  ADDRESSES.add(schema, { kind });
  return schema;
}

/**
 * A field that names whatever its sibling `subjectTypeField` says it is: a
 * comment's or a document's subject. A subject type that is not one of the
 * eight, a space say, takes a UUID only, and anything else is not-found.
 */
export function subjectAddress(subjectTypeField = "subjectType"): z.ZodString {
  const schema = addressString();
  ADDRESSES.add(schema, { subjectTypeField });
  return schema;
}

/** The seven, ready made, so an input reads `goalId: ADDRESS.goal`. */
export const ADDRESS = {
  cycle: addressOf("cycle"),
  goal: addressOf("goal"),
  keyResult: addressOf("key_result"),
  initiative: addressOf("initiative"),
  task: addressOf("task"),
  document: addressOf("document"),
  session: addressOf("session"),
} as const;

// ── Finding the address fields of an input ───────────────────────────────

/** One address field: where it sits in the input and how it resolves. */
interface AddressPath {
  /** Object keys, with `[]` for every element of an array. */
  readonly path: readonly string[];
  readonly meta: AddressMeta;
}

/** Zod's own definition, read structurally: it is not part of the public API. */
interface SchemaDef {
  readonly type: string;
  readonly shape?: Record<string, ZodType>;
  readonly innerType?: ZodType;
  readonly in?: ZodType;
  readonly element?: ZodType;
  readonly options?: readonly ZodType[];
  readonly left?: ZodType;
  readonly right?: ZodType;
}

const defOf = (schema: ZodType): SchemaDef =>
  (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;

function collect(
  schema: ZodType,
  path: readonly string[],
  found: AddressPath[],
): void {
  const meta = ADDRESSES.get(schema);
  if (meta) {
    found.push({ path, meta });
    return;
  }
  const def = defOf(schema);
  switch (def.type) {
    case "object":
      for (const [key, value] of Object.entries(def.shape ?? {})) {
        collect(value, [...path, key], found);
      }
      return;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      if (def.innerType) {
        collect(def.innerType, path, found);
      }
      return;
    case "pipe":
      if (def.in) {
        collect(def.in, path, found);
      }
      return;
    case "array":
      if (def.element) {
        collect(def.element, [...path, "[]"], found);
      }
      return;
    case "union":
      for (const option of def.options ?? []) {
        collect(option, path, found);
      }
      return;
    case "intersection":
      if (def.left) {
        collect(def.left, path, found);
      }
      if (def.right) {
        collect(def.right, path, found);
      }
      return;
    default:
      return;
  }
}

/** Each input schema's address fields, found once. */
const PATHS = new WeakMap<ZodType, readonly AddressPath[]>();

/** The address fields of an input schema. Empty for most actions. */
function addressPaths(schema: ZodType): readonly AddressPath[] {
  let paths = PATHS.get(schema);
  if (!paths) {
    const found: AddressPath[] = [];
    collect(schema, [], found);
    // A union lists a field once per branch; one entry is enough.
    paths = found.filter(
      (one, index) =>
        found.findIndex(
          (other) => other.path.join(".") === one.path.join("."),
        ) === index,
    );
    PATHS.set(schema, paths);
  }
  return paths;
}

// ── Resolving one ────────────────────────────────────────────────────────

/** Who is asking: a member, or the system, which sees everything. */
export interface AddressReader {
  readonly workspaceId: string;
  /** Null for a system or operator actor, which no access rule narrows. */
  readonly memberId: string | null;
}

/** What an address resolves to. */
export interface ResolvedAddress {
  readonly id: string;
  readonly shortId: string | null;
}

const LABEL: Readonly<Record<AddressKind, string>> = {
  cycle: "cycle",
  goal: "goal",
  key_result: "key result",
  kpi: "KPI",
  initiative: "initiative",
  task: "task",
  document: "document",
  session: "session",
};

/** One answer for unknown, malformed and invisible alike. */
const notFound = (kind: AddressKind) =>
  new OperationError(
    "not_found",
    `No such ${LABEL[kind]}, or you do not have access to it.`,
  );

interface Row {
  readonly id: string;
  readonly short_id: string | null;
  readonly goal_id?: string;
  readonly subject_type?: string;
  readonly subject_id?: string;
  readonly state?: string;
  readonly author_member_id?: string;
}

/** The columns beyond the two every kind has that its access rule reads. */
const EXTRA: Partial<Record<AddressKind, string>> = {
  key_result: ", goal_id",
  document: ", subject_type, subject_id, state, author_member_id",
};

/**
 * The row an address names, deleted or not: `goals.restore` takes the address
 * of a deleted goal. Visibility is the access rule's business, below.
 */
async function rowFor(
  tx: OperationTx,
  workspaceId: string,
  kind: AddressKind,
  value: string,
): Promise<Row | undefined> {
  const table = sql.identifier(SHORT_ID_TABLES[kind]);
  const extra = sql.raw(EXTRA[kind] ?? "");
  const match = isUuid(value)
    ? sql`id = ${value}::uuid`
    : sql`short_id = ${value}`;
  const { rows } = await tx.execute<Record<string, unknown>>(
    sql`select id, short_id${extra} from ${table}
         where workspace_id = ${workspaceId} and ${match}
         limit 1`,
  );
  return rows[0] as Row | undefined;
}

/**
 * Whether this member may see this row, by the rule its own read applies.
 * Throws not-found when not, through the access getter where there is one.
 */
async function requireVisible(
  tx: OperationTx,
  reader: AddressReader & { readonly memberId: string },
  kind: AddressKind,
  row: Row,
): Promise<void> {
  const scope = { workspaceId: reader.workspaceId, memberId: reader.memberId };
  switch (kind) {
    case "goal":
    case "initiative":
    case "task":
      await getAccessScoped(tx, {
        ...scope,
        resourceType: kind,
        resourceId: row.id,
      });
      return;
    case "key_result":
      // A key result owns no context: it is read through its goal.
      await getAccessScoped(tx, {
        ...scope,
        resourceType: "goal",
        resourceId: row.goal_id as string,
      });
      return;
    case "document":
      // A draft is its author's alone (documents.ts), then the subject decides.
      if (row.state === "draft" && row.author_member_id !== reader.memberId) {
        throw notFound(kind);
      }
      await getParentAccessScoped(tx, {
        ...scope,
        resourceType: row.subject_type as string,
        resourceId: row.subject_id as string,
      });
      return;
    case "session": {
      // `sessions.read`'s rule: the workspace's floor, and the room is open
      // to a member of its space, or to everybody when it has no space.
      await getAccessScoped(tx, {
        ...scope,
        resourceType: "workspace",
        resourceId: reader.workspaceId,
      });
      const [open] = await tx
        .select({ id: okrSessions.id })
        .from(okrSessions)
        .where(
          and(
            includeDeleted(
              okrSessions,
              eq(okrSessions.workspaceId, reader.workspaceId),
              eq(okrSessions.id, row.id),
            ),
            or(
              isNull(okrSessions.spaceId),
              inArray(
                okrSessions.spaceId,
                tx
                  .select({ spaceId: spaceMembers.spaceId })
                  .from(spaceMembers)
                  .where(
                    activeOnly(
                      spaceMembers,
                      eq(spaceMembers.workspaceId, reader.workspaceId),
                      eq(spaceMembers.memberId, reader.memberId),
                    ),
                  ),
              ),
            ),
          ),
        )
        .limit(1);
      if (!open) {
        throw notFound(kind);
      }
      return;
    }
    case "cycle":
    case "kpi":
      // Both belong to the workspace, as `cycles.list` and the KPI jump read.
      await getAccessScoped(tx, {
        ...scope,
        resourceType: "workspace",
        resourceId: reader.workspaceId,
      });
      return;
  }
}

/**
 * The thing an address names, if this reader may see it (short-ids.md S4).
 *
 * A UUID is looked up as a key, as it always was; anything else as a short
 * identifier, case-sensitively. Both go through the access rule the kind's own
 * read applies, so an address the reader cannot see answers not-found in the
 * same words as one that names nothing.
 */
export async function resolveAddress(
  tx: OperationTx,
  reader: AddressReader,
  kind: AddressKind,
  value: string,
): Promise<ResolvedAddress> {
  const trimmed = value.trim();
  if (!isUuid(trimmed) && !isShortId(trimmed)) {
    throw notFound(kind);
  }
  const row = await rowFor(tx, reader.workspaceId, kind, trimmed);
  if (!row) {
    throw notFound(kind);
  }
  if (reader.memberId !== null) {
    try {
      await requireVisible(
        tx,
        { ...reader, memberId: reader.memberId },
        kind,
        row,
      );
    } catch (error) {
      if (error instanceof OperationError && error.code === "not_found") {
        throw notFound(kind);
      }
      throw error;
    }
  }
  return { id: row.id, shortId: row.short_id };
}

// ── Resolving every address in an input ──────────────────────────────────

/** The kinds a subject type names, where it names one of the eight. */
const KIND_OF_SUBJECT: Readonly<Record<string, AddressKind>> = {
  cycle: "cycle",
  goal: "goal",
  key_result: "key_result",
  kpi: "kpi",
  initiative: "initiative",
  task: "task",
  document: "document",
  session: "session",
};

/** A place in the input holding an address that is not a UUID. */
interface Pending {
  readonly holder: Record<string, unknown> | unknown[];
  readonly key: string | number;
  readonly value: string;
  /** Null when the sibling names something with no short identifier. */
  readonly kind: AddressKind | null;
}

/** Every value at `path` under `node`, with the object or array holding it. */
function visit(
  node: unknown,
  path: readonly string[],
  sibling: Record<string, unknown> | null,
  each: (
    holder: Record<string, unknown> | unknown[],
    key: string | number,
    value: unknown,
    siblings: Record<string, unknown> | null,
  ) => void,
): void {
  const [head, ...rest] = path;
  if (head === undefined || node === null || typeof node !== "object") {
    return;
  }
  if (head === "[]") {
    if (!Array.isArray(node)) {
      return;
    }
    node.forEach((element, index) => {
      if (rest.length === 0) {
        each(node, index, element, sibling);
      } else {
        visit(element, rest, sibling, each);
      }
    });
    return;
  }
  if (Array.isArray(node)) {
    return;
  }
  const record = node as Record<string, unknown>;
  if (rest.length === 0) {
    each(record, head, record[head], record);
  } else {
    visit(record[head], rest, record, each);
  }
}

/** The member a call acts as, or null for the system and an operator. */
async function readerFor(
  tx: OperationTx,
  context: ActionCallContext,
): Promise<AddressReader> {
  const { actor, workspaceId } = context;
  if (actor.kind === "system" || actor.kind === "operator") {
    return { workspaceId, memberId: null };
  }
  const by = actor.memberId
    ? eq(workspaceMembers.id, actor.memberId)
    : actor.userId
      ? eq(workspaceMembers.userId, actor.userId)
      : undefined;
  const [member] = by
    ? await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            by,
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1)
    : [];
  if (!member) {
    // What the pipeline says to somebody who is not a member, said first.
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }
  return { workspaceId, memberId: member.id };
}

/**
 * The input with every short identifier in it replaced by the UUID it names
 * (short-ids.md S5). Called by both action builders after the input parses
 * and before the handler sees it.
 *
 * Costs nothing for an input with no address fields, and nothing beyond the
 * walk for one whose addresses are all UUIDs: a UUID goes to the handler as it
 * always did, and the handler's own read decides what it may see. Only a short
 * identifier opens a transaction, to find the row and check the reader may
 * see it before anything is done with it.
 */
export async function resolveAddresses<T>(
  context: ActionCallContext,
  schema: ZodType,
  input: T,
): Promise<T> {
  const paths = addressPaths(schema);
  if (paths.length === 0 || pendingIn(input, paths).length === 0) {
    return input;
  }

  // Replaced on a copy, so the caller's object is left as it sent it.
  const copy = structuredClone(input);
  const pending = pendingIn(copy, paths);
  // A subject with no short identifier of its own, named by something that is
  // not a UUID, names nothing.
  if (pending.some((one) => one.kind === null)) {
    throw new OperationError(
      "not_found",
      "No such item, or you do not have access to it.",
    );
  }
  await withWorkspace(
    drizzle(context.pool),
    context.workspaceId,
    async (tx) => {
      const operationTx = tx as unknown as OperationTx;
      const reader = await readerFor(operationTx, context);
      for (const one of pending) {
        const resolved = await resolveAddress(
          operationTx,
          reader,
          one.kind as AddressKind,
          one.value,
        );
        (one.holder as Record<string | number, unknown>)[one.key] = resolved.id;
      }
    },
  );
  return copy;
}

/** Every address in `input` that is not a UUID, with where it sits. */
function pendingIn(input: unknown, paths: readonly AddressPath[]): Pending[] {
  const pending: Pending[] = [];
  for (const { path, meta } of paths) {
    visit(input, path, null, (holder, key, value, siblings) => {
      if (typeof value !== "string" || isUuid(value)) {
        return;
      }
      const kind =
        "kind" in meta
          ? meta.kind
          : (KIND_OF_SUBJECT[String(siblings?.[meta.subjectTypeField])] ??
            null);
      pending.push({ holder, key, value, kind });
    });
  }
  return pending;
}
