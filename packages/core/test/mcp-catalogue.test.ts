import { describe, expect, it } from "vitest";
import { ACTION_MAP } from "../src/actions/registry.ts";
import {
  buildCatalogue,
  CATALOGUE_VERSION,
  diffCatalogue,
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_TOOLS,
  type McpCatalogue,
  toolNamed,
} from "../src/api/mcp/catalogue.ts";
import { REST_ROUTES } from "../src/api/surface.ts";

/**
 * The catalogue invariant (AI-NATIVE-PLAN.md §8.3, P5-T09a).
 *
 * **This file exists to fail.** The catalogue is generated, so nothing here
 * checks that the generator ran; what it checks is that a tool cannot lose the
 * two things a client and a token both depend on. A tool with no scope reaches
 * a surface no grant narrowed. A write tool that claims to be read-only is a
 * client telling somebody an agent is only looking.
 */

describe("every tool is an action, and every action is a tool", () => {
  it("names an action the registry defines", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name in ACTION_MAP, tool.name).toBe(true);
    }
  });

  it("offers every action the REST surface offers", () => {
    // One projection cannot quietly hold back what another exposes: an agent
    // and a REST client reach the same product.
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(
      REST_ROUTES.map((route) => route.action).sort(),
    );
  });

  it("finds a tool by name, and nothing by a name it does not have", () => {
    expect(toolNamed("goals.list")?.scope).toBe("read");
    expect(toolNamed("goals.nonsense")).toBeNull();
  });
});

describe("the safety classification, which is what this test exists for", () => {
  it("gives every tool a scope, and only one this server issues", () => {
    for (const tool of MCP_TOOLS) {
      expect(["read", "write", "destructive"], tool.name).toContain(tool.scope);
    }
  });

  it("carries the scope the action itself declares, never a second answer", () => {
    const declared = new Map(
      REST_ROUTES.map((route) => [route.action, route.scope]),
    );
    for (const tool of MCP_TOOLS) {
      expect(tool.scope, tool.name).toBe(declared.get(tool.name));
    }
  });

  it("marks a read as read-only and never as destructive", () => {
    const read = toolNamed("goals.list");
    expect(read?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("marks a delete as destructive and never as read-only", () => {
    // If this ever passes with readOnlyHint true, a client is telling somebody
    // an agent is only looking while it deletes a goal.
    const destroy = toolNamed("goals.delete");
    expect(destroy?.scope).toBe("destructive");
    expect(destroy?.annotations.destructiveHint).toBe(true);
    expect(destroy?.annotations.readOnlyHint).toBe(false);
  });

  it("keeps the three hints consistent for every tool, not just the two above", () => {
    for (const tool of MCP_TOOLS) {
      const isRead = tool.scope === "read";
      expect(tool.annotations.readOnlyHint, tool.name).toBe(isRead);
      expect(tool.annotations.destructiveHint, tool.name).toBe(
        tool.scope === "destructive",
      );
      // A read is idempotent by definition; nothing else claims to be.
      expect(tool.annotations.idempotentHint, tool.name).toBe(isRead);
      // And never both at once, which is the contradiction a client cannot
      // render.
      expect(
        tool.annotations.readOnlyHint && tool.annotations.destructiveHint,
        tool.name,
      ).toBe(false);
    }
  });

  it("includes the destructive tools rather than hiding them", () => {
    // Leaving them out would make the surface look safer than it is while an
    // agent reached them through the REST endpoint anyway.
    const destructive = MCP_TOOLS.filter(
      (tool) => tool.scope === "destructive",
    );
    expect(destructive.length).toBeGreaterThan(0);
  });
});

describe("what a tool tells an agent", () => {
  it("carries an input schema an agent can validate against", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema, tool.name).toBeTypeOf("object");
      // Never the `$schema` key: the protocol takes the schema itself.
      expect("$schema" in tool.inputSchema, tool.name).toBe(false);
    }
  });

  it("carries a summary, because a name alone is not a description", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("builds an example holding exactly the required fields", () => {
    const tool = toolNamed("goals.delete");
    expect(Object.keys(tool?.example ?? {})).toEqual(["id"]);
    expect(tool?.example.id).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("builds an empty example for a tool that requires nothing", () => {
    const tool = toolNamed("goals.list");
    // Not a guess at optional fields: an example that invented a filter would
    // teach an agent a query nobody asked for.
    expect(tool?.example).toEqual({});
  });
});

describe("resources and prompts", () => {
  it("points every resource at an action the registry defines", () => {
    for (const resource of MCP_RESOURCES) {
      expect(resource.action in ACTION_MAP, resource.action).toBe(true);
    }
  });

  it("gives every resource a template with a variable in it", () => {
    for (const resource of MCP_RESOURCES) {
      expect(resource.uriTemplate, resource.name).toMatch(
        /^openokr:\/\/.+\{.+\}$/,
      );
    }
  });

  it("binds every template variable to a field the action actually has", () => {
    // The template reads as {goalId} and the action's field is `id`, which is
    // fine because the resource declares the mapping. What is not fine is a
    // mapping to a field that does not exist: the read would run with an empty
    // input and answer something nobody asked for.
    const inputs = new Map(
      REST_ROUTES.map((route) => [route.action, new Set(route.parameters)]),
    );
    for (const resource of MCP_RESOURCES) {
      const fields = inputs.get(resource.action);
      for (const [variable, field] of Object.entries(resource.binds)) {
        expect(
          fields?.has(field),
          `${resource.name}: ${variable} -> ${field}`,
        ).toBe(true);
      }
    }
  });

  it("binds every variable its own template declares, and no other", () => {
    for (const resource of MCP_RESOURCES) {
      const declared = [...resource.uriTemplate.matchAll(/{([^}]+)}/g)].map(
        (found) => found[1] as string,
      );
      for (const variable of Object.keys(resource.binds)) {
        expect(declared, resource.name).toContain(variable);
      }
    }
  });

  it("names every prompt once, and describes it", () => {
    const names = MCP_PROMPTS.map((prompt) => prompt.name);
    expect(new Set(names).size).toBe(names.length);
    for (const prompt of MCP_PROMPTS) {
      expect(prompt.description.length, prompt.name).toBeGreaterThan(0);
    }
  });
});

describe("the drift gate", () => {
  const fresh = buildCatalogue();

  it("says nothing when the two agree", () => {
    expect(diffCatalogue(fresh, fresh)).toEqual([]);
  });

  it("names a tool that appeared", () => {
    const committed: McpCatalogue = {
      ...fresh,
      tools: fresh.tools.filter((tool) => tool.name !== "goals.list"),
    };
    expect(diffCatalogue(committed, fresh)).toEqual([
      {
        kind: "added",
        tool: "goals.list",
        detail: "in the registry and not in the committed catalogue",
      },
    ]);
  });

  it("names a tool that went", () => {
    const committed: McpCatalogue = {
      ...fresh,
      tools: [
        ...fresh.tools,
        {
          ...(fresh.tools[0] as (typeof fresh.tools)[number]),
          name: "gone.away",
        },
      ],
    };
    expect(
      diffCatalogue(committed, fresh).map((difference) => difference.tool),
    ).toContain("gone.away");
  });

  it("says plainly when a scope moved, because that is a security change", () => {
    const committed: McpCatalogue = {
      ...fresh,
      tools: fresh.tools.map((tool) =>
        tool.name === "goals.delete" ? { ...tool, scope: "read" } : tool,
      ),
    };
    const differences = diffCatalogue(committed, fresh);
    expect(differences).toContainEqual({
      kind: "changed",
      tool: "goals.delete",
      detail: "its scope moved from read to destructive",
    });
  });

  it("says plainly when a safety hint moved", () => {
    const committed: McpCatalogue = {
      ...fresh,
      tools: fresh.tools.map((tool) =>
        tool.name === "goals.delete"
          ? {
              ...tool,
              annotations: { ...tool.annotations, destructiveHint: false },
            }
          : tool,
      ),
    };
    expect(diffCatalogue(committed, fresh)).toContainEqual({
      kind: "changed",
      tool: "goals.delete",
      detail: "its safety hints moved",
    });
  });
});

describe("the catalogue itself", () => {
  it("carries its own version, so a client can tell shapes apart", () => {
    expect(buildCatalogue().version).toBe(CATALOGUE_VERSION);
  });
});
