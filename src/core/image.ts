/**
 * Image → Frame pipeline shared by the Import tab, GIF import and any
 * integration that shows artwork (e.g. Spotify album covers).
 */
import { adjust, pack, quantize, type Adjustments, NO_ADJUST } from "./color";
import { H, W, type Frame } from "./matrix";

export type Resample = "nearest" | "smooth";

/** Square crop in normalized source coordinates (0..1 of the shorter side). */
export interface Crop {
  /** center x, 0..1 of source width */
  cx: number;
  /** center y, 0..1 of source height */
  cy: number;
  /** side length as a fraction of min(width, height), 0..1 */
  size: number;
}

export const FULL_CROP: Crop = { cx: 0.5, cy: 0.5, size: 1 };

export interface RasterOptions {
  crop: Crop;
  resample: Resample;
  adjust: Adjustments;
  /** 0 = keep full color, otherwise limit to N colors */
  colors: number;
  /** color drawn behind transparent pixels */
  background: number;
}

export const DEFAULT_RASTER: RasterOptions = {
  crop: FULL_CROP,
  resample: "smooth",
  adjust: NO_ADJUST,
  colors: 0,
  background: 0x000000,
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

export function rasterize(src: Source, opts: RasterOptions): Frame {
  const { w: sw, h: sh } = sizeOf(src);
  const { x, y, side } = cropRect(sw, sh, opts.crop);

  const out = canvas(W, H);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#" + opts.background.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, W, H);

  if (opts.resample === "nearest") {
    ctx.imageSmoothingEnabled = false;
    // sample the center of each target cell for crisp pixel-art results
    const tmp = canvas(Math.max(1, Math.round(side)), Math.max(1, Math.round(side)));
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.drawImage(src as CanvasImageSource, x, y, side, side, 0, 0, tmp.width, tmp.height);
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
    const img = ctx.getImageData(0, 0, W, H);
    const bg = [(opts.background >> 16) & 255, (opts.background >> 8) & 255, opts.background & 255];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const sx = Math.min(tmp.width - 1, Math.floor(((i + 0.5) / W) * tmp.width));
        const sy = Math.min(tmp.height - 1, Math.floor(((j + 0.5) / H) * tmp.height));
        const si = (sy * tmp.width + sx) * 4;
        const a = data[si + 3] / 255;
        const di = (j * W + i) * 4;
        for (let k = 0; k < 3; k++) img.data[di + k] = data[si + k] * a + bg[k] * (1 - a);
        img.data[di + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  } else {
    // progressive halving gives a proper area-average (bicubic-like) result
    let cur: Source = src;
    let cx = x, cy = y, cs = side;
    while (cs / 2 > W * 2) {
      const half = Math.round(cs / 2);
      const step = canvas(half, half);
      const sctx = step.getContext("2d")!;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(cur as CanvasImageSource, cx, cy, cs, cs, 0, 0, half, half);
      cur = step; cx = 0; cy = 0; cs = half;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur as CanvasImageSource, cx, cy, cs, cs, 0, 0, W, H);
  }

  const data = ctx.getImageData(0, 0, W, H).data;
  let frame: Frame = new Array(W * H);
  for (let i = 0; i < W * H; i++) {
    frame[i] = adjust(pack(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]), opts.adjust);
  }
  if (opts.colors > 0) frame = quantize(frame, opts.colors);
  return frame;
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
