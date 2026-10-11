/**
 * Finds WLED devices on the local network.
 *
 * 1. Preferred: ask the app's own server (`/api/discover`, see server/discovery.ts),
 *    which does real mDNS + a sweep of the machine's actual subnet.
 * 2. Fallback (app hosted as static files): sweep likely home-router subnets
 *    straight from the browser. WLED answers `/json/info` with CORS headers.
 */
import { normalizeHost } from "./wled";

export interface FoundDevice {
  host: string;
  name: string;
  ver: string;
  mac: string;
  leds: number;
  matrix?: { w: number; h: number };
  via: "mdns" | "scan";
}

/** Common router defaults (incl. Jio/Airtel/Xiaomi/TP-Link mesh), most likely first. */
const COMMON_SUBNETS = [
  "192.168.1", "192.168.0", "192.168.29", "192.168.31", "192.168.68", "192.168.2",
  "192.168.10", "192.168.100", "192.168.88", "192.168.43", "10.0.0", "10.0.1", "192.168.50", "192.168.8",
];

export interface DiscoverProgress {
  phase: "server" | "browser";
  done: number;
  total: number;
  subnet?: string;
}

async function probe(host: string, timeoutMs: number, signal?: AbortSignal): Promise<FoundDevice | null> {
  try {
    const res = await fetch(`http://${host}/json/info`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const i = await res.json();
    if (!(i.brand === "WLED" || (typeof i.ver === "string" && typeof i.leds?.count === "number"))) return null;
    return { host, name: i.name ?? "WLED", ver: i.ver ?? "?", mac: i.mac ?? host, leds: i.leds?.count ?? 0, matrix: i.leds?.matrix, via: "scan" };
  } catch {
    return null;
  }
}

async function viaServer(signal?: AbortSignal): Promise<FoundDevice[] | null> {
  try {
    const res = await fetch("/api/discover", {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return (await res.json()).devices as FoundDevice[];
  } catch {
    return null;
  }
}

async function viaBrowser(
  subnets: string[],
  onFound: (d: FoundDevice) => void,
  onProgress: (p: DiscoverProgress) => void,
  signal?: AbortSignal
) {
  const ips = subnets.flatMap((s) => Array.from({ length: 254 }, (_, i) => `${s}.${i + 1}`));
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      while (next < ips.length && !signal?.aborted) {
        const ip = ips[next++];
        const d = await probe(ip, 1200, signal);
        done++;
        if (done % 16 === 0 || done === ips.length) onProgress({ phase: "browser", done, total: ips.length, subnet: ip.split(".").slice(0, 3).join(".") + ".x" });
        if (d) onFound(d);
      }
    })
  );
}

export async function discoverDevices(opts: {
  onFound: (d: FoundDevice) => void;
  onProgress?: (p: DiscoverProgress) => void;
  /** subnet of a previously known device, scanned first in browser mode */
  hint?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { onFound, onProgress = () => {}, hint, signal } = opts;
  onProgress({ phase: "server", done: 0, total: 1 });
  const server = await viaServer(signal);
  if (server) {
    server.forEach(onFound);
    onProgress({ phase: "server", done: 1, total: 1 });
    return;
  }
  // try the classic mDNS name first — many OSes resolve .local names themselves
  const named = await probe("wled.local", 1500, signal);
  if (named) onFound(named);
  const hintPrefix = hint ? normalizeHost(hint).split(":")[0].split(".").slice(0, 3).join(".") : null;
  const subnets = [...new Set([hintPrefix, ...COMMON_SUBNETS].filter(Boolean) as string[])];
  await viaBrowser(subnets, onFound, onProgress, signal);
}

/** Looks for a device with a known MAC (used when DHCP gave it a new IP). */
export async function findByMac(mac: string, hint?: string): Promise<FoundDevice | null> {
  const ctrl = new AbortController();
  let match: FoundDevice | null = null;
  await discoverDevices({
    hint,
    signal: ctrl.signal,
    onFound: (d) => {
      if (d.mac === mac) { match = d; ctrl.abort(); }
    },
  });
  return match;
}
