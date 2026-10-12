import { Copy, Radio, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { CLAUDE_DEMOS, renderClaude, type ClaudeView } from "@/core/claude";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Badge, Button, cx } from "@/components/ui";
import { registerSource, stopLive, goLive, useIsLive } from "@/engine/sources";
import { useAnimatedFrame } from "@/hooks/useAnimatedFrame";

const SERVICE = "http://127.0.0.1:8789";

interface ServiceState {
  host: string;
  taken: boolean;
  view: ClaudeView | null;
  sessions: { id: string; mode: string; cwd?: string }[];
  fiveHour: { pct: number; resetsAt: number } | null;
}

// lets the app itself play a demo when the background service isn't running
let demo: ClaudeView = CLAUDE_DEMOS[0].view;
registerSource({
  id: "claude-demo",
  label: "Claude animation",
  start(emit) {
    const t0 = performance.now();
    const h = setInterval(() => emit(renderClaude(demo, (performance.now() - t0) / 1000)), 1000 / 12);
    return () => clearInterval(h);
  },
});

function useService() {
  const [state, setState] = useState<ServiceState | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${SERVICE}/state`, { signal: AbortSignal.timeout(800) });
        if (alive) setState(await r.json());
      } catch {
        if (alive) setState(null);
      }
    };
    void poll();
    const h = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(h); };
  }, []);
  return state;
}

function DemoTile({ label, view, active, onClick }: { label: string; view: ClaudeView; active: boolean; onClick: () => void }) {
  const frame = useAnimatedFrame((t) => renderClaude(view, t), 8);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx("rounded-lg border-2 bg-bg p-1 text-left text-[11px] transition", active ? "border-accent-2 text-fg" : "border-line text-muted hover:border-line-strong")}
    >
      <MatrixCanvas frame={frame} grid={false} />
      <span className="mt-1 block truncate px-0.5">{label}</span>
    </button>
  );
}

export function ClaudePanel() {
  const service = useService();
  const [pick, setPick] = useState(0);
  const demoLive = useIsLive("claude-demo");
  const view = CLAUDE_DEMOS[pick].view;
  const big = useAnimatedFrame((t) => renderClaude(view, t), 12);
  const install = "npm run claude:install";

  const showOnPanel = async () => {
    if (service) {
      await fetch(`${SERVICE}/preview`, { method: "POST", body: JSON.stringify({ view, seconds: 10 }) }).catch(() => {});
    } else {
      demo = view;
      await goLive("claude-demo");
    }
  };

  const live = service?.view;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {service ? (
            <>
              <Badge tone="ok">Service running</Badge>
              <span className="text-muted">
                WLED {service.host} · {service.sessions.length} session{service.sessions.length === 1 ? "" : "s"}
                {live && <> · showing <span className="text-fg">{live.mode}{live.activity ? ` (${live.activity})` : ""}</span></>}
                {!service.taken && " · panel released"}
              </span>
            </>
          ) : (
            <>
              <Badge>Not running</Badge>
              <span className="text-muted">It starts automatically when a Claude Code session begins.</span>
            </>
          )}
        </div>

        <div className="rounded-lg border border-line bg-bg p-3 text-sm">
          <p className="text-muted">One-time setup (adds hooks + a status line to Claude Code, with a backup):</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 select-all rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs">{install}</code>
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => void navigator.clipboard?.writeText(install)}>Copy</Button>
          </div>
          <p className="mt-2 text-xs text-faint">
            Undo anytime with <code className="font-mono">npm run claude:uninstall</code>. Gauges: <span className="text-fg">right edge</span> = context window (from 60%),
            <span className="text-fg"> left edge</span> = 5-hour usage limit (from 70%); they turn amber, then red, and blink near 100%.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {CLAUDE_DEMOS.map((d, i) => <DemoTile key={d.label} label={d.label} view={d.view} active={i === pick} onClick={() => setPick(i)} />)}
        </div>
      </div>

      <div>
        <div className="rounded-lg bg-black p-2">
          <MatrixCanvas frame={big} look="led" grid={false} />
        </div>
        <p className="mt-2 text-center text-sm">{CLAUDE_DEMOS[pick].label}</p>
        {demoLive ? (
          <Button variant="live" className="mt-2 w-full" icon={<Square size={14} fill="currentColor" />} onClick={stopLive}>On air — stop</Button>
        ) : (
          <Button variant="primary" className="mt-2 w-full" icon={<Radio size={16} />} onClick={() => void showOnPanel()}>
            {service ? "Preview on panel (10s)" : "Show on matrix"}
          </Button>
        )}
      </div>
    </div>
  );
}
