import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { WebSocket, WebSocketServer } from "ws";

interface Peer {
  id: string;
  socket: WebSocket;
  role: "host" | "viewer" | null;
  ready: boolean;
}

interface BroadcastStatus {
  live: boolean;
  port: number | null;
  viewers: number;
}

export class LanBroadcast {
  private server: Server | null = null;
  private sockets: WebSocketServer | null = null;
  private readonly peers = new Map<string, Peer>();
  private host: Peer | null = null;
  private secret = "";
  private live = false;
  private port: number | null = null;
  private readonly mainWindow: () => BrowserWindow | null;
  private readonly publicWindow: () => BrowserWindow | null;

  constructor(
    mainWindow: () => BrowserWindow | null,
    publicWindow: () => BrowserWindow | null,
  ) {
    this.mainWindow = mainWindow;
    this.publicWindow = publicWindow;
  }

  async start(port: number): Promise<{ port: number; addresses: string[]; secret: string }> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Choose a port between 1024 and 65535.");
    }
    if (this.server) await this.stop();

    const server = createServer((request, response) => {
      void this.serveReader(request.url ?? "/", response);
    });
    const sockets = new WebSocketServer({ noServer: true });
    this.server = server;
    this.sockets = sockets;
    this.secret = randomBytes(32).toString("hex");
    this.live = false;
    this.port = port;

    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/signal") {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        sockets.emit("connection", websocket, request);
      });
    });
    sockets.on("connection", (socket) => this.accept(socket));
    server.on("error", (error) => {
      this.emitStopped();
      void this.stop();
      console.error("LAN broadcast server error:", error);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    }).catch((error: unknown) => {
      this.server = null;
      this.sockets = null;
      this.port = null;
      if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
        throw new Error(`Port ${port} is already in use.`);
      }
      throw error;
    });

    return { port, addresses: this.addresses(), secret: this.secret };
  }

  async stop(): Promise<void> {
    this.live = false;
    for (const peer of this.peers.values()) peer.socket.close(1001, "Broadcast stopped");
    this.peers.clear();
    this.host = null;
    this.secret = "";
    const sockets = this.sockets;
    const server = this.server;
    this.sockets = null;
    this.server = null;
    this.port = null;
    if (sockets) {
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    this.emitStopped();
  }

  status(): BroadcastStatus {
    return {
      live: this.live,
      port: this.port,
      viewers: [...this.peers.values()].filter((peer) => peer.role === "viewer").length,
    };
  }

  setLive(secret: string, active: boolean): void {
    if (!this.host || secret !== this.secret) throw new Error("Broadcast host authorization failed.");
    if (this.live === active) return;
    this.live = active;
    this.notifyViewers({ type: active ? "live" : "offline" });
    if (!active) {
      for (const peer of this.peers.values()) {
        if (peer.role === "viewer") peer.socket.close(1000, "Broadcast paused");
      }
    }
    this.emitViewerCount();
  }

  private accept(socket: WebSocket): void {
    const peer: Peer = { id: randomUUID(), socket, role: null, ready: false };
    this.peers.set(peer.id, peer);
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        this.handleMessage(peer, message);
      } catch (error) {
        console.warn("Ignoring invalid LAN signaling message:", error);
        socket.close(1003, "Invalid signaling message");
      }
    });
    socket.on("close", () => this.removePeer(peer));
    socket.on("error", (error) => {
      console.warn("LAN signaling peer error:", error);
      this.removePeer(peer);
    });
    this.send(peer, { type: "connected", id: peer.id });
  }

  private handleMessage(peer: Peer, message: Record<string, unknown>): void {
    if (message.type === "register-host") {
      if (typeof message.secret !== "string" || message.secret !== this.secret || this.host) {
        peer.socket.close(1008, "Host authorization failed");
        return;
      }
      peer.role = "host";
      this.host = peer;
      this.send(peer, { type: "host-ready" });
      return;
    }
    if (message.type === "register-viewer") {
      if (peer.role !== null) return;
      peer.role = "viewer";
      if (this.live) {
        this.send(peer, { type: "live" });
      } else {
        this.send(peer, { type: "offline" });
      }
      this.emitViewerCount();
      return;
    }
    if (peer.role === "viewer" && message.type === "viewer-ready") {
      if (!this.live || !this.host || peer.ready) return;
      peer.ready = true;
      this.send(this.host, { type: "viewer-connected", viewerId: peer.id });
      return;
    }
    if (peer.role === "host" && message.type === "signal") {
      const viewer = this.peers.get(String(message.viewerId ?? ""));
      if (!viewer || viewer.role !== "viewer") return;
      this.send(viewer, { type: "signal", payload: message.payload });
      return;
    }
    if (peer.role === "viewer" && message.type === "signal" && this.host) {
      this.send(this.host, { type: "signal", viewerId: peer.id, payload: message.payload });
    }
  }

  private removePeer(peer: Peer): void {
    if (!this.peers.delete(peer.id)) return;
    if (peer === this.host) {
      this.host = null;
      this.live = false;
      this.notifyViewers({ type: "offline" });
    } else if (peer.role === "viewer" && this.host) {
      this.send(this.host, { type: "viewer-disconnected", viewerId: peer.id });
    }
    this.emitViewerCount();
  }

  private notifyViewers(message: unknown): void {
    for (const peer of this.peers.values()) {
      if (peer.role === "viewer") this.send(peer, message);
    }
  }

  private send(peer: Peer | null, message: unknown): void {
    if (peer?.socket.readyState === WebSocket.OPEN) {
      peer.socket.send(JSON.stringify(message));
    }
  }

  private emitViewerCount(): void {
    const count = this.status().viewers;
    for (const window of [this.mainWindow(), this.publicWindow()]) {
      if (window && !window.isDestroyed()) window.webContents.send("broadcast:viewers", count);
    }
  }

  private emitStopped(): void {
    for (const window of [this.mainWindow(), this.publicWindow()]) {
      if (window && !window.isDestroyed()) window.webContents.send("broadcast:stopped");
    }
  }

  private addresses(): string[] {
    const result: string[] = [];
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
      }
    }
    return [...new Set(result)].sort();
  }

  private async serveReader(url: string, response: import("node:http").ServerResponse): Promise<void> {
    const files: Record<string, string> = {
      "/": "index.html",
      "/live": "index.html",
      "/index.html": "index.html",
      "/player.js": "player.js",
      "/player.css": "player.css",
      "/theme.css": "theme.css",
      "/liveIcon.png": "liveIcon.png",
    };
    const filename = files[url.split("?")[0]];
    if (!filename) {
      response.writeHead(404).end("Not found");
      return;
    }
    const directory = app.isPackaged
      ? path.join(app.getAppPath(), "out", "renderer", "reader")
      : path.join(app.getAppPath(), "src", "renderer", "public", "reader");
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
    };
    try {
      const content = await readFile(path.join(directory, filename));
      response.writeHead(200, {
        "Content-Type": types[path.extname(filename)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }).end(content);
    } catch (error) {
      console.error("Unable to serve broadcast reader:", error);
      response.writeHead(500).end("Broadcast reader is unavailable.");
    }
  }
}
