/**
 * Claude Code → matrix service.
 *
 * Claude Code hooks POST their events here (see claude/install.mjs), the
 * status line POSTs context/rate-limit usage, and this process animates the
 * panel accordingly. It runs in Node rather than the browser so animations
 * keep running while you're in the terminal (background tabs get throttled).
 *
 * When Claude goes quiet it gives the panel back: whatever WLED showed before
 * (effect, preset, or your pixel art) is restored.
 *
 *   npm run claude            start in the foreground
 *   npm run claude -- --host=192.168.1.125 --fps=12 --transport=ws
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activityForTool, CLAUDE_TIMING, renderClaude, type ClaudeActivity, type ClaudeMode, type ClaudeView } from "../src/core/claude";
import { framesEqual, type Frame } from "../src/core/matrix";
import { createTransport, type Transport, type TransportKind } from "../src/services/transports";
import { normalizeHost, WledClient } from "../src/services/wled";
import { discover } from "../server/discovery";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(DIR, "config.json");

interface Config {
  host: string;
  port: number;
  transport: TransportKind;
  fps: number;
  segId: number;
  /** idle this long → Clawd falls asleep */
  sleepAfterSec: number;
  /** asleep this long → give the panel back */
  releaseAfterSec: number;
  /** nothing to do this long → exit (the next session restarts it) */
  exitAfterSec: number;
}

const DEFAULTS: Config = {
  host: "",
  port: 8789,
  transport: "http",
  fps: 12,
  segId: 0,
  sleepAfterSec: 90,
  releaseAfterSec: 120,
  exitAfterSec: 1800,
};

function loadConfig(): Config {
  let file: Partial<Config> = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { /* none yet */ }
  const args: Partial<Record<keyof Config, string>> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (m) args[m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()) as keyof Config] = m[2];
  }
  const num = (k: keyof Config) => (args[k] !== undefined ? Number(args[k]) : undefined);
  return {
    ...DEFAULTS,
    ...file,
    ...(args.host ? { host: normalizeHost(args.host) } : {}),
    ...(args.transport ? { transport: args.transport as TransportKind } : {}),
    ...Object.fromEntries(
      (["port", "fps", "segId", "sleepAfterSec", "releaseAfterSec", "exitAfterSec"] as const)
        .map((k) => [k, num(k)])
        .filter(([, v]) => v !== undefined && !Number.isNaN(v))
    ),
  };
}

const cfg = loadConfig();
const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), ...a);

/* ------------------------------------------------------------------ */
/* session state                                                       */
/* ------------------------------------------------------------------ */

interface Session {
  id: string;
  mode: ClaudeMode;
  activity?: ClaudeActivity;
  since: number;
  last: number;
  agents: Set<string>;
  stoppedAt: number;
  beforeCompact?: ClaudeMode;
  ctxPct: number | null;
  toolFailedAt: number | null;
  /** epoch ms until which the "limit reached" screen stays up */
  limitedUntil: number;
  cwd?: string;
}

interface Limit { pct: number; resetsAt: number }

const sessions = new Map<string, Session>();
let fiveHour: Limit | null = null;
let sevenDay: Limit | null = null;
/** a preview requested from the app overrides everything for a few seconds */
let preview: { view: ClaudeView; until: number; since: number } | null = null;

function session(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { id, mode: "idle", since: Date.now(), last: Date.now(), agents: new Set(), stoppedAt: 0, ctxPct: null, toolFailedAt: null, limitedUntil: 0 };
    sessions.set(id, s);
  }
  return s;
}

function setMode(s: Session, mode: ClaudeMode, activity?: ClaudeActivity) {
  if (s.mode === mode && s.activity === activity) return;
  s.mode = mode;
  s.activity = activity;
  s.since = Date.now();
  log(`[${s.id.slice(0, 6)}] ${mode}${activity ? ` (${activity})` : ""}`);
}

const NEEDS_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"]);
const NEEDS_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

// Hooks run asynchronously, so a late PreToolUse/PostToolUse can arrive just
// after Stop. Ignore main-agent tool events for a moment after the turn ends.
const recentlyStopped = (s: Session) => s.stoppedAt > 0 && Date.now() - s.stoppedAt < 1500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onHook(ev: any) {
  const s = session(String(ev.session_id ?? "default"));
  s.last = Date.now();
  if (ev.cwd) s.cwd = ev.cwd;
  const fromSubagent = !!ev.agent_id;

  switch (ev.hook_event_name) {
    case "SessionStart":
      setMode(s, ev.source === "compact" ? "thinking" : "hello");
      break;
    case "UserPromptSubmit":
      s.stoppedAt = 0;
      s.limitedUntil = 0;
      setMode(s, "thinking");
      break;
    case "PreToolUse":
      if (recentlyStopped(s) && !fromSubagent) break;
      // while subagents run, keep showing them rather than every tool they call
      if (fromSubagent && s.agents.size) { setMode(s, "working", "agent"); break; }
      if (NEEDS_TOOLS.has(ev.tool_name)) setMode(s, "needs");
      else setMode(s, "working", activityForTool(String(ev.tool_name ?? "")));
      break;
    case "PostToolUse":
      if (recentlyStopped(s) || fromSubagent) break;
      if (s.mode === "working" || s.mode === "needs") setMode(s, s.agents.size ? "working" : "thinking", s.agents.size ? "agent" : undefined);
      break;
    case "PostToolUseFailure":
      s.toolFailedAt = Date.now();
      if (!recentlyStopped(s) && !fromSubagent && s.mode === "working") setMode(s, "thinking");
      break;
    case "PermissionRequest":
      setMode(s, "needs");
      break;
    case "Notification":
      if (NEEDS_NOTIFICATIONS.has(ev.notification_type)) setMode(s, "needs");
      break;
    case "SubagentStart":
      if (ev.agent_id) s.agents.add(String(ev.agent_id));
      setMode(s, "working", "agent");
      break;
    case "SubagentStop":
      if (ev.agent_id) s.agents.delete(String(ev.agent_id));
      if (!s.agents.size && s.activity === "agent" && s.mode === "working") setMode(s, "thinking");
      break;
    case "Stop":
      if (fromSubagent) break;
      s.stoppedAt = Date.now();
      setMode(s, "done");
      break;
    case "StopFailure":
      s.stoppedAt = Date.now();
      if (ev.error === "rate_limit") {
        // until the window resets if we know when, otherwise a while
        const reset = [fiveHour, sevenDay].filter((l): l is Limit => !!l && l.pct >= 90).map((l) => l.resetsAt * 1000);
        s.limitedUntil = reset.length ? Math.max(...reset) : Date.now() + 15 * 60_000;
        setMode(s, "limited");
      } else setMode(s, "error");
      break;
    case "PreCompact":
      s.beforeCompact = s.mode;
      setMode(s, "compacting");
      break;
    case "PostCompact":
      setMode(s, s.beforeCompact === "thinking" || s.beforeCompact === "working" ? "thinking" : "idle");
      break;
    case "SessionEnd":
      setMode(s, "bye");
      break;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onStatus(st: any) {
  if (st.session_id) {
    const s = session(String(st.session_id));
    const pct = st.context_window?.used_percentage;
    if (typeof pct === "number") s.ctxPct = pct;
  }
  const rl = st.rate_limits;
  if (rl?.five_hour) fiveHour = { pct: rl.five_hour.used_percentage, resetsAt: rl.five_hour.resets_at };
  if (rl?.seven_day) sevenDay = { pct: rl.seven_day.used_percentage, resetsAt: rl.seven_day.resets_at };
}

/** Time-based transitions; returns the session to display (or null). */
function tick(): Session | null {
  const now = Date.now();
  for (const s of sessions.values()) {
    const age = now - s.since;
    const quiet = now - s.last;
    if (s.mode === "hello" && age > CLAUDE_TIMING.helloMs) setMode(s, "idle");
    else if (s.mode === "done" && age > CLAUDE_TIMING.doneMs) setMode(s, "idle");
    else if (s.mode === "error" && age > CLAUDE_TIMING.errorMs) setMode(s, "idle");
    else if (s.mode === "bye" && age > CLAUDE_TIMING.byeMs) { sessions.delete(s.id); continue; }
    else if (s.mode === "limited" && now > s.limitedUntil && limitReset()) setMode(s, "idle");
    else if (s.mode === "idle" && quiet > cfg.sleepAfterSec * 1000) setMode(s, "sleep");
    // interrupted turns don't always send Stop — don't spin forever
    else if ((s.mode === "thinking" || s.mode === "needs") && quiet > 5 * 60_000) setMode(s, "idle");
    else if (s.mode === "working" && quiet > 20 * 60_000) setMode(s, "idle");
    else if (s.mode === "compacting" && quiet > 5 * 60_000) setMode(s, "idle");
    // a crashed/closed terminal never sends SessionEnd
    if (quiet > 3 * 3600_000) sessions.delete(s.id);
  }
  // usage limit hit outside of a turn
  const exhausted = (fiveHour && fiveHour.pct >= 100) || (sevenDay && sevenDay.pct >= 100);
  if (exhausted)
    for (const s of sessions.values())
      if (s.mode === "idle" || s.mode === "done") { s.limitedUntil = 0; setMode(s, "limited"); }

  const PRIORITY: Record<ClaudeMode, number> = {
    needs: 10, limited: 9, error: 8, working: 7, compacting: 6, thinking: 5, done: 4, hello: 3, bye: 2.5, idle: 2, sleep: 1,
  };
  let best: Session | null = null;
  for (const s of sessions.values())
    if (!best || PRIORITY[s.mode] > PRIORITY[best.mode] || (PRIORITY[s.mode] === PRIORITY[best.mode] && s.since > best.since)) best = s;
  return best;
}

function limitReset() {
  const now = Date.now() / 1000;
  const lim = [fiveHour, sevenDay].filter((l): l is Limit => !!l && l.pct >= 100);
  return lim.length === 0 || lim.every((l) => l.resetsAt && l.resetsAt < now);
}

function viewFor(s: Session): ClaudeView {
  const exhausted = [fiveHour, sevenDay].filter((l): l is Limit => !!l && l.pct >= 100).sort((a, b) => b.resetsAt - a.resetsAt)[0];
  return {
    mode: s.mode,
    activity: s.activity,
    agents: s.agents.size,
    ctxPct: s.ctxPct,
    fiveHourPct: fiveHour?.pct ?? null,
    resetsAt: exhausted?.resetsAt ?? fiveHour?.resetsAt ?? null,
    toolFailedAt: s.toolFailedAt,
  };
}

/* ------------------------------------------------------------------ */
/* output: take over the panel while active, restore it afterwards     */
/* ------------------------------------------------------------------ */

let transport: Transport | null = null;
let taken = false;
let busy = false;
let lastFrame: Frame | null = null;
let wake = false;
let sleepSince = 0;
let idleSince = Date.now();
let saved: { state: Record<string, unknown> | null; live: string[] | null } | null = null;

/**
 * Current LED colours via WLED's websocket live view ({"lv":true}). Newer WLED
 * builds disable /json/live; the binary frame is "L", version, [w, h,] RGB…
 * and for 2D setups is in matrix (x, y) order — the same order seg.i expects.
 */
function snapshotPixels(): Promise<string[] | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${normalizeHost(cfg.host)}/ws`);
    ws.binaryType = "arraybuffer";
    const done = (v: string[] | null) => { clearTimeout(timer); try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => done(null), 3000);
    ws.onerror = () => done(null);
    ws.onopen = () => ws.send(JSON.stringify({ lv: true }));
    ws.onmessage = (m) => {
      if (typeof m.data === "string") return;
      const b = new Uint8Array(m.data as ArrayBuffer);
      if (b[0] !== 76) return; // 'L'
      const off = b[1] === 2 ? 4 : 2;
      const out: string[] = [];
      for (let i = off; i + 2 < b.length; i += 3)
        out.push(((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]).toString(16).padStart(6, "0").toUpperCase());
      try { ws.send(JSON.stringify({ lv: false })); } catch { /* ignore */ }
      done(out.length ? out : null);
    };
  });
}

async function takeover() {
  const client = new WledClient(cfg.host);
  saved = { state: null, live: null };
  try {
    const state = (await client.state()) as unknown as Record<string, unknown>;
    saved.state = state;
    // frozen segment = custom pixels (e.g. art pushed from the app): snapshot them
    const seg0 = (state.seg as Record<string, unknown>[] | undefined)?.find((s) => s.id === cfg.segId);
    if (seg0?.frz) saved.live = await snapshotPixels();
  } catch (e) {
    log("could not snapshot WLED state:", (e as Error).message);
  }
  transport ??= createTransport(cfg.transport, {
    host: cfg.host, segId: cfg.segId, chunk: 0, bridgeUrl: "", udpPort: 21324, udpTimeout: 2,
  });
  transport.invalidate();
  taken = true;
  wake = true;
  lastFrame = null;
  log("took over the panel");
}

async function release() {
  taken = false;
  lastFrame = null;
  const client = new WledClient(cfg.host);
  const st = saved?.state;
  try {
    if (st && typeof st.ps === "number" && st.ps > 0) {
      await client.setState({ ps: st.ps });
    } else if (st) {
      const segs = (st.seg as Record<string, unknown>[] | undefined) ?? [];
      const body: Record<string, unknown> = {
        on: st.on,
        bri: st.bri,
        tt: 0,
        seg: segs.map((s) =>
          s.id === cfg.segId && saved?.live
            ? { id: s.id, frz: false, i: saved.live }
            : { id: s.id, fx: s.fx, sx: s.sx, ix: s.ix, pal: s.pal, col: s.col, frz: s.frz ?? false }
        ),
      };
      await client.setState(body, 6000);
      // re-freeze after restoring custom pixels so effects don't overwrite them
      if (saved?.live) await client.setState({ seg: { id: cfg.segId, frz: true } });
    }
    log("released the panel");
  } catch (e) {
    log("could not restore WLED state:", (e as Error).message);
  }
  saved = null;
}

async function render() {
  if (busy || !cfg.host) return;
  busy = true;
  try {
    const now = Date.now();
    const s = tick();
    let view: ClaudeView | null = null;
    let since = now;
    if (preview && now < preview.until) { view = preview.view; since = preview.since; }
    else if (s) { preview = null; view = viewFor(s); since = s.since; }

    if (view?.mode === "sleep") sleepSince ||= now;
    else sleepSince = 0;
    const shouldShow = !!view && !(view.mode === "sleep" && now - sleepSince > cfg.releaseAfterSec * 1000);

    if (!shouldShow) {
      if (taken) await release();
      if (!sessions.size && now - idleSince > cfg.exitAfterSec * 1000) { log("nothing to do — exiting"); process.exit(0); }
      return;
    }
    idleSince = now;
    if (!taken) await takeover();

    const frame = renderClaude(view!, (now - since) / 1000, now);
    if (!wake && lastFrame && framesEqual(frame, lastFrame)) return;
    await transport!.send(frame, { wake });
    wake = false;
    lastFrame = frame;
  } catch (e) {
    log("send failed:", (e as Error).message);
    transport?.invalidate();
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP API (127.0.0.1 only)                                           */
/* ------------------------------------------------------------------ */

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url ?? "/", "http://x");

  if (req.method === "POST" && url.pathname === "/hook") { onHook(await readJson(req)); res.statusCode = 204; return res.end(); }
  if (req.method === "POST" && url.pathname === "/status") { onStatus(await readJson(req)); res.statusCode = 204; return res.end(); }
  if (req.method === "POST" && url.pathname === "/preview") {
    const body = (await readJson(req)) as { view?: ClaudeView; seconds?: number };
    if (body.view?.mode) preview = { view: body.view, since: Date.now(), until: Date.now() + Math.min(60, body.seconds ?? 8) * 1000 };
    res.statusCode = 204;
    return res.end();
  }
  if (url.pathname === "/state") {
    const s = tick();
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      host: cfg.host,
      taken,
      view: preview && Date.now() < preview.until ? preview.view : s ? viewFor(s) : null,
      sessions: [...sessions.values()].map((x) => ({ id: x.id, mode: x.mode, activity: x.activity, cwd: x.cwd, ctxPct: x.ctxPct, agents: x.agents.size })),
      fiveHour,
      sevenDay,
    }));
  }
  res.statusCode = 404;
  res.end();
});

async function main() {
  if (!cfg.host) {
    log("no WLED host configured — searching the network…");
    const { devices } = await discover();
    const pick = devices.find((d) => d.matrix?.w === 16 && d.matrix?.h === 16) ?? devices[0];
    if (!pick) { console.error("No WLED device found. Run with --host=<ip>."); process.exit(1); }
    cfg.host = pick.host;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ host: pick.host }, null, 2) + "\n");
    log(`found ${pick.name} at ${pick.host} (saved to claude/config.json)`);
  }
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") { console.error(`Port ${cfg.port} is busy — is the service already running?`); process.exit(0); }
    throw e;
  });
  server.listen(cfg.port, "127.0.0.1", () =>
    log(`Claude → matrix on http://127.0.0.1:${cfg.port} · WLED ${cfg.host} via ${cfg.transport} @ ${cfg.fps} fps`)
  );
  setInterval(() => void render(), 1000 / cfg.fps);

  const shutdown = async () => { if (taken) await release(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
