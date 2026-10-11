/** Color helpers. Colors are packed 0xRRGGBB integers throughout the app. */

export type RGB = [number, number, number];

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export const pack = (r: number, g: number, b: number) => (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
export const unpack = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export const toHex = (c: number) => c.toString(16).padStart(6, "0").toUpperCase();
export const toCss = (c: number) => "#" + c.toString(16).padStart(6, "0");
export function fromHex(s: string): number {
  const h = s.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? 0 : n & 0xffffff;
}

export function mix(a: number, b: number, t: number) {
  const [ar, ag, ab] = unpack(a);
  const [br, bg, bb] = unpack(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export const scale = (c: number, k: number) => {
  const [r, g, b] = unpack(c);
  return pack(r * k, g * k, b * k);
};

/** h: 0..360, s/v: 0..1 */
export function hsv(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return pack(f(5) * 255, f(3) * 255, f(1) * 255);
}

export const luminance = (c: number) => {
  const [r, g, b] = unpack(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/* ---------- image adjustments ---------- */

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
}

export const NO_ADJUST: Adjustments = { brightness: 0, contrast: 0, saturation: 0 };

export function adjust(c: number, a: Adjustments) {
  let [r, g, b] = unpack(c);
  if (a.brightness) {
    const d = (a.brightness / 100) * 255;
    r += d; g += d; b += d;
  }
  if (a.contrast) {
    const k = (259 * (a.contrast * 2.55 + 255)) / (255 * (259 - a.contrast * 2.55));
    r = k * (r - 128) + 128; g = k * (g - 128) + 128; b = k * (b - 128) + 128;
  }
  if (a.saturation) {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const k = 1 + a.saturation / 100;
    r = gray + (r - gray) * k; g = gray + (g - gray) * k; b = gray + (b - gray) * k;
  }
  return pack(r, g, b);
}

/* ---------- palette quantization (median cut) ---------- */

export function medianCut(colors: number[], k: number): number[] {
  if (!colors.length) return [0];
  type Box = RGB[];
  let boxes: Box[] = [colors.map(unpack)];
  while (boxes.length < k) {
    let best = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = ch; }
      }
    });
    if (best < 0 || bestRange === 0) break;
    const box = boxes[best].slice().sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return pack(r / box.length, g / box.length, b / box.length);
  });
}

export function nearest(c: number, palette: number[]) {
  const [r, g, b] = unpack(c);
  let best = palette[0], bd = Infinity;
  for (const p of palette) {
    const [pr, pg, pb] = unpack(p);
    // weighted distance approximates perceived difference
    const d = 2 * (pr - r) ** 2 + 4 * (pg - g) ** 2 + 3 * (pb - b) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function quantize(colors: number[], k: number, palette?: number[]) {
  const pal = palette ?? medianCut(colors, k);
  return colors.map((c) => nearest(c, pal));
}

/* ---------- built-in palettes ---------- */

export interface Palette { name: string; colors: number[] }

export const PALETTES: Palette[] = [
  {
    name: "PICO-8",
    colors: [0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
             0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa],
  },
  {
    name: "Neon",
    colors: [0xff0055, 0xff2e88, 0xff00ff, 0x9d00ff, 0x5500ff, 0x0066ff, 0x00ccff, 0x00ffcc,
             0x00ff66, 0x66ff00, 0xccff00, 0xffee00, 0xffaa00, 0xff5500, 0xffffff, 0x000000],
  },
  {
    name: "Game Boy",
    colors: [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f, 0x000000, 0xffffff],
  },
  {
    name: "Pastel",
    colors: [0xffadad, 0xffd6a5, 0xfdffb6, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xbdb2ff, 0xffc6ff,
             0xfffffc, 0x000000],
  },
  {
    name: "Fire",
    colors: [0x000000, 0x330000, 0x660000, 0x990000, 0xcc0000, 0xff0000, 0xff3300, 0xff6600,
             0xff9900, 0xffcc00, 0xffff00, 0xffff99],
  },
];
