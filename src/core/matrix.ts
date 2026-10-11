/**
 * Matrix coordinate engine.
 *
 * A Frame is a flat, row-major array of packed 0xRRGGBB colors (index = y * W + x).
 * Everything in the app (editor, sources, transports) speaks Frames; the
 * physical wiring of the panel is applied only at the very edge, in `toPhysical`.
 * Matrix size lives here so a future 32x32 build only has to change W/H.
 */
export const W = 16;
export const H = 16;
export const N = W * H;

export type Frame = number[];

export const BLACK = 0x000000;

export const blankFrame = (color = BLACK): Frame => new Array(N).fill(color);
export const cloneFrame = (f: Frame): Frame => f.slice();
export const idx = (x: number, y: number) => y * W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

export function framesEqual(a: Frame, b: Frame) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------- drawing primitives ---------- */

export function setPx(f: Frame, x: number, y: number, c: number) {
  if (inBounds(x, y)) f[idx(x, y)] = c;
}

export function fillRect(f: Frame, x: number, y: number, w: number, h: number, c: number) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) setPx(f, i, j, c);
}

/** Bresenham line; calls `plot` for each cell. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** 4-way flood fill; returns a new frame. */
export function floodFill(f: Frame, x: number, y: number, color: number): Frame {
  const out = f.slice();
  const target = out[idx(x, y)];
  if (target === color) return out;
  const stack: number[] = [idx(x, y)];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] !== target) continue;
    out[i] = color;
    const cx = i % W;
    const cy = (i / W) | 0;
    if (cx > 0) stack.push(i - 1);
    if (cx < W - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - W);
    if (cy < H - 1) stack.push(i + W);
  }
  return out;
}

/* ---------- transforms ---------- */

export function flipH(f: Frame): Frame {
  const out = blankFrame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[idx(W - 1 - x, y)] = f[idx(x, y)];
  return out;
}

export function flipV(f: Frame): Frame {
  const out = blankFrame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[idx(x, H - 1 - y)] = f[idx(x, y)];
  return out;
}

/** Rotate 90° clockwise (square matrices only). */
export function rotateCW(f: Frame): Frame {
  const out = blankFrame();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[idx(W - 1 - y, x)] = f[idx(x, y)];
  return out;
}

export function shift(f: Frame, dx: number, dy: number, wrap = true): Frame {
  const out = blankFrame();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let nx = x + dx;
      let ny = y + dy;
      if (wrap) { nx = (nx + W) % W; ny = (ny + H) % H; }
      if (inBounds(nx, ny)) out[idx(nx, ny)] = f[idx(x, y)];
    }
  return out;
}

/* ---------- physical layout ---------- */

export type WiringOrder = "rows" | "serpentine-rows" | "columns" | "serpentine-columns";

export interface Layout {
  order: WiringOrder;
  flipX: boolean;
  flipY: boolean;
  rotate: 0 | 90 | 180 | 270;
}

export const DEFAULT_LAYOUT: Layout = { order: "rows", flipX: false, flipY: false, rotate: 0 };

function physicalIndex(x: number, y: number, order: WiringOrder) {
  switch (order) {
    case "rows": return y * W + x;
    case "serpentine-rows": return y * W + (y % 2 === 0 ? x : W - 1 - x);
    case "columns": return x * H + y;
    case "serpentine-columns": return x * H + (x % 2 === 0 ? y : H - 1 - y);
  }
}

/** Re-orders a logical frame into LED-strip order for the configured wiring. */
export function toPhysical(f: Frame, layout: Layout): Frame {
  if (layout.order === "rows" && !layout.flipX && !layout.flipY && layout.rotate === 0) return f;
  const out = blankFrame();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let px = x;
      let py = y;
      for (let r = 0; r < layout.rotate; r += 90) [px, py] = [W - 1 - py, px];
      if (layout.flipX) px = W - 1 - px;
      if (layout.flipY) py = H - 1 - py;
      out[physicalIndex(px, py, layout.order)] = f[idx(x, y)];
    }
  return out;
}
