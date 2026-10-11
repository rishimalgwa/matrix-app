import { create } from "zustand";
import { persist } from "zustand/middleware";
import { blankFrame, floodFill, idx, inBounds, W, type Frame } from "@/core/matrix";
import { safeStorage } from "./persist";

export type Tool = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect";

interface Snapshot { frames: Frame[]; current: number }

const HISTORY = 60;
const MAX_RECENT = 12;

interface EditorState {
  frames: Frame[];
  current: number;
  fps: number;
  tool: Tool;
  color: number;
  recent: number[];
  custom: number[];
  paletteName: string;
  grid: boolean;
  onion: boolean;
  mirror: boolean;
  /** push every edit to the matrix immediately */
  liveSync: boolean;
  past: Snapshot[];
  future: Snapshot[];

  setTool: (t: Tool) => void;
  setColor: (c: number) => void;
  set: (p: Partial<Pick<EditorState, "grid" | "onion" | "mirror" | "liveSync" | "paletteName" | "fps">>) => void;
  addCustom: (c: number) => void;
  removeCustom: (c: number) => void;

  /** snapshot for undo — call once at the start of each stroke/action */
  checkpoint: () => void;
  paint: (x: number, y: number, c: number) => void;
  fill: (x: number, y: number, c: number) => void;
  setCurrentFrame: (f: Frame, history?: boolean) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;

  select: (i: number) => void;
  addFrame: () => void;
  duplicateFrame: (i?: number) => void;
  deleteFrame: (i: number) => void;
  moveFrame: (from: number, to: number) => void;
  replaceAll: (frames: Frame[], fps?: number) => void;
  appendFrames: (frames: Frame[]) => void;
}

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => {
      const snapshot = (): Snapshot => ({ frames: get().frames.map((f) => f.slice()), current: get().current });
      const withHistory = (fn: () => Partial<EditorState>) => {
        const past = [...get().past, snapshot()].slice(-HISTORY);
        set({ ...fn(), past, future: [] });
      };
      const updateCurrent = (f: Frame) => {
        const frames = get().frames.slice();
        frames[get().current] = f;
        return { frames };
      };

      return {
        frames: [blankFrame()],
        current: 0,
        fps: 8,
        tool: "pencil",
        color: 0xff2e88,
        recent: [0xff2e88, 0x22d3ee, 0xfde047, 0x00e436, 0xffffff],
        custom: [],
        paletteName: "PICO-8",
        grid: true,
        onion: true,
        mirror: false,
        liveSync: false,
        past: [],
        future: [],

        setTool: (tool) => set({ tool }),
        setColor: (color) =>
          set({ color, recent: [color, ...get().recent.filter((c) => c !== color)].slice(0, MAX_RECENT) }),
        set: (p) => set(p),
        addCustom: (c) => set({ custom: [...get().custom.filter((x) => x !== c), c].slice(-32) }),
        removeCustom: (c) => set({ custom: get().custom.filter((x) => x !== c) }),

        checkpoint: () => set({ past: [...get().past, snapshot()].slice(-HISTORY), future: [] }),

        paint: (x, y, c) => {
          if (!inBounds(x, y)) return;
          const f = get().frames[get().current];
          const targets = [idx(x, y)];
          if (get().mirror) targets.push(idx(W - 1 - x, y));
          if (targets.every((i) => f[i] === c)) return;
          const next = f.slice();
          for (const i of targets) next[i] = c;
          set(updateCurrent(next));
        },

        fill: (x, y, c) => {
          if (!inBounds(x, y)) return;
          withHistory(() => updateCurrent(floodFill(get().frames[get().current], x, y, c)));
        },

        setCurrentFrame: (f, history = true) =>
          history ? withHistory(() => updateCurrent(f.slice())) : set(updateCurrent(f.slice())),

        clear: () => withHistory(() => updateCurrent(blankFrame())),

        undo: () => {
          const past = get().past;
          if (!past.length) return;
          const prev = past[past.length - 1];
          set({ ...prev, past: past.slice(0, -1), future: [snapshot(), ...get().future].slice(0, HISTORY) });
        },
        redo: () => {
          const [next, ...rest] = get().future;
          if (!next) return;
          set({ ...next, future: rest, past: [...get().past, snapshot()].slice(-HISTORY) });
        },

        select: (i) => set({ current: Math.max(0, Math.min(get().frames.length - 1, i)) }),
        addFrame: () =>
          withHistory(() => {
            const frames = get().frames.slice();
            frames.splice(get().current + 1, 0, blankFrame());
            return { frames, current: get().current + 1 };
          }),
        duplicateFrame: (i = get().current) =>
          withHistory(() => {
            const frames = get().frames.slice();
            frames.splice(i + 1, 0, frames[i].slice());
            return { frames, current: i + 1 };
          }),
        deleteFrame: (i) =>
          withHistory(() => {
            if (get().frames.length <= 1) return { frames: [blankFrame()], current: 0 };
            const frames = get().frames.filter((_, k) => k !== i);
            return { frames, current: Math.min(get().current, frames.length - 1) };
          }),
        moveFrame: (from, to) =>
          withHistory(() => {
            const frames = get().frames.slice();
            const t = Math.max(0, Math.min(frames.length - 1, to));
            const [f] = frames.splice(from, 1);
            frames.splice(t, 0, f);
            return { frames, current: t };
          }),
        replaceAll: (frames, fps) =>
          withHistory(() => ({ frames: frames.length ? frames.map((f) => f.slice()) : [blankFrame()], current: 0, ...(fps ? { fps } : {}) })),
        appendFrames: (add) =>
          withHistory(() => {
            const cur = get().frames;
            const onlyBlank = cur.length === 1 && cur[0].every((c) => c === 0);
            const frames = onlyBlank ? add.map((f) => f.slice()) : [...cur, ...add.map((f) => f.slice())];
            return { frames, current: onlyBlank ? 0 : cur.length };
          }),
      };
    },
    {
      name: "pm.editor",
      storage: safeStorage,
      partialize: (s) => ({
        frames: s.frames, current: s.current, fps: s.fps, color: s.color, recent: s.recent, custom: s.custom,
        paletteName: s.paletteName, grid: s.grid, onion: s.onion, mirror: s.mirror, tool: s.tool,
      }),
    }
  )
);

export const currentFrame = () => {
  const s = useEditor.getState();
  return s.frames[s.current];
};
