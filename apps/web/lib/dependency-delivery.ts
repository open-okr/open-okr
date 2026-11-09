import type { MessageValues } from "@openokr/ui";

/**
 * How a register entry's providing key result reads (plan 0.7.0 O5, design
 * `key-result-dependencies.md` K7 and K8).
 *
 * One map, so the S-10 register, the S-14 rail and the S-23 log say the same
 * words. The state is a chip with words, never a colour alone. A hidden key
 * result names the team at most, and carries no chip: its state would tell
 * the reader something about a goal they cannot open.
 */

export interface ProviderKeyResult {
  readonly id: string;
  readonly title: string | null;
  readonly goalId: string | null;
  readonly goalTitle: string | null;
  readonly progressPct: number | null;
  readonly state: "delivered" | "pending" | "stopped" | "hidden";
}

type Translate = (key: string, values?: MessageValues) => string;

const STATE = {
  delivered: { key: "common.dependencyDelivery.delivered", tone: "ok" },
  pending: { key: "common.dependencyDelivery.pending", tone: "neutral" },
  stopped: { key: "common.dependencyDelivery.stopped", tone: "bad" },
} as const;

export interface DeliveryReading {
  /** What delivers it, as one sentence. */
  readonly line: string;
  /** Whether it has, for a reader who may know. */
  readonly chip: {
    readonly label: string;
    readonly tone: "ok" | "neutral" | "bad";
  } | null;
}

/**
 * `providerName` is the providing team, for the hidden case; a screen that
 * does not name the team passes null.
 */
export function deliveryReading(
  t: Translate,
  provider: ProviderKeyResult,
  providerName: string | null,
): DeliveryReading {
  if (provider.state === "hidden" || provider.title === null) {
    return {
      line: providerName
        ? t("common.dependencyDelivery.hidden", { provider: providerName })
        : t("common.dependencyDelivery.hiddenUnnamed"),
      chip: null,
    };
  }
  const state = STATE[provider.state];
  return {
    line: t("common.dependencyDelivery.named", { title: provider.title }),
    chip: { label: t(state.key), tone: state.tone },
  };
}
