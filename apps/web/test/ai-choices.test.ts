import { describe, expect, it } from "vitest";
import {
  budgetOwnerFrom,
  budgetOwnerValue,
  tierModelFrom,
  tierModelValue,
} from "../app/admin/ai/choices.ts";

/**
 * One picker where there were a select and a pasted id (guided-inputs
 * §4.10): whose a budget is, and which model a tier routes to. The choice
 * carries what the select used to say, so the save reads both from it.
 */
describe("whose budget", () => {
  it("is the whole workspace when nobody is chosen", () => {
    expect(budgetOwnerFrom("")).toEqual({ scope: "workspace", scopeRef: null });
  });

  it("is a person or an agent, read from the choice", () => {
    const id = "01a0b0c0-0000-7000-8000-000000000001";
    expect(budgetOwnerFrom(budgetOwnerValue("user", id))).toEqual({
      scope: "user",
      scopeRef: id,
    });
    expect(budgetOwnerFrom(budgetOwnerValue("agent", id))).toEqual({
      scope: "agent",
      scopeRef: id,
    });
  });

  it("is nothing for a value the picker never offers", () => {
    expect(budgetOwnerFrom("team:abc")).toBeNull();
    expect(budgetOwnerFrom("user:")).toBeNull();
  });
});

describe("which model", () => {
  it("names its provider, and keeps a model id that holds a colon", () => {
    expect(tierModelFrom(tierModelValue("ollama", "llama3:8b"))).toEqual({
      provider: "ollama",
      modelId: "llama3:8b",
    });
  });

  it("is nothing without both halves", () => {
    expect(tierModelFrom("")).toBeNull();
    expect(tierModelFrom("anthropic:")).toBeNull();
  });
});
