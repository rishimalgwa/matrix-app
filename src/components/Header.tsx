import { Power, Settings2, Square, Sun } from "lucide-react";
import { MatrixCanvas } from "./MatrixCanvas";
import { cx, IconButton } from "./ui";
import { useOutputStats } from "@/engine/output";
import { stopLive, useLive } from "@/engine/sources";
import { useDevice } from "@/store/device";

function OnAir() {
  const onAir = useLive((s) => s.onAir);
  const frame = useOutputStats((s) => s.frame);
  const sending = useDevice((s) => s.outputEnabled && !!s.host);
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-panel py-1 pl-1 pr-1.5">
      <div className="w-8 shrink-0 overflow-hidden rounded-md bg-black p-0.5">
        <MatrixCanvas frame={frame} grid={false} label="What's on the matrix" />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
          {onAir ? (
            <>
              <span className={cx("size-1.5 rounded-full", sending ? "bg-err pulse-dot" : "bg-muted")} />
              <span className={sending ? "text-err" : "text-muted"}>{sending ? "On air" : "Preview"}</span>
            </>
          ) : (
            <span className="text-faint">Idle</span>
          )}
        </div>
        <div className="max-w-36 truncate text-xs text-fg">{onAir?.label ?? "Nothing showing"}</div>
      </div>
      {onAir?.kind === "source" && (
        <IconButton label="Stop" className="size-7" onClick={stopLive}><Square size={12} fill="currentColor" /></IconButton>
      )}
    </div>
  );
}

export function Header({ onDevice }: { onDevice: () => void }) {
  const { status, info, host, on, bri, setPower, setBrightness } = useDevice();
  const dot = status === "online" ? "bg-ok" : status === "offline" ? "bg-err" : status === "checking" ? "bg-warn pulse-dot" : "bg-faint";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-8" />
          <div className="hidden leading-none sm:block">
            <div className="font-pixel text-[15px] tracking-wide">PIXEL MATRIX</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-faint">16×16 · WLED</div>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <OnAir />
          <div className="hidden items-center gap-2 rounded-xl border border-line bg-panel px-2.5 py-1.5 md:flex">
            <Sun size={14} className="text-muted" />
            <input
              type="range"
              aria-label="Brightness"
              className="range w-24"
              min={1}
              max={255}
              value={bri}
              style={{ ["--p" as string]: `${(bri / 255) * 100}%` }}
              onChange={(e) => void setBrightness(Number(e.target.value))}
            />
          </div>
          <IconButton label={on ? "Turn off" : "Turn on"} active={on && status === "online"} onClick={() => void setPower(!on)} disabled={!host}>
            <Power size={18} />
          </IconButton>
          <button
            type="button"
            onClick={onDevice}
            className="flex items-center gap-2 rounded-xl border border-line bg-panel px-2.5 py-1.5 text-sm hover:border-line-strong"
          >
            <span className={cx("size-2 rounded-full", dot)} />
            <span className="hidden max-w-32 truncate sm:inline">{host ? info?.name ?? host : "Connect device"}</span>
            <Settings2 size={16} className="text-muted" />
          </button>
        </div>
      </div>
    </header>
  );
}
