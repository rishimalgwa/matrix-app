/**
 * Image → Frame pipeline shared by the Import tab, GIF import and any
 * integration that shows artwork (e.g. Spotify album covers).
 *
 * Getting a recognizable picture out of 256 LEDs is mostly about *what* you
 * keep, so the pipeline is:
 *
 *   crop (ideally `autoCrop` to the subject)
 *     → sample: each LED gets a block of 8×8 source pixels
 *         sharp:   dominant colour of the block (2-means), no muddy averages
 *         smooth:  plain average
 *         nearest: centre pixel (for sources that already are pixel art)
 *       transparent / removed-background pixels never bleed into the subject
 *     → tone: auto-levels + shadow lift (WLED's gamma 2.2 crushes dark tones),
 *       brightness/contrast/saturation, sharpening at 16×16
 *     → optional palette, shared by every frame of a GIF so colours don't flicker
 */
import { adjust, medianCut, nearest, pack, unpack, type Adjustments, NO_ADJUST } from "./color";
import { H, N, W, type Frame } from "./matrix";

export type Resample = "sharp" | "smooth" | "nearest";

/** Square crop in normalized source coordinates. */
export interface Crop {
  /** center x, 0..1 of source width */
  cx: number;
  /** center y, 0..1 of source height */
  cy: number;
  /** side length as a fraction of min(width, height), 0..1 */
  size: number;
}

export const FULL_CROP: Crop = { cx: 0.5, cy: 0.5, size: 1 };

export interface Enhance {
  /** stretch the subject's tonal range to full brightness */
  autoLevels: boolean;
  /** 0..100 — lifts dark tones so they survive LED gamma */
  shadows: number;
  /** 0..100 — edge contrast at 16×16 */
  sharpen: number;
  /** flood-fill the background from the image border and drop it */
  removeBg: boolean;
  /** 0..100 — how different a colour may be and still count as background */
  bgTolerance: number;
}

export const NO_ENHANCE: Enhance = { autoLevels: false, shadows: 0, sharpen: 0, removeBg: false, bgTolerance: 30 };
export const LED_ENHANCE: Enhance = { autoLevels: true, shadows: 25, sharpen: 30, removeBg: false, bgTolerance: 30 };

export interface RasterOptions {
  crop: Crop;
  resample: Resample;
  adjust: Adjustments;
  /** 0 = keep full color, otherwise limit to N colors */
  colors: number;
  /** color for transparent / removed background */
  background: number;
  enhance: Enhance;
}

export const DEFAULT_RASTER: RasterOptions = {
  crop: FULL_CROP,
  resample: "sharp",
  adjust: { ...NO_ADJUST, saturation: 10 },
  colors: 0,
  background: 0x000000,
  enhance: LED_ENHANCE,
};

/** Settings for sources that are already pixel art: keep every pixel exactly. */
export const PIXEL_ART_RASTER: Partial<RasterOptions> = {
  resample: "nearest",
  adjust: NO_ADJUST,
  enhance: { ...NO_ENHANCE },
};

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

const sizeOf = (s: Source) =>
  s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height };

export function cropRect(srcW: number, srcH: number, crop: Crop) {
  const side = Math.max(1, Math.min(srcW, srcH) * Math.min(1, Math.max(0.02, crop.size)));
  const x = Math.min(srcW - side, Math.max(0, crop.cx * srcW - side / 2));
  const y = Math.min(srcH - side, Math.max(0, crop.cy * srcH - side / 2));
  return { x, y, side };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

/** High-quality downscale of a source rect into a w×h canvas (progressive halving). */
function drawScaled(src: Source, sx: number, sy: number, sw: number, sh: number, w: number, h: number) {
  let cur: Source = src;
  let cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 > w * 1.5 && ch / 2 > h * 1.5) {
    const step = canvas(Math.round(cw / 2), Math.round(ch / 2));
    const s = ctx2d(step);
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = "high";
    s.drawImage(cur as CanvasImageSource, cx, cy, cw, ch, 0, 0, step.width, step.height);
    cur = step; cx = 0; cy = 0; cw = step.width; ch = step.height;
  }
  const out = canvas(w, h);
  const o = ctx2d(out);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = "high";
  o.drawImage(cur as CanvasImageSource, cx, cy, cw, ch, 0, 0, w, h);
  return o.getImageData(0, 0, w, h).data;
}

const dist2 = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

/* ================= stage 1: sampling ================= */

/** One sampled frame: float RGB per LED and which LEDs are background. */
export interface Cells {
  rgb: Float32Array;
  bg: Uint8Array;
}

const SUB = 8; // source pixels per LED (each side) in the working image
const WORK = W * SUB;

/** Marks background pixels by flood-filling from the border with the border's dominant colours. */
function floodBackground(d: Uint8ClampedArray, size: number, mask: Uint8Array, tolerance: number) {
  const border: number[] = [];
  const isBorder = (i: number) => {
    const x = i % size, y = (i / size) | 0;
    return x === 0 || y === 0 || x === size - 1 || y === size - 1;
  };
  for (let i = 0; i < size * size; i++)
    if (isBorder(i) && !mask[i]) border.push(pack(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
  if (!border.length) return;

  // background = border colours that cover a meaningful share of the border
  const pal = medianCut(border, 4);
  const counts = new Map<number, number>();
  for (const c of border) { const p = nearest(c, pal); counts.set(p, (counts.get(p) ?? 0) + 1); }
  const bgCols = pal.filter((p) => (counts.get(p) ?? 0) / border.length >= 0.15).map(unpack);
  const tol2 = (12 + tolerance * 1.4) ** 2;
  const isBg = (i: number) =>
    bgCols.some(([r, g, b]) => dist2(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], r, g, b) < tol2);

  const queue: number[] = [];
  for (let i = 0; i < size * size; i++)
    if (isBorder(i) && !mask[i] && isBg(i)) { mask[i] = 1; queue.push(i); }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % size, y = (i / size) | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1]) {
      if (n >= 0 && !mask[n] && isBg(n)) { mask[n] = 1; queue.push(n); }
    }
  }
}

/** Two-means clustering of a block's pixels; returns both centroids and their sizes. */
function twoMeans(px: number[]) {
  const n = px.length / 3;
  // seed with the darkest and brightest pixel
  let lo = 0, hi = 0, loL = Infinity, hiL = -Infinity;
  for (let k = 0; k < n; k++) {
    const l = px[k * 3] * 0.3 + px[k * 3 + 1] * 0.59 + px[k * 3 + 2] * 0.11;
    if (l < loL) { loL = l; lo = k; }
    if (l > hiL) { hiL = l; hi = k; }
  }
  const a = [px[lo * 3], px[lo * 3 + 1], px[lo * 3 + 2]];
  const b = [px[hi * 3], px[hi * 3 + 1], px[hi * 3 + 2]];
  let na = 0, nb = 0;
  const label = new Uint8Array(n);
  for (let it = 0; it < 4; it++) {
    const sa = [0, 0, 0], sb = [0, 0, 0];
    na = 0; nb = 0;
    for (let k = 0; k < n; k++) {
      const r = px[k * 3], g = px[k * 3 + 1], bl = px[k * 3 + 2];
      if (dist2(r, g, bl, a[0], a[1], a[2]) <= dist2(r, g, bl, b[0], b[1], b[2])) { sa[0] += r; sa[1] += g; sa[2] += bl; na++; label[k] = 0; }
      else { sb[0] += r; sb[1] += g; sb[2] += bl; nb++; label[k] = 1; }
    }
    if (na) for (let c = 0; c < 3; c++) a[c] = sa[c] / na;
    if (nb) for (let c = 0; c < 3; c++) b[c] = sb[c] / nb;
  }
  return { a, b, na, nb, label };
}

/**
 * How "edge-like" a two-way split of a full SUB×SUB block is: a real edge
 * separates the block into two coherent regions (few label changes between
 * neighbours); texture like fur, grass or wood grain flips constantly.
 */
function isCoherentSplit(label: Uint8Array) {
  if (label.length !== SUB * SUB) return false;
  let changes = 0;
  for (let y = 0; y < SUB; y++)
    for (let x = 0; x < SUB; x++) {
      const i = y * SUB + x;
      if (x < SUB - 1 && label[i] !== label[i + 1]) changes++;
      if (y < SUB - 1 && label[i] !== label[i + SUB]) changes++;
    }
  return changes <= SUB * 2.5;
}

export function sampleCells(src: Source, opts: Pick<RasterOptions, "crop" | "resample" | "enhance">): Cells {
  const { w: sw, h: sh } = sizeOf(src);
  const { x, y, side } = cropRect(sw, sh, opts.crop);
  const rgb = new Float32Array(N * 3);
  const bg = new Uint8Array(N);

  if (opts.resample === "nearest") {
    // sample the centre of each cell straight from the source — crisp for pixel art
    const s = Math.max(W, Math.min(2048, Math.round(side)));
    const tmp = canvas(s, s);
    const t = ctx2d(tmp);
    t.imageSmoothingEnabled = false;
    t.drawImage(src as CanvasImageSource, x, y, side, side, 0, 0, s, s);
    const d = t.getImageData(0, 0, s, s).data;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const sx = Math.min(s - 1, Math.floor(((i + 0.5) / W) * s));
        const sy = Math.min(s - 1, Math.floor(((j + 0.5) / H) * s));
        const si = (sy * s + sx) * 4;
        const c = j * W + i;
        if (d[si + 3] < 128) { bg[c] = 1; continue; }
        rgb[c * 3] = d[si]; rgb[c * 3 + 1] = d[si + 1]; rgb[c * 3 + 2] = d[si + 2];
      }
    return { rgb, bg };
  }

  const d = drawScaled(src, x, y, side, side, WORK, WORK);
  const mask = new Uint8Array(WORK * WORK);
  for (let i = 0; i < WORK * WORK; i++) if (d[i * 4 + 3] < 128) mask[i] = 1;
  if (opts.enhance.removeBg) floodBackground(d, WORK, mask, opts.enhance.bgTolerance);

  // pass 1: per-block foreground pixels and means
  const blocks: number[][] = [];
  const means = new Float32Array(N * 3);
  for (let c = 0; c < N; c++) {
    const bx = (c % W) * SUB, by = ((c / W) | 0) * SUB;
    const px: number[] = [];
    for (let yy = 0; yy < SUB; yy++)
      for (let xx = 0; xx < SUB; xx++) {
        const i = (by + yy) * WORK + bx + xx;
        if (!mask[i]) px.push(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      }
    blocks.push(px);
    const n = px.length / 3;
    if (n < (SUB * SUB) / 2) { bg[c] = 1; continue; }
    for (let k = 0; k < n; k++) { means[c * 3] += px[k * 3]; means[c * 3 + 1] += px[k * 3 + 1]; means[c * 3 + 2] += px[k * 3 + 2]; }
    for (let ch = 0; ch < 3; ch++) means[c * 3 + ch] /= n;
  }

  // pass 2: choose each LED's colour
  for (let c = 0; c < N; c++) {
    if (bg[c]) continue;
    let out: ArrayLike<number> = [means[c * 3], means[c * 3 + 1], means[c * 3 + 2]];
    if (opts.resample === "sharp") {
      const { a, b, na, nb, label } = twoMeans(blocks[c]);
      // texture (fur, grass, noise) keeps its average — only real edges get a crisp side
      const edge = blocks[c].length === SUB * SUB * 3 ? isCoherentSplit(label) : true;
      if (edge && nb && na && dist2(a[0], a[1], a[2], b[0], b[1], b[2]) > 48 * 48) {
        const share = na / (na + nb);
        if (share >= 0.7) out = a;
        else if (share <= 0.3) out = b;
        else {
          // an edge runs through this LED: keep the side that stands out from its neighbours
          const cx = c % W, cy = (c / W) | 0;
          const nbr = [0, 0, 0];
          let cnt = 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || bg[ny * W + nx]) continue;
            const n = ny * W + nx;
            nbr[0] += means[n * 3]; nbr[1] += means[n * 3 + 1]; nbr[2] += means[n * 3 + 2]; cnt++;
          }
          if (!cnt) out = share >= 0.5 ? a : b;
          else {
            const [r, g, bl] = nbr.map((v) => v / cnt);
            out = dist2(a[0], a[1], a[2], r, g, bl) >= dist2(b[0], b[1], b[2], r, g, bl) ? a : b;
          }
        }
      }
    }
    rgb[c * 3] = out[0]; rgb[c * 3 + 1] = out[1]; rgb[c * 3 + 2] = out[2];
  }
  return { rgb, bg };
}

/* ================= stage 2: tone ================= */

/** Turns sampled cells into frames. Pass every frame of an animation at once so levels and palette are shared. */
export function toneCells(list: Cells[], opts: Pick<RasterOptions, "adjust" | "colors" | "background" | "enhance">): Frame[] {
  const e = opts.enhance;

  let lo = 0, hi = 255;
  if (e.autoLevels) {
    const lums: number[] = [];
    for (const { rgb, bg } of list)
      for (let c = 0; c < N; c++) if (!bg[c]) lums.push(rgb[c * 3] * 0.299 + rgb[c * 3 + 1] * 0.587 + rgb[c * 3 + 2] * 0.114);
    if (lums.length > 8) {
      lums.sort((a, b) => a - b);
      const pl = lums[Math.floor(lums.length * 0.01)];
      const ph = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.995))];
      if (ph - pl > 24) {
        // never stretch more than 1.8×, and only go 75% of the way — avoids blown-out highlights
        const span = Math.max(ph - pl, 255 / 1.8);
        const mid = (pl + ph) / 2;
        const tlo = Math.max(0, Math.min(pl, mid - span / 2));
        const thi = Math.min(255, tlo + span);
        lo = tlo * 0.75;
        hi = 255 + (thi - 255) * 0.75;
      }
    }
  }
  const gamma = 1 - (e.shadows / 100) * 0.5;
  const k = (e.sharpen / 100) * 0.9;

  const frames = list.map(({ rgb, bg }) => {
    const v = new Float32Array(N * 3);
    for (let c = 0; c < N; c++) {
      if (bg[c]) continue;
      for (let ch = 0; ch < 3; ch++) {
        let x = ((rgb[c * 3 + ch] - lo) * 255) / (hi - lo);
        x = Math.max(0, Math.min(255, x));
        v[c * 3 + ch] = gamma === 1 ? x : 255 * Math.pow(x / 255, gamma);
      }
      const [r, g, b] = unpack(adjust(pack(v[c * 3], v[c * 3 + 1], v[c * 3 + 2]), opts.adjust));
      v[c * 3] = r; v[c * 3 + 1] = g; v[c * 3 + 2] = b;
    }
    const f: Frame = new Array(N);
    for (let c = 0; c < N; c++) {
      if (bg[c]) { f[c] = opts.background; continue; }
      if (!k) { f[c] = pack(v[c * 3], v[c * 3 + 1], v[c * 3 + 2]); continue; }
      // unsharp mask against foreground neighbours
      const cx = c % W, cy = (c / W) | 0;
      const s = [0, 0, 0];
      let cnt = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || bg[ny * W + nx]) continue;
        const n = ny * W + nx;
        s[0] += v[n * 3]; s[1] += v[n * 3 + 1]; s[2] += v[n * 3 + 2]; cnt++;
      }
      if (!cnt) { f[c] = pack(v[c * 3], v[c * 3 + 1], v[c * 3 + 2]); continue; }
      f[c] = pack(
        v[c * 3] + k * (v[c * 3] - s[0] / cnt),
        v[c * 3 + 1] + k * (v[c * 3 + 1] - s[1] / cnt),
        v[c * 3 + 2] + k * (v[c * 3 + 2] - s[2] / cnt)
      );
    }
    return f;
  });

  if (opts.colors > 0) {
    // one palette for every frame, built from a sample of all foreground pixels
    const all: number[] = [];
    const step = Math.max(1, Math.floor((frames.length * N) / 20000));
    let n = 0;
    frames.forEach((f, fi) => f.forEach((c, i) => { if (!list[fi].bg[i] && n++ % step === 0) all.push(c); }));
    const pal = medianCut(all.length ? all : [0], opts.colors);
    return frames.map((f, fi) => f.map((c, i) => (list[fi].bg[i] ? c : nearest(c, pal))));
  }
  return frames;
}

export function rasterize(src: Source, opts: RasterOptions): Frame {
  return toneCells([sampleCells(src, opts)], opts)[0];
}

/* ================= helpers: auto crop & pixel-art detection ================= */

/**
 * Finds the smallest square that still contains most of the "interesting"
 * content: edges, colours that differ from the border/background, and — for
 * animations — motion. Filling the 16×16 panel with the subject is the
 * single biggest improvement in how recognizable an image is.
 */
export function autoCrop(sources: Source[]): Crop {
  if (!sources.length) return FULL_CROP;
  const { w: sw, h: sh } = sizeOf(sources[0]);
  const A = 96;
  const sc = A / Math.max(sw, sh);
  const aw = Math.max(8, Math.round(sw * sc));
  const ah = Math.max(8, Math.round(sh * sc));
  const sal = new Float32Array(aw * ah);

  const picks = sources.length <= 8 ? sources : Array.from({ length: 8 }, (_, i) => sources[Math.floor((i * sources.length) / 8)]);

  // stickers / icons / emoji with a transparent background: the subject is
  // everything visible, so frame its bounding box instead of hunting for detail
  {
    let minX = aw, minY = ah, maxX = -1, maxY = -1, clearBorder = 0, border = 0;
    for (const src of picks) {
      const d = drawScaled(src, 0, 0, sw, sh, aw, ah);
      for (let i = 0; i < aw * ah; i++) {
        const x = i % aw, y = (i / aw) | 0;
        const opaque = d[i * 4 + 3] >= 64;
        if (x === 0 || y === 0 || x === aw - 1 || y === ah - 1) { border++; if (!opaque) clearBorder++; }
        if (opaque) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
    }
    if (maxX >= 0 && clearBorder / border > 0.3) {
      const side = Math.max(maxX - minX + 1, maxY - minY + 1) * 1.04;
      return { cx: (minX + maxX + 1) / 2 / aw, cy: (minY + maxY + 1) / 2 / ah, size: Math.min(1, side / Math.min(aw, ah)) };
    }
  }

  let prev: Float32Array | null = null;
  let borderColor: [number, number, number] | null = null;

  for (const src of picks) {
    const d = drawScaled(src, 0, 0, sw, sh, aw, ah);
    const lum = new Float32Array(aw * ah);
    for (let i = 0; i < aw * ah; i++) lum[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;

    if (!borderColor) {
      const ch: number[][] = [[], [], []];
      for (let i = 0; i < aw * ah; i++) {
        const x = i % aw, y = (i / aw) | 0;
        if ((x === 0 || y === 0 || x === aw - 1 || y === ah - 1) && d[i * 4 + 3] >= 128)
          for (let c = 0; c < 3; c++) ch[c].push(d[i * 4 + c]);
      }
      borderColor = ch.map((a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0)) as [number, number, number];
    }

    for (let y = 1; y < ah - 1; y++)
      for (let x = 1; x < aw - 1; x++) {
        const i = y * aw + x;
        if (d[i * 4 + 3] < 128) continue;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + aw] - lum[i - aw];
        const edge = Math.min(1, Math.hypot(gx, gy) / 160) ** 2; // squared: strong edges count, grain doesn't
        const [br, bgc, bb] = borderColor;
        const distinct = Math.sqrt(dist2(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], br, bgc, bb)) / 441;
        let s = edge * 1.6 + distinct;
        if (prev) s += (Math.abs(lum[i] - prev[i]) / 255) * 0.8;
        sal[i] += s;
      }
    prev = lum;
  }

  // mild preference for the centre, and slightly for the upper half (heads/faces usually sit there)
  const maxD = Math.hypot(aw / 2, ah / 2);
  let total = 0;
  for (let i = 0; i < aw * ah; i++) {
    const x = i % aw, y = (i / aw) | 0;
    sal[i] *= (1 - 0.35 * (Math.hypot(x - aw / 2, y - ah / 2) / maxD)) * (1.12 - 0.24 * (y / ah));
    total += sal[i];
  }
  if (total <= 0) return FULL_CROP;

  // integral image for O(1) window sums
  const I = new Float64Array((aw + 1) * (ah + 1));
  for (let y = 0; y < ah; y++)
    for (let x = 0; x < aw; x++)
      I[(y + 1) * (aw + 1) + x + 1] = sal[y * aw + x] + I[y * (aw + 1) + x + 1] + I[(y + 1) * (aw + 1) + x] - I[y * (aw + 1) + x];
  const sum = (x: number, y: number, s: number) =>
    I[(y + s) * (aw + 1) + x + s] - I[y * (aw + 1) + x + s] - I[(y + s) * (aw + 1) + x] + I[y * (aw + 1) + x];

  const m = Math.min(aw, ah);
  let best: { f: number; x: number; y: number } | null = null;
  for (let f = 1; f >= 0.3; f -= 0.05) {
    const s = Math.max(4, Math.round(m * f));
    let bs = -1, bx = 0, by = 0;
    for (let y = 0; y + s <= ah; y++)
      for (let x = 0; x + s <= aw; x++) {
        const v = sum(x, y, s);
        if (v > bs) { bs = v; bx = x; by = y; }
      }
    if (bs / total < 0.7) break;
    best = { f, x: bx, y: by };
  }
  if (!best) return FULL_CROP;
  const s = Math.round(m * best.f);
  const size = Math.min(1, best.f * 1.1); // a little breathing room
  return { cx: (best.x + s / 2) / aw, cy: (best.y + s / 2) / ah, size };
}

/**
 * True for sources that already are pixel art: tiny sprites, or images with
 * very few colours and hard edges (no anti-aliasing). Small anti-aliased icons
 * like emoji are *not* pixel art and go through the normal pipeline.
 */
export function looksLikePixelArt(src: Source): boolean {
  const { w, h } = sizeOf(src);
  if (Math.max(w, h) <= 32) return true;
  if (Math.max(w, h) > 256) return false;
  const c = canvas(w, h);
  const t = ctx2d(c);
  t.drawImage(src as CanvasImageSource, 0, 0);
  const d = t.getImageData(0, 0, w, h).data;
  const counts = new Map<number, number>();
  let opaque = 0;
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] < 128) continue;
    opaque++;
    const k = pack(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (counts.size > 48) return false;
  }
  // anti-aliasing leaves many rare in-between colours; real pixel art has almost none
  let rare = 0;
  for (const n of counts.values()) if (n < opaque * 0.002 + 2) rare += n;
  return rare / Math.max(1, opaque) < 0.01;
}

export function loadImage(url: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  });
}

/** Renders a frame to a PNG data URL (used for thumbnails / sharing). */
export function frameToDataURL(frame: Frame, scale = 8) {
  const c = canvas(W * scale, H * scale);
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < frame.length; i++) {
    ctx.fillStyle = "#" + frame[i].toString(16).padStart(6, "0");
    ctx.fillRect((i % W) * scale, Math.floor(i / W) * scale, scale, scale);
  }
  return c.toDataURL("image/png");
}
