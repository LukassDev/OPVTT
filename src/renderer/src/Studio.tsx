import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  Eraser,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  MousePointer2,
  Layers3,
  Library,
  MessageSquareText,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Redo2,
  Save,
  Send,
  Settings2,
  Shuffle,
  Square,
  Trash2,
  Undo2,
  Users,
  Volume2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  BoardState,
  CharacterSheet,
  LibraryAsset,
  MapLayer,
  RoomContent,
  RoomSummary,
  Token,
} from "../../shared/types";
import BoardCanvas from "./BoardCanvas";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  findAvailableTokenPosition,
  normalizeTokenPositions,
  placeTokenWithoutOverlap,
  tokenAt,
} from "./boardGeometry";

type Panel = "layers" | "characters" | "library" | "notes" | "media" | "dice" | "broadcast";
type Tool = "select" | "fog" | "reveal";

const blankBoard: BoardState = { map: "", tokens: [], fog: [], announcement: "", mapLayers: [] };
const panelItems: Array<{ id: Panel; label: string; icon: typeof Layers3 }> = [
  { id: "layers", label: "Layers", icon: Layers3 },
  { id: "characters", label: "Characters", icon: Users },
  { id: "library", label: "Library", icon: Library },
  { id: "notes", label: "GM notes", icon: MessageSquareText },
  { id: "media", label: "Media", icon: Film },
  { id: "dice", label: "Dice", icon: Shuffle },
  { id: "broadcast", label: "Broadcast", icon: Radio },
];

export default function Studio({
  room,
  content,
  onContentChange,
  onBack,
  onError,
  onRename,
}: {
  room: RoomSummary;
  content: RoomContent;
  onContentChange: (content: RoomContent) => void;
  onBack: () => void;
  onError: (message: string) => void;
  onRename: () => void;
}) {
  const [board, setBoard] = useState<BoardState>(blankBoard);
  const [panel, setPanel] = useState<Panel>("layers");
  const [tool, setTool] = useState<Tool>("select");
  const [selectedToken, setSelectedToken] = useState("");
  const [hoveredToken, setHoveredToken] = useState("");
  const [zoom, setZoom] = useState(111);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef({ zoom, pan });
  viewportRef.current = { zoom, pan };
  const [showOverview, setShowOverview] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [ready, setReady] = useState(false);
  const [cinematicPath, setCinematicPath] = useState("");
  const [cinematicUrl, setCinematicUrl] = useState("");
  const [isCinematicPlaying, setCinematicPlaying] = useState(false);
  const [cinematicLoop, setCinematicLoop] = useState(false);
  const [fadeDuration, setFadeDuration] = useState(0.7);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [musicPath, setMusicPath] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [musicLoop, setMusicLoop] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [notification, setNotification] = useState("");
  const [undoStack, setUndoStack] = useState<BoardState[]>([]);
  const [redoStack, setRedoStack] = useState<BoardState[]>([]);
  const [fogPreview, setFogPreview] = useState<BoardState["fog"][number] | null>(null);
  const [characterDraft, setCharacterDraft] = useState<CharacterSheet | null>(null);
  const [broadcastPort, setBroadcastPort] = useState(8080);
  const [broadcastData, setBroadcastData] = useState<{ port: number; addresses: string[]; secret: string } | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [broadcastLive, setBroadcastLive] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [broadcastLink, setBroadcastLink] = useState("");
  const [broadcastAddress, setBroadcastAddress] = useState("");
  const [themeVersion, setThemeVersion] = useState(0);
  const notificationTimer = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewDragPosition = useRef<{ x: number; y: number } | null>(null);
  const fadeGeneration = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; tokenId: string } | null>(null);
  const tokenDragOrigin = useRef<BoardState | null>(null);
  const tokenMoved = useRef(false);
  const tokenDragArmed = useRef(false);
  const tokenPress = useRef<{ x: number; y: number; tokenId: string } | null>(null);
  const tokenLongPress = useRef<number | null>(null);
  const lastTokenClick = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; fog: BoardState["fog"][number] | null } | null>(null);
  const hostSocket = useRef<WebSocket | null>(null);
  const hostPeers = useRef(new Map<string, RTCPeerConnection>());
  const pendingHostIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const captureStream = useRef<MediaStream | null>(null);
  const externalCinematicCompositable = useRef(false);
  const publicCaptureBoardRef = useRef<HTMLCanvasElement | null>(null);
  const broadcastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const broadcastFrameTimer = useRef<number | null>(null);
  const broadcastAudioContext = useRef<AudioContext | null>(null);
  const broadcastAudioDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const broadcastAudioSources = useRef(new Map<HTMLMediaElement, MediaElementAudioSourceNode>());
  const broadcastAudioVolumeHandlers = useRef(new Map<HTMLMediaElement, () => void>());
  const boardRef = useRef(board);
  boardRef.current = board;
  const stopBroadcastRef = useRef<() => Promise<void>>(async () => undefined);
  const requestBroadcastFrame = useCallback(() => {
    drawPublicBroadcastFrame();
    const track = captureStream.current?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (track && typeof track.requestFrame === "function") track.requestFrame();
  }, []);

  useEffect(() => {
    let active = true;
    void window.opvtt.rooms.board(room.id).then((saved) => {
      if (!active) return;
      const normalized = normalizeTokenPositions(saved.tokens);
      const loadedBoard = {
        ...blankBoard,
        ...saved,
        tokens: normalized.tokens,
        mapLayers: saved.mapLayers.map((layer, index) => ({
          ...layer,
          name: displayAssetName(layer.name, "Map layer", index + 1),
        })),
      };
      boardRef.current = loadedBoard;
      setBoard(loadedBoard);
      setReady(true);
      if (normalized.unresolved) {
        onError(`${normalized.unresolved} token(s) could not be separated because there is not enough free space on the board.`);
      }
    }).catch((cause: unknown) => onError(messageOf(cause)));
    return () => { active = false; };
  }, [room.id, onError]);

  useEffect(() => () => {
    if (tokenLongPress.current !== null) window.clearTimeout(tokenLongPress.current);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void window.opvtt.rooms.saveBoard(room.id, board).catch((cause: unknown) => onError(messageOf(cause)));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [board, ready, room.id, onError]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void window.opvtt.windows.updatePreviewBoard(room.id, board, previewViewport())
        .catch((cause: unknown) => onError(messageOf(cause)));
    }, 33);
    return () => window.clearTimeout(timer);
  }, [board, pan, ready, room.id, zoom, onError]);

  function previewViewport() {
    const frame = canvasRef.current?.parentElement;
    const width = frame?.clientWidth || 960;
    const height = frame?.clientHeight || 540;
    return {
      zoom,
      pan: { x: pan.x / width, y: pan.y / height },
    };
  }

  useEffect(() => {
    void Promise.all([window.opvtt.broadcast.status(), window.opvtt.settings.get()])
      .then(([status, settings]) => {
        setBroadcastPort(status.port ?? settings.port);
        if (status.live) setBroadcastLive(true);
      }).catch((cause: unknown) => onError(messageOf(cause)));
    const stopCount = window.opvtt.broadcast.onViewerCount(setViewerCount);
    const stopBroadcast = window.opvtt.broadcast.onBroadcastStopped(() => {
      setBroadcastLive(false);
      setBroadcastData(null);
      setViewerCount(0);
      setBroadcastLink("");
      setQr("");
    });
    return () => {
      stopCount();
      stopBroadcast();
    };
  }, [onError]);

  useEffect(() => {
    let active = true;
    if (!broadcastData) return;
    const address = broadcastAddress || broadcastData.addresses[0] || "127.0.0.1";
    const link = `http://${address}:${broadcastData.port}/live`;
    setBroadcastLink(link);
    const palette = getComputedStyle(document.documentElement);
    const dark = palette.getPropertyValue("--text").trim();
    const light = palette.getPropertyValue("--surface-raised").trim();
    void QRCode.toDataURL(link, { width: 220, margin: 1, color: { dark, light } })
      .then((value) => active && setQr(value))
      .catch((cause: unknown) => onError(messageOf(cause)));
    return () => { active = false; };
  }, [broadcastAddress, broadcastData, onError, themeVersion]);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cinematicPath) return;
    void window.opvtt.files.assetUrl(cinematicPath).then((url) => {
      video.crossOrigin = "anonymous";
      video.src = url;
      video.load();
    }).catch((cause: unknown) => onError(messageOf(cause)));
  }, [cinematicPath, onError]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !musicPath) return;
    void window.opvtt.files.assetUrl(musicPath).then((url) => {
      audio.src = url;
      audio.load();
    }).catch((cause: unknown) => onError(messageOf(cause)));
  }, [musicPath, onError]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => () => {
    void stopBroadcastRef.current();
    for (const [element, handler] of broadcastAudioVolumeHandlers.current) {
      element.removeEventListener("volumechange", handler);
    }
    if (notificationTimer.current !== null) window.clearTimeout(notificationTimer.current);
    void broadcastAudioContext.current?.close();
  }, []);

  const setBoardUndoable = useCallback((next: BoardState | ((current: BoardState) => BoardState)) => {
    const current = boardRef.current;
    const resolved = typeof next === "function" ? next(current) : next;
    if (resolved === current) return;
    setUndoStack((items) => [...items.slice(-39), current]);
    setRedoStack([]);
    boardRef.current = resolved;
    setBoard(resolved);
  }, []);

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((redo) => [...redo, boardRef.current]);
    setUndoStack((stack) => stack.slice(0, -1));
    boardRef.current = previous;
    setBoard(previous);
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((undo) => [...undo, boardRef.current]);
    setRedoStack((stack) => stack.slice(0, -1));
    boardRef.current = next;
    setBoard(next);
  }

  function boardPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - bounds.left) / bounds.width) * 960, y: ((event.clientY - bounds.top) / bounds.height) * 540 };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.ctrlKey || event.button === 1) {
      panStart.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
      return;
    }
    const point = boardPoint(event);
    const token = tokenAt(boardRef.current.tokens, point.x, point.y);
    setHoveredToken(token?.id ?? "");
    if (!token && tool !== "select") {
      dragRef.current = { ...point, fog: null };
      setFogPreview(null);
      return;
    }
    if (!token) {
      setSelectedToken("");
      pointerStart.current = null;
      const point = boardPoint(event);
      setHoveredToken(tokenAt(boardRef.current.tokens, point.x, point.y)?.id ?? "");
      return;
    }
    setSelectedToken(token.id);
    pointerStart.current = { ...point, tokenId: token.id };
    tokenDragOrigin.current = boardRef.current;
    tokenMoved.current = false;
    tokenPress.current = { x: event.clientX, y: event.clientY, tokenId: token.id };
    const lastClick = lastTokenClick.current;
    tokenDragArmed.current = event.detail >= 2
      || Boolean(lastClick
        && lastClick.id === token.id
        && performance.now() - lastClick.time <= 500
        && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= 8);
    if (!tokenDragArmed.current) {
      tokenLongPress.current = window.setTimeout(() => {
        tokenDragArmed.current = true;
        tokenLongPress.current = null;
      }, 2000);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (panStart.current) {
      const frame = canvasRef.current?.parentElement;
      const scale = zoom / 100;
      const maxX = frame ? frame.offsetWidth * Math.max(0, scale - 1) / 2 : Infinity;
      const maxY = frame ? frame.offsetHeight * Math.max(0, scale - 1) / 2 : Infinity;
      setPan({
        x: clamp(panStart.current.originX + event.clientX - panStart.current.x, -maxX, maxX),
        y: clamp(panStart.current.originY + event.clientY - panStart.current.y, -maxY, maxY),
      });
      return;
    }
    const start = pointerStart.current;
    if (start) {
      if (!tokenDragArmed.current) {
        const press = tokenPress.current;
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8
          && tokenLongPress.current !== null) {
          window.clearTimeout(tokenLongPress.current);
          tokenLongPress.current = null;
        }
        return;
      }
      const point = boardPoint(event);
      if (Math.hypot(point.x - start.x, point.y - start.y) > 1) {
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        const current = boardRef.current;
        const movingToken = current.tokens.find((item) => item.id === start.tokenId);
        if (!movingToken) return;
        const nextPosition = placeTokenWithoutOverlap(
          movingToken,
          current.tokens,
          movingToken.x + dx,
          movingToken.y + dy,
        );
        pointerStart.current = { ...point, tokenId: start.tokenId };
        if (nextPosition.x === movingToken.x && nextPosition.y === movingToken.y) return;
        const next = {
          ...current,
          tokens: current.tokens.map((item) => item.id === start.tokenId
            ? { ...item, ...nextPosition }
            : item),
        };
        boardRef.current = next;
        setBoard(next);
        tokenMoved.current = true;
      }
    }
    const drag = dragRef.current;
    if (drag) {
      const point = boardPoint(event);
      const fog = { x: Math.min(drag.x, point.x), y: Math.min(drag.y, point.y), width: Math.abs(point.x - drag.x), height: Math.abs(point.y - drag.y) };
      dragRef.current = { ...drag, fog };
      setFogPreview(fog);
    } else if (!start) {
      const point = boardPoint(event);
      setHoveredToken(tokenAt(boardRef.current.tokens, point.x, point.y)?.id ?? "");
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    panStart.current = null;
    if (tokenLongPress.current !== null) {
      window.clearTimeout(tokenLongPress.current);
      tokenLongPress.current = null;
    }
    if (tokenMoved.current && tokenDragOrigin.current) {
      setUndoStack((stack) => [...stack.slice(-39), tokenDragOrigin.current!]);
      setRedoStack([]);
    }
    const press = tokenPress.current;
    if (press && !tokenDragArmed.current) {
      lastTokenClick.current = {
        id: press.tokenId,
        time: performance.now(),
        x: event.clientX,
        y: event.clientY,
      };
    }
    tokenPress.current = null;
    tokenDragArmed.current = false;
    tokenDragOrigin.current = null;
    tokenMoved.current = false;
    const drag = dragRef.current;
    if (drag?.fog && drag.fog.width > 0 && drag.fog.height > 0) {
      if (tool === "fog") setBoardUndoable((current) => ({ ...current, fog: [...current.fog, drag.fog!] }));
      else setBoardUndoable((current) => ({ ...current, fog: subtractFog(current.fog, drag.fog!) }));
    }
    dragRef.current = null;
    setFogPreview(null);
    pointerStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function changeViewportZoom(nextZoom: number) {
    setPan((current) => {
      if (nextZoom <= 100) return { x: 0, y: 0 };
      const ratio = nextZoom / zoom;
      return { x: current.x * ratio, y: current.y * ratio };
    });
    setZoom(nextZoom);
  }

  function handleBoardWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (!event.ctrlKey) return;
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const frame = canvasRef.current?.parentElement;
    if (!canvasBounds || !frame) return;
    const offsetX = event.clientX - (canvasBounds.left + canvasBounds.width / 2);
    const offsetY = event.clientY - (canvasBounds.top + canvasBounds.height / 2);
    const nextZoom = clamp(zoom + (event.deltaY < 0 ? 25 : -25), 50, 300);
    if (nextZoom === zoom) return;
    const ratio = nextZoom / zoom;
    const scale = nextZoom / 100;
    const maxX = frame.offsetWidth * Math.max(0, scale - 1) / 2;
    const maxY = frame.offsetHeight * Math.max(0, scale - 1) / 2;
    setPan((current) => ({
      x: clamp(current.x + offsetX * (1 - ratio), -maxX, maxX),
      y: clamp(current.y + offsetY * (1 - ratio), -maxY, maxY),
    }));
    setZoom(nextZoom);
  }

  function beginOverviewNavigation(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewport = event.currentTarget.querySelector(".overview-viewport")?.getBoundingClientRect();
    const insideViewport = Boolean(viewport
      && event.clientX >= viewport.left && event.clientX <= viewport.right
      && event.clientY >= viewport.top && event.clientY <= viewport.bottom);
    const offsetX = insideViewport && viewport ? event.clientX - (viewport.left + viewport.width / 2) : 0;
    const offsetY = insideViewport && viewport ? event.clientY - (viewport.top + viewport.height / 2) : 0;
    const frame = canvasRef.current?.parentElement;
    if (bounds.width && bounds.height && frame) {
      const centerX = clamp((event.clientX - offsetX - bounds.left) / bounds.width, 0, 1);
      const centerY = clamp((event.clientY - offsetY - bounds.top) / bounds.height, 0, 1);
      const scale = zoom / 100;
      setPan({
        x: clamp((0.5 - centerX) * frame.offsetWidth * scale,
          -frame.offsetWidth * Math.max(0, scale - 1) / 2, frame.offsetWidth * Math.max(0, scale - 1) / 2),
        y: clamp((0.5 - centerY) * frame.offsetHeight * scale,
          -frame.offsetHeight * Math.max(0, scale - 1) / 2, frame.offsetHeight * Math.max(0, scale - 1) / 2),
      });
    }
    overviewDragPosition.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveOverviewNavigation(event: React.PointerEvent<HTMLDivElement>) {
    const previous = overviewDragPosition.current;
    if (!previous) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const frame = canvasRef.current?.parentElement;
    if (!frame || !bounds.width || !bounds.height) return;
    const scale = zoom / 100;
    const maxX = frame.offsetWidth * Math.max(0, scale - 1) / 2;
    const maxY = frame.offsetHeight * Math.max(0, scale - 1) / 2;
    setPan((current) => ({
      x: clamp(current.x - (event.clientX - previous.x) / bounds.width * frame.offsetWidth * scale, -maxX, maxX),
      y: clamp(current.y - (event.clientY - previous.y) / bounds.height * frame.offsetHeight * scale, -maxY, maxY),
    }));
    overviewDragPosition.current = { x: event.clientX, y: event.clientY };
  }

  function endOverviewNavigation(event: React.PointerEvent<HTMLDivElement>) {
    overviewDragPosition.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function importLayer() {
    const paths = await window.opvtt.files.import("images");
    if (!paths.length) return;
    const layers = paths.map((filename, index): MapLayer => ({
      id: crypto.randomUUID(),
      name: displayAssetName(filename, "Map layer", board.mapLayers.length + index + 1),
      path: filename,
      visible: true,
    }));
    setBoardUndoable((current) => ({ ...current, map: "", mapLayers: [...current.mapLayers, ...layers] }));
    onContentChange({ ...content, assets: [...content.assets, ...layers.map((layer) => ({ id: layer.id, name: layer.name, path: layer.path, kind: "image" }))] });
    notify(`${layers.length} map ${layers.length === 1 ? "layer added" : "layers added"}`);
  }

  function addCharacterToken(sheet: CharacterSheet) {
    const token: Token = {
      id: `sheet:${sheet.id}`, name: sheet.name, x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2, visible: true,
      imagePath: sheet.imagePath, ratio: sheet.tokenRatio,
    };
    const position = findAvailableTokenPosition(token, boardRef.current.tokens);
    if (!position) {
      notify("There is no free space left on the board for this token.");
      return;
    }
    Object.assign(token, position);
    setBoardUndoable((current) => ({ ...current, tokens: [...current.tokens, token] }));
    setSelectedToken(token.id);
  }

  async function importLibrary(kind: "images" | "videos") {
    const paths = await window.opvtt.files.import(kind);
    if (!paths.length) return;
    const assets = paths.map((filename): LibraryAsset => ({
      id: crypto.randomUUID(), name: baseName(filename), path: filename,
      kind: kind === "images" ? "Image" : "Video",
    }));
    onContentChange({ ...content, assets: [...content.assets, ...assets] });
    notify(`${assets.length} ${assets.length === 1 ? "asset imported" : "assets imported"}`);
  }

  async function chooseCinematic() {
    const [filename] = await window.opvtt.files.import("videos");
    if (filename) {
      setCinematicPath(filename);
      setCinematicUrl("");
      setPanel("media");
    }
  }

  function drawPublicBroadcastFrame() {
    const source = publicCaptureBoardRef.current;
    const canvas = broadcastCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!source || !canvas || !context) return;

    const width = 960;
    const height = 540;
    const frame = canvasRef.current?.parentElement;
    const viewport = viewportRef.current;
    const normalizedPan = {
      x: viewport.pan.x / (frame?.clientWidth || 960),
      y: viewport.pan.y / (frame?.clientHeight || 540),
    };
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);
    if (!boardRef.current.blackout) {
      context.translate(width / 2 + normalizedPan.x * width, height / 2 + normalizedPan.y * height);
      context.scale(viewport.zoom / 100, viewport.zoom / 100);
      context.translate(-width / 2, -height / 2);
      context.drawImage(source, 0, 0, width, height);
      const presentation = boardRef.current.presentation;
      const video = videoRef.current;
      if (presentation?.url && externalCinematicCompositable.current && video
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const ratio = Math.min(width / video.videoWidth, height / video.videoHeight);
        const videoWidth = video.videoWidth * ratio;
        const videoHeight = video.videoHeight * ratio;
        context.drawImage(video, (width - videoWidth) / 2, (height - videoHeight) / 2, videoWidth, videoHeight);
        const fade = clamp(boardRef.current.fade ?? 0, 0, 1);
        if (fade > 0) {
          context.globalAlpha = fade;
          context.fillStyle = "#000000";
          context.fillRect(0, 0, width, height);
          context.globalAlpha = 1;
        }
      }
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function canCompositeExternalVideo(video: HTMLVideoElement): boolean {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return false;
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const context = probe.getContext("2d");
    if (!context) return false;
    try {
      context.drawImage(video, 0, 0, 1, 1);
      context.getImageData(0, 0, 1, 1);
      return true;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "SecurityError") return false;
      throw cause;
    }
  }

  function ensureBroadcastAudioTrack(): MediaStreamTrack {
    const audioContext = broadcastAudioContext.current;
    const destination = broadcastAudioDestination.current;
    if (!audioContext || !destination) throw new Error("Broadcast audio is not initialized.");

    for (const element of [videoRef.current, audioRef.current]) {
      if (!element || broadcastAudioSources.current.has(element)) continue;
      const source = audioContext.createMediaElementSource(element);
      const broadcastGain = audioContext.createGain();
      const monitorGain = audioContext.createGain();
      broadcastGain.gain.value = 1;
      monitorGain.gain.value = element.muted ? 0 : element.volume;
      source.connect(broadcastGain).connect(destination);
      source.connect(monitorGain).connect(audioContext.destination);
      const syncMonitorVolume = () => {
        monitorGain.gain.value = element.muted ? 0 : element.volume;
      };
      element.addEventListener("volumechange", syncMonitorVolume);
      broadcastAudioVolumeHandlers.current.set(element, syncMonitorVolume);
      broadcastAudioSources.current.set(element, source);
    }

    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("The broadcast audio track is unavailable.");
    return track;
  }

  async function startBroadcast() {
    setBroadcastBusy(true);
    try {
      if (!broadcastAudioContext.current) {
        const audioContext = new AudioContext();
        broadcastAudioContext.current = audioContext;
        broadcastAudioDestination.current = audioContext.createMediaStreamDestination();
      }
      await broadcastAudioContext.current.resume();
      const settings = await window.opvtt.settings.set({ port: broadcastPort });
      const data = await window.opvtt.broadcast.start(settings.port);
      setBroadcastData(data);
      setBroadcastAddress(data.addresses[0] ?? "127.0.0.1");
      const socket = new WebSocket(`ws://127.0.0.1:${data.port}/signal`);
      hostSocket.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "register-host", secret: data.secret }));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; viewerId?: string; payload?: RTCSessionDescriptionInit | RTCIceCandidateInit };
        if (message.type === "host-ready") {
          void window.opvtt.broadcast.publish(data.secret, true).then(() => setBroadcastLive(true)).catch((cause: unknown) => onError(messageOf(cause)));
        } else if (message.type === "viewer-connected" && message.viewerId) {
          const viewerId = message.viewerId;
          void connectViewer(viewerId).catch((cause: unknown) => {
            onError(`Unable to start the viewer stream: ${messageOf(cause)}`);
            hostPeers.current.get(viewerId)?.close();
            hostPeers.current.delete(viewerId);
            pendingHostIce.current.delete(viewerId);
          });
        } else if (message.type === "viewer-disconnected" && message.viewerId) {
          hostPeers.current.get(message.viewerId)?.close();
          hostPeers.current.delete(message.viewerId);
          pendingHostIce.current.delete(message.viewerId);
        } else if (message.type === "signal" && message.viewerId && message.payload) {
          void handleHostSignal(message.viewerId, message.payload)
            .catch((cause: unknown) => onError(`LAN connection negotiation failed: ${messageOf(cause)}`));
        }
      };
      socket.onerror = () => onError("Unable to establish the local broadcast signaling connection.");
      socket.onclose = () => setBroadcastLive(false);
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBroadcastBusy(false);
    }
  }

  async function connectViewer(viewerId: string) {
    const canvas = broadcastCanvasRef.current;
    if (!canvas || !publicCaptureBoardRef.current) throw new Error("The public board capture is unavailable.");
    let stream = captureStream.current;
    if (!stream || stream.getVideoTracks().every((track) => track.readyState !== "live")) {
      stream?.getVideoTracks().forEach((track) => track.stop());
      canvas.width = 1920;
      canvas.height = 1080;
      drawPublicBroadcastFrame();
      stream = canvas.captureStream(30);
      stream.addTrack(ensureBroadcastAudioTrack());
      captureStream.current = stream;
      if (broadcastFrameTimer.current !== null) window.clearInterval(broadcastFrameTimer.current);
      broadcastFrameTimer.current = window.setInterval(requestBroadcastFrame, 1000 / 30);
    }
    const canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!canvasTrack) throw new Error("The board canvas did not provide a video track.");
    requestBroadcastFrame();
    const peer = new RTCPeerConnection({ iceServers: [] });
    hostPeers.current.set(viewerId, peer);
    pendingHostIce.current.set(viewerId, []);
    for (const track of stream.getTracks()) {
      peer.addTrack(track, stream);
    }
    const currentBoard = boardRef.current;
    if (currentBoard.presentation?.url && !currentBoard.blackout) {
      const externalVideo = videoRef.current;
      externalCinematicCompositable.current = Boolean(externalVideo && canCompositeExternalVideo(externalVideo));
      if (!externalCinematicCompositable.current) {
        onError("The online cinematic is blocked by CORS, so the broadcast will show the board without that video.");
      }
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) hostSocket.current?.send(JSON.stringify({ type: "signal", viewerId, payload: event.candidate.toJSON() }));
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) {
        hostPeers.current.delete(viewerId);
        pendingHostIce.current.delete(viewerId);
        peer.close();
      }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    hostSocket.current?.send(JSON.stringify({ type: "signal", viewerId, payload: peer.localDescription?.toJSON() }));
  }

  async function handleHostSignal(
    viewerId: string,
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit,
  ): Promise<void> {
    const peer = hostPeers.current.get(viewerId);
    if (!peer) return;
    if ("type" in payload) {
      await peer.setRemoteDescription(payload);
      const candidates = pendingHostIce.current.get(viewerId) ?? [];
      pendingHostIce.current.set(viewerId, []);
      for (const candidate of candidates) await peer.addIceCandidate(candidate);
    } else if (payload.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(payload);
      else pendingHostIce.current.get(viewerId)?.push(payload);
    }
  }

  async function stopBroadcast() {
    if (broadcastData) {
      await window.opvtt.broadcast.publish(broadcastData.secret, false).catch(() => undefined);
      await window.opvtt.broadcast.stop().catch(() => undefined);
    }
    hostSocket.current?.close();
    hostSocket.current = null;
    for (const peer of hostPeers.current.values()) peer.close();
    hostPeers.current.clear();
    pendingHostIce.current.clear();
    captureStream.current?.getVideoTracks().forEach((track) => track.stop());
    captureStream.current = null;
    if (broadcastFrameTimer.current !== null) {
      window.clearInterval(broadcastFrameTimer.current);
      broadcastFrameTimer.current = null;
    }
    setBroadcastData(null);
    setBroadcastLive(false);
    setViewerCount(0);
    setBroadcastLink("");
    setQr("");
  }
  stopBroadcastRef.current = stopBroadcast;

  async function stopCinematic() {
    const presentation = boardRef.current.presentation;
    const hadPresentation = Boolean(presentation);
    if (hadPresentation) await animateBoardFade(1);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    setCinematicPlaying(false);
    const current = boardRef.current;
    const { presentation: _presentation, ...rest } = current;
    const next = { ...rest, fade: hadPresentation ? 1 : 0 };
    boardRef.current = next;
    setBoard(next);
    void window.opvtt.windows.updatePreviewBoard(room.id, next, previewViewport())
      .catch((cause: unknown) => onError(messageOf(cause)));
    if (hadPresentation) await animateBoardFade(0);
    if (broadcastData) await window.opvtt.broadcast.publish(broadcastData.secret, true);
  }

  function animateBoardFade(target: number): Promise<void> {
    const generation = ++fadeGeneration.current;
    const start = boardRef.current.fade ?? 0;
    const beganAt = performance.now();
    let lastPreviewUpdate = 0;
    return new Promise((resolve) => {
      const step = (now: number) => {
        if (generation !== fadeGeneration.current) {
          resolve();
          return;
        }
        const progress = clamp((now - beganAt) / (fadeDuration * 1000), 0, 1);
        const next = {
          ...boardRef.current,
          fade: start + (target - start) * progress,
        };
        if (next.presentation && videoRef.current) {
          videoRef.current.volume = volume * (1 - next.fade);
        }
        boardRef.current = next;
        setBoard(next);
        if (now - lastPreviewUpdate >= 33 || progress >= 1) {
          lastPreviewUpdate = now;
          void window.opvtt.windows.updatePreviewBoard(room.id, next, previewViewport())
            .catch((cause: unknown) => onError(messageOf(cause)));
        }
        if (progress >= 1) resolve();
        else window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    });
  }

  async function setCinematicPlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (isCinematicPlaying) {
      video.pause();
      setCinematicPlaying(false);
      return;
    }
    if (cinematicUrl) {
      try {
        notify("Preparing compatible online video…", 10 * 60_000);
        const resolved = await window.opvtt.media.resolve(cinematicUrl, false);
        video.pause();
        video.removeAttribute("src");
        video.crossOrigin = "anonymous";
        video.src = resolved.url;
        video.load();
        notify("Video prepared. Starting playback…");
        await waitForMediaReady(video);
      } catch (cause) {
        notify("", 0);
        onError(messageOf(cause));
        return;
      }
    }
    if (!video.src) {
      onError("Choose a video or enter a supported HTTPS media link.");
      return;
    }
    try {
      video.volume = 0;
      await video.play();
      const hasBroadcastViewers = hostPeers.current.size > 0;
      const isExternalCinematic = video.currentSrc.startsWith("https://");
      externalCinematicCompositable.current = hasBroadcastViewers && isExternalCinematic
        ? canCompositeExternalVideo(video)
        : false;
      if (hasBroadcastViewers && isExternalCinematic && !externalCinematicCompositable.current) {
        onError("This online cinematic blocks broadcast capture with CORS. The local preview will play, but viewers will see the board.");
      }
      setCinematicPlaying(true);
      const next = {
        ...boardRef.current,
        fade: 1,
        presentation: {
          source: cinematicPath,
          url: cinematicUrl ? video.src : "",
          playing: true,
          loop: cinematicLoop,
        },
      };
      boardRef.current = next;
      setBoard(next);
      await animateBoardFade(0);
    } catch (cause) {
      notify("", 0);
      video.pause();
      setCinematicPlaying(false);
      video.volume = volume;
      onError(mediaPlaybackError("video", video, cause));
    }
  }

  async function chooseMusic() {
    const [filename] = await window.opvtt.files.import("audio");
    if (filename) {
      setMusicPath(filename);
      setMusicUrl("");
      audioRef.current?.removeAttribute("src");
    }
  }

  async function toggleMusic() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src && musicPath) {
      try { audio.src = await window.opvtt.files.assetUrl(musicPath); } catch (cause) { onError(messageOf(cause)); return; }
    }
    if (!audio.src && musicUrl) {
      try {
        notify("Preparing compatible online audio…", 10 * 60_000);
        const resolved = await window.opvtt.media.resolve(musicUrl, true);
        audio.pause();
        audio.removeAttribute("src");
        audio.crossOrigin = "anonymous";
        audio.src = resolved.url;
        audio.load();
        notify("Audio prepared. Starting playback…");
        await waitForMediaReady(audio);
      } catch (cause) {
        notify("", 0);
        onError(messageOf(cause));
        return;
      }
    }
    if (!audio.src) {
      onError("Choose an audio file or enter a supported HTTPS media link.");
      return;
    }
    if (audioPlaying) audio.pause();
    else {
      try { await audio.play(); } catch (cause) {
        notify("", 0);
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          notify("Audio is ready. Press Play again to start.");
          return;
        }
        onError(mediaPlaybackError("audio", audio, cause));
        return;
      }
    }
    setAudioPlaying(!audioPlaying);
  }

  function notify(text: string, duration = 2600) {
    if (notificationTimer.current !== null) window.clearTimeout(notificationTimer.current);
    setNotification(text);
    notificationTimer.current = duration > 0
      ? window.setTimeout(() => {
        setNotification("");
        notificationTimer.current = null;
      }, duration)
      : null;
  }

  function stopMusic() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setAudioTime(0);
  }

  return (
    <div className="studio-page">
      <aside className="studio-nav">
        <button className="studio-back" onClick={onBack}><ArrowLeft size={16} /><span>All rooms</span></button>
        <div className="studio-room">
          <div className="room-monogram">{room.name.trim().slice(0, 1).toUpperCase()}</div>
          <div className="studio-room-name"><strong title={room.name}>{room.name}</strong></div>
          <button className="icon-button studio-more" onClick={onRename} aria-label="Edit room name"><MoreHorizontal size={18} /></button>
        </div>
        <div className="studio-nav-caption">Workspace</div>
        <nav className="studio-panels">
          {panelItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`studio-nav-item ${panel === id ? "active" : ""}`} onClick={() => setPanel(id)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === "broadcast" && broadcastLive && <i className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="studio-nav-spacer" />
      </aside>

      <section className="studio-workspace">
        <header className="studio-toolbar">
          <div><h1>{room.name}</h1></div>
          <div className="studio-toolbar-actions">
            <button className="button button-quiet button-sm" aria-label="Undo" title="Undo" disabled={!undoStack.length} onClick={undo}><Undo2 /> Undo</button>
            <button className="button button-quiet button-sm" aria-label="Redo" title="Redo" disabled={!redoStack.length} onClick={redo}><Redo2 /> Redo</button>
            <span className="toolbar-divider" />
            <span className="saved-label"><Check size={14} /> Saved</span>
            <button className="button button-quiet button-sm" onClick={() => void window.opvtt.windows.openPublic(room.id)}><Radio size={15} /> Public window</button>
          </div>
        </header>
        <div className="board-area">
          <div className="board-topline">
            <div className="board-options-group"><button className="button button-quiet button-sm board-options" onClick={() => setShowOverview((value) => !value)}><Layers3 /> {showOverview ? "Hide overview" : "Show overview"}</button><button className="button button-quiet button-sm board-options" onClick={() => setExpanded((value) => !value)}><Settings2 /> {expanded ? "Hide tools" : "Show tools"}</button></div></div>
          <div className="board-stage">
            <div className="board-canvas-viewport">
              <div className="board-frame" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}>
                <BoardCanvas board={board} forwardedRef={canvasRef}
                  hoveredToken={hoveredToken}
                  continuousRender={broadcastData !== null}
                  onFrame={requestBroadcastFrame}
                  cinematic={board.presentation ? videoRef.current : null}
                  className={`${tool !== "select" ? "board-crosshair" : ""} ${hoveredToken && tool === "select" ? "token-hovered" : ""}`}
                  onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp} onPointerLeave={() => setHoveredToken("")} onWheel={handleBoardWheel} />
                <video ref={videoRef}
                  className={`media-capture-source ${isCinematicPlaying && cinematicUrl ? "cinematic-overlay" : ""}`}
                  playsInline loop={cinematicLoop}
                  onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
                  onLoadedMetadata={(event) => setVideoDuration(event.currentTarget.duration)}
                  onEnded={() => { setCinematicPlaying(false); void stopCinematic(); }}
                  onPause={() => {
                    setCinematicPlaying(false);
                    setBoard((current) => current.presentation ? { ...current, presentation: { ...current.presentation, playing: false } } : current);
                  }}
                  onPlay={() => {
                    setCinematicPlaying(true);
                    setBoard((current) => current.presentation ? { ...current, presentation: { ...current.presentation, playing: true } } : current);
                  }} />
                <div className="cinematic-fade" style={{ opacity: board.presentation?.url ? board.fade ?? 0 : 0 }} />
                {fogPreview && <div className="fog-preview" style={{
                  left: `${fogPreview.x / 960 * 100}%`,
                  top: `${fogPreview.y / 540 * 100}%`,
                  width: `${fogPreview.width / 960 * 100}%`,
                  height: `${fogPreview.height / 540 * 100}%`,
                  background: tool === "reveal" ? "rgba(60, 220, 180, .27)" : "rgba(0, 0, 0, .35)",
                  borderColor: tool === "reveal" ? "rgba(60, 255, 200, .9)" : "rgba(255, 190, 60, .9)",
                }} />}
              </div>
            </div>
            <div className="preview-hud">
              {showOverview && <section className="preview-card">
                <span className="preview-card-title">Map overview</span>
                <div
                  className="map-overview"
                  onPointerDown={beginOverviewNavigation}
                  onPointerMove={moveOverviewNavigation}
                  onPointerUp={endOverviewNavigation}
                  onPointerCancel={endOverviewNavigation}
                  title="Drag to navigate the board"
                >
                  <BoardCanvas board={board} mapOnly />
                  <span
                    className="overview-viewport"
                    aria-label="Visible map area"
                    style={{
                      width: `${Math.min(100, 10000 / zoom)}%`,
                      height: `${Math.min(100, 10000 / zoom)}%`,
                      left: `${clamp((480 - pan.x / (zoom / 100)) / 960 * 100 - 5000 / zoom, 0, 100 - Math.min(100, 10000 / zoom))}%`,
                      top: `${clamp((270 - pan.y / (zoom / 100)) / 540 * 100 - 5000 / zoom, 0, 100 - Math.min(100, 10000 / zoom))}%`,
                    }}
                  />
                </div>
              </section>}
              <section className="preview-card">
                <span className="preview-card-title">Public window</span>
                <PublicBoardPreview board={board} cinematicVideo={videoRef.current}
                  zoom={zoom} pan={previewViewport().pan} />
              </section>
            </div>
          </div>
          <div className="board-footer">
            <div className="board-tools"><button className={`tool-button ${tool === "select" ? "active" : ""}`} onClick={() => setTool("select")}><MousePointer2 /> Select</button>
              <button className={`tool-button ${tool === "fog" ? "active" : ""}`} onClick={() => setTool("fog")}><EyeOff size={14} /> Fog</button>
              <button className={`tool-button ${tool === "reveal" ? "active" : ""}`} onClick={() => setTool("reveal")}><Eye size={14} /> Reveal</button>
              <span className="toolbar-divider" />
              <button className="tool-button tool-icon-button clear-fog-button" disabled={!board.fog.length} aria-label="Clear fog" title="Clear fog" onClick={() => setBoardUndoable((current) => ({ ...current, fog: [] }))}><Eraser /><span>Clear fog</span></button>
              <button className="tool-button token-visibility-button"
                disabled={!board.previouslyVisibleTokenIds?.length && !board.tokens.some((token) => token.visible)}
                aria-label={board.previouslyVisibleTokenIds?.length ? "Restore tokens" : "Hide all"}
                title={board.previouslyVisibleTokenIds?.length ? "Restore tokens" : "Hide all"}
                onClick={() => setBoardUndoable((current) => {
                  const savedIds = current.previouslyVisibleTokenIds;
                  if (savedIds?.length) {
                    const previouslyVisible = new Set(savedIds);
                    const { previouslyVisibleTokenIds: _savedIds, ...rest } = current;
                    return {
                      ...rest,
                      tokens: current.tokens.map((token) => previouslyVisible.has(token.id)
                        ? { ...token, visible: true }
                        : token),
                    };
                  }
                  const visibleIds = current.tokens.filter((token) => token.visible).map((token) => token.id);
                  return {
                    ...current,
                    previouslyVisibleTokenIds: visibleIds,
                    tokens: current.tokens.map((token) => ({ ...token, visible: false })),
                  };
                })}>
                {board.previouslyVisibleTokenIds?.length ? <Eye size={14} /> : <EyeOff size={14} />}
                <span>{board.previouslyVisibleTokenIds?.length ? "Restore" : "Hide all"}</span>
              </button>
              <button className={`tool-button ${board.blackout ? "active" : ""}`} aria-label={board.blackout ? "Restore public view" : "Blackout"} title={board.blackout ? "Restore public view" : "Blackout"} aria-pressed={Boolean(board.blackout)} onClick={() => setBoardUndoable((current) => ({ ...current, blackout: !current.blackout }))}><EyeOff /><span>{board.blackout ? "Restore view" : "Blackout"}</span></button>
              {selectedToken && <button className="tool-button tool-icon-button danger-text" aria-label="Remove token" title="Remove token" onClick={() => { setBoardUndoable((current) => ({ ...current, tokens: current.tokens.filter((token) => token.id !== selectedToken) })); setSelectedToken(""); }}><Trash2 size={13} /></button>}
            </div>
            <div className="zoom-controls">
              <button onClick={() => changeViewportZoom(Math.max(50, zoom - 25))} aria-label="Zoom out" title="Zoom out">−</button>
              <span>{zoom}%</span>
              <button onClick={() => changeViewportZoom(Math.min(300, zoom + 25))} aria-label="Zoom in" title="Zoom in">+</button>
              <button onClick={() => { setZoom(111); setPan({ x: 0, y: 0 }); }} aria-label="Reset viewport" title="Reset viewport">Reset</button>
            </div>
          </div>
        </div>
      </section>

      {expanded && <aside className="tool-panel">
        {panel === "layers" && <LayersPanel board={board} onImport={() => void importLayer()} onUpdate={(next) => setBoardUndoable(next)} />}
        {panel === "characters" && <CharactersPanel content={content} onEdit={setCharacterDraft} onAddToken={addCharacterToken} board={board} onBoard={setBoardUndoable} selectedToken={selectedToken} onSelectToken={setSelectedToken} />}
        {panel === "library" && <LibraryPanel content={content} onChange={onContentChange} onImport={importLibrary} onUseMap={(asset) => setBoardUndoable((current) => ({ ...current, mapLayers: [...current.mapLayers, { id: crypto.randomUUID(), name: asset.name, path: asset.path, visible: true }], map: "" }))} onPlay={(asset) => { setCinematicPath(asset.path); setCinematicUrl(""); setPanel("media"); }} />}
        {panel === "notes" && <NotesPanel content={content} onChange={onContentChange} />}
        {panel === "media" && <MediaPanel cinematicUrl={cinematicUrl} onUrl={setCinematicUrl} cinematicPath={cinematicPath} onChooseCinematic={() => void chooseCinematic()} playing={isCinematicPlaying} onToggleCinematic={() => void setCinematicPlayback()} onStopCinematic={() => void stopCinematic()} cinematicLoop={cinematicLoop} onCinematicLoop={setCinematicLoop} fadeDuration={fadeDuration} onFadeDuration={setFadeDuration} musicPath={musicPath} musicUrl={musicUrl} onMusicUrl={(url) => { setMusicUrl(url); setMusicPath(""); audioRef.current?.removeAttribute("src"); }} onChooseMusic={() => void chooseMusic()} musicLoop={musicLoop} onLoop={setMusicLoop} audioPlaying={audioPlaying} onToggleMusic={() => void toggleMusic()} onStopMusic={stopMusic} audioTime={audioTime} audioDuration={audioDuration} onAudioTime={setAudioTime} audioRef={audioRef} volume={volume} onVolume={setVolume} videoRef={videoRef} videoTime={videoTime} videoDuration={videoDuration} onVideoTime={setVideoTime} />}
        {panel === "dice" && <DicePanel board={board} onChange={setBoardUndoable} />}
        {panel === "broadcast" && <BroadcastPanel port={broadcastPort} onPort={setBroadcastPort} address={broadcastAddress} onAddress={setBroadcastAddress} live={broadcastLive} busy={broadcastBusy} viewers={viewerCount} link={broadcastLink} qr={qr} addresses={broadcastData?.addresses ?? []} onStart={() => void startBroadcast()} onStop={() => void stopBroadcast()} onError={onError} />}
      </aside>}

      <audio ref={audioRef} className="media-capture-source" loop={musicLoop}
        onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration)}
        onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} />
      <div className="broadcast-capture-sources" aria-hidden="true">
        <BoardCanvas
          board={board}
          publicMode
          cinematic={board.presentation && !board.presentation.url ? videoRef.current : null}
          continuousRender={Boolean(board.presentation && isCinematicPlaying)}
          forwardedRef={publicCaptureBoardRef}
        />
        <canvas ref={broadcastCanvasRef} />
      </div>
      {notification && <div className="studio-notification"><Check size={15} /> {notification}</div>}
      {characterDraft && <CharacterModal draft={characterDraft} onClose={() => setCharacterDraft(null)} onSave={(sheet) => {
        const existing = content.sheets.filter((item) => item.id !== sheet.id);
        onContentChange({ ...content, sheets: [...existing, sheet] });
        setCharacterDraft(null);
        notify("Character saved");
      }} onError={onError} />}
    </div>
  );

}

function LayersPanel({ board, onImport, onUpdate }: {
  board: BoardState; onImport: () => void; onUpdate: (board: BoardState | ((current: BoardState) => BoardState)) => void;
}) {
  return <PanelFrame eyebrow="BOARD SETUP" title="Layers" subtitle={`${board.mapLayers.length} ${board.mapLayers.length === 1 ? "layer" : "layers"} · top layers appear in front`}>
    <div className="upload-tile" role="group"><strong>Map images</strong><button className="button button-quiet button-sm" onClick={onImport}><ImagePlus size={16} /> Choose files</button><span>PNG, JPG, WebP</span></div>
    {board.mapLayers.length ? <div className="layer-list">{[...board.mapLayers].reverse().map((layer, index) => <div className={`layer-row ${layer.visible ? "" : "muted"}`} key={layer.id}>
      <span className="layer-thumb"><img src={assetUrl(layer.path)} alt="" /></span><span className="layer-name" title={layer.name}>{layer.name}</span>
      <button className="small-icon" aria-label="Move layer up" disabled={index === 0} onClick={() => reorderLayer(layer.id, 1)}><ArrowUp size={13} /></button>
      <button className="small-icon" aria-label="Move layer down" disabled={index === board.mapLayers.length - 1} onClick={() => reorderLayer(layer.id, -1)}><ArrowDown size={13} /></button>
      <button className="small-icon" aria-label={layer.visible ? "Hide layer" : "Show layer"} onClick={() => onUpdate((current) => ({ ...current, mapLayers: current.mapLayers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item) }))}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      <button className="small-icon danger-hover" aria-label="Remove layer" onClick={() => onUpdate((current) => ({ ...current, mapLayers: current.mapLayers.filter((item) => item.id !== layer.id) }))}><Trash2 size={14} /></button>
    </div>)}</div> : <div className="panel-empty"><Layers3 size={19} /><strong>No map layers yet</strong><span>Layer artwork to set your scene.</span></div>}
    <div className="panel-tip"><span>Place larger maps first. New layers appear above existing ones.</span></div>
  </PanelFrame>;

  function reorderLayer(id: string, direction: number) {
    onUpdate((current) => {
      const index = current.mapLayers.findIndex((layer) => layer.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.mapLayers.length) return current;
      const layers = [...current.mapLayers];
      [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
      return { ...current, mapLayers: layers };
    });
  }
}

function CharactersPanel({ content, onEdit, onAddToken, board, onBoard, selectedToken, onSelectToken }: {
  content: RoomContent; onEdit: (sheet: CharacterSheet) => void; onAddToken: (sheet: CharacterSheet) => void;
  board: BoardState; onBoard: (board: BoardState | ((current: BoardState) => BoardState)) => void;
  selectedToken: string; onSelectToken: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = content.sheets.filter((sheet) => sheet.name.toLowerCase().includes(search.toLowerCase()));
  return <PanelFrame eyebrow="YOUR PARTY" title="Characters" subtitle={`${content.sheets.length} ${content.sheets.length === 1 ? "character" : "characters"} · private sheets`}>
    <button className="button button-primary full-button" onClick={() => onEdit(newSheet())}><Plus size={15} /> New character</button>
    <div className="panel-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a character…" /></div>
    {filtered.length ? <div className="character-list">{filtered.map((sheet) => {
      const placed = board.tokens.some((token) => token.id === `sheet:${sheet.id}`);
      const token = board.tokens.find((item) => item.id === `sheet:${sheet.id}`);
      return <article className="character-card" key={sheet.id}>
        <button className="character-avatar" onClick={() => onEdit(sheet)}>{sheet.imagePath ? <img src={assetUrl(sheet.imagePath)} alt="" /> : sheet.name.slice(0, 1).toUpperCase()}</button>
        <button className="character-details" onClick={() => onEdit(sheet)}><strong>{sheet.name}</strong><span>{sheet.kind} · {sheet.hp}/{sheet.maxHp} HP</span></button>
        <button className={`small-icon ${token?.visible ? "token-visible" : ""}`} aria-label={token?.visible ? "Hide token" : "Show token"} disabled={!placed} onClick={() => onBoard((current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token?.id ? { ...item, visible: !item.visible } : item) }))}>{token?.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
        {placed
          ? <button className="token-action" onClick={() => { onSelectToken(token?.id ?? ""); }}>On board</button>
          : <button className="token-action" onClick={() => onAddToken(sheet)}><Plus size={13} /> Add token</button>}
      </article>;
    })}</div> : <div className="panel-empty"><Users size={19} /><strong>No characters yet</strong><span>Create a sheet, then add its token to the table.</span></div>}
    <div className="panel-tip"><EyeOff size={14} /><span>Character attributes and private notes never appear on the public display.</span></div>
  </PanelFrame>;
}

function LibraryPanel({ content, onChange, onImport, onUseMap, onPlay }: {
  content: RoomContent; onChange: (content: RoomContent) => void; onImport: (kind: "images" | "videos") => Promise<void>;
  onUseMap: (asset: LibraryAsset) => void; onPlay: (asset: LibraryAsset) => void;
}) {
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const assets = content.assets.filter((asset) => filter === "all" || asset.kind.toLowerCase() === filter);
  return <PanelFrame eyebrow="CAMPAIGN FILES" title="Library" subtitle={`${content.assets.length} saved media ${content.assets.length === 1 ? "file" : "files"}`}>
    <div className="library-actions"><button className="button button-quiet button-sm" onClick={() => void onImport("images")}><ImagePlus size={14} /> Images</button><button className="button button-quiet button-sm" onClick={() => void onImport("videos")}><Film size={14} /> Videos</button></div>
    <div className="filter-pills">{(["all", "image", "video"] as const).map((value) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All files" : value === "image" ? "Images" : "Videos"}</button>)}</div>
    {assets.length ? <div className="asset-list">{assets.map((asset) => <article key={asset.id} className="asset-row">
      <span className="asset-thumb">{asset.kind.toLowerCase() === "image" ? <img src={assetUrl(asset.path)} alt="" /> : <Film size={17} />}</span>
      <span className="asset-info"><strong title={asset.name}>{asset.name}</strong><span>{asset.kind}</span></span>
      {asset.kind.toLowerCase() === "image" ? <button className="small-icon" title="Use as map layer" onClick={() => onUseMap(asset)}><Layers3 size={15} /></button> : <button className="small-icon" title="Play cinematic" onClick={() => onPlay(asset)}><Play size={15} /></button>}
      <button className="small-icon danger-hover" title="Remove from library" onClick={() => onChange({ ...content, assets: content.assets.filter((item) => item.id !== asset.id) })}><Trash2 size={14} /></button>
    </article>)}</div> : <div className="panel-empty"><Library size={19} /><strong>Your library is waiting.</strong><span>Add maps, portraits and videos to reuse them in your rooms.</span></div>}
    <div className="panel-tip"><span>Removing a file from this list keeps the original media on your device.</span></div>
  </PanelFrame>;
}

function NotesPanel({ content, onChange }: { content: RoomContent; onChange: (content: RoomContent) => void }) {
  return <PanelFrame eyebrow="JUST FOR YOU" title="GM notes" subtitle="Private notes · saved automatically">
    <div className="private-note-badge"><EyeOff size={13} /> Never shown to players</div>
    <textarea className="notes-editor" value={content.notes} onChange={(event) => onChange({ ...content, notes: event.target.value })} placeholder={"A secret passage lies behind the old tapestry…\n\nWrite down clues, names, and plans for your next session."} />
    <div className="notes-saved"><Check size={13} /> Autosaved to this room</div>
  </PanelFrame>;
}

function MediaPanel({ cinematicUrl, onUrl, cinematicPath, onChooseCinematic, playing, onToggleCinematic, onStopCinematic,
  cinematicLoop, onCinematicLoop, fadeDuration, onFadeDuration,
  musicPath, musicUrl, onMusicUrl, onChooseMusic, musicLoop, onLoop, audioPlaying, onToggleMusic, onStopMusic,
  audioTime, audioDuration, onAudioTime, audioRef, volume, onVolume, videoRef, videoTime, videoDuration, onVideoTime,
}: {
  cinematicUrl: string; onUrl: (value: string) => void; cinematicPath: string; onChooseCinematic: () => void;
  playing: boolean; onToggleCinematic: () => void; onStopCinematic: () => void; musicPath: string;
  cinematicLoop: boolean; onCinematicLoop: (value: boolean) => void;
  fadeDuration: number; onFadeDuration: (value: number) => void;
  musicUrl: string; onMusicUrl: (value: string) => void;
  onChooseMusic: () => void; musicLoop: boolean; onLoop: (value: boolean) => void;
  audioPlaying: boolean; onToggleMusic: () => void; onStopMusic: () => void;
  audioTime: number; audioDuration: number; onAudioTime: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  volume: number; onVolume: (value: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>; videoTime: number; videoDuration: number; onVideoTime: (time: number) => void;
}) {
  const video = videoRef.current;
  return <PanelFrame eyebrow="SOUND & SCENE" title="Media" subtitle="Set the mood for your table">
    <div className="media-section"><div className="media-section-title"><span className="media-icon"><Film size={16} /></span><div><strong>Cinematics</strong><span>Fade from the board into a video</span></div></div>
      <div className="upload-tile compact" role="group"><strong>{cinematicPath ? baseName(cinematicPath) : "No video selected"}</strong><button className="button button-quiet button-sm" onClick={onChooseCinematic}><Film size={16} /> Choose file</button><span>MP4, WebM, MOV</span></div>
      <div className="url-field"><input value={cinematicUrl} onChange={(event) => onUrl(event.target.value)} placeholder="HTTPS video URL" /></div>
      <p className="field-hint">External video links are still in development and may not work reliably.</p>
      <div className="media-controls"><button className="button button-primary button-sm" onClick={onToggleCinematic}>{playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play cinematic</>}</button><button className="button button-quiet button-sm" onClick={onStopCinematic}><ArrowLeft /> Return to board</button></div>
      <label className="volume-row fade-row"><span>Fade duration</span><input aria-label="Fade duration" type="range" min={0.1} max={5} step={0.1} value={fadeDuration} onChange={(event) => onFadeDuration(Number(event.target.value))} /><span>{fadeDuration.toFixed(1)}s</span></label>
      <label className="announce-toggle"><input type="checkbox" checked={cinematicLoop} onChange={(event) => onCinematicLoop(event.target.checked)} /> Loop cinematic</label>
      <div className="seek-row"><span className="range-label">Video position</span><input aria-label="Video position" type="range" min={0} max={videoDuration || 1} step={1} value={Math.min(videoTime, videoDuration || 1)} onChange={(event) => { const value = Number(event.target.value); onVideoTime(value); if (video) video.currentTime = value; }} /><span>{formatTime(videoTime)} / {formatTime(videoDuration)}</span></div>
    </div>
    <div className="panel-divider" />
    <div className="media-section"><div className="media-section-title"><span className="media-icon"><AudioLines size={16} /></span><div><strong>Music & audio</strong><span>Mix music into the live broadcast</span></div></div>
      <div className="upload-tile compact" role="group"><strong>{musicPath ? baseName(musicPath) : "No audio selected"}</strong><button className="button button-quiet button-sm" onClick={onChooseMusic}><AudioLines size={16} /> Choose file</button><span>Audio files</span></div>
      <div className="url-field"><input value={musicUrl} onChange={(event) => onMusicUrl(event.target.value)} placeholder="HTTPS audio URL" /></div>
      <p className="field-hint">External audio links are still in development and may not work reliably.</p>
      <div className="audio-control-row"><button className="button button-quiet button-sm" onClick={onToggleMusic}>{audioPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}</button><button className="button button-quiet button-sm" onClick={onStopMusic}><Square size={12} /> Stop</button><button className={`loop-toggle ${musicLoop ? "active" : ""}`} onClick={() => onLoop(!musicLoop)}><AudioLines size={14} /> Loop</button></div>
      <div className="seek-row"><span className="range-label">Track position</span><input aria-label="Track position" type="range" min={0} max={audioDuration || 1} step={1} value={Math.min(audioTime, audioDuration || 1)} onChange={(event) => { const value = Number(event.target.value); onAudioTime(value); if (audioRef.current) audioRef.current.currentTime = value; }} /><span>{formatTime(audioTime)} / {formatTime(audioDuration)}</span></div>
      <label className="volume-row"><Volume2 size={15} /><span>Volume</span><input aria-label="Volume" type="range" min={0} max={1} step={0.02} value={volume} onChange={(event) => onVolume(Number(event.target.value))} /><span>{Math.round(volume * 100)}%</span></label>
    </div>
  </PanelFrame>;
}

function DicePanel({ board, onChange }: { board: BoardState; onChange: (board: BoardState | ((current: BoardState) => BoardState)) => void }) {
  const [expression, setExpression] = useState("1d20");
  const [result, setResult] = useState<{ rolls: number[]; total: number } | null>(null);
  const [announce, setAnnounce] = useState(false);
  function roll() {
    try {
      const value = rollDice(expression);
      setResult(value);
      if (announce) onChange((current) => ({ ...current, announcement: `🎲 ${expression} = ${value.total}` }));
    } catch (cause) {
      setResult(null);
    }
  }
  return <PanelFrame eyebrow="LET THE DICE DECIDE" title="Dice roller" subtitle="Roll dice and share the moment">
    <label className="field-label">Roll formula<input className="dice-input" value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => event.key === "Enter" && roll()} placeholder="2d6 + 3" /></label>
    <div className="dice-presets">{["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((die) => <button key={die} onClick={() => setExpression((value) => value === "1d20" ? `1${die}` : `${value}+1${die}`)}>{die}</button>)}</div>
    <button className="button button-primary full-button roll-button" onClick={roll}><DiceIcon /> Roll dice</button>
    {result && <div className="dice-result"><span className="eyebrow">YOUR ROLL</span><strong>{result.total}</strong><span>{result.rolls.join(" + ")}</span></div>}
    <label className="announce-toggle"><input type="checkbox" checked={announce} onChange={(event) => setAnnounce(event.target.checked)} /> Announce result on the public board</label>
    <label className="field-label">Public board message<input maxLength={120} value={board.announcement} onChange={(event) => onChange((current) => ({ ...current, announcement: event.target.value }))} placeholder="Enter a message for the table" /></label>
    {board.announcement && <button className="button button-quiet full-button" onClick={() => onChange((current) => ({ ...current, announcement: "" }))}>Clear board announcement</button>}
    <div className="panel-tip"><span>Supports dice formulas like 2d6+3. Roll privately unless you announce it.</span></div>
  </PanelFrame>;
}

function BroadcastPanel({ port, onPort, address, onAddress, live, busy, viewers, link, qr, addresses, onStart, onStop, onError }: {
  port: number; onPort: (port: number) => void; address: string; onAddress: (address: string) => void; live: boolean; busy: boolean; viewers: number;
  link: string; qr: string; addresses: string[]; onStart: () => void; onStop: () => void; onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (cause) { onError(messageOf(cause)); }
  }
  return <PanelFrame eyebrow="PLAYERS & AUDIENCE" title="Broadcast" subtitle="Share the public board over your LAN">
    <div className={`broadcast-status ${live ? "live" : ""}`}><span className="broadcast-indicator"><span /></span><div><strong>{live ? "You’re live" : "Broadcast is off"}</strong><span>{live ? "Your public display is being shared" : "Only people on your local network can watch"}</span></div></div>
    {live ? <div className="viewer-stat"><Users size={15} /><strong>{viewers}</strong><span>{viewers === 1 ? "viewer connected" : "viewers connected"}</span></div> : <label className="field-label">Port<input type="number" min={1024} max={65535} value={port} onChange={(event) => onPort(Number(event.target.value))} /></label>}
    {live && addresses.length > 0 && <label className="field-label">Network interface<select value={address} onChange={(event) => onAddress(event.target.value)}>{addresses.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>}
    <button className={`button full-button ${live ? "button-danger-quiet" : "button-primary"}`} disabled={busy} onClick={live ? onStop : onStart}>{live ? <><Square size={14} /> Stop broadcast</> : <><Radio size={15} /> {busy ? "Starting…" : "Start broadcast"}</>}</button>
    {live && <>
      <div className="broadcast-reader"><span className="eyebrow">PLAYER LINK</span><div className="copy-link-row"><input readOnly value={link} /><button className="button button-quiet button-sm" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Send size={14} />}{copied ? "Copied" : "Copy"}</button></div></div>
      {qr && <div className="qr-block"><img src={qr} alt="QR code to open the broadcast player" /><span>Scan on the same Wi-Fi network</span></div>}
      <div className="network-list"><strong>Available on</strong>{addresses.map((address) => <span key={address}><Radio size={13} /> http://{address}:{port}/live</span>)}</div>
      <p className="field-hint">Share the link only with players you trust. Anyone on a reachable network can view while live.</p>
    </>}
    <div className="panel-tip"><Mic2 size={14} /><span>Video and music are included. This app never requests your camera or microphone.</span></div>
  </PanelFrame>;
}

function CharacterModal({ draft, onClose, onSave, onError }: {
  draft: CharacterSheet; onClose: () => void; onSave: (sheet: CharacterSheet) => void; onError: (message: string) => void;
}) {
  const [sheet, setSheet] = useState(draft);
  const set = <K extends keyof CharacterSheet>(key: K, value: CharacterSheet[K]) => setSheet((current) => ({ ...current, [key]: value }));
  async function choosePortrait() {
    try {
      const [path] = await window.opvtt.files.import("images");
      if (path) set("imagePath", path);
    } catch (cause) { onError(messageOf(cause)); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="modal-card character-modal" onSubmit={(event) => { event.preventDefault(); if (!sheet.name.trim()) return; onSave(sheet); }}>
      <div className="modal-heading"><div><span className="eyebrow">CHARACTER SHEET</span><h2>{draft.name ? "Edit character" : "New character"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
      <div className="character-portrait-row"><button type="button" className="character-avatar large" onClick={() => void choosePortrait()}>{sheet.imagePath ? <img src={assetUrl(sheet.imagePath)} alt="" /> : <ImagePlus size={20} />}</button><div><strong>Token portrait</strong><span>Optional · PNG or JPG</span><button type="button" className="text-button" onClick={() => void choosePortrait()}>Choose image</button></div></div>
      <div className="form-grid"><label className="field-label">Name<input autoFocus required maxLength={80} value={sheet.name} onChange={(e) => set("name", e.target.value)} /></label><label className="field-label">Type<select value={sheet.kind} onChange={(e) => set("kind", e.target.value)}><option>Player Character</option><option>NPC</option><option>Creature</option></select></label><label className="field-label">Hit points<input type="number" min={-999} max={99999} value={sheet.hp} onChange={(e) => set("hp", Number(e.target.value))} /></label><label className="field-label">Maximum HP<input type="number" min={1} max={99999} value={sheet.maxHp} onChange={(e) => set("maxHp", Number(e.target.value))} /></label></div>
      <label className="field-label">Attributes<textarea rows={2} value={sheet.attributes} onChange={(e) => set("attributes", e.target.value)} placeholder="Any game system · one attribute per line" /></label>
      <label className="field-label">Inventory<textarea rows={2} value={sheet.inventory} onChange={(e) => set("inventory", e.target.value)} placeholder="Equipment, items, treasures…" /></label>
      <label className="field-label">Abilities & spells<textarea rows={2} value={sheet.abilities} onChange={(e) => set("abilities", e.target.value)} /></label>
      <label className="field-label">Private notes<textarea rows={2} value={sheet.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="form-grid"><label className="field-label">Token width ratio<input type="number" min={0.25} max={4} step={0.05} value={sheet.tokenRatio} onChange={(e) => set("tokenRatio", clamp(Number(e.target.value), 0.25, 4))} /></label><span className="field-hint form-hint">1 is square. Use 1.5 or 2 for wider tokens.</span></div>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary"><Save size={15} /> Save character</button></div>
    </form>
  </div>;
}

function PublicBoardPreview({ board, cinematicVideo, zoom, pan }: {
  board: BoardState;
  cinematicVideo: HTMLVideoElement | null;
  zoom: number;
  pan: { x: number; y: number };
}) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentation = board.presentation;

  useEffect(() => {
    const preview = previewVideoRef.current;
    const source = cinematicVideo as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
    if (!preview || !presentation || !source?.captureStream) return;

    let stream: MediaStream;
    try {
      stream = source.captureStream();
    } catch (cause) {
      console.error("Unable to mirror the cinematic in the public preview:", cause);
      return;
    }

    preview.srcObject = stream;
    void preview.play().catch((cause: unknown) => {
      console.error("Unable to play the public preview stream:", cause);
    });
    return () => {
      preview.pause();
      preview.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    };
  }, [cinematicVideo, presentation?.source, presentation?.url]);

  return (
    <div className="public-preview-screen">
      <div className="public-preview-stage" style={{
        transform: `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom / 100})`,
      }}>
        <BoardCanvas board={board} publicMode cinematic={presentation ? cinematicVideo : null} />
        <video
          ref={previewVideoRef}
          muted
          playsInline
          className={presentation?.url ? "cinematic-overlay" : "media-capture-source"}
        />
        <div className="cinematic-fade" style={{ opacity: presentation?.url ? board.fade ?? 0 : 0 }} />
      </div>
      {board.blackout && <div className="public-blackout" />}
      {!board.blackout && !board.mapLayers.some((layer) => layer.visible) && !board.map && !presentation && (
        <span className="public-preview-empty">Your public table appears here</span>
      )}
    </div>
  );
}

function PanelFrame({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="panel-frame"><header className="panel-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></header><div className="panel-content">{children}</div></div>;
}

function newSheet(): CharacterSheet {
  return { id: crypto.randomUUID(), name: "", kind: "Player Character", hp: 20, maxHp: 20, attributes: "", inventory: "", abilities: "", notes: "", imagePath: "", tokenRatio: 1 };
}

function assetUrl(filename: string): string {
  return `opvtt-file://asset/${encodeURIComponent(filename)}`;
}

function baseName(filename: string): string {
  return filename.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? filename;
}

function displayAssetName(filename: string, fallback: string, number: number): string {
  const name = baseName(filename);
  return /^[a-f\d]{16,}(?:-[a-f\d-]{8,})*$/i.test(name) ? `${fallback} ${number}` : name;
}

function subtractFog(areas: BoardState["fog"], cut: BoardState["fog"][number]): BoardState["fog"] {
  const pieces: BoardState["fog"] = [];
  for (const area of areas) {
    const left = Math.max(area.x, cut.x);
    const top = Math.max(area.y, cut.y);
    const right = Math.min(area.x + area.width, cut.x + cut.width);
    const bottom = Math.min(area.y + area.height, cut.y + cut.height);
    if (left >= right || top >= bottom) { pieces.push(area); continue; }
    if (top > area.y) pieces.push({ x: area.x, y: area.y, width: area.width, height: top - area.y });
    if (bottom < area.y + area.height) pieces.push({ x: area.x, y: bottom, width: area.width, height: area.y + area.height - bottom });
    if (left > area.x) pieces.push({ x: area.x, y: top, width: left - area.x, height: bottom - top });
    if (right < area.x + area.width) pieces.push({ x: right, y: top, width: area.x + area.width - right, height: bottom - top });
  }
  return pieces;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rollDice(expression: string): { rolls: number[]; total: number } {
  const normalized = expression.toLowerCase().replace(/\s+/g, "");
  const tokens = normalized.match(/[+-]?[^+-]+/g);
  if (!tokens?.length || tokens.join("") !== normalized) throw new Error("Invalid dice formula.");
  let total = 0;
  const rolls: number[] = [];
  let diceCount = 0;
  for (const token of tokens) {
    const match = token.match(/^([+-]?)(?:(\d*)d(\d+)|(\d+))$/);
    if (!match) throw new Error("Invalid dice formula.");
    const sign = match[1] === "-" ? -1 : 1;
    if (match[4]) {
      total += sign * Number(match[4]);
      continue;
    }
    const count = Number(match[2] || 1);
    const sides = Number(match[3]);
    if (count < 1 || count > 100 || sides < 2 || sides > 1000 || diceCount + count > 100) {
      throw new Error("Keep rolls between 1 and 100 dice with 2–1000 sides.");
    }
    diceCount += count;
    for (let index = 0; index < count; index++) {
      const value = Math.floor(Math.random() * sides) + 1;
      rolls.push(value);
      total += sign * value;
    }
  }
  return { rolls, total };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function DiceIcon() {
  return <span className="dice-icon"><Shuffle size={16} /></span>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForMediaReady(element: HTMLMediaElement, timeoutMs = 30_000): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout: number;
    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener("loadedmetadata", onReady);
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      const error = element.error;
      reject(new Error(error
        ? `Media loading failed (code ${error.code}${error.message ? `: ${error.message}` : ""}).`
        : "Media loading failed before metadata became available."));
    };
    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Media did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    element.addEventListener("loadedmetadata", onReady, { once: true });
    element.addEventListener("canplay", onReady, { once: true });
    element.addEventListener("error", onError, { once: true });
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) onReady();
  });
}

function mediaPlaybackError(kind: "audio" | "video", element: HTMLMediaElement, cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "NotSupportedError") {
    const sourceProtocol = element.currentSrc ? new URL(element.currentSrc).protocol : "none";
    const details = {
      name: cause.name,
      message: cause.message,
      mediaError: element.error?.code ?? 0,
      networkState: element.networkState,
      readyState: element.readyState,
      sourceProtocol,
      canPlayWebM: element.canPlayType(kind === "video"
        ? 'video/webm; codecs="vp9, opus"'
        : 'audio/webm; codecs="opus"'),
    };
    console.error("Online media playback failed:", details);
    return `Electron rejected the prepared ${kind} (media error ${details.mediaError}, ready state ${details.readyState}, ${sourceProtocol}, WebM support: ${details.canPlayWebM || "no"}). Please send this full message.`;
  }
  return messageOf(cause);
}
