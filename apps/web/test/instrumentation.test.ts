import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "../instrumentation";

const original = { ...process.env };

beforeEach(() => {
  resetEnvCache();
  process.env.NEXT_RUNTIME = "nodejs";
});

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
  vi.restoreAllMocks();
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

test("boot succeeds with a valid environment", async () => {
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await register();

  expect(exit).not.toHaveBeenCalled();
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
