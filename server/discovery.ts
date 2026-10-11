/**
 * WLED auto-discovery, served by the Vite dev/preview server at GET /api/discover.
 *
 * Browsers can't do mDNS or learn the machine's IP, so discovery runs here in Node,
 * the same way the official WLED app finds devices:
 *   1. mDNS / Bonjour browse for `_wled._tcp`
 *   2. a quick HTTP sweep of every local /24 subnet for `/json/info`
 * Results are merged by MAC address.
 */
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import Bonjour from "bonjour-service";

export interface FoundDevice {
  host: string;
  name: string;
  ver: string;
  mac: string;
  leds: number;
  matrix?: { w: number; h: number };
  via: "mdns" | "scan";
}

interface WledInfo {
  ver?: string;
  name?: string;
  mac?: string;
  brand?: string;
  leds?: { count?: number; matrix?: { w: number; h: number } };
}

const isWled = (i: WledInfo) => i.brand === "WLED" || (typeof i.ver === "string" && typeof i.leds?.count === "number");

async function probe(host: string, timeoutMs: number): Promise<FoundDevice | null> {
  try {
    const res = await fetch(`http://${host}/json/info`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const info = (await res.json()) as WledInfo;
    if (!isWled(info)) return null;
    return {
      host,
      name: info.name ?? "WLED",
      ver: info.ver ?? "?",
      mac: info.mac ?? host,
      leds: info.leds?.count ?? 0,
      matrix: info.leds?.matrix,
      via: "scan",
    };
  } catch {
    return null;
  }
}

/** Private IPv4 /24 prefixes of this machine's network interfaces, e.g. "192.168.29". */
export function localSubnets(): { prefix: string; self: string }[] {
  const out: { prefix: string; self: string }[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      const prefix = a.address.split(".").slice(0, 3).join(".");
      if (!out.some((o) => o.prefix === prefix)) out.push({ prefix, self: a.address });
    }
  }
  return out;
}

function mdnsBrowse(ms: number): Promise<string[]> {
  return new Promise((resolve) => {
    const hosts = new Set<string>();
    let bonjour: Bonjour | null = null;
    try {
      bonjour = new Bonjour();
      bonjour.find({ type: "wled" }, (svc) => {
        const ip = svc.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? svc.referer?.address;
        if (ip) hosts.add(svc.port && svc.port !== 80 ? `${ip}:${svc.port}` : ip);
      });
    } catch {
      /* mDNS unavailable (no multicast) — the subnet sweep still runs */
    }
    setTimeout(() => {
      bonjour?.destroy();
      resolve([...hosts]);
    }, ms);
  });
}

async function sweep(prefix: string, self: string, concurrency = 64): Promise<FoundDevice[]> {
  const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter((ip) => ip !== self);
  const found: FoundDevice[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < ips.length) {
        const d = await probe(ips[next++], 900);
        if (d) found.push(d);
      }
    })
  );
  return found;
}

export async function discover(): Promise<{ devices: FoundDevice[]; subnets: string[] }> {
  const subnets = localSubnets();
  const [mdnsHosts, swept] = await Promise.all([
    mdnsBrowse(2500),
    Promise.all(subnets.map((s) => sweep(s.prefix, s.self))).then((r) => r.flat()),
  ]);
  const viaMdns = (await Promise.all(mdnsHosts.map((h) => probe(h, 2000)))).filter(Boolean) as FoundDevice[];
  const byMac = new Map<string, FoundDevice>();
  for (const d of viaMdns) byMac.set(d.mac, { ...d, via: "mdns" });
  for (const d of swept) if (!byMac.has(d.mac)) byMac.set(d.mac, d);
  const devices = [...byMac.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { devices, subnets: subnets.map((s) => `${s.prefix}.0/24`) };
}

let inflight: ReturnType<typeof discover> | null = null;

function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith("/api/discover")) return next();
  inflight ??= discover().finally(() => { inflight = null; });
  inflight
    .then((r) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(r));
    })
    .catch((e) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    });
}

export function wledDiscovery(): Plugin {
  return {
    name: "wled-discovery",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}
