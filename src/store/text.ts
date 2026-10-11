import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_TICKER, type TickerOptions } from "@/core/ticker";
import { safeStorage } from "./persist";

interface TextState {
  opts: TickerOptions;
  presets: string[];
  set: (p: Partial<TickerOptions>) => void;
  savePreset: (text: string) => void;
  removePreset: (text: string) => void;
}

export const useText = create<TextState>()(
  persist(
    (set, get) => ({
      opts: DEFAULT_TICKER,
      presets: ["HELLO WORLD ♥", "GAME ON", "BRB ☕"],
      set: (p) => set({ opts: { ...get().opts, ...p } }),
      savePreset: (text) => set({ presets: [text, ...get().presets.filter((t) => t !== text)].slice(0, 12) }),
      removePreset: (text) => set({ presets: get().presets.filter((t) => t !== text) }),
    }),
    {
      name: "pm.text",
      storage: safeStorage,
      merge: (p, c) => ({ ...c, ...(p as object), opts: { ...DEFAULT_TICKER, ...((p as Partial<TextState>)?.opts ?? {}) } }),
    }
  )
);
