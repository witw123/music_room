import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  desktopIpcChannels,
  type DesktopLoadedFile,
  type DesktopLogLevel,
  type DesktopPickedFile
} from "../shared/ipc";

const DEFAULT_DEV_WEB_URL = "http://localhost:3000";
const DEFAULT_PROD_WEB_URL = "https://witw.top";

let mainWindow: BrowserWindow | null = null;

function isDev() {
  return !app.isPackaged;
}

function resolvePreloadPath() {
  return path.join(app.getAppPath(), "dist", "preload", "preload.js");
}

function buildMenu() {
  const viewSubmenu = [
    { role: "reload" as const },
    { role: "forceReload" as const },
    ...(isDev() ? [{ role: "toggleDevTools" as const }] : []),
    { type: "separator" as const },
    { role: "resetZoom" as const },
    { role: "zoomIn" as const },
    { role: "zoomOut" as const },
    { type: "separator" as const },
    { role: "togglefullscreen" as const }
  ];

  return Menu.buildFromTemplate([
    {
      label: "Music Room",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: viewSubmenu
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }]
    }
  ]);
}

function normalizeExternalUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function resolveRendererUrl(): Promise<string | null> {
  const configuredUrl = process.env.MUSIC_ROOM_DESKTOP_RENDERER_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (isDev()) {
    return DEFAULT_DEV_WEB_URL;
  }

  return DEFAULT_PROD_WEB_URL;
}

async function loadRenderer(mainWindow: BrowserWindow) {
  const rendererUrl = await resolveRendererUrl();
  if (!rendererUrl) {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Music Room</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0b0d;
        color: #f5f5f5;
        font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(640px, calc(100vw - 48px));
        padding: 32px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        background: rgba(255,255,255,0.04);
      }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 12px; color: rgba(255,255,255,0.8); }
      code {
        display: block;
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,0.06);
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Renderer URL is not configured</h1>
      <p>This desktop build only packages the frontend shell. It does not include a local web runtime or backend.</p>
      <p>Set <strong>MUSIC_ROOM_DESKTOP_RENDERER_URL</strong> before packaging or launching the app.</p>
      <code>${escapeHtml("MUSIC_ROOM_DESKTOP_RENDERER_URL=https://witw.top")}</code>
    </main>
  </body>
</html>`;

    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return;
  }

  await mainWindow.loadURL(rendererUrl);
}

async function createMainWindow() {
  const preload = resolvePreloadPath();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#050505",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (!currentUrl || url === currentUrl) {
      return;
    }

    try {
      const currentOrigin = new URL(currentUrl).origin;
      const nextOrigin = new URL(url).origin;
      if (currentOrigin === nextOrigin) {
        return;
      }
    } catch {
      // Fall through to the external-url guard below.
    }

    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl) {
      event.preventDefault();
      void shell.openExternal(externalUrl);
    }
  });

  if (isDev()) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  await loadRenderer(mainWindow);
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".flac":
      return "audio/flac";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function registerDesktopIpc() {
  ipcMain.handle(desktopIpcChannels.pickAudioFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select audio files",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg"]
        }
      ]
    });

    if (result.canceled) {
      return [] as DesktopPickedFile[];
    }

    return result.filePaths.map((filePath) => ({
      name: path.basename(filePath),
      path: filePath
    }));
  });

  ipcMain.handle(desktopIpcChannels.readAudioFile, async (_event, filePath: string) => {
    const normalizedPath = path.normalize(filePath);
    const { readFile } = await import("node:fs/promises");
    const fileBuffer = await readFile(normalizedPath);
    const nextBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    const payload: DesktopLoadedFile = {
      name: path.basename(normalizedPath),
      path: normalizedPath,
      type: inferMimeType(normalizedPath),
      data: nextBuffer
    };

    return payload;
  });

  ipcMain.handle(desktopIpcChannels.getAppVersion, () => app.getVersion());

  ipcMain.handle(desktopIpcChannels.openExternal, async (_event, rawUrl: string) => {
    const externalUrl = normalizeExternalUrl(rawUrl);
    if (!externalUrl) {
      throw new Error("Only http(s) and mailto links are allowed.");
    }
    await shell.openExternal(externalUrl);
  });

  ipcMain.handle(desktopIpcChannels.showItemInFolder, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(
    desktopIpcChannels.writeDesktopLog,
    async (_event, level: DesktopLogLevel, message: string) => {
      const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      logger(`[desktop] ${message}`);
    }
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    registerDesktopIpc();
    await createMainWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
