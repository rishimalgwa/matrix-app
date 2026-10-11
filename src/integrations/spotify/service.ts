/**
 * Spotify "now playing" poller. Runs app-wide (not tied to a tab) so the
 * cover switches automatically when the song changes.
 */
import { blankFrame, setPx, W, H, type Frame } from "@/core/matrix";
import { mix, scale } from "@/core/color";
import { FULL_CROP, loadImage, rasterize } from "@/core/image";
import { goLive, isLive, showStatic, type FrameSource } from "@/engine/sources";
import { currentlyPlaying, SpotifyAuthError } from "./api";
import { handleRedirect, login, logout } from "./auth";
import { progressNow, useSpotify } from "./store";

let timer: ReturnType<typeof setTimeout> | null = null;
let lastTrackId: string | null = null;
let wasPlaying = false;

async function renderCover(url: string): Promise<Frame> {
  const s = useSpotify.getState();
  const img = await loadImage(url, true); // i.scdn.co sends CORS headers
  return rasterize(img, { crop: FULL_CROP, resample: s.resample, adjust: s.adjust, colors: s.colors, background: 0 });
}

/** Re-render the current cover after settings change. */
export async function rerenderCover() {
  const url = useSpotify.getState().coverUrl;
  if (url) useSpotify.setState({ cover: await renderCover(url) });
}

async function poll() {
  const s = useSpotify.getState();
  if (!s.clientId || !s.connected) return;
  try {
    const track = await currentlyPlaying(s.clientId);
    const changed = (track?.id ?? null) !== lastTrackId;
    useSpotify.setState({ track, fetchedAt: Date.now(), error: null });

    if (track && changed) {
      lastTrackId = track.id;
      // pick the ~300px image: enough detail for a clean downsample
      const img = track.images.find((i) => i.width && i.width <= 320) ?? track.images[0];
      if (img) {
        const cover = await renderCover(img.url);
        useSpotify.setState({ cover, coverUrl: img.url });
      } else useSpotify.setState({ cover: null, coverUrl: null });
    } else if (!track) {
      lastTrackId = null;
    }

    const playing = !!track?.isPlaying;
    if (playing && (changed || !wasPlaying) && s.autoShow && !isLive("spotify")) void goLive("spotify");
    if (!playing && wasPlaying && isLive("spotify")) {
      if (s.fallback === "clock") void goLive("clock");
      else if (s.fallback === "off") showStatic(blankFrame(), "Off");
    }
    wasPlaying = playing;
  } catch (e) {
    if (e instanceof SpotifyAuthError) {
      logout();
      useSpotify.setState({ connected: false });
    }
    useSpotify.setState({ error: (e as Error).message });
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  const s = useSpotify.getState();
  if (!s.connected) return;
  const base = Math.max(1, s.pollSeconds) * 1000;
  // poll faster near the end of a track so the next cover appears promptly
  const t = s.track;
  const remaining = t && t.isPlaying ? t.durationMs - progressNow() : Infinity;
  const delay = remaining < base ? Math.max(500, remaining + 300) : t?.isPlaying ? base : base * 2;
  timer = setTimeout(async () => { await poll(); schedule(); }, delay);
}

export async function startSpotify() {
  const { clientId } = useSpotify.getState();
  if (clientId) {
    try {
      if (await handleRedirect(clientId)) useSpotify.setState({ connected: true, error: null });
    } catch (e) {
      useSpotify.setState({ error: (e as Error).message });
    }
  }
  if (useSpotify.getState().connected) { await poll(); schedule(); }
  // restart polling when the connection state flips
  useSpotify.subscribe((s, prev) => {
    if (s.connected !== prev.connected || s.pollSeconds !== prev.pollSeconds) {
      if (s.connected) void poll().then(schedule);
      else if (timer) clearTimeout(timer);
    }
  });
}

export const connectSpotify = () => login(useSpotify.getState().clientId.trim());

export function disconnectSpotify() {
  logout();
  if (timer) clearTimeout(timer);
  lastTrackId = null;
  useSpotify.setState({ connected: false, track: null, cover: null, coverUrl: null });
}

export const refreshSpotify = () => poll();

/* ---- live source ---- */

const NOTE = ["....####", "....#..#", "....#..#", "....#..#", "..###.##", ".####.##", ".###....", "..#....."];

function idleFrame(): Frame {
  const f = blankFrame();
  NOTE.forEach((row, y) => [...row].forEach((c, x) => c === "#" && setPx(f, x + 4, y + 4, 0x1ed760)));
  return f;
}

export function renderSpotifyFrame(): Frame {
  const s = useSpotify.getState();
  if (!s.cover) return idleFrame();
  const f = s.cover.slice();
  if (s.showProgress && s.track && s.track.durationMs > 0) {
    const p = progressNow() / s.track.durationMs;
    const filled = p * W;
    for (let x = 0; x < W; x++) {
      const i = (H - 1) * W + x;
      const k = Math.max(0, Math.min(1, filled - x));
      f[i] = k > 0 ? mix(scale(f[i], 0.25), s.progressColor, k) : scale(f[i], 0.25);
    }
  }
  return f;
}

export const spotifySource: FrameSource = {
  id: "spotify",
  label: "Spotify",
  start(emit) {
    const tick = () => emit(renderSpotifyFrame());
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  },
};
