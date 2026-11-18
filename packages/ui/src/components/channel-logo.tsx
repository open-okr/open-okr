/**
 * A channel's badge: a square tile with the channel's mark inside, drawn
 * beside a channel name so a member finds Slack or Email by its mark first.
 *
 * Brand paths are from Simple Icons 13.21.0 (CC0-1.0), copied inline because
 * the product is air-gapped and takes no new dependency. The Teams glyph is
 * drawn for the product because Simple Icons no longer carries Microsoft
 * marks. Brand marks only identify the integration. The app and email marks
 * are lucide's own Bell and Mail.
 *
 * Server-safe: no state and no hooks. The mark is decorative (`aria-hidden`),
 * so the name beside it is what a screen reader reads. `muted` is for a
 * channel that cannot be picked yet.
 */

import { Bell, Mail } from "lucide-react";
import { cn } from "../lib/cn.ts";

export type ChannelLogoChannel =
  | "app"
  | "email"
  | "slack"
  | "teams"
  | "whatsapp"
  | "telegram";

export interface ChannelLogoProps {
  readonly channel: ChannelLogoChannel;
  readonly size?: "md" | "sm";
  readonly muted?: boolean;
  readonly className?: string;
}

function Mark({
  channel,
  px,
  brand,
}: {
  readonly channel: ChannelLogoChannel;
  readonly px: number;
  readonly brand: number;
}) {
  switch (channel) {
    case "app":
      return <Bell size={px} strokeWidth={2} aria-hidden="true" />;
    case "email":
      return <Mail size={px} strokeWidth={2} aria-hidden="true" />;
    case "slack":
      return (
        <svg
          viewBox="0 0 24 24"
          width={brand}
          height={brand}
          aria-hidden="true"
        >
          <path
            fill="#E01E5A"
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z"
          />
          <path
            fill="#E01E5A"
            d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          />
          <path
            fill="#36C5F0"
            d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z"
          />
          <path
            fill="#36C5F0"
            d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          />
          <path
            fill="#2EB67D"
            d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z"
          />
          <path
            fill="#2EB67D"
            d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          />
          <path
            fill="#ECB22E"
            d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z"
          />
          <path
            fill="#ECB22E"
            d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
          />
        </svg>
      );
    case "teams":
      return (
        <svg
          viewBox="0 0 24 24"
          width={brand}
          height={brand}
          aria-hidden="true"
        >
          <circle cx="18.5" cy="6.5" r="2.5" fill="#7B83EB" />
          <rect x="14" y="10" width="9" height="9" rx="2.5" fill="#7B83EB" />
          <circle cx="11" cy="5" r="3" fill="#5059C9" />
          <rect x="1" y="7" width="15" height="14" rx="2.5" fill="#5059C9" />
          <path d="M5 10.5h7v1.8H9.4V18H7.6v-5.7H5z" fill="#fff" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg
          viewBox="0 0 24 24"
          width={brand}
          height={brand}
          fill="#25D366"
          aria-hidden="true"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      );
    case "telegram":
      return (
        <svg
          viewBox="0 0 24 24"
          width={brand}
          height={brand}
          fill="#26A5E4"
          aria-hidden="true"
        >
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
  }
}

export function ChannelLogo({
  channel,
  size = "md",
  muted = false,
  className,
}: ChannelLogoProps) {
  const small = size === "sm";
  return (
    <span
      data-channel={channel}
      className={cn(
        "grid flex-none place-items-center rounded-control border border-line bg-surface",
        small ? "size-7" : "size-8",
        channel === "app" && "border-brand-line bg-brand-weak text-brand-text",
        channel === "email" && "bg-raised text-ink-2",
        muted && "grayscale opacity-70",
        className,
      )}
    >
      <Mark channel={channel} px={small ? 16 : 18} brand={small ? 16 : 20} />
    </span>
  );
}
