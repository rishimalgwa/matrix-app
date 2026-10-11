/** Spectrum analysis → 16 bands → frame renderers for Music mode. */
import { hsv, mix, scale } from "./color";
import { H, W, blankFrame, setPx, type Frame } from "./matrix";

export type VisualizerStyle = "bars" | "center" | "peaks" | "dots" | "radial";
export type VisualizerPalette = "classic" | "neon" | "fire" | "ice" | "rainbow" | "mono";

export interface VisualizerOptions {
  style: VisualizerStyle;
  palette: VisualizerPalette;
  /** input gain multiplier */
  gain: number;
  /** 0..0.95 temporal smoothing */
  smoothing: number;
  /** rows per second the peak caps fall */
  peakFall: number;
  minHz: number;
  maxHz: number;
  color: number;
}

export const DEFAULT_VISUALIZER: VisualizerOptions = {
  style: "peaks",
  palette: "classic",
  gain: 1.4,
  smoothing: 0.55,
  peakFall: 12,
  minHz: 40,
  maxHz: 14000,
  color: 0x22d3ee,
};

/** Log-spaced bin ranges for `bands` buckets. */
export function bandRanges(fftSize: number, sampleRate: number, bands: number, minHz: number, maxHz: number) {
  const binHz = sampleRate / fftSize;
  const maxBin = fftSize / 2 - 1;
  const ranges: [number, number][] = [];
  for (let b = 0; b < bands; b++) {
    const lo = minHz * Math.pow(maxHz / minHz, b / bands);
    const hi = minHz * Math.pow(maxHz / minHz, (b + 1) / bands);
    const a = Math.min(maxBin, Math.max(1, Math.floor(lo / binHz)));
    const z = Math.min(maxBin, Math.max(a, Math.ceil(hi / binHz) - 1));
    ranges.push([a, z]);
  }
  return ranges;
}

/** Stateful band processor: smoothing + peak-hold with decay. */
export class BandProcessor {
  levels = new Float32Array(W);
  peaks = new Float32Array(W);
  private last = performance.now();

  update(freq: Uint8Array, ranges: [number, number][], o: VisualizerOptions) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (let b = 0; b < ranges.length; b++) {
      const [a, z] = ranges[b];
      let max = 0;
      for (let i = a; i <= z; i++) if (freq[i] > max) max = freq[i];
      // gentle tilt so treble bands aren't always empty
      const tilt = 1 + (b / ranges.length) * 0.6;
      const v = Math.min(1, Math.pow(max / 255, 1.6) * o.gain * tilt);
      // instant attack, smoothed release
      this.levels[b] = v >= this.levels[b] ? v : this.levels[b] * o.smoothing + v * (1 - o.smoothing);
      const lvl = this.levels[b] * H;
      this.peaks[b] = Math.max(lvl, this.peaks[b] - o.peakFall * dt);
    }
  }
}

function colorFor(p: VisualizerPalette, base: number, col: number, row: number, t: number) {
  const k = row / (H - 1); // 0 bottom .. 1 top
  switch (p) {
    case "classic": return k < 0.55 ? 0x00e436 : k < 0.8 ? 0xffd000 : 0xff1744;
    case "neon": return mix(0x00e5ff, 0xff2e88, k);
    case "fire": return k < 0.35 ? mix(0x660000, 0xff2200, k / 0.35) : mix(0xff2200, 0xffee00, (k - 0.35) / 0.65);
    case "ice": return mix(0x0a2a6b, 0xe0f7ff, k);
    case "rainbow": return hsv((col * 22 + t * 60) % 360, 1, 1);
    case "mono": return scale(base, 0.35 + 0.65 * k);
  }
}

export function renderVisualizer(levels: ArrayLike<number>, peaks: ArrayLike<number>, o: VisualizerOptions, t = 0): Frame {
  const f = blankFrame();
  const c = (x: number, row: number) => colorFor(o.palette, o.color, x, row, t);
  for (let x = 0; x < W; x++) {
    const h = Math.round(levels[x] * H);
    switch (o.style) {
      case "bars":
      case "peaks": {
        for (let r = 0; r < h; r++) setPx(f, x, H - 1 - r, c(x, r));
        if (o.style === "peaks") {
          const p = Math.min(H - 1, Math.floor(peaks[x]));
          if (p > 0) setPx(f, x, H - 1 - p, 0xffffff);
        }
        break;
      }
      case "center": {
        const half = Math.round((levels[x] * H) / 2);
        for (let r = 0; r < half; r++) {
          const row = Math.round((r / (H / 2)) * (H - 1));
          setPx(f, x, H / 2 - 1 - r, c(x, row));
          setPx(f, x, H / 2 + r, c(x, row));
        }
        break;
      }
      case "dots": {
        if (h > 0) setPx(f, x, H - h, c(x, h - 1));
        if (h > 1) setPx(f, x, H - h + 1, scale(c(x, h - 1), 0.35));
        break;
      }
      case "radial": {
        // bands mirrored around center as concentric energy
        const cx = 7.5, cy = 7.5;
        for (let y = 0; y < H; y++) {
          const d = Math.hypot(x - cx, y - cy);
          const band = Math.min(W - 1, Math.floor((d / 10.6) * W));
          const lv = levels[band];
          if (lv * 10.6 > d * 0.9) setPx(f, x, y, c(band, Math.round(lv * (H - 1))));
        }
        break;
      }
    }
  }
  return f;
}
