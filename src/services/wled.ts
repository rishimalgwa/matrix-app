/**
 * WLED JSON API client + payload builders.
 * Docs: https://kno.wled.ge/interfaces/json-api/
 */
import { toHex } from "@/core/color";
import type { Frame } from "@/core/matrix";

export interface WledInfo {
  ver: string;
  name: string;
  arch?: string;
  ip?: string;
  mac?: string;
  leds: { count: number; matrix?: { w: number; h: number }; fps?: number; pwr?: number };
  wifi?: { signal?: number; rssi?: number };
  live?: boolean;
  lm?: string;
}

export interface WledState {
  on: boolean;
  bri: number;
  ps?: number;
  seg?: unknown[];
}

export type WledPresets = Record<string, { n?: string; [k: string]: unknown }>;

/** Accepts "192.168.1.5", "http://wled.local/", "10.0.0.2:8080". Returns host[:port]. */
export function normalizeHost(input: string) {
  return input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the `seg.i` array. Runs of consecutive pixels are sent as
 * `[start, "RRGGBB", "RRGGBB", ...]` — WLED auto-increments the index after
 * each color. With `prev`, only changed pixels are included (diff update).
 */
export function buildSegI(frame: Frame, prev?: Frame | null): (number | string)[] {
  if (!prev) return frame.map(toHex); // full frame starting at LED 0
  const out: (number | string)[] = [];
  let runOpen = false;
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] !== prev[i]) {
      if (!runOpen) { out.push(i); runOpen = true; }
      out.push(toHex(frame[i]));
    } else runOpen = false;
  }
  return out;
}

/** Splits a full frame into several smaller payload arrays (for tiny WLED JSON buffers). */
export function chunkSegI(frame: Frame, chunk: number): (number | string)[][] {
  const out: (number | string)[][] = [];
  for (let s = 0; s < frame.length; s += chunk) out.push([s, ...frame.slice(s, s + chunk).map(toHex)]);
  return out;
}

export class WledClient {
  constructor(public host: string) {}

  get base() {
    return `http://${normalizeHost(this.host)}`;
  }

  info() {
    return request<WledInfo>(`${this.base}/json/info`);
  }

  state() {
    return request<WledState>(`${this.base}/json/state`);
  }

  setState(body: Record<string, unknown>, timeoutMs = 4000) {
    return request<{ success?: boolean }>(
      `${this.base}/json/state`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      timeoutMs
    );
  }

  setPower(on: boolean) {
    return this.setState({ on });
  }

  setBrightness(bri: number) {
    return this.setState({ bri: Math.max(0, Math.min(255, Math.round(bri))) });
  }

  presets() {
    return request<WledPresets>(`${this.base}/presets.json`);
  }

  loadPreset(id: number) {
    return this.setState({ ps: id });
  }

  deletePreset(id: number) {
    return this.setState({ pdel: id });
  }

  /**
   * Saves a frame as a WLED preset. `o: true` stores the request body itself
   * (an "API preset"), so the pixel data is replayed when the preset loads.
   */
  savePresetFrame(id: number, name: string, frame: Frame, segId = 0, bri?: number) {
    const body: Record<string, unknown> = {
      psave: id,
      n: name,
      o: true,
      on: true,
      seg: { id: segId, i: frame.map(toHex) },
    };
    if (bri !== undefined) body.bri = bri;
    return this.setState(body, 6000);
  }
}
