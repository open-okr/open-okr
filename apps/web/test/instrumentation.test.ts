import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "../instrumentation";
import { installAdmission } from "../lib/admission";
import { resolveSignupPolicy } from "../lib/auth";
import { announceCallerAddress } from "../lib/caller-address";
import { installPromptEvaluator } from "../lib/prompt-evaluation";
import { startRelay } from "../lib/relay";
import { startScheduler } from "../lib/scheduler";
import { installShutdown } from "../lib/shutdown";
import { installStatusThresholds } from "../lib/status-thresholds";
import { installTelemetry } from "../lib/telemetry";

// Mocked rather than allowed to run: the real one opens a pool and polls
// forever, which a unit test should neither connect for nor be kept alive by.
vi.mock("../lib/relay", () => ({ startRelay: vi.fn() }));
vi.mock("../lib/scheduler", () => ({ startScheduler: vi.fn() }));
// **Mocked for the import cost, not for a side effect** (P7-T06a).
// Constructing a meter opens nothing and connects to nothing. What it does do
// is pull `@openokr/adapters` into this file's module graph, and that package
// carries every vendor SDK the product has: the S3 client, the mail
// transport, the socket server and four LLM clients. Loading it took these
// two tests past the five-second timeout. The other two mocks above already
// cut the same graph out, so an unmocked third route to it put the cost back.
vi.mock("../lib/telemetry", () => ({ installTelemetry: vi.fn() }));
// **The fourth route, and the comment above predicted it.** P8-T02b added
// `resolveSignupPolicy` to the boot sequence, so `instrumentation.node`
// imports `./lib/auth`, which carries Better Auth and `@openokr/core` behind
// it. The first test to trigger the dynamic import paid that load and went
// past the five-second timeout; the rest passed because the module was cached
// by then, which is why this reads as one flaky test rather than as a boot
// that got heavier. Mocked for the import cost, like the three above.
vi.mock("../lib/auth", () => ({ resolveSignupPolicy: vi.fn() }));
// The fifth route, arriving one task after the fourth (P8-T06a).
// `lib/admission` reaches the cache driver and the pool, so it carries the
// same graph. Mocked for the import cost, and the mock is what makes the two
// ordering assertions below possible at all.
vi.mock("../lib/admission", () => ({ installAdmission: vi.fn() }));
// The `/api/status` thresholds resolve beside the limits (plan 0.7.0 P8),
// and read `system_settings`, so they are mocked for the same reason.
vi.mock("../lib/status-thresholds", () => ({
  installStatusThresholds: vi.fn(),
}));
// The sixth route (P8-T07). `lib/sso` reaches the pool and the key ring
// to decrypt SSO connections at boot. Mocked for the import cost.
vi.mock("../lib/sso", () => ({ resolveSSOProviders: vi.fn() }));
// The seventh (completeness review H-01). `lib/tenant-floor` asks the pool
// which role it connects as, so unmocked it would open a connection.
vi.mock("../lib/tenant-floor", () => ({
  tenantFloor: vi.fn(async () => "enforced"),
}));
// The eighth (plan 0.7.0 E1). `lib/error-reporting` reaches `@openokr/core`
// and the meter, and the real one adds process listeners that would outlive
// the test. Mocked for both.
vi.mock("../lib/error-reporting", () => ({ installErrorReports: vi.fn() }));
// The ninth (plan 0.7.0 A9). `lib/prompt-evaluation` reaches the drafter and
// the mock driver through `@openokr/agents`, which carries the adapters graph.
// Mocked for the import cost.
vi.mock("../lib/prompt-evaluation", () => ({
  installPromptEvaluator: vi.fn(),
}));
// The tenth (plan 0.8.0 H2). `lib/caller-address` writes the reading to the
// instance chain through `@openokr/core` and the pool. Mocked for both.
vi.mock("../lib/caller-address", () => ({ announceCallerAddress: vi.fn() }));
// Not for the import cost: the real one replaces `console.error` for the
// whole process, and the tests below spy on it (completeness review L-04).
vi.mock("../lib/abandoned-responses", () => ({
  quietAbandonedResponses: vi.fn(),
}));
// Not for the import cost either: the real one adds SIGTERM and SIGINT
// listeners to the test's own process (plan 0.8.0 H10a).
vi.mock("../lib/shutdown", () => ({ installShutdown: vi.fn() }));

const original = { ...process.env };

beforeEach(() => {
  resetEnvCache();
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.NEXT_PHASE = "";
});

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
  vi.restoreAllMocks();
  vi.mocked(startRelay).mockClear();
  vi.mocked(startScheduler).mockClear();
  vi.mocked(installTelemetry).mockClear();
  vi.mocked(resolveSignupPolicy).mockClear();
  vi.mocked(installAdmission).mockClear();
  vi.mocked(installPromptEvaluator).mockClear();
  vi.mocked(announceCallerAddress).mockClear();
  vi.mocked(installShutdown).mockClear();
});

test("boot fails with a clear error naming the variable when it is missing", async () => {
  process.env.DATABASE_URL = "";
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).toHaveBeenCalledWith(1);
  expect(stderr.mock.calls.join()).toMatch(/DATABASE_URL/);
  expect(stderr.mock.calls.join()).toMatch(/cannot start/i);
});

test("boot succeeds with a valid environment, and starts the relay (P5-T01a)", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).not.toHaveBeenCalled();
  // Without this call nothing delivers an invitation email or a live event,
  // which is exactly the state PLAN.md §12 R10 recorded.
  expect(startRelay).toHaveBeenCalled();
  // **Before the relay and the scheduler, so the work they do from the first
  // second is measured rather than missed** (P7-T06a). Held here because the
  // order is the whole reason the call sits where it does in
  // `instrumentation.ts`, and nothing else would notice if it moved.
  expect(installTelemetry).toHaveBeenCalled();
  expect(vi.mocked(installTelemetry).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startRelay).mock.invocationCallOrder[0] as number,
  );
});

test("a build worker does not start the relay, because it has to be able to exit", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(startRelay).not.toHaveBeenCalled();
});

test("a relay that cannot start is logged, not fatal", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  vi.mocked(startRelay).mockImplementationOnce(() => {
    throw new Error("no route to the database");
  });
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await expect(register()).resolves.toBeUndefined();

  expect(exit).not.toHaveBeenCalled();
  expect(stderr.mock.calls.join()).toMatch(/no route to the database/);
});

test("the edge runtime is skipped, because it holds no database connection", async () => {
  process.env.NEXT_RUNTIME = "edge";
  process.env.DATABASE_URL = "";
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).not.toHaveBeenCalled();
});

test("boot starts the scheduler, which is what runs the agents on a clock (P6-G01a)", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).not.toHaveBeenCalled();
  // Without this call the Champion never chases a check-in, the morning
  // summary never sends and a neglected goal never flips to outdated. That was
  // every deployment until the gap audit found it (B-01).
  expect(startScheduler).toHaveBeenCalled();
});

test("a build worker does not start the scheduler either", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(startScheduler).not.toHaveBeenCalled();
});

test("a scheduler that cannot start is logged, not fatal", async () => {
  // A serving replica that cannot reach pg-boss must still serve. Discovering
  // it through a log line beats discovering it through an outage.
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  vi.mocked(startScheduler).mockImplementationOnce(() => {
    throw new Error("pgboss schema is not reachable");
  });
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await expect(register()).resolves.toBeUndefined();

  expect(exit).not.toHaveBeenCalled();
  expect(stderr.mock.calls.join()).toMatch(/pgboss schema is not reachable/);
});

test("the signup policy resolves last, and boot waits for it (P8-T02b)", async () => {
  // `instrumentation.ts` says this call is last and awaited so that the first
  // request cannot reach Better Auth with the answer still unresolved: a
  // mail-capable instance would otherwise serve one sign-in without the
  // requirement it is configured for. Nothing asserted that until now, so the
  // call could have moved up the sequence and no test would have noticed.
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";

  await register();

  expect(resolveSignupPolicy).toHaveBeenCalled();
  expect(
    vi.mocked(resolveSignupPolicy).mock.invocationCallOrder[0],
  ).toBeGreaterThan(
    vi.mocked(startScheduler).mock.invocationCallOrder[0] as number,
  );
});

test("a build worker resolves no signup policy, because it reaches no database", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(resolveSignupPolicy).not.toHaveBeenCalled();
});

test("admission is installed before the relay and the scheduler (P8-T06a)", async () => {
  // Both of them call actions from their first tick. Installing the limits
  // after they start would leave the first minute of every boot unlimited,
  // and the first minute after a restart is exactly when a backlog arrives.
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";

  await register();

  expect(installAdmission).toHaveBeenCalled();
  // And the status thresholds with them, so a bad pair stops the boot.
  expect(installStatusThresholds).toHaveBeenCalled();
  expect(vi.mocked(installAdmission).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startRelay).mock.invocationCallOrder[0] as number,
  );
  expect(vi.mocked(installAdmission).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startScheduler).mock.invocationCallOrder[0] as number,
  );
});

test("a boot that cannot resolve its limits fails, rather than serving unlimited", async () => {
  // **The one step here whose failure is fatal, and deliberately so.** A
  // relay or a meter that cannot start leaves a product that still works.
  // A limit an operator set and nothing enforcing is a product that says one
  // thing on its settings screen and does another, which is worse than a
  // process that refuses to start and says why.
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  vi.mocked(installAdmission).mockRejectedValueOnce(
    new Error("cloud.limits.actionsPerMinute is 1, which is below the floor"),
  );

  await expect(register()).rejects.toThrow(/below the floor/);
});

test("the prompt evaluation set is installed before the relay, the scheduler and the first request (plan 0.7.0 A9)", async () => {
  // Until it is, `ai.updatePrompt` refuses every version rather than store one
  // unchecked, so a boot that forgot it would leave S-37's Prompts card unable
  // to save anything. Pure, so a build worker installs it too.
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";

  await register();

  expect(installPromptEvaluator).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(installPromptEvaluator).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(startRelay).mock.invocationCallOrder[0] as number);
  expect(
    vi.mocked(installPromptEvaluator).mock.invocationCallOrder[0],
  ).toBeLessThan(
    vi.mocked(resolveSignupPolicy).mock.invocationCallOrder[0] as number,
  );
});

test("a build worker installs no admission, because it reaches no database", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(installAdmission).not.toHaveBeenCalled();
});

test("a malformed trusted proxy refuses the boot, naming the entry (trusted-proxies.md D7)", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.OPENOKR_TRUSTED_PROXIES = "10.0.1.0/24, cloudflare";
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).toHaveBeenCalledWith(1);
  expect(stderr.mock.calls.join()).toMatch(/OPENOKR_TRUSTED_PROXIES/);
  expect(stderr.mock.calls.join()).toMatch(/cloudflare/);
});

test("boot announces the caller address reading before anything is served (trusted-proxies.md D10)", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";

  await register();

  expect(announceCallerAddress).toHaveBeenCalledTimes(1);
});

test("a build worker announces no reading, because it writes to no database", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(announceCallerAddress).not.toHaveBeenCalled();
});

test("a reading that cannot be announced is logged, not fatal", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  vi.mocked(announceCallerAddress).mockRejectedValueOnce(
    new Error("the instance chain is not reachable"),
  );
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  await expect(register()).resolves.toBeUndefined();

  expect(stderr.mock.calls.join()).toMatch(/instance chain is not reachable/);
});

test("the shutdown coordinator is installed first, before anything that can fail (plan 0.8.0 H10a)", async () => {
  // docs/design/worker-deployment.md D4. A Node process that is PID 1
  // ignores SIGTERM unless something handles it, and the image sets
  // NEXT_MANUAL_SIG_HANDLE so Next registers nothing. A boot that failed
  // before the coordinator was installed would leave a container that only
  // SIGKILL can stop.
  process.env.DATABASE_URL = "";
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(installShutdown).toHaveBeenCalledTimes(1);
  expect(vi.mocked(installShutdown).mock.invocationCallOrder[0]).toBeLessThan(
    exit.mock.invocationCallOrder[0] as number,
  );
});

test("a build worker installs no coordinator, because it has to be able to exit", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  process.env.NEXT_PHASE = "phase-production-build";

  await register();

  expect(installShutdown).not.toHaveBeenCalled();
});
