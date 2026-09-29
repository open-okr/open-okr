"use client";

import { Kbd, useTheme, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { setAppearance } from "../../lib/appearance-action.ts";
import { paletteRelatedAction, paletteSearchAction } from "./actions.ts";
import {
  EMPTY_ANSWER,
  type PaletteAnswer,
  type PaletteCommand,
  type PaletteGroupId,
  type PaletteHit,
  type PaletteRow,
  paletteGroups,
} from "./palette-groups.ts";

/**
 * The command palette (UIUX-PLAN.md §3 and §4 S-32, P5-T13, completeness
 * review M-21).
 *
 * **⌘K opens it, Escape closes it, the arrows move and Enter opens.** That is
 * the whole contract, and it is a keyboard surface first: a palette somebody
 * has to reach for a pointer to use is a slower version of the search page.
 * Focus stays in the input the whole time, and the row the arrows are on is
 * named to assistive technology through `aria-activedescendant`, which is the
 * combobox pattern rather than a list of buttons to tab through.
 *
 * **Four groups** (`palette-groups.ts` says what each holds): Go to, which
 * jumps to a thing of any kind by its name or short code; the search results;
 * Related, only when an AI provider found something; and Actions, which run a
 * command or open a page and are all there is before anything is typed.
 *
 * **Every result is a link the server decided on.** The rows carry an `href`
 * from `search.entities`, `search.jump` and `search.query`, each filtered by
 * what the reader may open. The palette never queries anything itself and
 * cannot widen what it can see. The pages it offers come from the navigation
 * registry, filtered by the same level the sidebar is.
 *
 * **The snippet is emphasised by Postgres and rendered as text.** `ts_headline`
 * marks matches with `<b>`, and this splits on those markers and renders the
 * pieces rather than setting HTML: the words in it are typed by people, and a
 * snippet is not a place to start trusting them.
 */

/** A page the palette can open, as the shell's navigation lists it. */
export interface PaletteDestination {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Which part of the product it is in, which is what its hint says. */
  readonly area: "page" | "account" | "admin";
}

/** How long typing has to pause before the palette asks. */
const DEBOUNCE_MS = 150;

const GROUP_HEADING: Readonly<Record<PaletteGroupId, string>> = {
  goTo: "search.palette.groupGoTo",
  results: "search.palette.groupResults",
  related: "search.related",
  actions: "search.palette.groupActions",
};

const AREA_HINT: Readonly<Record<PaletteDestination["area"], string>> = {
  page: "search.palette.page",
  account: "search.palette.yourAccount",
  admin: "search.palette.adminSettings",
};

export function CommandPalette({
  destinations = [],
  canCreateObjective = false,
  semantic = false,
}: {
  readonly destinations?: readonly PaletteDestination[];
  /** Whether the reader may draft an objective, which the first command opens. */
  readonly canCreateObjective?: boolean;
  /**
   * Whether the workspace has an embedding model. Off means the Related group
   * is never asked for, so a provider-off workspace makes no request for it
   * at all. The server action checks again, because this is only a hint.
   */
  readonly semantic?: boolean;
}) {
  const { t } = useTranslations();
  const { resolvedTheme, setTheme } = useTheme();

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<PaletteAnswer>(EMPTY_ANSWER);
  const [related, setRelated] = useState<readonly PaletteHit[]>([]);
  const [pending, setPending] = useState(false);
  /** The request itself failed, as opposed to the server refusing it. */
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** Whatever had focus when the palette opened, so Escape can hand it back. */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  /**
   * Which request is current. An answer to an older phrase can arrive after
   * the answer to a newer one, and drawing it would show results for words
   * that are no longer in the box.
   */
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      // **Remember where focus came from, and put it back on close**
      // (P7-T05). A dialog opened by a shortcut has no trigger element for
      // the browser to return focus to, so closing it left
      // `document.activeElement` as `<body>`: the next Tab started again
      // from the top of the page, which for a keyboard user means walking
      // the whole navigation after every search. Found by
      // `s43b-accessibility-keyboard.spec.ts`, which is the class of defect
      // an axe scan cannot see at all.
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      input.current?.focus();
    } else {
      latest.current += 1;
      setText("");
      setAnswer(EMPTY_ANSWER);
      setRelated([]);
      setPending(false);
      setFailed(false);
      setActive(0);
      const previous = returnFocusTo.current;
      returnFocusTo.current = null;
      // Only if it is still on the page: a result that navigated away has
      // replaced it, and focusing a detached node silently does nothing.
      if (previous?.isConnected) {
        previous.focus();
      }
    }
  }, [open]);

  // Asked once typing pauses, and twice when there is a model: the fast
  // answer and the Related group separately, so a slow provider holds back
  // only its own group. Not keyed on `t`: the failure is a flag rather than a
  // translated sentence, so a new `t` from a server render cannot ask again.
  useEffect(() => {
    const phrase = text.trim();
    const request = ++latest.current;
    setActive(0);
    if (phrase === "") {
      setAnswer(EMPTY_ANSWER);
      setRelated([]);
      setPending(false);
      setFailed(false);
      return;
    }
    setPending(true);
    const timer = window.setTimeout(() => {
      paletteSearchAction(phrase)
        .then((found) => {
          if (request === latest.current) {
            setAnswer(found);
            setFailed(false);
            setActive(0);
          }
        })
        .catch(() => {
          if (request === latest.current) {
            setAnswer(EMPTY_ANSWER);
            setFailed(true);
          }
        })
        .finally(() => {
          if (request === latest.current) {
            setPending(false);
          }
        });
      if (!semantic) {
        return;
      }
      paletteRelatedAction(phrase)
        .then((found) => {
          if (request === latest.current) {
            setRelated(found);
          }
        })
        // No Related group is the answer a failure gets, which is what the
        // palette looks like with no provider.
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, semantic]);

  const commands = useMemo<readonly PaletteCommand[]>(() => {
    const phrase = text.trim();
    return [
      ...(canCreateObjective
        ? [
            {
              id: "new-objective",
              title: t("search.palette.newObjective"),
              hint: null,
              // The drafting phase of the cycle screen, at its form.
              href: "/cycle?phase=4#goal-title",
            },
          ]
        : []),
      {
        id: "switch-theme",
        title:
          resolvedTheme === "dark"
            ? t("search.palette.switchToLight")
            : t("search.palette.switchToDark"),
        hint: null,
        href: null,
      },
      ...(phrase === ""
        ? []
        : [
            {
              id: "search-everything",
              title: t("search.palette.searchFor", { phrase }),
              hint: null,
              href: `/search?q=${encodeURIComponent(phrase)}`,
            },
          ]),
      ...destinations.map((destination) => ({
        id: `page-${destination.id}`,
        title: destination.label,
        hint: t(AREA_HINT[destination.area]),
        href: destination.href,
      })),
    ];
  }, [canCreateObjective, destinations, resolvedTheme, t, text]);

  // The last answer stays on screen while the next one is asked, with the
  // Looking note beside it, rather than blanking the list on every letter.
  const groups = paletteGroups(text, answer, related, commands);
  const rows = groups.flatMap((group) => group.rows);
  const current = rows[Math.min(active, rows.length - 1)];
  const currentId = current?.id;

  useEffect(() => {
    if (currentId) {
      document
        .getElementById(`palette-${currentId}`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [currentId]);

  const run = (row: PaletteRow) => {
    if (row.command === "switch-theme") {
      const next = resolvedTheme === "dark" ? "light" : "dark";
      setTheme(next);
      // On the member as well, so the choice follows them to another machine
      // (P6-G23). The provider has already applied it here.
      void setAppearance({ theme: next });
      setOpen(false);
      return;
    }
    if (row.href) {
      setOpen(false);
      router.push(row.href);
    }
  };

  if (!open) {
    return null;
  }

  const phrase = text.trim();
  const error = failed ? t("search.palette.failed") : answer.error;
  // Whether anything but the actions answered the phrase.
  const found = groups.some((group) => group.id !== "actions");
  const note =
    phrase === ""
      ? t("search.palette.typeToSearch")
      : found
        ? null
        : pending
          ? t("search.palette.looking")
          : t("search.palette.nothingMatches");
  let index = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24">
      {/*
       * The backdrop is a button, because clicking it does something. A div
       * with a click handler is a control keyboard users cannot reach, and
       * Escape already closes this for them.
       */}
      <button
        type="button"
        aria-label={t("search.palette.closeTheSearch")}
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.palette.searchEverything")}
        data-testid="palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        {/*
         * The input keeps focus the whole time the palette is open, so its
         * ring is the rule under it turning brand rather than an outline that
         * would sit around the field for good. The row the arrows are on
         * carries its own outline below.
         */}
        <div className="flex items-center gap-2 border-line border-b-2 px-3 py-2 focus-within:border-brand">
          <input
            ref={input}
            value={text}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={rows.length > 0 ? "palette-listbox" : undefined}
            aria-activedescendant={
              current ? `palette-${current.id}` : undefined
            }
            aria-autocomplete="list"
            aria-label={t("search.palette.searchEverything")}
            placeholder={t("search.palette.searchOrTypeA")}
            maxLength={200}
            className="flex-1 bg-transparent text-sm text-ink outline-none"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((was) =>
                  rows.length === 0 ? 0 : (was + 1) % rows.length,
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((was) =>
                  rows.length === 0
                    ? 0
                    : (Math.min(was, rows.length - 1) - 1 + rows.length) %
                      rows.length,
                );
              }
              if (event.key === "Home" && rows.length > 0) {
                event.preventDefault();
                setActive(0);
              }
              if (event.key === "End" && rows.length > 0) {
                event.preventDefault();
                setActive(rows.length - 1);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (current) {
                  run(current);
                }
              }
              // The dialog is modal and the input is the one place focus
              // belongs in it, so Tab stays here rather than wandering to the
              // page underneath.
              if (event.key === "Tab") {
                event.preventDefault();
              }
            }}
          />
          <Kbd>{t("common.esc")}</Kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p role="alert" className="px-3 py-3 text-sm text-bad">
              {error}
            </p>
          ) : note ? (
            // Above the actions rather than instead of them: a phrase that
            // matched nothing still has somewhere to go, and says so first.
            <p role="status" className="px-3 pt-3 pb-1 text-sm text-ink-3">
              {note}
            </p>
          ) : null}

          {rows.length > 0 ? (
            <div
              id="palette-listbox"
              role="listbox"
              aria-label={t("search.palette.results")}
              aria-busy={pending}
              data-testid="palette-results"
              className="py-1"
            >
              {groups.map((group) => (
                // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls, and these are the options of a listbox, which the ARIA listbox pattern groups with the group role
                <div
                  key={group.id}
                  role="group"
                  aria-labelledby={`palette-group-${group.id}`}
                  data-testid={`palette-group-${group.id}`}
                >
                  {/*
                   * Presentation, as the grouped listbox pattern has it: the
                   * heading names the group through aria-labelledby and is
                   * not itself something the arrows can land on.
                   */}
                  <div
                    id={`palette-group-${group.id}`}
                    role="presentation"
                    className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-3 uppercase tracking-wide"
                  >
                    {t(GROUP_HEADING[group.id])}
                  </div>
                  {group.rows.map((row) => {
                    index += 1;
                    const position = index;
                    const selected = row.id === current?.id;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard drives this list from the input through aria-activedescendant, so an option never holds focus to receive a key
                      <div
                        key={row.id}
                        id={`palette-${row.id}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={selected}
                        data-testid="palette-option"
                        // Keeps focus in the input, so a click does not blur
                        // it and leave the arrows with nothing to drive.
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActive(position)}
                        onClick={() => run(row)}
                        className={
                          selected
                            ? "flex w-full cursor-pointer flex-col items-start gap-0.5 bg-brand-weak px-3 py-2 text-left outline-2 outline-brand -outline-offset-2"
                            : "flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left"
                        }
                      >
                        <span className="flex w-full items-baseline gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-ink">
                            {row.title}
                          </span>
                          {row.kind ? (
                            <span className="ml-auto shrink-0 text-xs text-ink-3">
                              {t(row.kind)}
                            </span>
                          ) : null}
                        </span>
                        {row.detail ? (
                          <span className="line-clamp-2 text-xs text-ink-3">
                            <Snippet text={row.detail} />
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-line border-t px-3 py-1.5 text-xs text-ink-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("search.palette.hintMove")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            {t("search.palette.hintOpen")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>{t("common.esc")}</Kbd>
            {t("search.palette.hintClose")}
          </span>
          {pending && found ? (
            <span role="status" className="ml-auto">
              {t("search.palette.looking")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * `ts_headline`'s emphasis, rendered as elements rather than as HTML.
 *
 * Postgres marks the matching words with `<b>` and `</b>`. Setting that as HTML
 * would be trusting a string built from words a person typed, so the markers
 * are split on and the pieces are rendered.
 */
export function Snippet({ text }: { readonly text: string }) {
  const parts = text.split(/<b>|<\/b>/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one split have no identity beyond their position, and the string is re-split whole on every render
          <mark key={index} className="bg-warn-bg text-warn">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
