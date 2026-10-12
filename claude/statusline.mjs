#!/usr/bin/env node
/**
 * Claude Code status line: forwards context / usage-limit data to the matrix
 * service and prints a compact status line.
 */
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  let d = {};
  try { d = JSON.parse(input); } catch { /* ignore */ }

  // fire-and-forget; never slow the status line down
  await fetch("http://127.0.0.1:8789/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: input || "{}",
    signal: AbortSignal.timeout(250),
  }).catch(() => {});

  const parts = [];
  if (d.model?.display_name) parts.push(d.model.display_name);
  const ctx = d.context_window?.used_percentage;
  if (typeof ctx === "number") parts.push(`ctx ${Math.round(ctx)}%`);
  const five = d.rate_limits?.five_hour;
  if (five && typeof five.used_percentage === "number") {
    let s = `5h ${Math.round(five.used_percentage)}%`;
    if (five.used_percentage >= 70 && five.resets_at) {
      const mins = Math.max(0, Math.round((five.resets_at * 1000 - Date.now()) / 60000));
      s += ` (resets in ${mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : `${mins}m`})`;
    }
    parts.push(s);
  }
  const week = d.rate_limits?.seven_day;
  if (week && week.used_percentage >= 70) parts.push(`week ${Math.round(week.used_percentage)}%`);
  process.stdout.write(parts.join(" · "));
});
