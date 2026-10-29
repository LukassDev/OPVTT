import type { Token } from "../../shared/types";

export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 540;
export const TOKEN_HEIGHT = 36;

export interface TokenFootprint {
  halfWidth: number;
  halfHeight: number;
}

export function tokenFootprint(token: Token): TokenFootprint {
  return {
    halfWidth: Math.max(18 * Math.max(0.25, Math.min(4, token.ratio || 1)), 12),
    halfHeight: TOKEN_HEIGHT / 2,
  };
}

export function tokenAt(tokens: Token[], x: number, y: number): Token | undefined {
  return [...tokens].reverse().find((token) => {
    const footprint = tokenFootprint(token);
    return Math.abs(x - token.x) <= footprint.halfWidth
      && Math.abs(y - token.y) <= footprint.halfHeight;
  });
}

export function placeTokenWithoutOverlap(
  token: Token,
  tokens: Token[],
  targetX: number,
  targetY: number,
): { x: number; y: number } {
  const footprint = tokenFootprint(token);
  let x = clamp(token.x, footprint.halfWidth, BOARD_WIDTH - footprint.halfWidth);
  let y = clamp(token.y, footprint.halfHeight, BOARD_HEIGHT - footprint.halfHeight);
  const others = tokens.filter((other) => other.id !== token.id);
  x = moveOnAxis(token, others, x, y, clamp(targetX, footprint.halfWidth, BOARD_WIDTH - footprint.halfWidth), "x");
  y = moveOnAxis(token, others, x, y, clamp(targetY, footprint.halfHeight, BOARD_HEIGHT - footprint.halfHeight), "y");
  return { x, y };
}

export function findAvailableTokenPosition(
  token: Token,
  tokens: Token[],
  originX = BOARD_WIDTH / 2,
  originY = BOARD_HEIGHT / 2,
): { x: number; y: number } | null {
  const footprint = tokenFootprint(token);
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = footprint.halfHeight; y <= BOARD_HEIGHT - footprint.halfHeight; y += TOKEN_HEIGHT) {
    for (let x = footprint.halfWidth; x <= BOARD_WIDTH - footprint.halfWidth; x += TOKEN_HEIGHT) {
      candidates.push({ x, y, distance: Math.hypot(x - originX, y - originY) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.find((point) => tokens.every((other) => overlapArea(token, point.x, point.y, other) === 0)) ?? null;
}

export function normalizeTokenPositions(tokens: Token[]): { tokens: Token[]; unresolved: number } {
  const normalized: Token[] = [];
  let unresolved = 0;
  for (const token of tokens) {
    const footprint = tokenFootprint(token);
    const x = clamp(token.x, footprint.halfWidth, BOARD_WIDTH - footprint.halfWidth);
    const y = clamp(token.y, footprint.halfHeight, BOARD_HEIGHT - footprint.halfHeight);
    const position = normalized.every((other) => overlapArea(token, x, y, other) === 0)
      ? { x, y }
      : findAvailableTokenPosition(token, normalized, x, y);
    if (position) normalized.push({ ...token, ...position });
    else {
      normalized.push({ ...token, x, y });
      unresolved += 1;
    }
  }
  return { tokens: normalized, unresolved };
}

function moveOnAxis(
  token: Token,
  others: Token[],
  startX: number,
  startY: number,
  target: number,
  axis: "x" | "y",
): number {
  const start = axis === "x" ? startX : startY;
  const distance = target - start;
  const steps = Math.ceil(Math.abs(distance) / 2);
  if (!steps) return start;
  let x = startX;
  let y = startY;
  for (let step = 1; step <= steps; step += 1) {
    const next = start + distance * step / steps;
    const nextX = axis === "x" ? next : x;
    const nextY = axis === "y" ? next : y;
    const blocked = others.some((other) => {
      const nextOverlap = overlapArea(token, nextX, nextY, other);
      return nextOverlap > 0
        && nextOverlap >= overlapArea(token, x, y, other);
    });
    if (blocked) break;
    x = nextX;
    y = nextY;
  }
  return axis === "x" ? x : y;
}

function overlapArea(token: Token, x: number, y: number, other: Token): number {
  const first = tokenFootprint(token);
  const second = tokenFootprint(other);
  const width = Math.min(x + first.halfWidth, other.x + second.halfWidth)
    - Math.max(x - first.halfWidth, other.x - second.halfWidth);
  const height = Math.min(y + first.halfHeight, other.y + second.halfHeight)
    - Math.max(y - first.halfHeight, other.y - second.halfHeight);
  return Math.max(0, width) * Math.max(0, height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
