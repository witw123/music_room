import { describe, expect, it } from "vitest";
import { pushBackHandler, runBackHandler } from "./back-handler";

describe("back handler stack", () => {
  it("reports an unclaimed press so the shell can navigate instead", () => {
    expect(runBackHandler()).toBe(false);
  });

  it("runs the most recently registered handler first", () => {
    const order: string[] = [];
    const removeFirst = pushBackHandler(() => order.push("first"));
    const removeSecond = pushBackHandler(() => order.push("second"));

    expect(runBackHandler()).toBe(true);
    expect(order).toEqual(["second"]);

    removeSecond();
    expect(runBackHandler()).toBe(true);
    expect(order).toEqual(["second", "first"]);

    removeFirst();
    expect(runBackHandler()).toBe(false);
  });

  it("keeps the stack usable when a handler unregisters itself", () => {
    // A handler that closes its overlay unregisters through the effect
    // cleanup, so the list must survive mutation during dispatch.
    const order: string[] = [];
    const removeSelf = pushBackHandler(() => {
      order.push("self-closing");
      removeSelf();
    });
    const removeOuter = pushBackHandler(() => order.push("outer"));

    expect(runBackHandler()).toBe(true);
    expect(order).toEqual(["outer"]);

    removeOuter();
    expect(runBackHandler()).toBe(true);
    expect(order).toEqual(["outer", "self-closing"]);
    expect(runBackHandler()).toBe(false);
  });

  it("drops one registration per unregister when the same handler is pushed twice", () => {
    const order: string[] = [];
    const handler = () => order.push("shared");
    const removeFirst = pushBackHandler(handler);
    const removeSecond = pushBackHandler(handler);

    removeFirst();
    expect(runBackHandler()).toBe(true);
    expect(order).toEqual(["shared"]);

    removeSecond();
    expect(runBackHandler()).toBe(false);
  });
});
