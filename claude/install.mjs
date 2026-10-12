#!/usr/bin/env node
/**
 * Adds (or removes, with --uninstall) the Claude Code hooks and status line
 * that drive the matrix. Edits ~/.claude/settings.json after backing it up.
 *
 *   npm run claude:install
 *   npm run claude:install -- --host=192.168.1.125
 *   npm run claude:uninstall
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const uninstall = process.argv.includes("--uninstall");
const hostArg = process.argv.find((a) => a.startsWith("--host="))?.slice(7);

const HOOK_URL = "http://127.0.0.1:8789/hook";
const forward = `curl -s -m 2 -H 'Content-Type: application/json' --data-binary @- ${HOOK_URL} >/dev/null 2>&1 || true`;
const ensure = `node "${path.join(ROOT, "claude", "ensure.mjs")}"`;
const statusCmd = `node "${path.join(ROOT, "claude", "statusline.mjs")}"`;

const EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "Notification", "SubagentStart", "SubagentStop", "Stop", "StopFailure", "PreCompact", "PostCompact",
];

const isOurs = (x) => JSON.stringify(x).includes(HOOK_URL) || JSON.stringify(x).includes("claude/ensure.mjs");

let settings = {};
if (fs.existsSync(SETTINGS)) {
  settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const backup = `${SETTINGS}.bak-pixel-matrix-${Date.now()}`;
  fs.copyFileSync(SETTINGS, backup);
  console.log(`Backed up settings to ${backup}`);
}

settings.hooks ??= {};
for (const ev of Object.keys(settings.hooks)) {
  settings.hooks[ev] = settings.hooks[ev].filter((group) => !isOurs(group));
  if (!settings.hooks[ev].length) delete settings.hooks[ev];
}

if (!uninstall) {
  for (const ev of EVENTS) {
    settings.hooks[ev] ??= [];
    settings.hooks[ev].push({
      hooks: [{ type: "command", command: ev === "SessionStart" ? ensure : forward, async: true, timeout: 10 }],
    });
  }
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

const ourStatus = settings.statusLine && JSON.stringify(settings.statusLine).includes("claude/statusline.mjs");
if (uninstall) {
  if (ourStatus) delete settings.statusLine;
} else if (!settings.statusLine || ourStatus) {
  settings.statusLine = { type: "command", command: statusCmd };
} else {
  console.warn("You already have a status line, so it was left alone. Context/usage gauges need the status line JSON —");
  console.warn(`add this to your script: pipe its stdin to ${statusCmd} (output can be ignored).`);
}

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");

if (!uninstall && hostArg) {
  fs.writeFileSync(path.join(ROOT, "claude", "config.json"), JSON.stringify({ host: hostArg }, null, 2) + "\n");
}

console.log(uninstall
  ? "Removed the matrix hooks and status line from Claude Code."
  : `Installed: ${EVENTS.length} hooks + status line. New Claude Code sessions will animate the matrix.\n` +
    "The service starts automatically with each session (or run `npm run claude` to watch its log).");
