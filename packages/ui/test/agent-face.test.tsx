import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AgentFace } from "../src/components/agent-face.tsx";
import {
  AGENT_FACE_KINDS,
  AGENT_MOODS,
  agentFaceKind,
} from "../src/components/agent-face-kinds.ts";

const face = (container: HTMLElement) =>
  container.querySelector("svg.agent-face") as SVGSVGElement;

describe("AgentFace", () => {
  test("draws every kind in every mood", () => {
    for (const agent of AGENT_FACE_KINDS) {
      for (const mood of AGENT_MOODS) {
        const { container, unmount } = render(
          <AgentFace agent={agent} mood={mood} />,
        );
        const svg = face(container);
        expect(svg.dataset.agent).toBe(agent);
        expect(svg.dataset.mood).toBe(mood);
        expect(svg.querySelectorAll(".af-white")).toHaveLength(2);
        unmount();
      }
    }
  });

  test("is decorative unless it is given a name", () => {
    const { container } = render(<AgentFace agent="coach" />);
    expect(face(container).getAttribute("aria-hidden")).toBe("true");

    render(<AgentFace agent="champion" label="OKR Champion" />);
    expect(screen.getByRole("img", { name: "OKR Champion" })).toBeTruthy();
  });

  /**
   * The point of drawing it inline. The general face's ink is the text colour
   * and its eyes are the surface token, both of which `data-theme` repaints;
   * the Coach and the Champion keep their own colour and white eyes.
   */
  test("the general face follows the theme, the two agents keep their colour", () => {
    const general = face(render(<AgentFace />).container);
    expect(general.getAttribute("class")).not.toMatch(/text-\[#/);
    for (const white of general.querySelectorAll(".af-white")) {
      expect(white.getAttribute("class")).toContain("fill-surface");
    }

    const coach = face(render(<AgentFace agent="coach" />).container);
    expect(coach.getAttribute("class")).toContain("text-[#3a80ed]");
    const champion = face(render(<AgentFace agent="champion" />).container);
    expect(champion.getAttribute("class")).toContain("text-[#27a959]");
    for (const white of champion.querySelectorAll(".af-white")) {
      expect(white.getAttribute("class")).toContain("fill-white");
    }
  });

  test("only the moods with lids draw them, each face clipped to its own eyes", () => {
    const lidded = (mood: (typeof AGENT_MOODS)[number]) =>
      face(render(<AgentFace mood={mood} />).container).querySelectorAll(
        "[clip-path]",
      ).length;
    expect(lidded("happy")).toBe(2);
    expect(lidded("sad")).toBe(2);
    expect(lidded("sleeping")).toBe(2);
    expect(lidded("idle")).toBe(0);
    expect(lidded("thinking")).toBe(0);
    expect(lidded("surprised")).toBe(0);

    const { container } = render(
      <>
        <AgentFace mood="happy" />
        <AgentFace mood="happy" />
      </>,
    );
    const clips = [...container.querySelectorAll("clipPath")].map(
      (clip) => clip.id,
    );
    expect(new Set(clips).size).toBe(2);
    for (const id of clips) {
      expect(id).toMatch(/^[a-zA-Z0-9-]+$/);
    }
  });

  /**
   * UIUX-PLAN.md §2: motion on a state change, never on first paint. A list
   * of twenty run rows that all hopped as the page loaded is what this
   * prevents.
   */
  test("is still on first paint and plays when its mood changes", () => {
    const { container, rerender } = render(<AgentFace mood="thinking" />);
    expect(face(container).dataset.playing).toBeUndefined();

    rerender(<AgentFace mood="happy" />);
    expect(face(container).dataset.playing).toBe("");

    // Settling back to idle is calm.
    rerender(<AgentFace mood="idle" />);
    expect(face(container).dataset.playing).toBeUndefined();
  });

  test("a live face loops rather than playing once", () => {
    const { container, rerender } = render(<AgentFace mood="idle" live />);
    expect(face(container).dataset.live).toBe("");

    rerender(<AgentFace mood="thinking" live />);
    expect(face(container).dataset.live).toBe("");
    expect(face(container).dataset.playing).toBeUndefined();
  });

  test("a played mood can be hovered into playing again once it ends", () => {
    const { container, rerender } = render(<AgentFace mood="idle" />);
    rerender(<AgentFace mood="happy" />);
    const svg = face(container);
    expect(svg.dataset.playing).toBe("");

    // The eyes' bob ends with the hop, so only the hop clears it.
    //
    // jsdom has no `AnimationEvent`, so React listens for the prefixed name
    // there; a browser sends `animationend` and React hears that instead.
    const ended = (animationName: string) => {
      const event = new Event("webkitAnimationEnd", { bubbles: true });
      Object.assign(event, { animationName });
      act(() => {
        svg.querySelector(".af-head")?.dispatchEvent(event);
      });
    };
    ended("af-bob");
    expect(face(container).dataset.playing).toBe("");
    ended("af-hop");
    expect(face(container).dataset.playing).toBeUndefined();
  });

  test("a custom agent, or any kind added later, wears the general face", () => {
    expect(agentFaceKind("coach")).toBe("coach");
    expect(agentFaceKind("champion")).toBe("champion");
    expect(agentFaceKind("custom")).toBe("agent");
    expect(agentFaceKind("something-new")).toBe("agent");
  });
});
