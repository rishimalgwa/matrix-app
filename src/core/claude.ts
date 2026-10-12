/**
 * Claude Code status animations: frame = f(view, time).
 *
 * The bottom half is a pixel Clawd that reacts (blinks, types, waves, jumps,
 * sleeps); the top half shows what Claude is doing (thinking spark, code being
 * typed, terminal, search, web, subagents...). Usage gauges appear on the
 * edges only when a limit is getting close.
 *
 * Pure and DOM-free so it runs both in the browser (previews) and in the
 * Node service (claude/daemon.ts) that drives the panel.
 */
import { hsv, mix, scale } from "./color";
import { FONT_3x5, renderText, stamp } from "./font";
import { blankFrame, fillRect, setPx, W, type Frame } from "./matrix";

export type ClaudeMode =
  | "hello" | "idle" | "thinking" | "working" | "needs" | "done" | "error" | "compacting" | "limited" | "sleep" | "bye";

export type ClaudeActivity = "edit" | "bash" | "read" | "search" | "web" | "agent" | "plan" | "other";

export interface ClaudeView {
  mode: ClaudeMode;
  activity?: ClaudeActivity;
  /** running subagents */
  agents?: number;
  /** context window used, 0..100 */
  ctxPct?: number | null;
  /** 5-hour plan usage, 0..100 */
  fiveHourPct?: number | null;
  /** epoch seconds when the limit resets */
  resetsAt?: number | null;
  /** epoch ms of the last failed tool call (brief red flash) */
  toolFailedAt?: number | null;
}

export const CLAUDE_ORANGE = 0xd97757;
const CREAM = 0xf3e3cf;
const GREEN = 0x22c55e;
const AMBER = 0xf59e0b;
const RED = 0xef4444;
const SKY = 0x7dd3fc;

/* ------------------------------------------------------------------ */
/* Clawd                                                               */
/* ------------------------------------------------------------------ */

type Eyes = "open" | "blink" | "closed" | "up" | "down" | "happy" | "sad";
type Arms = "out" | "down" | "up" | "wave" | "type" | "none";

interface ClawdPose {
  eyes: Eyes;
  arms: Arms;
  /** vertical offset (negative = up) */
  dy?: number;
  /** 0/1 alternates leg positions */
  step?: number;
  /** animation phase for wave/type */
  phase?: number;
  squash?: boolean;
  dim?: number;
}

const BODY_X = 3; // body spans x 3..12
const BASE_Y = 8; // body top row

function drawClawd(f: Frame, p: ClawdPose) {
  const y0 = BASE_Y + (p.dy ?? 0);
  const body = p.dim ? scale(CLAUDE_ORANGE, p.dim) : CLAUDE_ORANGE;
  const rows = p.squash ? 4 : 5;
  const top = y0 + (p.squash ? 1 : 0);
  fillRect(f, BODY_X, top, 10, rows, body);

  // eyes are "holes" in the body (LEDs off)
  const eye = (x: number, y: number) => setPx(f, x, top + y, 0);
  for (const ex of [5, 10]) {
    switch (p.eyes) {
      case "open": eye(ex, 1); eye(ex, 2); break;
      case "up": eye(ex, 0); eye(ex, 1); break;
      case "down": eye(ex, 2); eye(ex, 3); break;
      case "blink":
      case "closed": eye(ex, 2); eye(ex - 1, 2); break;
      case "sad": eye(ex, 2); eye(ex, 3); break;
      case "happy": eye(ex - 1, 2); eye(ex, 1); eye(ex + 1, 2); break;
    }
  }

  const ph = p.phase ?? 0;
  const arm = (x: number, y: number) => setPx(f, x, top + y, body);
  switch (p.arms) {
    case "out": arm(1, 3); arm(2, 3); arm(13, 3); arm(14, 3); break;
    case "down": arm(2, 3); arm(2, 4); arm(13, 3); arm(13, 4); break;
    case "up": arm(2, 1); arm(1, 0); arm(13, 1); arm(14, 0); break;
    case "wave":
      arm(1, 3); arm(2, 3);
      if (ph % 2 === 0) { arm(13, 1); arm(14, 0); } else { arm(13, 2); arm(14, 2); }
      break;
    case "type": {
      // alternating paws tapping a keyboard
      const l = ph % 2 === 0 ? 4 : 3;
      const r = ph % 2 === 0 ? 3 : 4;
      arm(2, l); arm(1, l); arm(13, r); arm(14, r);
      break;
    }
  }

  // legs
  const legY = top + rows;
  const legs = p.step ? [3, 6, 9, 12] : [4, 6, 9, 11];
  const legRows = p.squash ? 1 : 2;
  for (const lx of legs) for (let r = 0; r < legRows; r++) setPx(f, lx, legY + r, body);
}

function blinkEyes(t: number, base: Eyes = "open"): Eyes {
  return t % 3.7 < 0.15 ? "blink" : base;
}

/* ------------------------------------------------------------------ */
/* top-zone scenes (rows 0..6)                                         */
/* ------------------------------------------------------------------ */

/** Claude's spark: 8 rays with a highlight sweeping round. */
function drawSpark(f: Frame, cx: number, cy: number, t: number, r = 3, color = 0xff8a5c) {
  setPx(f, cx, cy, mix(color, 0xffffff, 0.6));
  const pulse = 0.9 + 0.1 * Math.sin(t * 5);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const dx = Math.round(Math.cos(a) * 10) / 10;
    const dy = Math.round(Math.sin(a) * 10) / 10;
    const lit = 0.5 + 0.5 * Math.max(0, Math.cos(a - t * 4)) ** 2;
    const len = k % 2 === 0 ? r : r - 1;
    for (let i = 1; i <= len; i++)
      setPx(f, cx + Math.round(dx * i), cy + Math.round(dy * i), scale(color, lit * pulse * (1 - (i - 1) * 0.1)));
  }
}

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const SYNTAX = [0x569cd6, 0xce9178, 0x4ec9b0, 0xdcdcaa, 0xc586c0, 0x9cdcfe];

/** Code being typed into an editor, scrolling up. */
function sceneEdit(f: Frame, t: number) {
  const cps = 9;
  const lineLen = (k: number) => 4 + Math.floor(hash(k) * 9);
  const indent = (k: number) => (hash(k + 99) < 0.4 ? 2 : 0);
  let chars = Math.floor(t * cps);
  let line = 0;
  while (chars >= lineLen(line) + 3) { chars -= lineLen(line) + 3; line++; }
  const typed = Math.min(chars, lineLen(line));
  // show the current line at row 5, previous ones above (rows 1, 3)
  for (let back = 0; back < 3; back++) {
    const k = line - back;
    if (k < 0) continue;
    const y = 5 - back * 2;
    const len = back === 0 ? typed : lineLen(k);
    let x = 1 + indent(k);
    let word = 0;
    for (let i = 0; i < len && x < 15; i++) {
      if (i > 0 && hash(k * 31 + i) < 0.22) { x++; word++; continue; }
      setPx(f, x++, y, scale(SYNTAX[Math.floor(hash(k * 7 + word) * SYNTAX.length)], back === 0 ? 1 : 0.55));
    }
    if (back === 0 && t % 0.6 < 0.3) setPx(f, Math.min(14, x), y, 0xffffff);
  }
}

/** Terminal: prompt, command typing, output scrolling. */
function sceneBash(f: Frame, t: number) {
  const cycle = 2.4;
  const k = Math.floor(t / cycle);
  const ph = (t % cycle) / cycle;
  // output of the command appears once it has been "typed"
  const shown = ph > 0.5 ? Math.min(2, Math.floor((ph - 0.5) * 8) + 1) : 0;
  for (let i = 0; i < shown; i++) {
    const len = 3 + Math.floor(hash(k * 13 + i) * 10);
    for (let x = 1; x < 1 + len && x < 15; x++) setPx(f, x, i * 2, scale(0xcbd5e1, 0.45));
  }
  // prompt: green ">" chevron + command being typed
  setPx(f, 1, 4, GREEN); setPx(f, 2, 5, GREEN); setPx(f, 1, 6, GREEN);
  const cmdLen = 3 + Math.floor(hash(k) * 8);
  const typed = Math.min(cmdLen, Math.floor(ph * 2 * cmdLen));
  for (let i = 0; i < typed; i++) setPx(f, 4 + i, 5, 0xffffff);
  if (t % 0.5 < 0.25) setPx(f, Math.min(14, 4 + typed), 5, scale(0xffffff, 0.8));
}

/** Reading a page: lines light up as a scan bar passes. */
function sceneRead(f: Frame, t: number) {
  fillRect(f, 3, 0, 10, 7, 0x1e1a14);
  const scan = (t * 4) % 9 - 1;
  for (let y = 1; y < 7; y += 2) {
    const len = 5 + Math.floor(hash(y + Math.floor(t / 2.25) * 5) * 4);
    const near = Math.abs(y - scan) < 1.2;
    for (let x = 4; x < 4 + len && x < 12; x++) setPx(f, x, y, near ? CREAM : scale(CREAM, 0.3));
  }
}

/** Magnifying glass sweeping across text. */
function sceneSearch(f: Frame, t: number) {
  for (let y = 1; y < 7; y += 2)
    for (let x = 1; x < 15; x++) if (hash(x * 3 + y) > 0.25) setPx(f, x, y, scale(0x94a3b8, 0.3));
  const cx = 3 + Math.round((Math.sin(t * 1.6) * 0.5 + 0.5) * 8);
  const cy = 2;
  const ring = [[-1, -2], [0, -2], [1, -2], [-2, -1], [2, -1], [-2, 0], [2, 0], [-2, 1], [2, 1], [-1, 2], [0, 2], [1, 2]];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setPx(f, cx + dx, cy + dy, 0x0b1a2a);
  for (const [dx, dy] of ring) setPx(f, cx + dx, cy + dy, SKY);
  setPx(f, cx + 2, cy + 3, CREAM); setPx(f, cx + 3, cy + 4, CREAM);
}

/** Spinning globe. */
function sceneWeb(f: Frame, t: number) {
  const cx = 7.5, cy = 3, r = 3.4;
  for (let y = 0; y < 7; y++)
    for (let x = 4; x < 12; x++) {
      const dx = (x - cx) / r, dy = (y - cy) / r;
      if (dx * dx + dy * dy > 1) continue;
      // longitude of this pixel on a rotating sphere
      const lon = Math.asin(Math.max(-1, Math.min(1, dx / Math.sqrt(Math.max(0.01, 1 - dy * dy))))) + t * 1.5;
      const land = Math.sin(lon * 2) + Math.sin(lon * 3 + dy * 3) * 0.6 > 0.4;
      setPx(f, x, y, land ? 0x22a35a : 0x1d4ed8);
    }
}

/** Mini Clawds marching — one per running subagent. */
function sceneAgents(f: Frame, t: number, n: number) {
  const count = Math.max(1, Math.min(3, n));
  for (let i = 0; i < count; i++) {
    const x = Math.round(((t * 5 + i * 6) % 20) - 4);
    const bob = Math.floor(t * 6 + i) % 2;
    const y = 2 + bob;
    fillRect(f, x, y, 4, 2, CLAUDE_ORANGE);
    setPx(f, x + 1, y, 0); setPx(f, x + 3, y, 0);
    setPx(f, x, y + 2, CLAUDE_ORANGE); setPx(f, x + 3, y + 2, CLAUDE_ORANGE);
  }
  if (n > 3) stamp(f, renderText(String(n), FONT_3x5), 12, 0, CREAM);
}

/** Checklist being ticked off. */
function scenePlan(f: Frame, t: number) {
  const done = Math.floor(t * 1.2) % 4;
  for (let i = 0; i < 3; i++) {
    const y = i * 2 + 1;
    const checked = i < done;
    setPx(f, 2, y, checked ? GREEN : scale(CREAM, 0.6));
    for (let x = 4; x < 4 + 5 + Math.floor(hash(i) * 5); x++) setPx(f, x, y, scale(CREAM, checked ? 0.25 : 0.6));
  }
}

/** Generic busy indicator: orbiting dots. */
function sceneOther(f: Frame, t: number) {
  for (let i = 0; i < 6; i++) {
    const a = t * 3 + (i / 6) * Math.PI * 2;
    setPx(f, Math.round(7.5 + Math.cos(a) * 3), Math.round(3 + Math.sin(a) * 2.6), scale(CREAM, 0.25 + (i / 6) * 0.75));
  }
}

function drawGauge(f: Frame, x: number, pct: number, t: number) {
  const h = Math.round((Math.min(100, pct) / 100) * 16);
  const c = pct < 75 ? GREEN : pct < 90 ? AMBER : RED;
  const blink = pct >= 95 && t % 0.8 < 0.4;
  for (let i = 0; i < 16; i++) setPx(f, x, 15 - i, i < h ? (blink ? scale(c, 0.3) : c) : 0x0d0d0d);
}

function formatCountdown(resetsAt: number, now: number) {
  const s = Math.max(0, resetsAt - now / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}H${String(m).padStart(2, "0")}` : `${Math.max(1, m)}M`;
}

/* ------------------------------------------------------------------ */
/* main renderer                                                       */
/* ------------------------------------------------------------------ */

export const CLAUDE_TIMING = {
  /** how long the "done" celebration plays */
  doneMs: 6000,
  helloMs: 2500,
  byeMs: 2200,
  errorMs: 6000,
};

/**
 * @param v what Claude is doing
 * @param t seconds since this mode started
 * @param now wall-clock ms (for countdowns / flashes)
 */
export function renderClaude(v: ClaudeView, t: number, now = Date.now()): Frame {
  const f = blankFrame();
  const beat = Math.floor(t * 4);

  switch (v.mode) {
    case "hello": {
      stamp(f, renderText("HI", FONT_3x5), 5, 1, CREAM);
      drawClawd(f, { eyes: blinkEyes(t, "happy"), arms: "wave", phase: Math.floor(t * 5) });
      break;
    }
    case "idle": {
      if (t % 1.2 < 0.7) { setPx(f, 7, 5, scale(CREAM, 0.6)); setPx(f, 8, 5, scale(CREAM, 0.6)); }
      drawClawd(f, { eyes: blinkEyes(t), arms: "down" });
      break;
    }
    case "thinking": {
      drawSpark(f, 7, 3, t);
      // thought bubbles rising from the head
      const b = Math.floor(t * 2.5) % 4;
      if (b >= 1) setPx(f, 12, 6, scale(CREAM, 0.7));
      if (b >= 2) setPx(f, 13, 4, scale(CREAM, 0.7));
      drawClawd(f, { eyes: blinkEyes(t, "up"), arms: "down", dy: Math.sin(t * 3) > 0.6 ? -1 : 0 });
      break;
    }
    case "working": {
      const a = v.activity ?? "other";
      const scenes: Record<ClaudeActivity, () => void> = {
        edit: () => sceneEdit(f, t),
        bash: () => sceneBash(f, t),
        read: () => sceneRead(f, t),
        search: () => sceneSearch(f, t),
        web: () => sceneWeb(f, t),
        agent: () => sceneAgents(f, t, v.agents ?? 1),
        plan: () => scenePlan(f, t),
        other: () => sceneOther(f, t),
      };
      scenes[a]();
      const typing = a === "edit" || a === "bash";
      drawClawd(f, {
        eyes: blinkEyes(t, typing ? "down" : a === "read" || a === "search" ? "up" : "open"),
        arms: typing ? "type" : "out",
        phase: Math.floor(t * 8),
        step: a === "agent" ? beat % 2 : 0,
        dy: typing ? 0 : beat % 4 === 0 ? -1 : 0,
      });
      break;
    }
    case "needs": {
      const on = t % 0.7 < 0.45;
      if (on) { fillRect(f, 7, 0, 2, 4, AMBER); fillRect(f, 7, 5, 2, 2, AMBER); }
      drawClawd(f, { eyes: "open", arms: "wave", phase: Math.floor(t * 4), dy: on ? -1 : 0 });
      // pulsing frame
      const edge = scale(AMBER, 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6)));
      for (let i = 0; i < W; i++) { setPx(f, i, 0, f[i] || edge); setPx(f, i, 15, edge); setPx(f, 0, i, edge); setPx(f, 15, i, edge); }
      break;
    }
    case "done": {
      // check mark draws in, confetti falls, Clawd jumps
      const check: [number, number][] = [[4, 3], [5, 4], [6, 5], [7, 4], [8, 3], [9, 2], [10, 1], [11, 0]];
      const n = Math.min(check.length, Math.floor(t * 14));
      for (let i = 0; i < n; i++) setPx(f, check[i][0], check[i][1], GREEN);
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(hash(i) * 16);
        const speed = 5 + hash(i + 50) * 6;
        const y = Math.floor((t * speed + hash(i + 7) * 16) % 18) - 2;
        if (y >= 0 && y < 16) setPx(f, x, y, hsv(hash(i + 3) * 360, 0.8, 1));
      }
      const jump = Math.abs(Math.sin(t * Math.PI * 1.6));
      drawClawd(f, { eyes: "happy", arms: "up", dy: -Math.round(jump * 2) });
      break;
    }
    case "error": {
      if (t % 1 < 0.6) for (let i = 0; i < 5; i++) { setPx(f, 5 + i, 1 + i, RED); setPx(f, 9 - i, 1 + i, RED); }
      drawClawd(f, { eyes: "sad", arms: "down", dim: 0.75 });
      break;
    }
    case "compacting": {
      const squeeze = Math.round((0.5 - 0.5 * Math.cos(t * 4)) * 4);
      for (let y = 0; y < 7; y++) { setPx(f, 1 + squeeze, y, SKY); setPx(f, 14 - squeeze, y, SKY); }
      for (let y = 1; y < 7; y += 2) for (let x = 3 + squeeze; x < 13 - squeeze; x++) setPx(f, x, y, scale(CREAM, 0.4));
      drawClawd(f, { eyes: "closed", arms: "out", squash: squeeze >= 2 });
      break;
    }
    case "limited": {
      const text = v.resetsAt ? formatCountdown(v.resetsAt, now) : "WAIT";
      const cols = renderText(text, FONT_3x5);
      stamp(f, cols, Math.max(0, Math.floor((W - cols.length) / 2)), 0, t % 2 < 1.6 ? RED : scale(RED, 0.4));
      const zy = 6 - Math.floor((t * 2) % 3);
      setPx(f, 13, zy, scale(CREAM, 0.6)); setPx(f, 14, zy, scale(CREAM, 0.6));
      drawClawd(f, { eyes: "closed", arms: "down", dim: 0.5 });
      break;
    }
    case "sleep": {
      // z's drifting up from the head
      for (let i = 0; i < 2; i++) {
        const p = (t * 0.6 + i * 0.5) % 1;
        const x = 11 + Math.round(p * 3);
        const y = 6 - Math.round(p * 6);
        const c = scale(CREAM, 0.5 * (1 - p) + 0.1);
        setPx(f, x, y, c); setPx(f, x + 1, y, c); setPx(f, x, y + 1, c); setPx(f, x + 1, y + 1, 0);
      }
      drawClawd(f, { eyes: "closed", arms: "down", dim: 0.45, dy: t % 3 < 1.5 ? 0 : 1 });
      break;
    }
    case "bye": {
      stamp(f, renderText("BYE", FONT_3x5), 2, 1, CREAM);
      drawClawd(f, { eyes: "happy", arms: "wave", phase: Math.floor(t * 5) });
      const fade = Math.max(0, 1 - Math.max(0, t - 1.2) / 1);
      for (let i = 0; i < f.length; i++) f[i] = scale(f[i], fade);
      break;
    }
  }

  // limit warnings: right edge = context window, left edge = 5-hour plan usage
  if (v.mode !== "limited" && v.mode !== "bye") {
    if (v.ctxPct != null && v.ctxPct >= 60) drawGauge(f, 15, v.ctxPct, t);
    if (v.fiveHourPct != null && v.fiveHourPct >= 70) drawGauge(f, 0, v.fiveHourPct, t);
    // a sweat drop when either is nearly full
    if (Math.max(v.ctxPct ?? 0, v.fiveHourPct ?? 0) >= 85 && t % 1.4 < 1) setPx(f, 13, BASE_Y - 1, SKY);
  }

  // brief red flash on a failed tool call
  if (v.toolFailedAt && now - v.toolFailedAt < 900 && (now - v.toolFailedAt) % 300 < 150)
    for (let i = 0; i < W; i++) { setPx(f, i, 0, RED); setPx(f, i, 15, RED); }

  return f;
}

/** Tool name → what to animate. */
export function activityForTool(tool: string): ClaudeActivity {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return "edit";
  if (/^(Bash|BashOutput|KillShell|KillBash|Monitor|PowerShell)$/.test(tool)) return "bash";
  if (/^(Read|NotebookRead)$/.test(tool)) return "read";
  if (/^(Grep|Glob|LS|LSP|ToolSearch)$/.test(tool)) return "search";
  if (/^(WebFetch|WebSearch)$/.test(tool) || /browser|chrome/i.test(tool)) return "web";
  if (/^(Task|Agent)$/.test(tool)) return "agent";
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|EnterPlanMode|ExitPlanMode)$/.test(tool)) return "plan";
  return "other";
}

/** Example views for previews / the gallery in the app. */
export const CLAUDE_DEMOS: { label: string; view: ClaudeView }[] = [
  { label: "Thinking", view: { mode: "thinking" } },
  { label: "Editing code", view: { mode: "working", activity: "edit" } },
  { label: "Running commands", view: { mode: "working", activity: "bash" } },
  { label: "Reading", view: { mode: "working", activity: "read" } },
  { label: "Searching", view: { mode: "working", activity: "search" } },
  { label: "On the web", view: { mode: "working", activity: "web" } },
  { label: "Subagents", view: { mode: "working", activity: "agent", agents: 2 } },
  { label: "Planning", view: { mode: "working", activity: "plan" } },
  { label: "Needs you", view: { mode: "needs" } },
  { label: "Done", view: { mode: "done" } },
  { label: "Error", view: { mode: "error" } },
  { label: "Compacting", view: { mode: "compacting" } },
  { label: "Context 88%", view: { mode: "thinking", ctxPct: 88, fiveHourPct: 76 } },
  { label: "Limit reached", view: { mode: "limited", resetsAt: Math.floor(Date.now() / 1000) + 4320 } },
  { label: "Idle", view: { mode: "idle" } },
  { label: "Sleeping", view: { mode: "sleep" } },
];
