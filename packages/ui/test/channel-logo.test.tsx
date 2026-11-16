import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ChannelLogo,
  type ChannelLogoChannel,
} from "../src/components/channel-logo.tsx";

const CHANNELS: readonly ChannelLogoChannel[] = [
  "app",
  "email",
  "slack",
  "teams",
  "whatsapp",
  "telegram",
];

describe("ChannelLogo", () => {
  it.each(CHANNELS)("%s renders a decorative svg", (channel) => {
    const { container } = render(<ChannelLogo channel={channel} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("muted adds grayscale, and unmuted does not", () => {
    const muted = render(<ChannelLogo channel="slack" muted />);
    expect(muted.container.firstElementChild?.className).toContain("grayscale");
    const plain = render(<ChannelLogo channel="slack" />);
    expect(plain.container.firstElementChild?.className).not.toContain(
      "grayscale",
    );
  });

  it("the small size uses the smaller badge", () => {
    const { container } = render(<ChannelLogo channel="email" size="sm" />);
    expect(container.firstElementChild?.className).toContain("size-7");
  });
});
