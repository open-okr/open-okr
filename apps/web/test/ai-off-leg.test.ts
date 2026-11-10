import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { P0_FLOWS, p0SpecFiles } from "../../../e2e/p0-flows.ts";

/**
 * The AI-off leg's wiring (PLAN.md §9, AI-NATIVE-PLAN §10, release 0.7.0 A12,
 * `docs/design/ai-off-leg.md`).
 *
 * The end-to-end job is the leg: it boots with no AI provider and runs every
 * P0 flow, and `e2e/ai-off.spec.ts` proves at run time that the instance has
 * no provider and that no screen draws an AI affordance. What is checked here
 * is what that spec cannot see from inside the run: that the boot cannot pick
 * a provider up from the runner's environment, that the workflow hands it
 * none, and that the P0 list names files that exist and run.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const E2E = fileURLToPath(new URL("../../../e2e/", import.meta.url));
const config = at("../../../playwright.config.ts");
const workflow = at("../../../.github/workflows/ci.yml");

/** The three variables a deployment-wide provider is configured with. */
const DEPLOYMENT_AI = [
  "OPENOKR_AI_PROVIDER",
  "OPENOKR_AI_API_KEY",
  "OPENOKR_AI_BASE_URL",
];

describe("the leg boots with AI off", () => {
  test("both servers start with every deployment AI variable empty", () => {
    // Playwright lays a server's `env` over the runner's own, so a variable
    // exported in the shell or set on the job would otherwise reach the
    // instance. Empty is "unset" to the settings registry.
    const serverEnv = config.slice(
      config.indexOf("const serverEnv"),
      config.indexOf("export default defineConfig"),
    );
    for (const name of DEPLOYMENT_AI) {
      expect(serverEnv, name).toContain(`${name}: ""`);
    }
  });

  test("every test in the run carries the leg's tag", () => {
    expect(config).toContain('tag: "@ai-off"');
  });

  test("the workflow gives no job an AI provider", () => {
    expect(workflow).not.toMatch(/OPENOKR_AI_/);
  });

  test("the end-to-end job names itself the AI-off leg", () => {
    const job = workflow.slice(
      workflow.indexOf("\n  e2e:"),
      workflow.indexOf("\n  deploy:"),
    );
    expect(job).toContain("name: End to end, AI off");
    expect(job).toContain("pnpm test:e2e --shard=");
  });
});

describe("the P0 flows", () => {
  const specs = readdirSync(E2E).filter((name) => name.endsWith(".spec.ts"));

  test("name files that exist", () => {
    const missing = p0SpecFiles().filter(
      (file) => !existsSync(`${E2E}${file}`),
    );
    expect(missing).toEqual([]);
  });

  test("each cites the requirement it proves and names at least one spec", () => {
    for (const flow of P0_FLOWS) {
      expect(flow.requirement, flow.flow).toMatch(/^REQUIREMENTS §/);
      expect(flow.specs.length, flow.flow).toBeGreaterThan(0);
    }
  });

  test("include the leg's own spec", () => {
    expect(p0SpecFiles()).toContain("ai-off.spec.ts");
  });

  test("are not skipped wholesale, so a green leg means they ran", () => {
    // A conditional skip inside one test is allowed, as `s32-search` has for
    // an instance with no KPI. A whole file skipped or marked to fix would
    // leave the job green having proved nothing.
    // Three patterns rather than one alternation, so the line-start anchor
    // plainly belongs to the first alone.
    const wholesale = [
      /^test\.(skip|fixme)\(/m,
      /test\.describe\.(skip|fixme)\(/,
      /test\.fixme\(/,
    ];
    const skipped = p0SpecFiles().filter((file) => {
      const text = readFileSync(`${E2E}${file}`, "utf8");
      return wholesale.some((pattern) => pattern.test(text));
    });
    expect(skipped).toEqual([]);
  });

  test("are a subset of the suite the job runs, not a second copy of it", () => {
    for (const file of p0SpecFiles()) {
      expect(specs, file).toContain(file);
    }
    expect(p0SpecFiles().length).toBeLessThan(specs.length);
  });
});

describe("an AI affordance is one the leg can find", () => {
  /**
   * UIUX-PLAN §2 defines an AI affordance as a ✨ action, and the leg finds
   * one by the mark the `ai` button variant carries. So every screen file
   * that draws the ✨ must draw it on that variant, or the leg would walk
   * past it. The navigation's own icons are the one exception: they name the
   * AI console and the member's AI keys, which are settings, not assists.
   */
  const SOURCE = fileURLToPath(new URL("../", import.meta.url));
  const files = (directory: string): string[] =>
    readdirSync(`${SOURCE}${directory}`, {
      recursive: true,
      encoding: "utf8",
    })
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `${directory}/${name}`);

  test("every file that draws the ✨ draws it on an ai button", () => {
    const drawn = [...files("app"), ...files("lib")].filter(
      (file) =>
        file !== "lib/nav-icons.tsx" &&
        /import \{[^}]*\bSparkles\b[^}]*\} from "lucide-react"/.test(
          readFileSync(`${SOURCE}${file}`, "utf8"),
        ),
    );
    expect(drawn.length).toBeGreaterThan(0);
    const unmarked = drawn.filter(
      (file) =>
        !readFileSync(`${SOURCE}${file}`, "utf8").includes('variant="ai"'),
    );
    expect(unmarked).toEqual([]);
  });
});
