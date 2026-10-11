#!/usr/bin/env node
/**
 * Fake WLED device for developing without hardware.
 *   node dev/mock-wled.mjs     → http://127.0.0.1:8080 (HTTP + /ws) and UDP :21324
 * Then set the device IP in the app to 127.0.0.1:8080.
 *   HOST=0.0.0.0 PORT=80 node dev/mock-wled.mjs
 * makes it discoverable on your LAN (mDNS + subnet scan) like a real ESP32.
 * It renders the received matrix in the terminal.
 */
import http from "node:http";
import dgram from "node:dgram";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const pixels = new Array(256).fill("000000");
let state = { on: true, bri: 128, ps: -1 };
const presets = { 0: {} };
let renders = 0;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function applySegI(arr) {
  let i = 0;
  for (const v of arr) {
    if (typeof v === "number") i = v;
    else pixels[i++ % 256] = v.toUpperCase();
  }
}

function applyState(body) {
  if (body.on !== undefined) state.on = body.on;
  if (body.bri !== undefined) state.bri = body.bri;
  if (body.seg?.i) applySegI(body.seg.i);
  if (body.psave) {
    const { psave, n, o, ...rest } = body;
    presets[psave] = { n, ...rest };
  }
  if (body.pdel) delete presets[body.pdel];
  if (body.ps && presets[body.ps]?.seg?.i) applySegI(presets[body.ps].seg.i);
  draw();
}

let drawTimer = null;
function draw() {
  if (drawTimer) return;
  drawTimer = setTimeout(() => {
    drawTimer = null;
    renders++;
    let out = "\x1b[H\x1b[2J";
    for (let y = 0; y < 16; y += 2) {
      for (let x = 0; x < 16; x++) {
        const t = pixels[y * 16 + x], b = pixels[(y + 1) * 16 + x];
        const rgb = (h) => [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)).join(";");
        out += `\x1b[38;2;${rgb(t)}m\x1b[48;2;${rgb(b)}m▀`;
      }
      out += "\x1b[0m\n";
    }
    out += `\nmock WLED :${PORT}  on=${state.on} bri=${state.bri}  updates=${renders}\n`;
    if (!process.env.QUIET) process.stdout.write(out);
  }, 30);
}

const info = () => ({
  ver: "0.15.0-mock", name: "Mock Matrix", brand: "WLED", product: "FOSS", mac: "a0b1c2d3e4f5", arch: "esp32", ip: HOST,
  leds: { count: 256, matrix: { w: 16, h: 16 }, fps: 42, pwr: 0 }, wifi: { signal: 88 }, live: false,
});

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(200, cors); return res.end(); }
  const send = (obj) => { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.url === "/json/info") return send(info());
  if (req.url === "/json/state" && req.method === "GET") return send(state);
  if (req.url === "/presets.json") return send(presets);
  if (req.url === "/debug/pixels") return send(pixels);
  if (req.url === "/json/state" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { applyState(JSON.parse(body)); send({ success: true }); }
      catch { res.writeHead(400, cors); res.end(); }
    });
    return;
  }
  res.writeHead(404, cors); res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.on("message", (d) => { try { applyState(JSON.parse(d.toString())); ws.send(JSON.stringify({ state })); } catch { /* ignore */ } });
});

const udp = dgram.createSocket("udp4");
udp.on("message", (msg) => {
  if (msg[0] !== 2) return;
  for (let i = 0; i < 256 && 2 + i * 3 + 2 < msg.length; i++)
    pixels[i] = [msg[2 + i * 3], msg[3 + i * 3], msg[4 + i * 3]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  draw();
});
udp.bind(Number(process.env.UDP_PORT || 21324));

server.listen(PORT, HOST, async () => {
  console.log(`mock WLED on http://${HOST}:${PORT}`);
  if (HOST === "127.0.0.1") return;
  // advertise like real WLED firmware does
  const { Bonjour } = await import("bonjour-service");
  new Bonjour().publish({ name: "wled-d3e4f5", type: "wled", port: PORT });
  console.log("advertising _wled._tcp via mDNS");
});
