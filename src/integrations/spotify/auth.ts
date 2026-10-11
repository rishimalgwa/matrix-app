/**
 * Spotify Authorization Code + PKCE flow — runs entirely in the browser,
 * no client secret or backend required.
 * https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
 */
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"];

const K_VERIFIER = "pm.spotify.verifier";
const K_STATE = "pm.spotify.state";
const K_TOKENS = "pm.spotify.tokens";

export interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const redirectUri = () => window.location.origin + window.location.pathname;

function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function challenge(verifier: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function loadTokens(): Tokens | null {
  const raw = store.get(K_TOKENS);
  if (!raw) return null;
  try { return JSON.parse(raw) as Tokens; } catch { return null; }
}

function saveTokens(json: { access_token: string; refresh_token?: string; expires_in: number }, prev?: Tokens | null) {
  const t: Tokens = {
    access: json.access_token,
    refresh: json.refresh_token ?? prev?.refresh ?? "",
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  store.set(K_TOKENS, JSON.stringify(t));
  return t;
}

export function logout() {
  store.del(K_TOKENS);
}

export async function login(clientId: string) {
  if (!window.isSecureContext) throw new Error("Spotify login needs a secure context — open the app at http://127.0.0.1:5173");
  const verifier = randomString(64);
  const state = randomString(16);
  store.set(K_VERIFIER, verifier);
  store.set(K_STATE, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    scope: SCOPES.join(" "),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

/** Call once on boot. Returns true if this page load completed a login. */
export async function handleRedirect(clientId: string): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return false;

  const clean = () => {
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
  };

  if (error) { clean(); throw new Error(`Spotify: ${error}`); }
  if (!state || state !== store.get(K_STATE)) { clean(); throw new Error("Spotify login state mismatch — try again."); }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: store.get(K_VERIFIER) ?? "",
    }),
  });
  clean();
  store.del(K_VERIFIER);
  store.del(K_STATE);
  if (!res.ok) throw new Error(`Spotify token exchange failed (${res.status})`);
  saveTokens(await res.json());
  return true;
}

let refreshing: Promise<Tokens | null> | null = null;

async function refresh(clientId: string, t: Tokens): Promise<Tokens | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId }),
  });
  if (!res.ok) { logout(); return null; }
  return saveTokens(await res.json(), t);
}

/** Returns a valid access token, refreshing if it's about to expire. */
export async function accessToken(clientId: string, force = false): Promise<string | null> {
  const t = loadTokens();
  if (!t) return null;
  if (!force && t.expiresAt - Date.now() > 60_000) return t.access;
  refreshing ??= refresh(clientId, t).finally(() => { refreshing = null; });
  return (await refreshing)?.access ?? null;
}
