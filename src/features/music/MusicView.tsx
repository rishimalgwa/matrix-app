import { Mic, MicOff, MonitorSpeaker } from "lucide-react";
import { useEffect, useState } from "react";
import { blankFrame } from "@/core/matrix";
import { renderVisualizer, type VisualizerPalette, type VisualizerStyle } from "@/core/visualizer";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Button, ColorField, cx, Panel, Segmented, Slider } from "@/components/ui";
import { isLive, stopLive } from "@/engine/sources";
import { audio, useAudioStatus } from "@/services/audio";
import { useMusic } from "@/store/music";

const STYLES: { value: VisualizerStyle; label: string }[] = [
  { value: "peaks", label: "Peak VU" },
  { value: "bars", label: "Equalizer" },
  { value: "center", label: "Center split" },
  { value: "dots", label: "Dots" },
  { value: "radial", label: "Radial" },
];

const PALETTES: { value: VisualizerPalette; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "neon", label: "Neon" },
  { value: "fire", label: "Fire" },
  { value: "ice", label: "Ice" },
  { value: "rainbow", label: "Rainbow" },
  { value: "mono", label: "Mono" },
];

export function MusicView() {
  const { opts, set, input, setInput } = useMusic();
  const status = useAudioStatus();
  const [frame, setFrame] = useState(blankFrame);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    return audio.subscribe((levels, peaks) =>
      setFrame(renderVisualizer(levels, peaks, useMusic.getState().opts, (performance.now() - t0) / 1000))
    );
  }, []);

  const start = async () => {
    setErr(null);
    try { await audio.start(input); } catch (e) { setErr((e as Error).message); }
  };
  const stop = () => {
    if (isLive("music")) stopLive();
    audio.stop();
    setFrame(blankFrame());
  };

  const tabSupported = typeof navigator.mediaDevices?.getDisplayMedia === "function";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Audio input">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { id: "mic" as const, icon: <Mic size={18} />, title: "Microphone", text: "Listens to the room — works on phones too." },
              { id: "tab" as const, icon: <MonitorSpeaker size={18} />, title: "Tab / system audio", text: "Share a browser tab (e.g. Spotify Web Player) for a clean signal. Desktop Chrome/Edge." },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={o.id === "tab" && !tabSupported}
                onClick={() => setInput(o.id)}
                aria-pressed={input === o.id}
                className={cx(
                  "rounded-xl border-2 p-3 text-left transition disabled:opacity-40",
                  input === o.id ? "border-accent-2 bg-accent-2/5" : "border-line hover:border-line-strong"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">{o.icon}{o.title}</span>
                <span className="mt-1 block text-xs text-muted">{o.text}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {status.running ? (
              <Button variant="danger" icon={<MicOff size={16} />} onClick={stop}>Stop listening</Button>
            ) : (
              <Button icon={<Mic size={16} />} onClick={start}>Start listening</Button>
            )}
            <div className="flex h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-panel-3" aria-label="Input level">
              <div className="bg-gradient-to-r from-ok via-warn to-err transition-[width] duration-75" style={{ width: `${Math.min(100, status.level * 160)}%` }} />
            </div>
            {status.running && <span className="text-xs text-muted">{status.input === "tab" ? "Tab audio" : "Microphone"}</span>}
          </div>
          {(err || status.error) && <p className="mt-2 text-xs text-err">{err ?? status.error}</p>}
        </Panel>

        <Panel title="Visualizer">
          <span className="label mb-1.5 block">Style</span>
          <Segmented value={opts.style} onChange={(style) => set({ style })} options={STYLES} />
          <span className="label mb-1.5 mt-4 block">Colors</span>
          <Segmented value={opts.palette} onChange={(palette) => set({ palette })} options={PALETTES} />
          {opts.palette === "mono" && <div className="mt-3"><ColorField label="Base color" value={opts.color} onChange={(color) => set({ color })} /></div>}
          <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Slider label="Sensitivity" value={opts.gain} min={0.3} max={4} step={0.1} onChange={(gain) => set({ gain })} format={(v) => `${v.toFixed(1)}×`} />
            <Slider label="Smoothing" value={opts.smoothing} min={0} max={0.95} step={0.05} onChange={(smoothing) => set({ smoothing })} format={(v) => v.toFixed(2)} />
            <Slider label="Peak fall speed" value={opts.peakFall} min={2} max={40} onChange={(peakFall) => set({ peakFall })} format={(v) => `${v} rows/s`} />
            <Slider label="Lowest frequency" value={opts.minHz} min={20} max={200} step={5} onChange={(minHz) => set({ minHz })} format={(v) => `${v} Hz`} />
            <Slider label="Highest frequency" value={opts.maxHz} min={4000} max={20000} step={500} onChange={(maxHz) => set({ maxHz })} format={(v) => `${(v / 1000).toFixed(1)} kHz`} />
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Preview">
          <div className="rounded-lg bg-black p-2">
            <MatrixCanvas frame={frame} look="led" grid={false} />
          </div>
          <LiveButton source="music" label="Stream to matrix" className="mt-3" />
          <p className="mt-2 text-xs text-muted">
            16 log-spaced frequency bands → 16 columns. For smooth streaming pick the WebSocket or UDP Bridge transport in Device settings.
          </p>
        </Panel>
      </div>
    </div>
  );
}
