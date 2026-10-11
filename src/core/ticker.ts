/** Scrolling text marquee renderer (pure: frame = f(time, options)). */
import { hsv, mix } from "./color";
import { fontById, renderText, stamp } from "./font";
import { H, W, blankFrame, type Frame } from "./matrix";

export type ScrollDirection = "rtl" | "ltr";
export type TextColorMode = "solid" | "gradient" | "rainbow";

export interface TickerOptions {
  text: string;
  fontId: string;
  color: number;
  color2: number;
  colorMode: TextColorMode;
  background: number;
  /** pixels per second */
  speed: number;
  direction: ScrollDirection;
  /** vertical position: -1 = centered, otherwise top row */
  y: number;
  spacing: number;
  /** blank columns between repeats */
  gap: number;
}

export const DEFAULT_TICKER: TickerOptions = {
  text: "HELLO WORLD ♥",
  fontId: "5x7",
  color: 0x22d3ee,
  color2: 0xff2e88,
  colorMode: "solid",
  background: 0x000000,
  speed: 12,
  direction: "rtl",
  y: -1,
  spacing: 1,
  gap: 4,
};

export const MAX_TEXT = 120;

export function tickerStrip(o: TickerOptions) {
  return renderText(o.text.slice(0, MAX_TEXT) || " ", fontById(o.fontId), o.spacing);
}

/** Duration in seconds of one complete pass. */
export function tickerPeriod(o: TickerOptions) {
  return (tickerStrip(o).length + Math.max(W, o.gap)) / Math.max(1, o.speed);
}

export function renderTicker(t: number, o: TickerOptions, strip = tickerStrip(o)): Frame {
  const font = fontById(o.fontId);
  const frame = blankFrame(o.background);
  const cycle = strip.length + Math.max(W, o.gap);
  const p = Math.floor(t * o.speed) % cycle;
  const x = o.direction === "rtl" ? W - p : p - strip.length;
  const y = o.y < 0 ? Math.floor((H - font.height) / 2) : o.y;

  const color = (px: number, py: number) => {
    if (o.colorMode === "rainbow") return hsv(((px * 12 + t * 120) % 360 + 360) % 360, 1, 1);
    if (o.colorMode === "gradient") return mix(o.color, o.color2, (py - y) / Math.max(1, font.height - 1));
    return o.color;
  };
  stamp(frame, strip, x, y, color);
  // second copy so the loop is seamless when the gap is shorter than the panel
  if (cycle < strip.length + W) stamp(frame, strip, o.direction === "rtl" ? x + cycle : x - cycle, y, color);
  return frame;
}
