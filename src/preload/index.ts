import { contextBridge, ipcRenderer } from "electron";
import type { OpvttApi } from "../shared/types";

const api: OpvttApi = {
  rooms: {
    list: () => ipcRenderer.invoke("rooms:list"),
    create: (name, description) => ipcRenderer.invoke("rooms:create", name, description),
    update: (id, name, description) => ipcRenderer.invoke("rooms:update", id, name, description),
    delete: (id) => ipcRenderer.invoke("rooms:delete", id),
    board: (id) => ipcRenderer.invoke("rooms:board", id),
    saveBoard: (id, board) => ipcRenderer.invoke("rooms:saveBoard", id, board),
    content: (id) => ipcRenderer.invoke("rooms:content", id),
    saveContent: (id, content) => ipcRenderer.invoke("rooms:saveContent", id, content),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings) => ipcRenderer.invoke("settings:set", settings),
    activeDatabase: () => ipcRenderer.invoke("settings:activeDatabase"),
    importDatabase: () => ipcRenderer.invoke("settings:importDatabase"),
    backup: () => ipcRenderer.invoke("settings:backup"),
    createDatabase: () => ipcRenderer.invoke("settings:createDatabase"),
  },
  files: {
    import: (kind) => ipcRenderer.invoke("files:import", kind),
    choose: (kind) => ipcRenderer.invoke("files:choose", kind),
    assetUrl: (filename) => ipcRenderer.invoke("files:assetUrl", filename),
    removeAsset: (filename) => ipcRenderer.invoke("files:removeAsset", filename),
  },
  media: {
    resolve: (link, audioOnly) => ipcRenderer.invoke("media:resolve", link, audioOnly),
  },
  windows: {
    displays: () => ipcRenderer.invoke("windows:displays"),
    onMainFullscreen: (callback) => subscribe("windows:mainFullscreen", callback),
    onPreviewBoard: (callback) => subscribe("windows:previewBoard", callback),
    updatePreviewBoard: (roomId, board, viewport) => ipcRenderer.invoke("windows:updatePreviewBoard", roomId, board, viewport),
    openPublic: (roomId) => ipcRenderer.invoke("windows:openPublic", roomId),
    closePublic: () => ipcRenderer.invoke("windows:closePublic"),
    toggleFullscreen: () => ipcRenderer.invoke("windows:toggleFullscreen"),
  },
  broadcast: {
    start: (port) => ipcRenderer.invoke("broadcast:start", port),
    stop: () => ipcRenderer.invoke("broadcast:stop"),
    status: () => ipcRenderer.invoke("broadcast:status"),
    publish: (secret, active) => ipcRenderer.invoke("broadcast:publish", secret, active),
    onViewerCount: (callback) => subscribe("broadcast:viewers", callback),
    onBroadcastStopped: (callback) => subscribe("broadcast:stopped", callback),
  },
  onWindowClose: (callback) => subscribe("window:close", callback),
};

contextBridge.exposeInMainWorld("opvtt", api);

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
