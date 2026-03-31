export const desktopIpcChannels = {
  pickAudioFiles: "desktop:pick-audio-files",
  readAudioFile: "desktop:read-audio-file",
  getAppVersion: "desktop:get-app-version",
  openExternal: "desktop:open-external",
  showItemInFolder: "desktop:show-item-in-folder",
  writeDesktopLog: "desktop:write-log"
} as const;

export type DesktopLogLevel = "info" | "warn" | "error";

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
