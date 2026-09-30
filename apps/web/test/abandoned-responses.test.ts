import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  isAbandonedResponse,
  quietAbandonedResponses,
} from "../lib/abandoned-responses";

/**
 * A response the browser walked away from stays out of the error log
 * (completeness review L-04), and nothing else does.
 *
 * The shapes are the ones Next.js produces: its logger calls
 * `console.error(prefix, error)`, and the error carries a `digest`.
 */

const original = console.error;
let seen: unknown[][];

beforeEach(() => {
  seen = [];
  console.error = (...args: unknown[]) => {
    seen.push(args);
  };
});

afterEach(() => {
  console.error = original;
});

const closedEarly = () =>
  Object.assign(new Error("The destination stream closed early."), {
    digest: "3118745351",
  });

test("a response the browser cancelled is recognised by its whole message", () => {
  expect(isAbandonedResponse(["⨯", closedEarly()])).toBe(true);
  expect(
    isAbandonedResponse([
      "⨯",
      new Error("The destination stream errored while writing data."),
    ]),
  ).toBe(false);
  expect(isAbandonedResponse(["The destination stream closed early."])).toBe(
    false,
  );
  expect(isAbandonedResponse([null, undefined, 3])).toBe(false);
});

test("the filter drops it and passes everything else through unchanged", () => {
  quietAbandonedResponses("info");
  const real = new Error('relation "goals" does not exist');

  console.error("⨯", closedEarly());
  console.error("⨯", real);
  console.error("relay: could not start");

  expect(seen).toEqual([["⨯", real], ["relay: could not start"]]);
});

test("installing it twice filters once, rather than wrapping itself", () => {
  quietAbandonedResponses("info");
  const once = console.error;
  quietAbandonedResponses("info");
  expect(console.error).toBe(once);
});

test("LOG_LEVEL=debug keeps every one of them", () => {
  const spy = vi.fn();
  console.error = spy;
  quietAbandonedResponses("debug");

  console.error("⨯", closedEarly());
  expect(spy).toHaveBeenCalledTimes(1);
});
