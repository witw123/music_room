/**
 * Last-in-first-out registry for hardware back presses (Capacitor Android).
 *
 * Overlays register a handler while they are open; the shell's back listener
 * runs the most recently registered one, so back dismisses the top-most
 * surface before it ever reaches navigation. Handlers are *not* removed here:
 * closing the overlay is what unregisters it, which keeps ownership with the
 * component and avoids double-closing when a handler is also wired to Escape.
 */

type BackHandler = () => void;

const handlers: BackHandler[] = [];

/** Registers `handler` on top of the stack; call the result to unregister. */
export function pushBackHandler(handler: BackHandler) {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  };
}

/**
 * Runs the top-most handler. Returns false when nothing is registered, which
 * tells the caller the press belongs to navigation instead.
 */
export function runBackHandler() {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/**
 * Routes that render the rooms home page — the app's start destination. Both
 * are listed because `/app` and `/rooms` render the same page.
 */
const homePaths = ["/app", "/rooms"];

/**
 * Decides where a back press goes once no overlay has claimed it.
 *
 * `canGoBack` cannot answer this on its own: it stays true once anything has
 * been visited, so on the home page it would keep rewinding history instead of
 * ever quitting. A start destination quits instead.
 */
export function resolveBackNavigation(input: {
  pathname: string | null | undefined;
  canGoBack: boolean | undefined;
}): "history" | "exit" {
  const onHomePath = typeof input.pathname === "string" && homePaths.includes(input.pathname);
  return !onHomePath && input.canGoBack ? "history" : "exit";
}
