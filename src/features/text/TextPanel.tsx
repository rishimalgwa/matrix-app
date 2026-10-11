import { ArrowLeft, ArrowRight, Bookmark, X } from "lucide-react";
import { FONTS } from "@/core/font";
import { MAX_TEXT, renderTicker } from "@/core/ticker";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Button, ColorField, Panel, Segmented, Slider, Toggle } from "@/components/ui";
import { useAnimatedFrame } from "@/hooks/useAnimatedFrame";
import { useText } from "@/store/text";

export function TextPanel() {
  const { opts, set, presets, savePreset, removePreset } = useText();
  const frame = useAnimatedFrame((t) => renderTicker(t, useText.getState().opts), 30);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Message">
          <div className="relative">
            <textarea
              className="input min-h-20 resize-y pr-14 font-pixel text-base tracking-wide"
              value={opts.text}
              maxLength={MAX_TEXT}
              placeholder="Type something…"
              onChange={(e) => set({ text: e.target.value })}
            />
            <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[11px] text-faint">
              {opts.text.length}/{MAX_TEXT}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <span key={p} className="group inline-flex items-center rounded-full border border-line bg-bg text-xs">
                <button type="button" className="py-1 pl-2.5 pr-1 text-muted hover:text-fg" onClick={() => set({ text: p })}>
                  {p}
                </button>
                <button type="button" aria-label={`Remove ${p}`} className="pr-1.5 text-faint hover:text-err" onClick={() => removePreset(p)}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <Button size="sm" variant="ghost" icon={<Bookmark size={14} />} onClick={() => opts.text.trim() && savePreset(opts.text.trim())}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel title="Style">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <span className="label mb-1.5 block">Font</span>
              <Segmented value={opts.fontId} onChange={(fontId) => set({ fontId })} options={FONTS.map((f) => ({ value: f.id, label: f.name }))} />
            </div>
            <div>
              <span className="label mb-1.5 block">Color</span>
              <Segmented
                value={opts.colorMode}
                onChange={(colorMode) => set({ colorMode })}
                options={[{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }, { value: "rainbow", label: "Rainbow" }]}
              />
            </div>
            <ColorField label="Text" value={opts.color} onChange={(color) => set({ color })} />
            {opts.colorMode === "gradient" ? (
              <ColorField label="Gradient end" value={opts.color2} onChange={(color2) => set({ color2 })} />
            ) : <span className="hidden sm:block" />}
            <ColorField label="Background" value={opts.background} onChange={(background) => set({ background })} />
          </div>
        </Panel>

        <Panel title="Motion">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <span className="label mb-1.5 block">Direction</span>
              <Segmented
                value={opts.direction}
                onChange={(direction) => set({ direction })}
                options={[
                  { value: "rtl", label: <span className="inline-flex items-center gap-1"><ArrowLeft size={14} /> Right to left</span> },
                  { value: "ltr", label: <span className="inline-flex items-center gap-1">Left to right <ArrowRight size={14} /></span> },
                ]}
              />
            </div>
            <Slider label="Speed" value={opts.speed} min={2} max={40} onChange={(speed) => set({ speed })} format={(v) => `${v} px/s`} />
            <Slider label="Letter spacing" value={opts.spacing} min={0} max={3} onChange={(spacing) => set({ spacing })} format={(v) => `${v}px`} />
            <Slider label="Gap between repeats" value={opts.gap} min={0} max={32} onChange={(gap) => set({ gap })} format={(v) => `${v}px`} />
            <div className="sm:col-span-2">
              <Toggle label="Center vertically" checked={opts.y < 0} onChange={(v) => set({ y: v ? -1 : 0 })} />
              {opts.y >= 0 && <Slider label="Top row" value={opts.y} min={0} max={15} onChange={(y) => set({ y })} />}
            </div>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Preview">
          <div className="rounded-lg bg-black p-2">
            <MatrixCanvas frame={frame} look="led" grid={false} />
          </div>
          <LiveButton source="ticker" label="Scroll on matrix" className="mt-3" />
          <p className="mt-2 text-xs text-muted">Changes apply live while on air.</p>
        </Panel>
      </div>
    </div>
  );
}
