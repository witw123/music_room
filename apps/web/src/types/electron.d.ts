import type {
  DesktopLoadedFile,
  DesktopLogLevel,
  DesktopPickedFile
} from "@/lib/desktop-api";

declare global {
  interface Window {
    electron?: {
      pickAudioFiles: () => Promise<DesktopPickedFile[]>;
      readAudioFile: (filePath: string) => Promise<DesktopLoadedFile>;
      getAppVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<void>;
      showItemInFolder: (filePath: string) => Promise<void>;
      writeDesktopLog: (level: DesktopLogLevel, message: string) => Promise<void>;
    };
  }
}

export {};
