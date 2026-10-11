/**
 * Output transports. Each takes a frame already in physical LED order.
 *
 *  - http:   POST /json/state — works everywhere, ~10-15 fps.
 *  - ws:     WLED's own websocket (ws://<ip>/ws) with the same JSON — ~25+ fps.
 *  - bridge: local Node bridge (bridge/udp-bridge.mjs) that converts binary
 *            websocket frames to WLED realtime UDP (DRGB, port 21324) — 40+ fps.
 *
 * New transports (DDP, MQTT, multiple panels...) only need to implement `Transport`.
 */
import type { Frame } from "@/core/matrix";
import { buildSegI, chunkSegI, normalizeHost, WledClient } from "./wled";

export type TransportKind = "http" | "ws" | "bridge";

export interface SendOptions {
  /** also turn the light on (first frame of a new show) */
  wake: boolean;
}

export interface Transport {
  readonly kind: TransportKind;
  send(frame: Frame, opts: SendOptions): Promise<void>;
  /** forget what the device is showing so the next send is a full frame */
  invalidate(): void;
  close(): void;
}

export interface TransportConfig {
  host: string;
  segId: number;
  /** pixels per HTTP request; 0 = whole frame at once */
  chunk: number;
  bridgeUrl: string;
  udpPort: number;
  /** seconds WLED stays in realtime mode after the last UDP packet */
  udpTimeout: number;
}

/* ---------------- HTTP JSON ---------------- */

class HttpTransport implements Transport {
  readonly kind = "http" as const;
  private client: WledClient;
  private prev: Frame | null = null;

  constructor(private cfg: TransportConfig) {
    this.client = new WledClient(cfg.host);
  }

  async send(frame: Frame, { wake }: SendOptions) {
    const base: Record<string, unknown> = { tt: 0 };
    if (wake) base.on = true;
    try {
      if (this.cfg.chunk > 0 && !this.prev) {
        const chunks = chunkSegI(frame, this.cfg.chunk);
        for (let k = 0; k < chunks.length; k++)
          await this.client.setState({ ...(k === 0 ? base : { tt: 0 }), seg: { id: this.cfg.segId, i: chunks[k] } }, 3000);
      } else {
        const i = buildSegI(frame, this.prev);
        if (!i.length && !wake) return;
        await this.client.setState({ ...base, seg: { id: this.cfg.segId, i } }, 3000);
      }
      this.prev = frame.slice();
    } catch (e) {
      this.prev = null;
      throw e;
    }
  }

  invalidate() { this.prev = null; }
  close() {}
}

/* ---------------- WLED websocket ---------------- */

class WsTransport implements Transport {
  readonly kind = "ws" as const;
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private prev: Frame | null = null;
  private closed = false;

  constructor(private cfg: TransportConfig) {}

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://${normalizeHost(this.cfg.host)}/ws`);
      const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket timed out")); }, 4000);
      ws.onopen = () => { clearTimeout(timer); this.ws = ws; this.prev = null; resolve(ws); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket error")); };
      ws.onclose = () => { this.ws = null; this.prev = null; };
      ws.onmessage = () => {}; // WLED echoes state; ignored
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  async send(frame: Frame, { wake }: SendOptions) {
    if (this.closed) return;
    const ws = await this.connect();
    // don't pile up frames if the ESP32 is slower than us
    if (ws.bufferedAmount > 8192) return;
    const i = buildSegI(frame, this.prev);
    if (!i.length && !wake) return;
    const body: Record<string, unknown> = { tt: 0, v: false, seg: { id: this.cfg.segId, i } };
    if (wake) body.on = true;
    ws.send(JSON.stringify(body));
    this.prev = frame.slice();
  }

  invalidate() { this.prev = null; }
  close() { this.closed = true; this.ws?.close(); }
}

/* ---------------- Node UDP bridge ---------------- */

class BridgeTransport implements Transport {
  readonly kind = "bridge" as const;
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private closed = false;

  constructor(private cfg: TransportConfig) {}

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.cfg.bridgeUrl);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => { ws.close(); reject(new Error("Bridge not reachable")); }, 3000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({
          type: "config",
          host: normalizeHost(this.cfg.host).split(":")[0],
          port: this.cfg.udpPort,
          timeout: this.cfg.udpTimeout,
        }));
        this.ws = ws;
        resolve(ws);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("Bridge not reachable — run `npm run bridge`")); };
      ws.onclose = () => { this.ws = null; };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  async send(frame: Frame) {
    if (this.closed) return;
    const ws = await this.connect();
    if (ws.bufferedAmount > 16384) return;
    const buf = new Uint8Array(frame.length * 3);
    for (let i = 0; i < frame.length; i++) {
      buf[i * 3] = (frame[i] >> 16) & 255;
      buf[i * 3 + 1] = (frame[i] >> 8) & 255;
      buf[i * 3 + 2] = frame[i] & 255;
    }
    ws.send(buf);
  }

  invalidate() {}
  close() { this.closed = true; this.ws?.close(); }
}

export function createTransport(kind: TransportKind, cfg: TransportConfig): Transport {
  switch (kind) {
    case "ws": return new WsTransport(cfg);
    case "bridge": return new BridgeTransport(cfg);
    default: return new HttpTransport(cfg);
  }
}

export const TRANSPORT_INFO: Record<TransportKind, { label: string; hint: string; fps: number }> = {
  http: { label: "HTTP JSON", hint: "Most compatible. Best for static art, clock and slow animations.", fps: 12 },
  ws: { label: "WebSocket", hint: "Persistent connection to WLED — smoother animations & music.", fps: 25 },
  bridge: { label: "UDP Bridge", hint: "Realtime DRGB over UDP via the local Node bridge (npm run bridge). Fastest.", fps: 40 },
};
