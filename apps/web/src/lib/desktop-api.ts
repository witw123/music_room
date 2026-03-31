export type DesktopPickedFile = {
  name: string;
  path: string;
};

export type DesktopLoadedFile = {
  name: string;
  path: string;
  type: string;
  data: ArrayBuffer;
};

export type DesktopLogLevel = "info" | "warn" | "error";

export function isDesktopRuntime() {
  return typeof window !== "undefined" && !!window.electron;
}

export async function pickDesktopAudioFilesAsFileObjects() {
  if (!window.electron) {
    return [] as File[];
  }

  const pickedFiles = await window.electron.pickAudioFiles();
  const nextFiles = await Promise.all(
    pickedFiles.map(async (pickedFile) => {
      const loaded = await window.electron!.readAudioFile(pickedFile.path);
      return new File([loaded.data], loaded.name, {
        type: loaded.type || "application/octet-stream"
      });
    })
  );

  return nextFiles;
}

export async function getDesktopAppVersion() {
  return window.electron?.getAppVersion() ?? null;
}

export async function openDesktopExternal(url: string) {
  if (window.electron) {
    await window.electron.openExternal(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function writeDesktopLog(level: DesktopLogLevel, message: string) {
  await window.electron?.writeDesktopLog(level, message);
}
