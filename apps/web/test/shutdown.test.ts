import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  installShutdown,
  onShutdown,
  resetShutdown,
  runShutdown,
  type ShutdownStep,
  stopProcess,
  waitForActions,
} from "../lib/shutdown";

/**
 * How the server stops (plan 0.8.0 H10a, docs/design/worker-deployment.md D4,
 * D5 and §1.1).
 *
 * Next's own handler exited without waiting for anything, so the relay's and
 * the scheduler's promises to finish their work were dropped on every deploy.
 * The coordinator owns the signal instead: it runs every step it was given,
 * bounded by `OPENOKR_SHUTDOWN_SECONDS`, says what it waited for, and exits.
 */

const original = { ...process.env };

const step = (
  name: string,
  phase: ShutdownStep["phase"],
  stop: ShutdownStep["stop"],
): ShutdownStep => ({ name, phase, stop });

const never = () => new Promise<string>(() => undefined);

let out: string[];

beforeEach(() => {
  resetEnvCache();
  resetShutdown();
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
  out = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
  resetShutdown();
  vi.restoreAllMocks();
});

describe("runShutdown", () => {
  test("runs the drain steps together, then the flush steps", async () => {
    const order: string[] = [];
    const later = (name: string, ms: number) => async () => {
      order.push(`${name} began`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`${name} ended`);
      return `${name} done`;
    };

    const report = await runShutdown(
      [
        step("flush", "flush", later("flush", 1)),
        step("relay", "drain", later("relay", 30)),
        step("scheduler", "drain", later("scheduler", 10)),
      ],
      { budgetMs: 5_000 },
    );

    // Both drains began before either ended, and the flush waited for both.
    expect(order.slice(0, 2).sort()).toEqual([
      "relay began",
      "scheduler began",
    ]);
    expect(order.indexOf("flush began")).toBeGreaterThan(
      order.indexOf("relay ended"),
    );
    expect(report.outcomes).toEqual([
      "relay done",
      "scheduler done",
      "flush done",
    ]);
  });

  test("stops waiting at the budget and names the step it left", async () => {
    const began = Date.now();
    const report = await runShutdown(
      [
        step("relay", "drain", never),
        step("scheduler", "drain", async () => "scheduler idle"),
      ],
      { budgetMs: 200 },
    );

    expect(Date.now() - began).toBeLessThan(1_000);
    expect(report.outcomes).toEqual([
      "relay still running at the bound",
      "scheduler idle",
    ]);
  });

  test("bounds the flush steps on their own, after the drain", async () => {
    const report = await runShutdown([step("telemetry", "flush", never)], {
      budgetMs: 1_000,
      flushMs: 100,
    });
    expect(report.outcomes).toEqual(["telemetry still running at the bound"]);
  });

  test("a step that throws is named with its reason, and the others still run", async () => {
    const report = await runShutdown(
      [
        step("relay", "drain", async () => {
          throw new Error("the pool is closed");
        }),
        step("errors", "flush", async () => "error reports flushed"),
      ],
      { budgetMs: 1_000 },
    );
    expect(report.outcomes).toEqual([
      "relay failed: the pool is closed",
      "error reports flushed",
    ]);
  });
});

describe("waiting for actions in flight", () => {
  test("waits until none are in flight", async () => {
    let inFlight = 1;
    setTimeout(() => {
      inFlight = 0;
    }, 120);
    const began = Date.now();

    const report = await runShutdown([waitForActions(() => inFlight)], {
      budgetMs: 5_000,
    });

    expect(Date.now() - began).toBeGreaterThanOrEqual(100);
    expect(report.outcomes).toEqual(["actions in flight: 0"]);
  });

  test("gives up at the budget and says how many it left", async () => {
    const report = await runShutdown([waitForActions(() => 2)], {
      budgetMs: 200,
    });
    expect(report.outcomes).toEqual(["actions still in flight: 2"]);
  });
});

describe("the signal", () => {
  test("with the server owning the signal, exits 0 within a second when nothing is in flight", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    onShutdown(step("relay", "drain", async () => "relay idle"));
    onShutdown(waitForActions(() => 0));
    onShutdown(step("errors", "flush", async () => "error reports flushed"));

    const began = Date.now();
    await stopProcess("SIGTERM");

    expect(Date.now() - began).toBeLessThan(1_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    const stopped = out.filter((line) => line.includes("stopped after"));
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatch(
      /^shutdown: stopped after \d+\.\ds: relay idle, actions in flight: 0, error reports flushed\n$/,
    );
    expect(out[0]).toBe("shutdown: SIGTERM, draining for up to 20s\n");
  });

  test("reads the bound from OPENOKR_SHUTDOWN_SECONDS", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    process.env.OPENOKR_SHUTDOWN_SECONDS = "45";
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await stopProcess("SIGINT");

    expect(out[0]).toBe("shutdown: SIGINT, draining for up to 45s\n");
  });

  test("waits for an action in flight before it exits", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    let inFlight = 1;
    onShutdown(waitForActions(() => inFlight));

    const stopping = stopProcess("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(exit).not.toHaveBeenCalled();

    inFlight = 0;
    await stopping;
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("exits at the bound when a step never finishes", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    process.env.OPENOKR_SHUTDOWN_SECONDS = "1";
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    onShutdown(step("relay", "drain", never));

    const began = Date.now();
    await stopProcess("SIGTERM");

    expect(Date.now() - began).toBeLessThan(2_000);
    expect(exit).toHaveBeenCalledWith(0);
    expect(out.join("")).toMatch(/relay still running at the bound/);
  });

  test("without NEXT_MANUAL_SIG_HANDLE, runs the steps and leaves the exit to Next", async () => {
    delete process.env.NEXT_MANUAL_SIG_HANDLE;
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const ran = vi.fn(async () => "relay idle");
    onShutdown(step("relay", "drain", ran));

    await stopProcess("SIGTERM");

    expect(ran).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  test("a second signal does not start a second stop", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const ran = vi.fn(async () => "relay idle");
    onShutdown(step("relay", "drain", ran));

    await Promise.all([stopProcess("SIGTERM"), stopProcess("SIGINT")]);

    expect(ran).toHaveBeenCalledTimes(1);
  });

  test("a step registered again under its name replaces the first", async () => {
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const first = vi.fn(async () => "first");
    const second = vi.fn(async () => "second");
    onShutdown(step("relay", "drain", first));
    onShutdown(step("relay", "drain", second));

    await stopProcess("SIGTERM");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("installs one handler each for SIGTERM and SIGINT, once", () => {
    const on = vi.spyOn(process, "on").mockImplementation(() => process);

    installShutdown();
    installShutdown();

    const signals = on.mock.calls.map(([signal]) => signal);
    expect(signals.sort()).toEqual(["SIGINT", "SIGTERM"]);
  });
});
