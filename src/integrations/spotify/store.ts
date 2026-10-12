import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NO_ADJUST, type Adjustments } from "@/core/color";
import { LED_ENHANCE, type Enhance, type Resample } from "@/core/image";
import type { Frame } from "@/core/matrix";
import { safeStorage } from "@/store/persist";
import type { NowPlaying } from "./api";
import { loadTokens } from "./auth";

export type SpotifyFallback = "keep" | "clock" | "off";

export interface SpotifySettings {
  clientId: string;
  /** switch the matrix to the cover automatically when a song starts */
  autoShow: boolean;
  showProgress: boolean;
  progressColor: number;
  resample: Resample;
  adjust: Adjustments;
  colors: number;
  enhance: Enhance;
  /** what to show when playback stops (only while Spotify is on air) */
  fallback: SpotifyFallback;
  pollSeconds: number;
}

interface SpotifyState extends SpotifySettings {
  connected: boolean;
  track: NowPlaying | null;
  /** when `track.progressMs` was measured (for smooth interpolation) */
  fetchedAt: number;
  cover: Frame | null;
  coverUrl: string | null;
  error: string | null;
  set: (p: Partial<SpotifySettings>) => void;
}

export const useSpotify = create<SpotifyState>()(
  persist(
    (set) => ({
      clientId: "",
      autoShow: true,
      showProgress: true,
      progressColor: 0x1ed760,
      resample: "sharp",
      adjust: { ...NO_ADJUST, saturation: 15 },
      colors: 0,
      enhance: { ...LED_ENHANCE, sharpen: 25 },
      fallback: "keep",
      pollSeconds: 3,

      connected: !!loadTokens(),
      track: null,
      fetchedAt: 0,
      cover: null,
      coverUrl: null,
      error: null,
      set: (p) => set(p),
    }),
    {
      name: "pm.spotify",
      storage: safeStorage,
      version: 1,
      // v0 defaulted to plain "smooth" averaging; move everyone to the sharper LED pipeline
      migrate: (p, v) => {
        const s = p as Partial<SpotifySettings>;
        return v < 1 && s.resample === "smooth" ? { ...s, resample: "sharp" } : s;
      },
      partialize: (s) => ({
        clientId: s.clientId, autoShow: s.autoShow, showProgress: s.showProgress, progressColor: s.progressColor,
        resample: s.resample, adjust: s.adjust, colors: s.colors, enhance: s.enhance, fallback: s.fallback, pollSeconds: s.pollSeconds,
      }),
    }
  )
);

export function progressNow(): number {
  const { track, fetchedAt } = useSpotify.getState();
  if (!track) return 0;
  const p = track.progressMs + (track.isPlaying ? Date.now() - fetchedAt : 0);
  return Math.min(track.durationMs, p);
}
