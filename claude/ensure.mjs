#!/usr/bin/env node
/**
 * SessionStart hook: makes sure the matrix service is running (starts it in
 * the background if not), then forwards the event.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_BASE = "http://127.0.0.1:8789";

const up = () => fetch(`${URL_BASE}/state`, { signal: AbortSignal.timeout(300) }).then((r) => r.ok, () => false);

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  if (!(await up())) {
    const out = fs.openSync(path.join(ROOT, "claude", "daemon.log"), "a");
    const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
    spawn(tsx, ["claude/daemon.ts"], { cwd: ROOT, detached: true, stdio: ["ignore", out, out] }).unref();
    for (let i = 0; i < 30 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
  }
  await fetch(`${URL_BASE}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: input || "{}",
    signal: AbortSignal.timeout(1000),
  }).catch(() => {});
});
