export type DesktopPickedFile = {
  name: string;
  path: string;
};

export type DesktopLoadedFile = {
  name: string;
  path: string;
  type: string;
  data: number[];
};

export type DesktopLogLevel = "info" | "warn" | "error";

export function isDesktopRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const tauriWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopRuntime()) {
    return null;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function pickDesktopAudioFilesAsFileObjects() {
  const pickedFiles = await invokeDesktop<DesktopPickedFile[]>("pick_audio_files");
  if (!pickedFiles?.length) {
    return [] as File[];
  }

  const nextFiles = await Promise.all(
    pickedFiles.map(async (pickedFile) => {
      const loaded = await invokeDesktop<DesktopLoadedFile>("read_audio_file", {
        filePath: pickedFile.path
      });
      if (!loaded) {
        return null;
      }

      return new File([new Uint8Array(loaded.data)], loaded.name, {
        type: loaded.type || "application/octet-stream"
      });
    })
  );

  return nextFiles.filter((file): file is File => file instanceof File);
}

export async function getDesktopAppVersion() {
  return invokeDesktop<string>("get_app_version");
}

export async function openDesktopExternal(url: string) {
  if (isDesktopRuntime()) {
    await invokeDesktop("open_external", { rawUrl: url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function writeDesktopLog(level: DesktopLogLevel, message: string) {
  await invokeDesktop("write_desktop_log", { level, message });
}
