import { accessToken } from "./auth";

export interface NowPlaying {
  id: string;
  name: string;
  artists: string;
  album: string;
  /** largest → smallest */
  images: { url: string; width: number; height: number }[];
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  kind: "track" | "episode";
}

export class SpotifyAuthError extends Error {}

/** null = nothing playing. */
export async function currentlyPlaying(clientId: string): Promise<NowPlaying | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(clientId, attempt > 0);
    if (!token) throw new SpotifyAuthError("Not connected");
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) continue; // token revoked/expired → refresh once
    if (res.status === 204) return null;
    if (res.status === 429) throw new Error("Rate limited by Spotify");
    if (!res.ok) throw new Error(`Spotify ${res.status}`);
    const d = await res.json();
    const item = d.item;
    if (!item) return null;
    const isEpisode = d.currently_playing_type === "episode";
    return {
      id: item.id ?? item.uri ?? item.name,
      name: item.name,
      artists: isEpisode ? item.show?.publisher ?? "" : (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
      album: isEpisode ? item.show?.name ?? "" : item.album?.name ?? "",
      images: (isEpisode ? item.images ?? item.show?.images : item.album?.images) ?? [],
      isPlaying: !!d.is_playing,
      progressMs: d.progress_ms ?? 0,
      durationMs: item.duration_ms ?? 0,
      kind: isEpisode ? "episode" : "track",
    };
  }
  throw new SpotifyAuthError("Spotify session expired — reconnect");
}
