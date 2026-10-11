import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Frame } from "@/core/matrix";
import { safeStorage } from "./persist";

export interface Artwork {
  id: string;
  name: string;
  frames: Frame[];
  fps: number;
  created: number;
}

interface LibraryState {
  items: Artwork[];
  save: (name: string, frames: Frame[], fps: number) => Artwork;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      items: [],
      save: (name, frames, fps) => {
        const art: Artwork = {
          id: Math.random().toString(36).slice(2, 10),
          name: name.trim() || "Untitled",
          frames: frames.map((f) => f.slice()),
          fps,
          created: Date.now(),
        };
        set({ items: [art, ...get().items] });
        return art;
      },
      remove: (id) => set({ items: get().items.filter((a) => a.id !== id) }),
      rename: (id, name) => set({ items: get().items.map((a) => (a.id === id ? { ...a, name } : a)) }),
    }),
    { name: "pm.library", storage: safeStorage }
  )
);

/* ---- JSON import/export format ---- */

export interface PixelFile {
  format: "pixel-matrix";
  version: 1;
  width: number;
  height: number;
  fps: number;
  /** each frame is an array of "RRGGBB" strings, row-major */
  frames: string[][];
}

export function toPixelFile(frames: Frame[], fps: number, width = 16, height = 16): PixelFile {
  return {
    format: "pixel-matrix",
    version: 1,
    width,
    height,
    fps,
    frames: frames.map((f) => f.map((c) => c.toString(16).padStart(6, "0"))),
  };
}

export function fromPixelFile(json: unknown): { frames: Frame[]; fps: number } {
  const d = json as Partial<PixelFile>;
  if (!d || !Array.isArray(d.frames)) throw new Error("Not a pixel-matrix file");
  const frames = d.frames.map((f) => {
    if (!Array.isArray(f) || f.length !== 256) throw new Error("Frames must contain 256 pixels");
    return f.map((h) => parseInt(String(h).replace("#", ""), 16) & 0xffffff);
  });
  return { frames, fps: typeof d.fps === "number" ? d.fps : 8 };
}
