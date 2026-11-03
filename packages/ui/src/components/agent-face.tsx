"use client";

import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { cn } from "../lib/cn.ts";
import type { AgentFaceKind, AgentMood } from "./agent-face-kinds.ts";

/**
 * The face an agent wears (docs/design/agent-faces.md).
 *
 * Three kinds: the general agent, which is the copilot and any custom agent,
 * in the text colour around it; the OKR Coach in blue; the OKR Champion in
 * green. Six moods, each a still pose with a short animation behind it.
 *
 * **Drawn inline rather than loaded as a file.** An `<img>` of an SVG sees
 * the operating system's colour scheme and never the product's own theme
 * switch, so the general face would stay dark on a dark page whenever the
 * two disagreed. Inline, its ink is `currentColor` and its eyes are
 * `--surface`, which follow `data-theme` like every other component. The
 * motion lives in `styles/agent-face.css` because the content security
 * policy refuses an inline `<style>`.
 *
 * **Idle blinks; the rest wait for a reason** (UIUX-PLAN.md §2, Motion). An
 * idle face blinks and glances on the drawing's own loop. Every other mood
 * is still on first paint, plays when the mood changes after it appeared,
 * which is a state change, and when the row, link or button holding it is
 * hovered or focused. `live` loops it, and is for an agent that is working
 * right now: that is the ambient motion §2 reserves for live meaning.
 */

/**
 * The general face takes the text colour, so it sits in a navigation row or
 * a button the way a Lucide icon does. The Coach and the Champion keep their
 * own colour in both themes, with white eyes, as they are drawn.
 */
const KIND_CLASS: Record<AgentFaceKind, { face: string; eyes: string }> = {
  agent: { face: "", eyes: "fill-surface" },
  coach: { face: "text-[#3a80ed]", eyes: "fill-white" },
  champion: { face: "text-[#27a959]", eyes: "fill-white" },
};

interface Eyes {
  /** Each eye's centre on the 240-unit grid the faces are drawn on. */
  readonly left: number;
  readonly right: number;
  readonly rx: number;
  readonly ry: number;
  /** Lids in the head's colour, clipped to the eye, for a mood that has them. */
  readonly lids?: (side: "left" | "right") => ReactNode;
}

const PLAIN: Eyes = { left: 86, right: 154, rx: 27, ry: 29 };

const EYES: Record<AgentMood, Eyes> = {
  idle: PLAIN,
  thinking: PLAIN,
  // The lower half covered, which is a smile with the eyes.
  happy: {
    left: 86,
    right: 154,
    rx: 29,
    ry: 29,
    lids: () => <rect x="-70" y="0" width="140" height="90" />,
  },
  // The upper lids tilted down towards the outside.
  sad: {
    left: 86,
    right: 154,
    rx: 29,
    ry: 29,
    lids: (side) => (
      <rect
        x="-70"
        y="-95"
        width="140"
        height="90"
        transform={`rotate(${side === "left" ? -16 : 16} 0 -5)`}
      />
    ),
  },
  sleeping: {
    left: 86,
    right: 154,
    rx: 29,
    ry: 28,
    lids: () => (
      <>
        <rect x="-70" y="-83" width="140" height="90" />
        <rect x="-70" y="14" width="140" height="90" />
      </>
    ),
  },
  surprised: { left: 82.6, right: 157.4, rx: 34, ry: 34 },
};

/**
 * The animation that ends a mood's play, so the face can be hovered into
 * playing again afterwards. The others in a mood end with it or before it.
 */
const LAST_ANIMATION: Record<AgentMood, string> = {
  idle: "af-look",
  thinking: "af-ponder",
  happy: "af-hop",
  sad: "af-droop",
  surprised: "af-swell",
  sleeping: "af-breathe",
};

/** A stable number from a string, for a face's start in its idle loop. */
function phaseOf(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const HEAD =
  "M120 35.4 L132 35.4 138.7 35.6 144.1 35.8 148.9 36.1 153.3 36.5 157.3 37.1 161.1 37.7 164.6 38.4 167.9 39.1 171.1 40 174.1 41 176.9 42 179.7 43.2 182.2 44.5 184.7 45.8 187.1 47.2 189.3 48.8 191.5 50.4 193.5 52.1 195.4 54 197.3 55.9 199 57.9 200.6 60.1 202.2 62.3 203.6 64.7 204.9 67.2 206.2 69.7 207.4 72.5 208.4 75.3 209.4 78.3 210.3 81.5 211 84.8 211.7 88.3 212.3 92.1 212.9 96.1 213.3 100.5 213.6 105.3 213.8 110.7 214 114.6 214 120 214 125.4 213.8 129.3 213.6 134.7 213.3 139.5 212.9 143.9 212.3 147.9 211.7 151.7 211 155.2 210.3 158.5 209.4 161.7 208.4 164.7 207.4 167.5 206.2 170.3 204.9 172.8 203.6 175.3 202.2 177.7 200.6 179.9 199 182.1 197.3 184.1 195.4 186 193.5 187.9 191.5 189.6 189.3 191.2 187.1 192.8 184.7 194.2 182.2 195.5 179.7 196.8 176.9 198 174.1 199 171.1 200 167.9 200.9 164.6 201.6 161.1 202.3 157.3 202.9 153.3 203.5 148.9 203.9 144.1 204.2 138.7 204.4 132 204.6 120 204.6 108 204.6 101.3 204.4 95.9 204.2 91.1 203.9 86.7 203.5 82.7 202.9 78.9 202.3 75.4 201.6 72.1 200.9 68.9 200 65.9 199 63.1 198 60.3 196.8 57.8 195.5 55.3 194.2 52.9 192.8 50.7 191.2 48.5 189.6 46.5 187.9 44.6 186 42.7 184.1 41 182.1 39.4 179.9 37.8 177.7 36.4 175.3 35.1 172.8 33.8 170.3 32.6 167.5 31.6 164.7 30.6 161.7 29.7 158.5 29 155.2 28.3 151.7 27.7 147.9 27.1 143.9 26.7 139.5 26.4 134.7 26.2 129.3 26 125.4 26 120 26 114.6 26.2 110.7 26.4 105.3 26.7 100.5 27.1 96.1 27.7 92.1 28.3 88.3 29 84.8 29.7 81.5 30.6 78.3 31.6 75.3 32.6 72.5 33.8 69.7 35.1 67.2 36.4 64.7 37.8 62.3 39.4 60.1 41 57.9 42.7 55.9 44.6 54 46.5 52.1 48.5 50.4 50.7 48.8 52.9 47.2 55.3 45.8 57.8 44.5 60.3 43.2 63.1 42 65.9 41 68.9 40 72.1 39.1 75.4 38.4 78.9 37.7 82.7 37.1 86.7 36.5 91.1 36.1 95.9 35.8 101.3 35.6 108 35.4Z";

export interface AgentFaceProps {
  readonly agent?: AgentFaceKind;
  readonly mood?: AgentMood;
  /** The agent is working right now, so the mood loops until it stops. */
  readonly live?: boolean;
  /**
   * What a screen reader hears. Left out, the face is decorative, which is
   * right wherever the agent's name is already written beside it.
   */
  readonly label?: string;
  readonly className?: string;
}

export function AgentFace({
  agent = "agent",
  mood = "idle",
  live = false,
  label,
  className,
}: AgentFaceProps) {
  // `useId` returns colons and guillemets, which a `url(#...)` reference
  // does not survive. One clip per face, so two faces never share one.
  const id = useId();
  const clip = `af${id.replace(/[^a-zA-Z0-9-]/g, "")}`;
  // Where in the idle loop this face starts, so a list of them does not
  // blink in unison. From the id rather than at random, so the server and
  // the browser agree and hydration does not see two different styles.
  const phase = `${-(phaseOf(id) % 4600) / 1000}s`;

  // A mood that differs from the one last drawn is a state change, so it
  // plays, and the round remounts the parts so it plays from its start.
  // Idle needs no play: it is always on its own loop.
  const [drawn, setDrawn] = useState(mood);
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState(false);
  if (drawn !== mood) {
    setDrawn(mood);
    setRound(round + 1);
    setPlaying(mood !== "idle");
  }

  const eyes = EYES[mood];
  const colours = KIND_CLASS[agent];

  const eye = (side: "left" | "right") => (
    <g transform={`translate(${eyes[side]} 126)`}>
      <g className={`af-eye af-eye-${side}`}>
        <ellipse
          className={cn("af-white", colours.eyes)}
          rx={eyes.rx}
          ry={eyes.ry}
        />
        {eyes.lids ? (
          <g clipPath={`url(#${clip})`} className="fill-current">
            {eyes.lids(side)}
          </g>
        ) : null}
      </g>
    </g>
  );

  return (
    <svg
      viewBox="8 -12 224 224"
      className={cn("agent-face size-6 shrink-0", colours.face, className)}
      data-agent={agent}
      data-mood={mood}
      data-live={live ? "" : undefined}
      data-playing={playing && !live ? "" : undefined}
      style={{ "--af-phase": phase } as CSSProperties}
      onAnimationEnd={(event) => {
        if (event.animationName === LAST_ANIMATION[mood]) {
          setPlaying(false);
        }
      }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    >
      <defs>
        <clipPath id={clip}>
          <rect x="-40" y="-54" width="80" height="108" />
        </clipPath>
      </defs>
      <g transform={mood === "sleeping" ? "translate(0 4)" : undefined}>
        <g key={round} className="af-head">
          {/* Invisible, and it is the head's box: the swell scales about
              the middle of the grid rather than the middle of the ink. */}
          <rect width="240" height="240" fill="none" />
          <circle className="fill-current" cx="120" cy="12" r="15" />
          <path className="fill-current" d={HEAD} />
          {eye("left")}
          {eye("right")}
        </g>
      </g>
    </svg>
  );
}
