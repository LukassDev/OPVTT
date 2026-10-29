import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from "electron";
import { copyFile, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { RoomDatabase } from "./database";
import { LanBroadcast } from "./broadcast";
import { resolveOnlineMedia, startOnlineMediaServer } from "./online-media";
import type { AppSettings, BoardState, BoardViewport, PreviewBoardUpdate, RoomContent } from "../shared/types";

protocol.registerSchemesAsPrivileged([{
  scheme: "opvtt-file",
  privileges: { standard: true, secure: true, stream: true, corsEnabled: true },
}]);

let database: RoomDatabase;
let mainWindow: BrowserWindow | null = null;
let publicWindow: BrowserWindow | null = null;
let publicRoomId = "";
let latestPreviewUpdate: PreviewBoardUpdate | null = null;
let broadcast: LanBroadcast;
let quitting = false;

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  display: "",
  fullscreen: false,
  mainFullscreen: true,
  quality: "FULL_HD",
  port: 8080,
};

function currentSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...database.getSetting<Partial<AppSettings>>("app.settings.v1", DEFAULT_SETTINGS),
  };
}

function registerIpc(): void {
  ipcMain.handle("rooms:list", () => database.listRooms());
  ipcMain.handle("rooms:create", (_event, name: string, description: string) =>
    database.createRoom(name, description),
  );
  ipcMain.handle("rooms:update", (_event, id: string, name: string, description: string) =>
    database.updateRoom(id, name, description),
  );
  ipcMain.handle("rooms:delete", (_event, id: string) => database.deleteRoom(id));
  ipcMain.handle("rooms:board", (_event, id: string) => database.getBoard(id));
  ipcMain.handle("rooms:saveBoard", (_event, id: string, board: BoardState) =>
    database.saveBoard(id, board),
  );
  ipcMain.handle("rooms:content", (_event, id: string) => database.getContent(id));
  ipcMain.handle("rooms:saveContent", (_event, id: string, content: RoomContent) =>
    database.saveContent(id, content),
  );
  ipcMain.handle("settings:get", () => currentSettings());
  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) => {
    const current = currentSettings();
    const next = { ...current, ...patch };
    if (next.theme !== "dark" && next.theme !== "light") throw new Error("Invalid theme.");
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) {
      throw new Error("Choose a port between 1024 and 65535.");
    }
    if (typeof next.mainFullscreen !== "boolean") throw new Error("Invalid fullscreen preference.");
    database.setSetting("app.settings.v1", next);
    if (patch.mainFullscreen !== undefined) mainWindow?.setFullScreen(next.mainFullscreen);
    return next;
  });
  ipcMain.handle("settings:activeDatabase", () => database.activeDatabase());
  ipcMain.handle("settings:backup", () => database.backup());
  ipcMain.handle("settings:createDatabase", () => {
    return database.createDatabase();
  });
  ipcMain.handle("settings:importDatabase", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import OPVTT data file",
      properties: ["openFile"],
      filters: [{ name: "OPVTT database", extensions: ["db"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return database.importDatabase(result.filePaths[0]);
  });

  ipcMain.handle("files:import", async (_event, kind: "images" | "videos" | "audio") => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: kind === "images" ? "Import images" : "Import videos",
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: kind === "images" ? "Images" : kind === "videos" ? "Videos" : "Audio",
        extensions: mediaExtensions(kind),
      }],
    });
    if (result.canceled) return [];
    const destination = path.join(database.directory, "media", kind);
    await mkdir(destination, { recursive: true });
    const copied: string[] = [];
    for (const source of result.filePaths) {
      const extension = path.extname(source).toLowerCase();
      const filename = `${path.basename(source, extension).replace(/[^\w.-]+/g, "-")}-${randomUUID()}${extension}`;
      const target = path.join(destination, filename);
      await copyFile(source, target);
      copied.push(target);
    }
    return copied;
  });
  ipcMain.handle("files:choose", async (_event, kind: "images" | "videos" | "audio") => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose local media",
      properties: ["openFile"],
      filters: [{
        name: kind === "images" ? "Images" : kind === "videos" ? "Videos" : "Audio",
        extensions: mediaExtensions(kind),
      }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("files:assetUrl", async (_event, filename: string) => {
    const resolved = path.resolve(filename);
      const allowed = [
        database.directory,
        path.join(app.getAppPath(), "public"),
        path.resolve(app.getAppPath(), "..", "OPVTT-desktop", "public"),
      ];
    if (!allowed.some((root) => resolved.startsWith(path.resolve(root) + path.sep))) {
      throw new Error("Media file is outside the OPVTT asset folders.");
    }
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("Selected media file is unavailable.");
    return `opvtt-file://asset/${encodeURIComponent(resolved)}`;
  });
  ipcMain.handle("files:removeAsset", async (_event, filename: string) => {
    const resolved = path.resolve(filename);
    const mediaRoot = path.resolve(database.directory, "media") + path.sep;
    if (!resolved.startsWith(mediaRoot)) throw new Error("Media file is outside the OPVTT media folder.");
    await unlink(resolved);
  });

  ipcMain.handle("media:resolve", (_event, link: string, audioOnly: boolean) =>
    resolveOnlineMedia(link, audioOnly),
  );
  ipcMain.handle("windows:openPublic", (_event, roomId: string) => openPublicWindow(roomId));
  ipcMain.handle("windows:displays", () =>
    screen.getAllDisplays().map((display, index) => ({
      id: display.id.toString(),
      label: `Display ${index + 1} · ${display.bounds.width} × ${display.bounds.height}`,
    })),
  );
  ipcMain.handle("windows:updatePreviewBoard", (
    event,
    roomId: string,
    board: BoardState,
    viewport: BoardViewport,
  ) => {
    if (event.sender !== mainWindow?.webContents) {
      throw new Error("Only the desktop workspace can update the public preview.");
    }
    latestPreviewUpdate = { roomId, board, viewport };
    if (publicWindow && publicRoomId === roomId) {
      publicWindow.webContents.send("windows:previewBoard", latestPreviewUpdate);
    }
  });
  ipcMain.handle("windows:closePublic", () => publicWindow?.destroy());
  ipcMain.handle("windows:toggleFullscreen", () => {
    if (publicWindow) publicWindow.setFullScreen(!publicWindow.isFullScreen());
  });
  ipcMain.handle("broadcast:start", (_event, port: number) => broadcast.start(port));
  ipcMain.handle("broadcast:stop", () => broadcast.stop());
  ipcMain.handle("broadcast:status", () => broadcast.status());
  ipcMain.handle("broadcast:publish", (_event, secret: string, active: boolean) =>
    broadcast.setLive(secret, active),
  );
}

function rendererEntry(): string {
  return process.env.ELECTRON_RENDERER_URL ?? path.join(__dirname, "../renderer/index.html");
}

function mediaExtensions(kind: "images" | "videos" | "audio"): string[] {
  if (kind === "images") return ["png", "jpg", "jpeg", "webp", "gif"];
  if (kind === "videos") return ["mp4", "webm", "mov", "m4v", "mkv"];
  return ["mp3", "wav", "m4a", "aac", "ogg", "flac", "mp4", "webm"];
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#101113",
    title: "OPVTT",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key !== "F11" || input.type !== "keyDown") return;
    event.preventDefault();
    const fullscreen = !mainWindow?.isFullScreen();
    mainWindow?.setFullScreen(fullscreen);
    try {
      const current = currentSettings();
      database.setSetting("app.settings.v1", { ...current, mainFullscreen: fullscreen });
      mainWindow?.webContents.send("windows:mainFullscreen", fullscreen);
    } catch (cause) {
      console.error("Unable to save the workspace fullscreen preference:", cause);
    }
  });
  const settings = currentSettings();
  if (settings.mainFullscreen) mainWindow.setFullScreen(true);
  void mainWindow.loadURL(rendererEntry());
  mainWindow.on("close", () => publicWindow?.destroy());
  mainWindow.on("closed", () => { mainWindow = null; });
}

function openPublicWindow(roomId: string): void {
  if (publicWindow && !publicWindow.isDestroyed()) {
    if (publicRoomId !== roomId) {
      const entry = rendererEntry();
      if (process.env.ELECTRON_RENDERER_URL) {
        void publicWindow.loadURL(`${entry}${entry.includes("?") ? "&" : "?"}public=1&roomId=${encodeURIComponent(roomId)}`);
      } else {
        void publicWindow.loadFile(entry, { query: { public: "1", roomId } });
      }
      publicRoomId = roomId;
    }
    publicWindow.show();
    publicWindow.focus();
    return;
  }
  publicRoomId = roomId;
  const displays = screen.getAllDisplays();
  const settings = currentSettings();
  const display = displays.find((item) => item.id.toString() === settings.display) ?? displays[0];
  const bounds = display?.workArea;
  const outputWindow = new BrowserWindow({
    ...(bounds ? { x: bounds.x + 30, y: bounds.y + 30 } : {}),
    width: 960,
    height: 540,
    show: false,
    title: "OPVTT · Public Window",
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  publicWindow = outputWindow;
  outputWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11" && input.type === "keyDown") {
      event.preventDefault();
      const fullscreen = !outputWindow.isFullScreen();
      outputWindow.setFullScreen(fullscreen);
      try {
        database.setSetting("app.settings.v1", { ...currentSettings(), fullscreen });
      } catch (cause) {
        console.error("Unable to save the public window fullscreen preference:", cause);
      }
    }
  });
  const entry = rendererEntry();
  outputWindow.webContents.on("did-finish-load", () => {
    if (latestPreviewUpdate?.roomId === roomId) {
      outputWindow.webContents.send("windows:previewBoard", latestPreviewUpdate);
    }
  });
  outputWindow.once("ready-to-show", () => {
    if (outputWindow.isDestroyed()) return;
    outputWindow.show();
    if (settings.fullscreen) outputWindow.setFullScreen(true);
  });
  outputWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    outputWindow.hide();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void outputWindow.loadURL(`${entry}${entry.includes("?") ? "&" : "?"}public=1&roomId=${encodeURIComponent(roomId)}`);
  } else {
    void outputWindow.loadFile(entry, { query: { public: "1", roomId } });
  }
  outputWindow.on("closed", () => {
    if (publicWindow === outputWindow) publicWindow = null;
    publicRoomId = "";
  });
  outputWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url).catch((error: unknown) => console.error("Unable to open external link:", error));
    }
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    database = await RoomDatabase.open();
    await startOnlineMediaServer();
    protocol.handle("opvtt-file", async (request) => {
      const rawPath = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const filename = path.resolve(rawPath.replace(/^\/(?=[A-Za-z]:[\\/])/, ""));
      const origin = request.headers.get("Origin");
      const trustedOrigin = process.env.ELECTRON_RENDERER_URL
        ? new URL(process.env.ELECTRON_RENDERER_URL).origin
        : "null";
      const corsHeaders: Record<string, string> = {};
      if (origin === trustedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = origin;
        corsHeaders.Vary = "Origin";
      }
      const roots = [
        database.directory,
        path.join(app.getAppPath(), "public"),
        path.resolve(app.getAppPath(), "..", "OPVTT-desktop", "public"),
      ].map((root) => path.resolve(root));
      if (!roots.some((root) => filename.startsWith(root + path.sep))) {
        return new Response("Asset outside OPVTT media folders.", { status: 403 });
      }
      try {
        const info = await stat(filename);
        if (!info.isFile()) return new Response("Not found", { status: 404 });
        const content = await readFile(filename);
        const types: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".mp4": "video/mp4",
          ".m4v": "video/mp4",
          ".mov": "video/quicktime",
          ".webm": "video/webm",
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".m4a": "audio/mp4",
          ".ogg": "audio/ogg",
          ".aac": "audio/aac",
          ".flac": "audio/flac",
        };
        return new Response(content, {
          headers: {
            "Content-Type": types[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            ...corsHeaders,
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    broadcast = new LanBroadcast(() => mainWindow, () => publicWindow);
    registerIpc();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
    app.on("before-quit", (event) => {
      if (quitting) {
        database.close();
        return;
      }
      event.preventDefault();
      quitting = true;
      void broadcast.stop().catch((error: unknown) => {
        console.error("Unable to stop LAN broadcast cleanly:", error);
      }).finally(() => {
        database.close();
        app.quit();
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("OPVTT could not start", message);
    app.quit();
  }
}).catch((error: unknown) => {
  dialog.showErrorBox("OPVTT could not start", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
