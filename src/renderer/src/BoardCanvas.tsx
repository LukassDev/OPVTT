import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, Ref, WheelEvent as ReactWheelEvent } from "react";
import type { BoardState, Token } from "../../shared/types";
import { TOKEN_HEIGHT } from "./boardGeometry";

interface BoardCanvasProps {
  board: BoardState;
  publicMode?: boolean;
  mapOnly?: boolean;
  continuousRender?: boolean;
  onFrame?: () => void;
  hoveredToken?: string;
  cinematic?: HTMLVideoElement | null;
  className?: string;
  forwardedRef?: Ref<HTMLCanvasElement>;
  onPointerDown?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
  onWheel?: (event: ReactWheelEvent<HTMLCanvasElement>) => void;
}

const WIDTH = 960;
const HEIGHT = 540;
interface CachedImage {
  image: HTMLImageElement;
  listeners: Set<() => void>;
}
const imageCache = new Map<string, CachedImage>();

export default function BoardCanvas({
  board,
  publicMode = false,
  mapOnly = false,
  continuousRender = false,
  onFrame,
  hoveredToken,
  cinematic,
  className = "",
  forwardedRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onDoubleClick,
  onWheel,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef(board);
  const cinemaRef = useRef(cinematic);
  boardRef.current = board;
  cinemaRef.current = cinematic;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    context.setTransform(2, 0, 0, 2, 0, 0);

    let alive = true;
    const draw = () => {
      if (!alive) return;
      if (continuousRender) onFrame?.();
      const state = boardRef.current;
      const video = cinemaRef.current;
      const palette = getComputedStyle(canvas);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = "#101b29";
      context.fillRect(0, 0, WIDTH, HEIGHT);

      const isExternalVideo = video?.currentSrc.startsWith("https://") ?? false;
      if (video && !isExternalVideo && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const ratio = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
        const width = video.videoWidth * ratio;
        const height = video.videoHeight * ratio;
        context.drawImage(video, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
      } else {
        let hasMap = false;
        for (const layer of state.mapLayers) {
          if (!layer.visible) continue;
          const image = imageCache.get(layer.path)?.image;
          if (image?.complete && image.naturalWidth) {
            drawFittedImage(context, image);
            hasMap = true;
          }
        }
        if (!state.mapLayers.length && state.map) {
          const image = imageCache.get(state.map)?.image;
          if (image?.complete && image.naturalWidth) {
            drawFittedImage(context, image);
            hasMap = true;
          }
        }
        if (!hasMap) {
          context.strokeStyle = "#1c2b3d";
          context.lineWidth = 1;
          for (let x = 0; x <= WIDTH; x += 40) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, HEIGHT);
            context.stroke();
          }
          for (let y = 0; y <= HEIGHT; y += 40) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(WIDTH, y);
            context.stroke();
          }
        }
      }

      if (!mapOnly) {
        for (const token of state.tokens) {
          if (publicMode && !token.visible) continue;
          drawToken(context, token, hoveredToken === token.id && !publicMode);
        }
      }

      if (!mapOnly && state.fog.length) {
        context.save();
        context.beginPath();
        for (const area of state.fog) context.rect(area.x, area.y, area.width, area.height);
        context.fillStyle = palette.getPropertyValue(publicMode ? "--fog-public" : "--fog-fill").trim();
        context.fill();
        context.restore();
      }

      if (!mapOnly && state.announcement) {
        context.save();
        context.fillStyle = "rgba(5, 10, 20, .88)";
        context.fillRect(0, HEIGHT - 62, WIDTH, 62);
        context.fillStyle = "#ffffff";
        context.font = "600 21px Bahnschrift, \"Segoe UI\", Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(state.announcement, WIDTH / 2, HEIGHT - 31, WIDTH - 60);
        context.restore();
      }
      if (!mapOnly && state.fade && state.fade > 0) {
        context.globalAlpha = Math.min(1, state.fade);
        context.fillStyle = palette.getPropertyValue("--cinematic-black").trim();
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.globalAlpha = 1;
      }
    };
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const paths = [
      ...board.mapLayers.map((layer) => layer.path),
      board.map,
      ...board.tokens.map((token) => token.imagePath),
    ].filter(Boolean);
    const subscribedImages = new Set<CachedImage>();
    for (const source of paths) {
      let cached = imageCache.get(source);
      if (!cached) {
        const image = new Image();
        image.crossOrigin = "anonymous";
        cached = { image, listeners: new Set() };
        image.onload = () => cached?.listeners.forEach((listener) => listener());
        image.onerror = () => {
          console.error(`Unable to load OPVTT board asset: ${source}`);
          cached?.listeners.forEach((listener) => listener());
        };
        imageCache.set(source, cached);
        void window.opvtt.files.assetUrl(source).then((url) => {
          image.src = url;
        }).catch((error: unknown) => {
          console.error("Unable to resolve OPVTT board asset:", error);
          if (imageCache.get(source) === cached) imageCache.delete(source);
          cached?.listeners.forEach((listener) => listener());
        });
      }
      cached.listeners.add(draw);
      subscribedImages.add(cached);
      if (cached.image.complete) draw();
    }
    draw();

    const renderTimer = continuousRender
      ? window.setInterval(draw, 1000 / 30)
      : null;
    let frame = 0;
    const video = cinemaRef.current;
    if (video && !video.paused && !continuousRender) {
      const animate = () => {
        draw();
        frame = window.requestAnimationFrame(animate);
      };
      frame = window.requestAnimationFrame(animate);
    }
    return () => {
      alive = false;
      themeObserver.disconnect();
      subscribedImages.forEach((image) => image.listeners.delete(draw));
      if (renderTimer !== null) window.clearInterval(renderTimer);
      window.cancelAnimationFrame(frame);
    };
  }, [board, continuousRender, mapOnly, onFrame, publicMode, hoveredToken, cinematic]);

  return (
    <canvas
      ref={(element) => {
        canvasRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      className={`board-canvas ${className}`}
      aria-label={publicMode ? "Public game board" : "Editable game board"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
    />
  );
}

function drawToken(context: CanvasRenderingContext2D, token: Token, hovered: boolean): void {
  const width = TOKEN_HEIGHT * Math.max(0.25, Math.min(4, token.ratio || 1));
  const x = token.x - width / 2;
  const y = token.y - TOKEN_HEIGHT / 2;
  context.save();
  context.globalAlpha = token.visible ? 1 : 0.5;
  if (hovered) {
    context.shadowColor = "rgba(255, 255, 255, .95)";
    context.shadowBlur = 10;
  }
  if (token.imagePath) {
    const image = imageCache.get(token.imagePath)?.image;
    if (image?.complete && image.naturalWidth) {
      context.save();
      context.beginPath();
      context.rect(x, y, width, TOKEN_HEIGHT);
      context.clip();
      context.drawImage(image, x, y, width, TOKEN_HEIGHT);
      context.restore();
    } else {
      drawFallbackToken(context, token, x, y, width);
    }
  } else {
    drawFallbackToken(context, token, x, y, width);
  }
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.font = "600 14px Bahnschrift, \"Segoe UI\", Arial, sans-serif";
  const labelWidth = Math.min(220, context.measureText(token.name).width + 10);
  const labelX = Math.max(labelWidth / 2 + 2, Math.min(958 - labelWidth / 2, token.x));
  const labelY = Math.max(15, y - 4);
  context.strokeStyle = "#000000";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.strokeText(token.name, labelX, labelY, 220);
  context.fillStyle = "#ffffff";
  context.fillText(token.name, labelX, labelY, 220);
  context.restore();
}

function drawFallbackToken(context: CanvasRenderingContext2D, token: Token, x: number, y: number, width: number): void {
  context.fillStyle = token.visible ? "#408bda" : "#808080";
  context.beginPath();
  context.ellipse(token.x, token.y, width / 2, TOKEN_HEIGHT / 2, 0, 0, Math.PI * 2);
  context.fill();
}

function drawFittedImage(context: CanvasRenderingContext2D, image: HTMLImageElement): void {
  const scale = Math.min(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
}
