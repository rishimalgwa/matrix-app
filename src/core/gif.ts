/** Animated GIF decode (gifuct-js) and encode (gifenc). */
import { decompressFrames, parseGIF } from "gifuct-js";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { rasterize, type RasterOptions } from "./image";
import { H, W, type Frame } from "./matrix";

export interface DecodedGif {
  width: number;
  height: number;
  /** fully composited RGBA canvases, one per GIF frame */
  canvases: HTMLCanvasElement[];
  /** per-frame delay in ms */
  delays: number[];
}

export const MAX_GIF_FRAMES = 240;

export async function decodeGif(buffer: ArrayBuffer): Promise<DecodedGif> {
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true).slice(0, MAX_GIF_FRAMES);
  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const ctx = full.getContext("2d", { willReadFrequently: true })!;

  const patchCanvas = document.createElement("canvas");
  const pctx = patchCanvas.getContext("2d")!;

  const canvases: HTMLCanvasElement[] = [];
  const delays: number[] = [];
  let restore: ImageData | null = null;

  for (const f of frames) {
    const { left, top, width: pw, height: ph } = f.dims;
    if (f.disposalType === 3) restore = ctx.getImageData(0, 0, width, height);

    patchCanvas.width = pw;
    patchCanvas.height = ph;
    const patch = new ImageData(new Uint8ClampedArray(f.patch), pw, ph);
    pctx.putImageData(patch, 0, 0);
    ctx.drawImage(patchCanvas, left, top); // drawImage respects patch transparency

    const snap = document.createElement("canvas");
    snap.width = width;
    snap.height = height;
    snap.getContext("2d")!.drawImage(full, 0, 0);
    canvases.push(snap);
    delays.push(f.delay && f.delay > 10 ? f.delay : 100);

    if (f.disposalType === 2) ctx.clearRect(left, top, pw, ph);
    else if (f.disposalType === 3 && restore) ctx.putImageData(restore, 0, 0);
  }
  return { width, height, canvases, delays };
}

export function gifToFrames(gif: DecodedGif, opts: RasterOptions) {
  return gif.canvases.map((c) => rasterize(c, opts));
}

/** Encodes frames as an upscaled animated GIF. */
export function encodeGif(frames: Frame[], fps: number, scale = 20): Blob {
  const gif = GIFEncoder();
  const w = W * scale;
  const h = H * scale;
  const delay = Math.round(1000 / fps);
  for (const frame of frames) {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = frame[Math.floor(y / scale) * W + Math.floor(x / scale)];
        const o = (y * w + x) * 4;
        rgba[o] = (c >> 16) & 255;
        rgba[o + 1] = (c >> 8) & 255;
        rgba[o + 2] = c & 255;
        rgba[o + 3] = 255;
      }
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay });
  }
  gif.finish();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}
