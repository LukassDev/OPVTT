import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Dice5,
  Gamepad2,
  LayoutDashboard,
  Moon,
  Plus,
  Radio,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { AppSettings, BoardState, BoardViewport, DisplayOption, RoomContent, RoomSummary } from "../../shared/types";
import BoardCanvas from "./BoardCanvas";
import Studio from "./Studio";

type Page = "home" | "studio" | "settings";
const defaults: AppSettings = {
  theme: "dark",
  display: "",
  fullscreen: false,
  mainFullscreen: true,
  quality: "FULL_HD",
  port: 8080,
};

export default function App() {
  const isPublic = new URLSearchParams(location.search).has("public");
  const publicRoomId = new URLSearchParams(location.search).get("roomId") ?? undefined;
  const [page, setPage] = useState<Page>("home");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [content, setContent] = useState<RoomContent | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");

  const roomCountLabel = useMemo(
    () => `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`,
    [rooms.length],
  );

  useEffect(() => {
    let mounted = true;
    if (!window.opvtt) {
      setError("This workspace requires the OPVTT Electron desktop app.");
      setLoading(false);
      return () => { mounted = false; };
    }
    void Promise.all([window.opvtt.rooms.list(), window.opvtt.settings.get()])
      .then(([loadedRooms, loadedSettings]) => {
        if (!mounted) return;
        setRooms(loadedRooms);
        setSettings({ ...defaults, ...loadedSettings });
        document.documentElement.dataset.theme = loadedSettings.theme;
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!window.opvtt) return;
    return window.opvtt.windows.onMainFullscreen((mainFullscreen) => {
      setSettings((current) => ({ ...current, mainFullscreen }));
    });
  }, []);

  useEffect(() => {
    if (content === null || !room || isPublic) return;
    const timer = window.setTimeout(() => {
      void window.opvtt.rooms.saveContent(room.id, content).catch((cause: unknown) => setError(messageOf(cause)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [content, isPublic, room]);

  useEffect(() => {
    if (page !== "studio" || !room || isPublic) return;
    const title = document.title;
    document.title = `${room.name} · OPVTT`;
    return () => { document.title = title; };
  }, [page, room, isPublic]);

  async function openRoom(selected: RoomSummary) {
    try {
      const roomContent = await window.opvtt.rooms.content(selected.id);
      await window.opvtt.windows.openPublic(selected.id);
      setRoom(selected);
      setContent(roomContent);
      setPage("studio");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function refreshRooms(next: RoomSummary[]) {
    setRooms(next);
    setDialog(null);
    setRoomName("");
    setDescription("");
  }

  async function saveRoom(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = dialog === "edit" && room
        ? await window.opvtt.rooms.update(room.id, roomName, description)
        : await window.opvtt.rooms.create(roomName, description);
      await refreshRooms(next);
      if (dialog === "edit" && room) setRoom({ ...room, name: roomName.trim(), description });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function deleteRoom(target: RoomSummary) {
    if (!window.confirm(`Delete “${target.name}”? A database backup will be created first.`)) return;
    try {
      await refreshRooms(await window.opvtt.rooms.delete(target.id));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function changeSettings(patch: Partial<AppSettings>) {
    try {
      const next = await window.opvtt.settings.set(patch);
      setSettings(next);
      document.documentElement.dataset.theme = next.theme;
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  if (!window.opvtt) {
    return <div className="bridge-required"><span className="brand-orbit"><span /></span><span className="eyebrow">OPVTT DESKTOP</span><h1>Open this workspace in the desktop app.</h1><p>The React interface needs Electron to access your local rooms and media safely.</p></div>;
  }

  if (isPublic) {
    return (
      <PublicWindow
        theme={settings.theme}
        roomId={publicRoomId}
        onError={setError}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <button className="brand-mark" aria-label="OPVTT home" onClick={() => { setPage("home"); setRoom(null); }}>
          <span className="brand-orbit"><span /></span>
        </button>
        <div className="rail-group">
          <RailButton active={page === "home"} label="Rooms" onClick={() => { setPage("home"); setRoom(null); }}>
            <LayoutDashboard />
          </RailButton>
          <RailButton active={page === "studio"} label="Studio" disabled={!room} onClick={() => setPage("studio")}>
            <Gamepad2 />
          </RailButton>
        </div>
        <div className="rail-bottom">
          <RailButton active={page === "settings"} label="Settings" onClick={() => setPage("settings")}>
            <SettingsIcon />
          </RailButton>
          <span className="rail-avatar">O</span>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-brand">OPVTT</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button theme-toggle" aria-label="Toggle theme" title="Toggle theme"
              onClick={() => void changeSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}>
              {settings.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}

        {loading ? (
          <div className="loading-screen"><span className="loader" /><p>Preparing your table…</p></div>
        ) : page === "home" ? (
          <Home
            rooms={rooms}
            roomCount={roomCountLabel}
            onCreate={() => { setDialog("create"); setRoomName(""); setDescription(""); }}
            onEdit={(target) => { setRoom(target); setRoomName(target.name); setDescription(target.description); setDialog("edit"); }}
            onDelete={(target) => void deleteRoom(target)}
            onOpen={(target) => void openRoom(target)}
          />
        ) : page === "settings" ? (
          <SettingsPage settings={settings} onChange={changeSettings} onError={setError}
            onRooms={setRooms} onBack={() => setPage("home")} />
        ) : room ? (
          <Studio room={room} content={content ?? emptyContent()} onContentChange={setContent}
            onBack={() => { void window.opvtt.windows.closePublic(); setPage("home"); setRoom(null); }} onError={setError}
            onRename={() => { setRoomName(room.name); setDescription(room.description); setDialog("edit"); }} />
        ) : (
          <Home rooms={rooms} roomCount={roomCountLabel} onCreate={() => setDialog("create")}
            onEdit={() => {}} onDelete={(target) => void deleteRoom(target)} onOpen={(target) => void openRoom(target)} />
        )}
      </main>

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}>
          <form className="modal-card" onSubmit={(event) => void saveRoom(event)}>
            <div className="modal-heading">
              <div><span className="eyebrow">{dialog === "edit" ? "ROOM DETAILS" : "NEW ADVENTURE"}</span><h2>{dialog === "edit" ? "Edit room" : "Create a room"}</h2></div>
              <button type="button" className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <label className="field-label">Room name<input autoFocus maxLength={80} required value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="The Sunken Citadel" /></label>
            <label className="field-label">Description <span className="optional">Optional</span><textarea maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A few words about this campaign…" /></label>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button className="button button-primary">{dialog === "edit" ? "Save changes" : <><Plus size={16} /> Create room</>}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function Home({ rooms, roomCount, onCreate, onEdit, onDelete, onOpen }: {
  rooms: RoomSummary[];
  roomCount: string;
  onCreate: () => void;
  onEdit: (room: RoomSummary) => void;
  onDelete: (room: RoomSummary) => void;
  onOpen: (room: RoomSummary) => void;
}) {
  const [menuRoom, setMenuRoom] = useState("");
  return (
    <div className="home-page">
      <section className="welcome-row">
        <div><span className="eyebrow">YOUR ADVENTURE STARTS HERE</span><h1>Make room for the story.</h1><p>Create a room, arrange the map, and bring your players in.</p></div>
        <button className="button button-primary button-create" onClick={onCreate}><Plus size={17} /> New room</button>
      </section>
      <section className="room-section">
        <div className="section-heading"><div><h2>Your rooms</h2><span className="muted-copy">{roomCount}</span></div></div>
        {rooms.length ? (
          <div className="room-grid">
            {rooms.map((item, index) => (
              <article className={`room-card room-card-${index % 3}`} key={item.id}>
                <button className="room-art" onClick={() => onOpen(item)} aria-label={`Open ${item.name}`}>
                  <span className="art-grid" /><span className="art-sigil">{index % 3 === 1 ? <Sparkles /> : <Gamepad2 />}</span>
                  <span className="room-open">Enter room <ChevronRight size={15} /></span>
                </button>
                <div className="room-info">
                  <div className="room-title-row"><div><h3>{item.name}</h3><span className="room-meta"><span className="status-dot" /> Ready to play</span></div>
                    <button className="icon-button room-menu-trigger" aria-label="Room options" onClick={() => setMenuRoom(menuRoom === item.id ? "" : item.id)}><span>•••</span></button></div>
                  <p>{item.description || "No description yet."}</p>
                  {menuRoom === item.id && <div className="room-menu">
                    <button onClick={() => { setMenuRoom(""); onEdit(item); }}>Edit details</button>
                    <button className="danger-text" onClick={() => { setMenuRoom(""); onDelete(item); }}><Trash2 size={14} /> Delete room</button>
                  </div>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><BookOpen size={24} /></div><h3>No rooms yet</h3><p>Create a room to set up a table for your players.</p><button className="button button-quiet" onClick={onCreate}><Plus size={16} /> Create your first room</button>
          </div>
        )}
      </section>
      <section className="home-tip"><span>Rooms are stored on this device. No account required.</span></section>
    </div>
  );
}

function SettingsPage({ settings, onChange, onError, onRooms, onBack }: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void>;
  onError: (message: string) => void;
  onRooms: (rooms: RoomSummary[]) => void;
  onBack: () => void;
}) {
  const [activeDb, setActiveDb] = useState("");
  const [displays, setDisplays] = useState<DisplayOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void window.opvtt.settings.activeDatabase().then(setActiveDb).catch((e: unknown) => onError(messageOf(e)));
    void window.opvtt.windows.displays().then(setDisplays).catch((e: unknown) => onError(messageOf(e)));
  }, [onError]);

  async function run(action: () => Promise<unknown>, success: (result: unknown) => void) {
    setBusy(true);
    setNotice("");
    try { success(await action()); } catch (cause) { onError(messageOf(cause)); } finally { setBusy(false); }
  }
  const settingsRows = [
    { key: "theme", title: "Appearance", detail: "Choose a light or dark workspace", control: <select value={settings.theme} onChange={(e) => void onChange({ theme: e.target.value as AppSettings["theme"] })}><option value="dark">Dark</option><option value="light">Light</option></select> },
    { key: "display", title: "Public display", detail: "Monitor used when the audience window next opens", control: <select value={settings.display} onChange={(e) => void onChange({ display: e.target.value })}><option value="">Primary display</option>{displays.map((display) => <option key={display.id} value={display.id}>{display.label}</option>)}</select> },
    { key: "quality", title: "Broadcast quality", detail: "Video resolution for the public stream", control: <select value={settings.quality} onChange={(e) => void onChange({ quality: e.target.value as AppSettings["quality"] })}><option value="FULL_HD">1080p · Full HD</option><option value="HD">720p · HD</option></select> },
    { key: "port", title: "Broadcast port", detail: "TCP port for the local player and signaling", control: <input type="number" min={1024} max={65535} value={settings.port} onChange={(e) => void onChange({ port: Number(e.target.value) })} /> },
    { key: "mainFullscreen", title: "Fullscreen workspace", detail: "Toggle fullscreen with F11", control: <button className={`switch ${settings.mainFullscreen ? "on" : ""}`} role="switch" aria-checked={settings.mainFullscreen} onClick={() => void onChange({ mainFullscreen: !settings.mainFullscreen })}><span /></button> },
    { key: "fullscreen", title: "Fullscreen public window", detail: "Open the audience display in fullscreen", control: <button className={`switch ${settings.fullscreen ? "on" : ""}`} role="switch" aria-checked={settings.fullscreen} onClick={() => void onChange({ fullscreen: !settings.fullscreen })}><span /></button> },
  ];
  return (
    <div className="settings-page">
      <div className="settings-back-row"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to rooms</button></div>
      <div className="settings-title"><span className="eyebrow">PREFERENCES</span><h1>Make it yours.</h1><p>Fine-tune your workspace and take care of your game data.</p></div>
      <section className="settings-section"><div className="settings-section-heading"><div className="settings-icon"><SettingsIcon size={18} /></div><div><h2>Workspace</h2><p>Your visual and broadcast preferences</p></div></div>
        <div className="settings-card">{settingsRows.map((row) => <div className="settings-row" key={row.key}><div><strong>{row.title}</strong><span>{row.detail}</span></div><div className="settings-control">{row.control}</div></div>)}</div>
      </section>
      <section className="settings-section"><div className="settings-section-heading"><div className="settings-icon"><Archive size={18} /></div><div><h2>Data & recovery</h2><p>Room data is stored locally on your device</p></div></div>
        <div className="settings-card">
          <div className="settings-row"><div><strong>Active database</strong><span className="database-path" title={activeDb}>{activeDb || "Loading…"}</span></div><div className="settings-control"><button disabled={busy} className="button button-quiet button-sm" onClick={() => void run(() => window.opvtt.settings.backup(), (result) => setNotice(`Backup created: ${String(result)}`))}>Create backup</button></div></div>
          <div className="settings-row"><div><strong>Import a database</strong><span>Open a valid OPVTT .db file. The source file is preserved.</span></div><div className="settings-control"><button disabled={busy} className="button button-quiet button-sm" onClick={() => void run(() => window.opvtt.settings.importDatabase(), (result) => { if (Array.isArray(result)) onRooms(result); })}>Import data file</button></div></div>
          <div className="settings-row"><div><strong>Start with an empty database</strong><span>Create a separate database. Existing files remain untouched.</span></div><div className="settings-control"><button disabled={busy} className="button button-danger-quiet button-sm" onClick={() => { if (window.confirm("Create a new empty database? Your current data file will be preserved.")) void run(() => window.opvtt.settings.createDatabase(), (result) => { if (Array.isArray(result)) onRooms(result); }); }}>New database</button></div></div>
        </div>
        {notice && <div className="settings-notice" role="status"><Check size={14} />{notice}</div>}
      </section>
      <div className="settings-footer"><Users size={15} /><span>Designed for your table. No accounts, no cloud, no distractions.</span></div>
    </div>
  );
}

function PublicWindow({ theme, roomId, onError }: { theme: AppSettings["theme"]; roomId?: string; onError: (message: string) => void }) {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [viewport, setViewport] = useState<BoardViewport>({ zoom: 111, pan: { x: 0, y: 0 } });
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const refresh = () => window.opvtt.rooms.board(roomId).then((nextBoard) => {
      if (active) setBoard(nextBoard);
    }).catch((e: unknown) => active && onError(messageOf(e)));
    const stopPreviewUpdates = window.opvtt.windows.onPreviewBoard((update) => {
      if (active && update.roomId === roomId) {
        setBoard(update.board);
        setViewport(update.viewport);
      }
    });
    void refresh();
    const syncTimer = window.setTimeout(() => void refresh(), 400);
    return () => {
      active = false;
      stopPreviewUpdates();
      window.clearTimeout(syncTimer);
    };
  }, [roomId, onError]);
  return (
    <div className="public-window">
      <div className="public-canvas-wrap">{board ? <><PublicBoard board={board} viewport={viewport} />{board.blackout && <div className="public-blackout" />}</> : <div className="public-waiting"><Radio size={28} /><span>Open a room in OPVTT Studio to show the table.</span></div>}</div>
    </div>
  );
}

function PublicBoard({ board, viewport }: { board: BoardState; viewport: BoardViewport }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cinematic, setCinematic] = useState<HTMLVideoElement | null>(null);
  const presentation = board.presentation;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) { setCinematic(null); return; }
    if (!presentation) {
      video.pause();
      video.removeAttribute("src");
      setCinematic(null);
      return;
    }
    let active = true;
    const setSource = async () => {
      if (presentation.url) video.src = presentation.url;
      else if (presentation.source) {
        video.crossOrigin = "anonymous";
        video.src = await window.opvtt.files.assetUrl(presentation.source);
      }
      if (!active) return;
      setCinematic(video);
      if (presentation.playing) await video.play();
      else video.pause();
    };
    void setSource().catch((error: unknown) => console.error("Unable to play public cinematic:", error));
    return () => { active = false; };
  }, [presentation?.source, presentation?.url, presentation?.playing]);
  return (
    <div className="public-board-frame" style={{
      transform: `translate(${viewport.pan.x * 100}%, ${viewport.pan.y * 100}%) scale(${viewport.zoom / 100})`,
      transformOrigin: "center",
    }}>
      <BoardCanvas board={board} publicMode cinematic={cinematic} />
      <video ref={videoRef} muted playsInline loop={presentation?.loop ?? false}
        className={presentation?.url ? "cinematic-overlay" : "media-capture-source"} />
      <div className="cinematic-fade" style={{ opacity: presentation?.url ? board.fade ?? 0 : 0 }} />
    </div>
  );
}

function RailButton({ active, disabled, label, onClick, children }: {
  active: boolean; disabled?: boolean; label: string; onClick: () => void; children: React.ReactNode;
}) {
  return <button className={`rail-button ${active ? "active" : ""}`} disabled={disabled} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function emptyContent(): RoomContent {
  return { scenes: [], sheets: [], assets: [], notes: "", maps: [] };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
