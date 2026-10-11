/** Clock & HUD renderer: frame = f(date, options, weather). */
import { hsv, mix, scale } from "./color";
import { FONT_3x5, FONT_5x7, renderText, stamp } from "./font";
import { W, blankFrame, line, setPx, type Frame } from "./matrix";

export type ClockLayout = "compact" | "stacked" | "ring" | "seconds" | "analog";
export type InfoLine = "none" | "date" | "weekday" | "weather" | "cycle";

export interface ClockTheme {
  id: string;
  name: string;
  bg: number;
  primary: number;
  secondary: number;
  accent: number;
  dim: number;
}

export const CLOCK_THEMES: ClockTheme[] = [
  { id: "cyberpunk", name: "Cyberpunk", bg: 0x0a0014, primary: 0xff2e88, secondary: 0x22d3ee, accent: 0xfde047, dim: 0x2a0a3a },
  { id: "amber", name: "Amber CRT", bg: 0x0a0500, primary: 0xffb000, secondary: 0xcc7a00, accent: 0xffd27a, dim: 0x2a1600 },
  { id: "matrix", name: "Matrix Green", bg: 0x000a02, primary: 0x00ff41, secondary: 0x008f11, accent: 0xb6ffc4, dim: 0x002a0a },
  { id: "pastel", name: "Pastel", bg: 0x0d0b14, primary: 0xffadc8, secondary: 0xa0c4ff, accent: 0xcaffbf, dim: 0x2a2433 },
  { id: "ice", name: "Ice", bg: 0x000510, primary: 0xffffff, secondary: 0x7dd3fc, accent: 0x38bdf8, dim: 0x0c1a2e },
  { id: "rainbow", name: "Rainbow", bg: 0x000000, primary: 0xff0000, secondary: 0x00ff00, accent: 0x0000ff, dim: 0x1a1a1a },
];

export interface ClockOptions {
  layout: ClockLayout;
  themeId: string;
  hour12: boolean;
  showSeconds: boolean;
  info: InfoLine;
  blinkColon: boolean;
  leadingZero: boolean;
}

export const DEFAULT_CLOCK: ClockOptions = {
  layout: "compact",
  themeId: "cyberpunk",
  hour12: false,
  showSeconds: true,
  info: "cycle",
  blinkColon: true,
  leadingZero: true,
};

export type WeatherKind = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export interface WeatherInfo {
  tempC: number;
  kind: WeatherKind;
  isDay: boolean;
  updated: number;
}

/* ---- 5x5 weather icons ---- */
// prettier-ignore
const ICONS: Record<WeatherKind, string[]> = {
  clear:  ["#.#.#", ".###.", "#####", ".###.", "#.#.#"],
  partly: ["#.#..", ".#...", "#.##.", ".####", "#####"],
  cloud:  [".....", ".##..", "####.", "#####", "....."],
  fog:    ["####.", ".....", ".####", ".....", "####."],
  rain:   [".##..", "####.", "#####", "#.#.#", ".#.#."],
  snow:   ["#.#.#", ".#.#.", "#.#.#", ".#.#.", "#.#.#"],
  storm:  [".##..", "####.", "..#..", ".#...", "..#.."],
};
const ICON_COLORS: Record<WeatherKind, number> = {
  clear: 0xffd000, partly: 0xffd000, cloud: 0xbcc6d6, fog: 0x8a94a6, rain: 0x38bdf8, snow: 0xffffff, storm: 0xfde047,
};

function drawIcon(f: Frame, kind: WeatherKind, x: number, y: number) {
  ICONS[kind].forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== "#") return;
      let c = ICON_COLORS[kind];
      if (kind === "partly" && (i + j > 4)) c = 0xbcc6d6;
      setPx(f, x + i, y + j, c);
    })
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const themeById = (id: string) => CLOCK_THEMES.find((t) => t.id === id) ?? CLOCK_THEMES[0];

function hoursOf(d: Date, o: ClockOptions) {
  let h = d.getHours();
  if (o.hour12) h = h % 12 || 12;
  return o.leadingZero ? pad(h) : String(h).padStart(2, " ");
}

/** Fixed-width digit pair: each glyph is centered in its own cell so "1" doesn't shift the layout. */
function pair(f: Frame, s: string, x: number, y: number, font: typeof FONT_3x5, color: number | ((x: number, y: number) => number)) {
  const cell = font === FONT_5x7 ? 5 : 3;
  [...s].forEach((ch, i) => {
    if (ch === " ") return;
    const g = font.glyph(ch);
    stamp(f, g, x + i * (cell + 1) + Math.floor((cell - g.length) / 2), y, color);
  });
}

function centered(f: Frame, text: string, font = FONT_3x5, y: number, color: number | ((x: number, y: number) => number)) {
  const cols = renderText(text, font);
  stamp(f, cols, Math.floor((W - cols.length) / 2), y, color);
}

/** Perimeter cell for step i of 60 (clockwise from top-center). */
function perimeter(i: number): [number, number] {
  const p = (i + 8) % 60; // start at top center
  if (p < 15) return [p, 0];
  if (p < 30) return [15, p - 15];
  if (p < 45) return [15 - (p - 30), 15];
  return [0, 15 - (p - 45)];
}

function resolveInfo(d: Date, o: ClockOptions, weather: WeatherInfo | null): InfoLine {
  if (o.info !== "cycle") return o.info;
  const slots: InfoLine[] = weather ? ["date", "weekday", "weather"] : ["date", "weekday"];
  return slots[Math.floor(d.getTime() / 5000) % slots.length];
}

/** Draws the 5px-high info line (date / weekday / weather) at row y. */
function drawInfo(f: Frame, d: Date, o: ClockOptions, t: ClockTheme, weather: WeatherInfo | null, y: number) {
  const mode = resolveInfo(d, o, weather);
  if (mode === "date") {
    // DD MM in two colors; 3x5 digit pairs are 7px, so this fills exactly 16px
    pair(f, pad(d.getDate()), 0, y, FONT_3x5, t.secondary);
    pair(f, pad(d.getMonth() + 1), 9, y, FONT_3x5, t.accent);
  } else if (mode === "weekday") {
    centered(f, DAYS[d.getDay()], FONT_3x5, y, t.secondary);
  } else if (mode === "weather" && weather) {
    const cols = renderText(`${Math.round(weather.tempC)}°`, FONT_3x5);
    const total = 5 + 1 + cols.length;
    const x0 = Math.max(0, Math.floor((W - total) / 2));
    drawIcon(f, weather.kind, x0, y);
    stamp(f, cols, x0 + 6, y, t.secondary);
  }
}

export function renderClock(d: Date, o: ClockOptions, weather: WeatherInfo | null = null): Frame {
  const t = themeById(o.themeId);
  const f = blankFrame(t.bg);
  const hh = hoursOf(d, o);
  const mm = pad(d.getMinutes());
  const ss = d.getSeconds();
  const colonOn = !o.blinkColon || d.getMilliseconds() < 500;
  const rainbow = t.id === "rainbow";
  const prim = rainbow ? (x: number, y: number) => hsv((x * 14 + y * 6 + d.getTime() / 40) % 360, 1, 1) : t.primary;

  switch (o.layout) {
    case "compact": {
      // HH:MM on one line in 3x5 digits: digits at 0,4 | colon 7 | 9,13
      const y = o.info === "none" ? 5 : 2;
      pair(f, hh, 0, y, FONT_3x5, prim);
      pair(f, mm, 9, y, FONT_3x5, prim);
      if (colonOn) { setPx(f, 7, y + 1, t.accent); setPx(f, 7, y + 3, t.accent); }
      drawInfo(f, d, o, t, weather, 9);
      if (o.showSeconds) {
        const filled = (ss / 60) * W;
        for (let x = 0; x < W; x++) setPx(f, x, 15, x < filled ? t.accent : t.dim);
      }
      break;
    }
    case "stacked": {
      // big 5x7 HH over MM
      pair(f, hh, 2, 0, FONT_5x7, prim);
      pair(f, mm, 2, 8, FONT_5x7, rainbow ? prim : t.secondary);
      if (o.showSeconds) {
        // seconds as a vertical dot meter on the right edge
        const lit = Math.round((ss / 59) * 15);
        for (let y = 0; y < 16; y++) setPx(f, 15, 15 - y, y <= lit ? t.accent : t.dim);
      }
      if (colonOn && !o.showSeconds) { setPx(f, 14, 5, t.accent); setPx(f, 14, 9, t.accent); }
      break;
    }
    case "ring": {
      pair(f, hh, 4, 3, FONT_3x5, prim);
      pair(f, mm, 4, 9, FONT_3x5, rainbow ? prim : t.secondary);
      for (let i = 0; i < 60; i++) {
        const [x, y] = perimeter(i);
        const on = o.showSeconds ? i <= ss : i % 5 === 0;
        setPx(f, x, y, on ? (i % 5 === 0 ? t.accent : scale(t.accent, 0.55)) : t.dim);
      }
      break;
    }
    case "seconds": {
      // HH:MM on top, big SS below
      const y = 1;
      pair(f, hh, 0, y, FONT_3x5, prim);
      pair(f, mm, 9, y, FONT_3x5, prim);
      if (colonOn) { setPx(f, 7, y + 1, t.accent); setPx(f, 7, y + 3, t.accent); }
      pair(f, pad(ss), 2, 8, FONT_5x7, rainbow ? prim : t.secondary);
      break;
    }
    case "analog": {
      const c = 7.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = Math.round(c + Math.sin(a) * 7.2 - 0.0001);
        const y = Math.round(c - Math.cos(a) * 7.2 - 0.0001);
        setPx(f, Math.max(0, Math.min(15, x)), Math.max(0, Math.min(15, y)), i % 3 === 0 ? t.accent : t.dim);
      }
      const hand = (frac: number, len: number, color: number) => {
        const a = frac * Math.PI * 2;
        line(7, 7, Math.round(7 + Math.sin(a) * len), Math.round(7 - Math.cos(a) * len), (x, y) => setPx(f, x, y, color));
        line(8, 8, Math.round(8 + Math.sin(a) * len), Math.round(8 - Math.cos(a) * len), (x, y) => setPx(f, x, y, mix(color, t.bg, 0.5)));
      };
      const h = (d.getHours() % 12) + d.getMinutes() / 60;
      hand(h / 12, 3.6, t.secondary);
      hand((d.getMinutes() + ss / 60) / 60, 5.6, t.primary);
      if (o.showSeconds) {
        const a = (ss / 60) * Math.PI * 2;
        setPx(f, Math.round(7.5 + Math.sin(a) * 6), Math.round(7.5 - Math.cos(a) * 6), t.accent);
      }
      setPx(f, 7, 7, t.accent); setPx(f, 8, 8, t.accent); setPx(f, 7, 8, t.accent); setPx(f, 8, 7, t.accent);
      break;
    }
  }
  return f;
}

/** WMO weather code → icon kind (Open-Meteo). */
export function wmoToKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}
