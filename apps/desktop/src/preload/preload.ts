import { contextBridge, ipcRenderer } from "electron";
import {
  desktopIpcChannels,
  type DesktopLoadedFile,
  type DesktopLogLevel,
  type DesktopPickedFile
} from "../shared/ipc";

const electronBridge = {
  pickAudioFiles: () =>
    ipcRenderer.invoke(desktopIpcChannels.pickAudioFiles) as Promise<DesktopPickedFile[]>,
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke(desktopIpcChannels.readAudioFile, filePath) as Promise<DesktopLoadedFile>,
  getAppVersion: () =>
    ipcRenderer.invoke(desktopIpcChannels.getAppVersion) as Promise<string>,
  openExternal: (url: string) =>
    ipcRenderer.invoke(desktopIpcChannels.openExternal, url) as Promise<void>,
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke(desktopIpcChannels.showItemInFolder, filePath) as Promise<void>,
  writeDesktopLog: (level: DesktopLogLevel, message: string) =>
    ipcRenderer.invoke(desktopIpcChannels.writeDesktopLog, level, message) as Promise<void>
};

contextBridge.exposeInMainWorld("electron", electronBridge);
