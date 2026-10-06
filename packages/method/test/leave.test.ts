import { describe, expect, it } from "vitest";
import {
  DELEGATED_TRIGGERS,
  type Leave,
  leaveOn,
  standInFor,
} from "../src/leave.ts";
import { suppressionFor } from "../src/suppression.ts";
import { canonThresholds } from "../src/thresholds.ts";
import { TRIGGER_CATALOGUE } from "../src/triggers.ts";

/**
 * §7.4: a member marks their own leave, with a delegate (P9-T19b-b). Sara is
 * away from 23 to 27 August 2026 with Amara standing in (NW-Q3-06).
 */
const SARA: Leave = {
  memberId: "sara",
  startsOn: "2026-08-23",
  endsOn: "2026-08-27",
  delegateId: "amara",
};

describe("who is away", () => {
  it("is the member on any day of their leave, both ends included", () => {
    expect(leaveOn("sara", "2026-08-23", [SARA])).toBe(SARA);
    expect(leaveOn("sara", "2026-08-27", [SARA])).toBe(SARA);
    expect(leaveOn("sara", "2026-08-28", [SARA])).toBeNull();
    expect(leaveOn("amara", "2026-08-24", [SARA])).toBeNull();
  });
});

describe("who stands in", () => {
  it("is the delegate while the member is away, and the member otherwise (acceptance)", () => {
    expect(standInFor("sara", "2026-08-24", [SARA])).toBe("amara");
    expect(standInFor("sara", "2026-08-30", [SARA])).toBe("sara");
  });

  it("follows a delegate who is away as well", () => {
    const amara: Leave = {
      memberId: "amara",
      startsOn: "2026-08-24",
      endsOn: "2026-08-25",
      delegateId: "kofi",
    };
    expect(standInFor("sara", "2026-08-24", [SARA, amara])).toBe("kofi");
    expect(standInFor("sara", "2026-08-26", [SARA, amara])).toBe("amara");
  });

  it("is nobody when the chain comes back round", () => {
    const amara: Leave = {
      memberId: "amara",
      startsOn: "2026-08-20",
      endsOn: "2026-08-30",
      delegateId: "sara",
    };
    expect(standInFor("sara", "2026-08-24", [SARA, amara])).toBeNull();
  });
});

describe("what the delegate takes over", () => {
  it("is the check-ins and the acknowledgements, all of them rules the catalogue defines", () => {
    const keys = TRIGGER_CATALOGUE.map((entry) => entry.key);
    for (const key of DELEGATED_TRIGGERS) {
      expect(keys).toContain(key);
    }
    expect(DELEGATED_TRIGGERS).toContain("checkin.due");
    expect(DELEGATED_TRIGGERS).toContain("ack.owed");
    expect(DELEGATED_TRIGGERS).not.toContain("digest.daily");
  });

  it("holds what is not passed on, with the reason leave", () => {
    const base = {
      ruleKey: "digest.daily",
      escalationStep: 0,
      urgent: false,
      ruleEnabled: true,
      quietModeExempt: false,
      workspaceQuietMode: false,
      previous: null,
      localTime: { hour: 10, minute: 0 },
      quietHours: null,
      snoozedUntilHoursAway: null,
      sentThisWeek: 0,
    } as const;
    expect(suppressionFor({ ...base, onLeave: true }, canonThresholds())).toBe(
      "leave",
    );
    expect(suppressionFor(base, canonThresholds())).toBeNull();
  });
});
