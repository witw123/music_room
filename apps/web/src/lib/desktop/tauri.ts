/**
 * Thin helpers for talking to the Tauri desktop shell. Everything degrades to
 * a no-op in plain browsers so the same bundle serves web, Capacitor mobile,
 * and the Tauri desktop window.
 */

type TauriGlobal = {
  core?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, Record<string, (args?: Record<string, unknown>) => Promise<unknown>> | undefined>;
};

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True inside the Capacitor Android/iOS shell (injected Capacitor global). */
export function isCapacitorRuntime() {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

export function capacitorPlugin(name: string) {
  if (typeof window === "undefined") return undefined;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.Plugins?.[name];
}

export async function invokeTauri<T = void>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (!invoke) {
    return undefined;
  }
  try {
    return (await invoke(command, args)) as T;
  } catch (error) {
    // Surface shell failures in the console; silent failures made toggle
    // buttons look dead during real-device testing.
    console.warn(`[tauri] invoke "${command}" failed:`, error);
    return undefined;
  }
}
