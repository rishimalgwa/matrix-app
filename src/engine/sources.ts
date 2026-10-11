/**
 * Live sources. A source is anything that continuously produces frames: the
 * clock, the ticker, music visualizer, animation playback, Spotify artwork...
 *
 * Exactly one thing is "on air" at a time — either a running source or a
 * static frame. Sources keep running when you switch tabs, so the matrix
 * keeps showing the clock while you draw something new.
 *
 * Adding a new mode = implement `FrameSource` and call `registerSource`.
 */
import { create } from "zustand";
import type { Frame } from "@/core/matrix";
import { output } from "./output";

export interface FrameSource {
  id: string;
  label: string;
  /** Starts producing frames; returns a stop function. May be async (e.g. mic permission). */
  start(emit: (frame: Frame) => void): (() => void) | Promise<() => void>;
}

const registry = new Map<string, FrameSource>();

export function registerSource(source: FrameSource) {
  registry.set(source.id, source);
}

type OnAir =
  | { kind: "source"; id: string; label: string }
  | { kind: "static"; label: string }
  | null;

interface LiveState {
  onAir: OnAir;
  error: string | null;
}

export const useLive = create<LiveState>(() => ({ onAir: null, error: null }));

let stopCurrent: (() => void) | null = null;
let generation = 0;

function stopRunning() {
  generation++;
  stopCurrent?.();
  stopCurrent = null;
}

export async function goLive(id: string) {
  const src = registry.get(id);
  if (!src) throw new Error(`Unknown source ${id}`);
  stopRunning();
  const gen = generation;
  let first = true;
  const emit = (f: Frame) => {
    if (gen !== generation) return;
    output.push(f, first);
    first = false;
  };
  useLive.setState({ onAir: { kind: "source", id, label: src.label }, error: null });
  try {
    const stop = await src.start(emit);
    if (gen !== generation) stop(); // superseded while starting
    else stopCurrent = stop;
  } catch (e) {
    if (gen === generation) useLive.setState({ onAir: null, error: (e as Error).message });
    throw e;
  }
}

export function stopLive() {
  stopRunning();
  useLive.setState({ onAir: null });
}

/** Shows a single static frame (stops any running source). */
export function showStatic(frame: Frame, label: string) {
  stopRunning();
  useLive.setState({ onAir: { kind: "static", label }, error: null });
  output.push(frame, true);
}

/** Updates the static frame on air without re-waking (used by live drawing). */
export function updateStatic(frame: Frame, label: string) {
  const cur = useLive.getState().onAir;
  if (cur?.kind === "static" && cur.label === label) output.push(frame);
  else showStatic(frame, label);
}

export const isLive = (id: string) => {
  const a = useLive.getState().onAir;
  return a?.kind === "source" && a.id === id;
};

export function useIsLive(id: string) {
  return useLive((s) => s.onAir?.kind === "source" && s.onAir.id === id);
}

export async function toggleLive(id: string) {
  if (isLive(id)) stopLive();
  else await goLive(id);
}

/** Helper for simple timer-driven sources. */
export function intervalSource(id: string, label: string, fps: number, render: (t: number) => Frame): FrameSource {
  return {
    id,
    label,
    start(emit) {
      const t0 = performance.now();
      const tick = () => emit(render((performance.now() - t0) / 1000));
      tick();
      const h = setInterval(tick, 1000 / fps);
      return () => clearInterval(h);
    },
  };
}
