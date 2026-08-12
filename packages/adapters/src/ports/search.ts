/**
 * The Search port (TECHNICAL-PLAN §5, §9).
 *
 * The index is a projection, never a source of truth, and it is refreshed by
 * outbox-driven jobs. Results are identifiers plus a rank: the caller reloads
 * them through the access-aware getter, so search can never widen what
 * someone is allowed to see. Every query is workspace-scoped.
 */

export interface SearchDocument {
  readonly workspaceId: string;
  /** For example `goal`, `kpi`, `document`. */
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  /** Plain text, already extracted from rich text by the caller. */
  readonly body?: string;
}

export interface SearchQuery {
  readonly workspaceId: string;
  readonly text: string;
  readonly entityTypes?: readonly string[];
  readonly limit?: number;
}

export interface SearchHit {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly rank: number;
}

export interface Search {
  index(document: SearchDocument): Promise<void>;
  remove(
    entityType: string,
    entityId: string,
    workspaceId: string,
  ): Promise<void>;
  query(query: SearchQuery): Promise<SearchHit[]>;
  /** Releases whatever this driver holds open. The shipped driver shares an
   * injected pool it does not own, so it no-ops; declared here so a future
   * driver that owns a connection of its own is not exempt from closing it. */
  stop(): Promise<void>;
}
