import { describe, expect, it } from "vitest";
import { pushBackHandler, resolveBackNavigation, runBackHandler } from "./back-handler";

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

describe("back navigation resolution", () => {
  it("quits on the home page even though history exists", () => {
    // The regression this guards: `canGoBack` stays true after any navigation,
    // so trusting it on the home page means back rewinds history forever and
    // never reaches the exit path the user expects on a start destination.
    expect(resolveBackNavigation({ pathname: "/app", canGoBack: true })).toBe("exit");
    expect(resolveBackNavigation({ pathname: "/rooms", canGoBack: true })).toBe("exit");
  });

  it("quits on the home page when there is no history either", () => {
    expect(resolveBackNavigation({ pathname: "/app", canGoBack: false })).toBe("exit");
  });

  it("steps back from a sub-page that has history", () => {
    expect(resolveBackNavigation({ pathname: "/app/discover", canGoBack: true })).toBe("history");
    expect(resolveBackNavigation({ pathname: "/app/settings", canGoBack: true })).toBe("history");
    expect(resolveBackNavigation({ pathname: "/app/search", canGoBack: true })).toBe("history");
  });

  it("treats a room as a sub-page rather than a start destination", () => {
    expect(resolveBackNavigation({ pathname: "/room/abc123", canGoBack: true })).toBe("history");
  });

  it("quits from a sub-page reached without history, such as a deep link", () => {
    expect(resolveBackNavigation({ pathname: "/app/discover", canGoBack: false })).toBe("exit");
  });

  it("falls through to history when the route is not known yet", () => {
    expect(resolveBackNavigation({ pathname: null, canGoBack: true })).toBe("history");
    expect(resolveBackNavigation({ pathname: undefined, canGoBack: true })).toBe("history");
  });
});
