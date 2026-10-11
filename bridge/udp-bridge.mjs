#!/usr/bin/env node
/**
 * WebSocket → WLED realtime UDP bridge.
 *
 * Browsers can't send UDP, so the app streams raw RGB frames here over a
 * local websocket and this script forwards them to WLED as DRGB packets:
 *   [2, timeout, r0, g0, b0, r1, g1, b1, ...]   → <ESP32_IP>:21324
 * For more than 490 LEDs it automatically switches to DNRGB (protocol 4).
 *
 * Usage:  npm run bridge            (listens on ws://127.0.0.1:8787)
 *         PORT=9000 npm run bridge
 */
import dgram from "node:dgram";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const udp = dgram.createSocket("udp4");
const wss = new WebSocketServer({ port: PORT, host: HOST });

let frames = 0;
setInterval(() => {
  if (frames) process.stdout.write(`\r${(frames / 5).toFixed(1)} fps   `);
  frames = 0;
}, 5000);

wss.on("connection", (ws, req) => {
  let target = null; // { host, port, timeout }
  console.log(`\n[bridge] client connected from ${req.socket.remoteAddress}`);

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "config") {
          target = { host: String(msg.host), port: Number(msg.port) || 21324, timeout: Math.max(1, Math.min(255, Number(msg.timeout) || 2)) };
          console.log(`[bridge] streaming to ${target.host}:${target.port} (timeout ${target.timeout}s)`);
          ws.send(JSON.stringify({ type: "ok" }));
        }
      } catch {
        /* ignore malformed */
      }
      return;
    }
    if (!target) return;
    const rgb = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const leds = Math.floor(rgb.length / 3);
    if (leds <= 490) {
      const pkt = Buffer.allocUnsafe(2 + leds * 3);
      pkt[0] = 2; // DRGB
      pkt[1] = target.timeout;
      rgb.copy(pkt, 2, 0, leds * 3);
      udp.send(pkt, target.port, target.host);
    } else {
      // DNRGB: [4, timeout, startHi, startLo, rgb...] in chunks of 489 LEDs
      for (let start = 0; start < leds; start += 489) {
        const n = Math.min(489, leds - start);
        const pkt = Buffer.allocUnsafe(4 + n * 3);
        pkt[0] = 4;
        pkt[1] = target.timeout;
        pkt[2] = start >> 8;
        pkt[3] = start & 255;
        rgb.copy(pkt, 4, start * 3, (start + n) * 3);
        udp.send(pkt, target.port, target.host);
      }
    }
    frames++;
  });

  ws.on("close", () => console.log("\n[bridge] client disconnected"));
});

wss.on("listening", () => console.log(`[bridge] listening on ws://${HOST}:${PORT} — select "UDP Bridge" in the app's Device settings`));
wss.on("error", (e) => { console.error("[bridge]", e.message); process.exit(1); });
