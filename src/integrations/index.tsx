import { registerSource } from "@/engine/sources";
import { SpotifyPanel } from "./spotify/SpotifyPanel";
import { spotifySource, startSpotify } from "./spotify/service";
import { useSpotify } from "./spotify/store";
import type { Integration } from "./types";

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.21.86Zm1.22-2.73a.78.78 0 0 1-1.07.26c-2.68-1.65-6.78-2.13-9.96-1.16a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.22 1.32.37.23.49.71.26 1.07Zm.1-2.84C14.7 8.92 9.4 8.74 6.32 9.67a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.1 1.33a.94.94 0 0 1-.96 1.62Z" />
    </svg>
  );
}

/** All integrations. Add new ones here. */
export const INTEGRATIONS: Integration[] = [
  {
    id: "spotify",
    name: "Spotify",
    description: "Shows the album cover of whatever you're playing, automatically, with a live progress bar.",
    icon: <span className="text-spotify"><SpotifyIcon /></span>,
    init: () => {
      registerSource(spotifySource);
      return startSpotify();
    },
    Panel: SpotifyPanel,
    useStatus: () => {
      const { connected, track } = useSpotify();
      if (!connected) return { label: "Not connected", tone: "default" };
      if (track?.isPlaying) return { label: "Playing", tone: "ok" };
      return { label: "Connected", tone: "ok" };
    },
  },
];

let started = false;
export function initIntegrations() {
  if (started) return;
  started = true;
  for (const i of INTEGRATIONS) void i.init?.();
}
