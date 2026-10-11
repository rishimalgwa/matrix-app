import { Plus, X } from "lucide-react";
import { useState } from "react";
import { fromHex, PALETTES, toCss, toHex } from "@/core/color";
import { cx, Panel } from "@/components/ui";
import { useEditor } from "@/store/editor";

function Swatch({ c, active, onClick, onRemove }: { c: number; active?: boolean; onClick: () => void; onRemove?: () => void }) {
  return (
    <span className="group relative">
      <button
        type="button"
        title={toCss(c)}
        aria-label={`Color ${toCss(c)}`}
        onClick={onClick}
        className={cx(
          "block size-7 rounded-md border transition hover:scale-110",
          active ? "border-white ring-2 ring-accent-2/60" : "border-white/10"
        )}
        style={{ background: toCss(c) }}
      />
      {onRemove && (
        <button
          type="button"
          aria-label="Remove color"
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 hidden size-4 place-items-center rounded-full bg-panel-3 text-muted group-hover:grid hover:text-fg"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function ColorPanel() {
  const { color, recent, custom, paletteName, setColor, set, addCustom, removeCustom } = useEditor();
  const [hex, setHex] = useState<string | null>(null);
  const palette = PALETTES.find((p) => p.name === paletteName);
  const swatches = paletteName === "custom" ? custom : palette?.colors ?? [];

  return (
    <Panel title="Color">
      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label="Pick color"
          className="swatch-input size-14 shrink-0"
          value={toCss(color)}
          onChange={(e) => setColor(fromHex(e.target.value))}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center rounded-[10px] border border-line bg-bg pl-3 focus-within:border-accent-2">
            <span className="font-mono text-sm text-faint">#</span>
            <input
              aria-label="Hex color"
              className="w-full bg-transparent px-1 py-2 font-mono text-sm uppercase outline-none"
              value={hex ?? toHex(color)}
              maxLength={6}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9a-f]/gi, "");
                setHex(v);
                if (v.length === 6) setColor(fromHex(v));
              }}
              onBlur={() => setHex(null)}
            />
          </div>
          <button
            type="button"
            onClick={() => { addCustom(color); set({ paletteName: "custom" }); }}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          >
            <Plus size={12} /> Save to my colors
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-2">Recent</div>
        <div className="flex flex-wrap gap-1.5">
          {recent.map((c) => <Swatch key={c} c={c} active={c === color} onClick={() => setColor(c)} />)}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Palette</span>
          <select
            aria-label="Palette"
            value={paletteName}
            onChange={(e) => set({ paletteName: e.target.value })}
            className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
          >
            {PALETTES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            <option value="custom">My colors</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {swatches.map((c) => (
            <Swatch
              key={c}
              c={c}
              active={c === color}
              onClick={() => setColor(c)}
              onRemove={paletteName === "custom" ? () => removeCustom(c) : undefined}
            />
          ))}
          {paletteName === "custom" && !custom.length && (
            <p className="text-xs text-muted">Pick a color and hit “Save to my colors”.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
