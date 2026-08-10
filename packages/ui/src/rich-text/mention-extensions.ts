/**
 * `@` mentions and `#` entity autolink (docs/design/rich-text-editor.md
 * §5-6). Two configured instances of `@tiptap/extension-mention` rather
 * than one multi-trigger instance: the schema needs two distinct node
 * types (`mention` with `id`/`label`, `entityLink` with `shortId`/
 * `label`), and one Mention instance always produces one node type
 * regardless of how many trigger characters it answers to.
 *
 * Neither extension hardcodes a data source: `packages/core` has no
 * search of its own yet (S-32's index is unbuilt), so both take a search
 * function as a factory argument, supplied by whichever host actually has
 * one — the same dependency-injection shape as the upload function (§7).
 */
import Mention from "@tiptap/extension-mention";
import type { SuggestionItem } from "./suggestion-list.tsx";
import { createSuggestionRender } from "./suggestion-list.tsx";

export interface MentionSearchResult {
  readonly id: string;
  readonly label: string;
}

export function createMemberMentionExtension(
  search: (query: string) => Promise<readonly MentionSearchResult[]>,
) {
  return Mention.configure({
    suggestion: {
      char: "@",
      items: async ({ query }) => {
        const results = await search(query);
        return results.map(
          (result): SuggestionItem => ({ id: result.id, label: result.label }),
        );
      },
      render: createSuggestionRender<SuggestionItem>(),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: "mention", attrs: { id: props.id, label: props.label } },
            { type: "text", text: " " },
          ])
          .run();
      },
    },
  });
}

export function createEntityLinkExtension(
  search: (query: string) => Promise<readonly MentionSearchResult[]>,
) {
  return Mention.extend({
    name: "entityLink",
    addAttributes() {
      return {
        shortId: {
          default: null,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute("data-short-id"),
          renderHTML: (attrs: Record<string, unknown>) => ({
            "data-short-id": attrs.shortId,
          }),
        },
        label: {
          default: null,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute("data-label"),
          renderHTML: (attrs: Record<string, unknown>) => ({
            "data-label": attrs.label,
          }),
        },
      };
    },
    renderText({ node }) {
      return `#${node.attrs.label ?? node.attrs.shortId}`;
    },
    renderHTML({ node }) {
      return [
        "span",
        {
          "data-type": "entity-link",
          "data-short-id": node.attrs.shortId,
          "data-label": node.attrs.label,
        },
        `#${node.attrs.label ?? node.attrs.shortId}`,
      ];
    },
  }).configure({
    suggestion: {
      char: "#",
      items: async ({ query }) => {
        const results = await search(query);
        return results.map(
          (result): SuggestionItem => ({ id: result.id, label: result.label }),
        );
      },
      render: createSuggestionRender<SuggestionItem>(),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "entityLink",
              attrs: { shortId: props.id, label: props.label },
            },
            { type: "text", text: " " },
          ])
          .run();
      },
    },
  });
}
