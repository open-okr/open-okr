import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_PERSONA_PASSWORD, DEMO_PERSONAS } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * The public demonstration instance (P8-T13c).
 *
 * Three claims worth holding, and none of them is about rendering:
 *
 * 1. **The persona list is empty unless the deployment says it is a demo.**
 *    The route publishes addresses and a shared password, which is correct for
 *    an instance that is wiped every night and wrong for every other kind.
 * 2. **The two unauthenticated reads the sign-in page makes are public.** This
 *    list has been the defect five times. `/api/sso-providers` had never been
 *    on it, so on a deployed instance every request for it was answered with a
 *    307 to the sign-in page and the buttons silently never appeared.
 * 3. **The reset destroys one fixed project.** A reset that took its target
 *    from the environment is one typo away from somebody's instance.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const route = at("../app/api/demo-personas/route.ts");
const signIn = at("../app/(auth)/sign-in/page.tsx");
const proxy = at("../proxy.ts");
const reset = at("../../../deploy/demo/reset.sh");
const overlay = at("../../../deploy/demo/compose.demo.yaml");

describe("the persona list", () => {
  test("is the cast, with an address each on a reserved domain", () => {
    expect(DEMO_PERSONAS).toHaveLength(7);
    for (const persona of DEMO_PERSONAS) {
      // RFC 2606 reserves `.example`, so none of these can ever be a real
      // person's address and none of them can receive mail.
      expect(persona.email).toMatch(/@northwind\.example$/);
      expect(persona.name.length).toBeGreaterThan(0);
      expect(persona.title.length).toBeGreaterThan(0);
    }
  });

  test("is withheld unless the deployment says it is a demo", () => {
    // Read from the source rather than by calling the handler, which would
    // need the whole environment loaded. The condition is the thing that
    // matters and it is one line.
    expect(route).toContain('env.OPENOKR_DEMO !== "on"');
    expect(route).toContain("personas: [], password: null");
  });

  test("publishes a password that is stated everywhere rather than hidden", () => {
    expect(DEMO_PERSONA_PASSWORD.length).toBeGreaterThan(8);
    const docs = at("../../../docs/install/demo.md");
    expect(docs).toContain(DEMO_PERSONA_PASSWORD);
  });
});

describe("the sign-in page", () => {
  test("asks for the personas and renders nothing when there are none", () => {
    expect(signIn).toContain('fetch("/api/demo-personas")');
    expect(signIn).toContain("{personas.length > 0 && (");
  });
});

describe("the two reads the sign-in page makes before anybody has a session", () => {
  test("are both public, which one of them had never been", () => {
    expect(proxy).toContain('"/api/sso-providers"');
    expect(proxy).toContain('"/api/demo-personas"');
  });
});

describe("the reset", () => {
  test("destroys one fixed project, not one named by the environment", () => {
    expect(reset).toContain('PROJECT="openokr-demo"');
    // No reading it from the environment, which is the whole guard.
    expect(reset).not.toContain("PROJECT=${");
    expect(reset).not.toContain("OPENOKR_DEMO_PROJECT");
  });

  test("refuses a checkout carrying a .env, which would redirect the seed", () => {
    expect(reset).toContain('if [ -f "$REPO/.env" ]; then');
  });

  test("runs the seed and the persona command, in that order", () => {
    const seedAt = reset.indexOf("pnpm db:seed");
    const prepareAt = reset.indexOf("pnpm demo:prepare");
    expect(seedAt).toBeGreaterThan(-1);
    expect(prepareAt).toBeGreaterThan(seedAt);
  });
});

describe("the compose overlay", () => {
  test("changes two things and leaves the product alone", () => {
    expect(overlay).toContain('OPENOKR_DEMO: "on"');
    // Loopback only. A demo instance publishing its database is a different
    // kind of demonstration.
    expect(overlay).toContain("127.0.0.1:");
  });

  test("is an overlay rather than a second compose file", () => {
    // No image, no volumes, no healthcheck: anything repeated here would drift
    // from the file every self-hosted install runs.
    expect(overlay).not.toContain("image:");
    expect(overlay).not.toContain("healthcheck:");
  });
});
