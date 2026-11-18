import { describe, expect, it } from "vitest";
import { fromWireName, toWireName } from "../src/drivers/ai/tool-names.ts";

describe("tool wire names", () => {
  it("replaces dots, which providers reject", () => {
    expect(toWireName("goals.read")).toBe("goals_read");
    expect(toWireName("get_weather")).toBe("get_weather");
  });

  it("maps a wire name back by lookup against the offered tools", () => {
    const tools = [{ name: "goals.read" }, { name: "kpis.list" }];
    expect(fromWireName("kpis_list", tools)).toBe("kpis.list");
    expect(fromWireName("unknown_tool", tools)).toBe("unknown_tool");
  });
});
