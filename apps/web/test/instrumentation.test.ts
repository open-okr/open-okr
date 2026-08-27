import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "../instrumentation";
import { startRelay } from "../lib/relay";

// Mocked rather than allowed to run: the real one opens a pool and polls
// forever, which a unit test should neither connect for nor be kept alive by.
vi.mock("../lib/relay", () => ({ startRelay: vi.fn() }));

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
