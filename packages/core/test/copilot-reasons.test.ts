/**
 * Why the copilot did not answer, as codes (plan 0.9.0 CP10).
 *
 * Pure: no database. What is stored in `run_halted_reason` is the JSON of a
 * code, and a row written before the codes holds an English sentence, which
 * must read back as the same sentence with no code.
 */
import { describe, expect, it } from "vitest";
import { AI_OFF_REASONS, aiOffSentence } from "../src/ai/off-reason.ts";
import {
  aiOffReason,
  COPILOT_REASON_CODES,
  type CopilotReason,
  decodeReason,
  encodeReason,
  eventReasonFields,
  reasonSentence,
  storedReasonFields,
} from "../src/copilot/reasons.ts";

const EVERY: readonly CopilotReason[] = [
  { code: "ai_off", params: { offReason: "egress_blocked" } },
  { code: "unavailable" },
  { code: "provider_error" },
  { code: "nothing_to_add" },
  { code: "stopped_partway" },
  { code: "cost_cap_before", params: { cap: "0" } },
  { code: "cost_cap_after", params: { spent: "0.02", cap: "0.01" } },
  { code: "could_not_answer" },
];

describe("copilot reason codes", () => {
  it("has a case in this test for every code", () => {
    expect(EVERY.map((one) => one.code).sort()).toEqual(
      [...COPILOT_REASON_CODES].sort(),
    );
  });

  it("round-trips every reason through the stored text", () => {
    for (const reason of EVERY) {
      expect(decodeReason(encodeReason(reason))).toEqual(reason);
    }
  });

  it("reads an old English sentence, junk and a null as no code", () => {
    expect(
      decodeReason(
        "The provider stopped partway through this answer. What arrived is kept.",
      ),
    ).toBeNull();
    expect(decodeReason("{not json")).toBeNull();
    expect(decodeReason("12")).toBeNull();
    expect(decodeReason('{"code":"made_up"}')).toBeNull();
    expect(
      decodeReason('{"code":"ai_off","params":{"offReason":3}}'),
    ).toBeNull();
    expect(decodeReason(null)).toBeNull();
  });

  it("keeps the English sentence each place showed before", () => {
    for (const offReason of AI_OFF_REASONS) {
      for (const where of ["panel", "answer"] as const) {
        expect(reasonSentence(aiOffReason(offReason), where)).toBe(
          aiOffSentence(offReason, where),
        );
      }
    }
    expect(
      reasonSentence({ code: "cost_cap_before", params: { cap: "0" } }),
    ).toBe(
      "Halted before starting: the cost cap for this workspace is 0, so a run may not spend. An administrator sets it in AI governance.",
    );
    expect(
      reasonSentence({
        code: "cost_cap_after",
        params: { spent: "0.02", cap: "0.01" },
      }),
    ).toBe(
      "This answer cost 0.02 and the cap for this workspace is 0.01. The next run will halt before starting until an administrator raises it.",
    );
  });

  it("gives a thread the sentence and the code for a coded row", () => {
    expect(
      storedReasonFields(encodeReason({ code: "nothing_to_add" })),
    ).toEqual({
      haltedReason:
        "The copilot had nothing to add. These are the passages that match your question.",
      haltedCode: "nothing_to_add",
      haltedParams: null,
    });
  });

  it("passes an old row's text through unchanged", () => {
    expect(
      storedReasonFields("This workspace has reached its AI budget (3 of 2)."),
    ).toEqual({
      haltedReason: "This workspace has reached its AI budget (3 of 2).",
      haltedCode: null,
      haltedParams: null,
    });
    expect(storedReasonFields(null)).toEqual({
      haltedReason: null,
      haltedCode: null,
      haltedParams: null,
    });
  });

  it("reads the code off a realtime event only when it has the right shape", () => {
    expect(
      eventReasonFields({
        haltedCode: "ai_off",
        haltedParams: { offReason: "x" },
      }),
    ).toEqual({ code: "ai_off", params: { offReason: "x" } });
    expect(
      eventReasonFields({ haltedCode: "unavailable", haltedParams: 4 }),
    ).toEqual({
      code: "unavailable",
    });
    expect(eventReasonFields({ haltedCode: null })).toEqual({});
    expect(eventReasonFields({})).toEqual({});
  });
});
