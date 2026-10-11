import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_VISUALIZER, type VisualizerOptions } from "@/core/visualizer";
import type { AudioInput } from "@/services/audio";
import { safeStorage } from "./persist";

interface MusicState {
  opts: VisualizerOptions;
  input: AudioInput;
  set: (p: Partial<VisualizerOptions>) => void;
  setInput: (input: AudioInput) => void;
}

export const useMusic = create<MusicState>()(
  persist(
    (set, get) => ({
      opts: DEFAULT_VISUALIZER,
      input: "mic",
      set: (p) => set({ opts: { ...get().opts, ...p } }),
      setInput: (input) => set({ input }),
    }),
    {
      name: "pm.music",
      storage: safeStorage,
      merge: (p, c) => ({ ...c, ...(p as object), opts: { ...DEFAULT_VISUALIZER, ...((p as Partial<MusicState>)?.opts ?? {}) } }),
    }
  )
);
