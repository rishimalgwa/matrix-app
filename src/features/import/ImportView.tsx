import { Clapperboard, ImagePlus, PenLine, Plus, RotateCcw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NO_ADJUST } from "@/core/color";
import { decodeGif, gifToFrames, type DecodedGif } from "@/core/gif";
import { DEFAULT_RASTER, FULL_CROP, loadImage, rasterize, type RasterOptions } from "@/core/image";
import type { Frame } from "@/core/matrix";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Button, ColorField, Panel, Segmented, Slider, cx } from "@/components/ui";
import { registerSource, showStatic, stopLive, useIsLive } from "@/engine/sources";
import { useEditor } from "@/store/editor";
import { CropBox } from "./CropBox";

interface Loaded {
  name: string;
  url: string;
  width: number;
  height: number;
  image: HTMLImageElement | null;
  gif: DecodedGif | null;
}

let importFrames: Frame[] = [];
let importFps = 10;
registerSource({
  id: "import",
  label: "Imported GIF",
  start(emit) {
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      if (importFrames.length) emit(importFrames[i++ % importFrames.length]);
      t = setTimeout(step, 1000 / importFps);
    };
    step();
    return () => clearTimeout(t);
  },
});

export function ImportView() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [opts, setOpts] = useState<RasterOptions>(DEFAULT_RASTER);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const gifLive = useIsLive("import");

  const set = (p: Partial<RasterOptions>) => setOpts((o) => ({ ...o, ...p }));
  const setAdj = (p: Partial<RasterOptions["adjust"]>) => setOpts((o) => ({ ...o, adjust: { ...o.adjust, ...p } }));

  const load = async (file: File) => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (src) URL.revokeObjectURL(src.url);
      const url = URL.createObjectURL(file);
      if (file.type === "image/gif") {
        const gif = await decodeGif(await file.arrayBuffer());
        if (!gif.canvases.length) throw new Error("GIF has no frames");
        setSrc({ name: file.name, url: gif.canvases[0].toDataURL(), width: gif.width, height: gif.height, image: null, gif });
      } else {
        const image = await loadImage(url);
        setSrc({ name: file.name, url, width: image.naturalWidth, height: image.naturalHeight, image, gif: null });
      }
      setOpts((o) => ({ ...o, crop: FULL_CROP }));
    } catch (e) {
      setError((e as Error).message || "Unsupported file");
    } finally {
      setBusy(false);
    }
  };

  // paste an image from the clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void load(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // re-rasterize (debounced) whenever options change
  useEffect(() => {
    if (!src) return;
    const h = setTimeout(() => {
      const out = src.gif ? gifToFrames(src.gif, opts) : [rasterize(src.image!, opts)];
      setFrames(out);
      importFrames = out;
    }, 80);
    return () => clearTimeout(h);
  }, [src, opts]);

  const gifFps = useMemo(() => {
    if (!src?.gif) return 10;
    const avg = src.gif.delays.reduce((a, b) => a + b, 0) / src.gif.delays.length;
    return Math.max(1, Math.min(24, Math.round(1000 / avg)));
  }, [src]);
  importFps = gifFps;

  useEffect(() => {
    if (frames.length < 2) return;
    const h = setInterval(() => setTick((t) => t + 1), 1000 / gifFps);
    return () => clearInterval(h);
  }, [frames.length, gifFps]);

  const preview = frames.length ? frames[tick % frames.length] : null;
  const ed = useEditor.getState;
  const flash = (m: string) => { setDone(m); setTimeout(() => setDone(null), 2500); };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div
          className={cx("panel p-3 transition", dragOver && "border-accent-2 bg-accent-2/5")}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void load(f);
          }}
        >
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }}
          />
          {src ? (
            <>
              <CropBox src={src.url} width={src.width} height={src.height} crop={opts.crop} onChange={(crop) => set({ crop })} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="min-w-48 flex-1">
                  <Slider
                    label="Crop zoom"
                    value={Math.round((1 / opts.crop.size) * 100) / 100}
                    min={1}
                    max={10}
                    step={0.05}
                    format={(v) => `${v.toFixed(1)}×`}
                    onChange={(v) => {
                      const size = 1 / v;
                      set({ crop: { ...opts.crop, size } });
                    }}
                  />
                </div>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => set({ crop: FULL_CROP })}>
                  Reset crop
                </Button>
                <Button size="sm" icon={<Upload size={14} />} onClick={() => input.current?.click()}>
                  Replace
                </Button>
              </div>
              <p className="mt-2 truncate text-xs text-muted">
                {src.name} · {src.width}×{src.height}
                {src.gif && ` · ${src.gif.canvases.length} frames @ ~${gifFps} fps`} · drag to move, scroll to zoom
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line text-muted transition hover:border-accent-2 hover:text-fg"
            >
              <ImagePlus size={36} strokeWidth={1.5} />
              <span className="text-sm font-medium">{busy ? "Decoding…" : "Drop a photo or animated GIF"}</span>
              <span className="text-xs text-faint">PNG · JPG · WEBP · GIF — or paste from clipboard</span>
            </button>
          )}
          {error && <p className="mt-2 text-sm text-err">{error}</p>}
        </div>

        <Panel title="Adjust">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <span className="label mb-1.5 block">Downsampling</span>
              <Segmented
                value={opts.resample}
                onChange={(resample) => set({ resample })}
                options={[{ value: "smooth", label: "Smooth (bicubic)" }, { value: "nearest", label: "Nearest" }]}
              />
            </div>
            <div>
              <span className="label mb-1.5 block">Color limit</span>
              <Segmented
                value={opts.colors}
                onChange={(colors) => set({ colors })}
                options={[0, 32, 16, 8, 4].map((v) => ({ value: v, label: v ? String(v) : "Full" }))}
              />
            </div>
            <Slider label="Brightness" value={opts.adjust.brightness} min={-100} max={100} onChange={(brightness) => setAdj({ brightness })} />
            <Slider label="Contrast" value={opts.adjust.contrast} min={-100} max={100} onChange={(contrast) => setAdj({ contrast })} />
            <Slider label="Saturation" value={opts.adjust.saturation} min={-100} max={100} onChange={(saturation) => setAdj({ saturation })} />
            <div className="flex items-end justify-between gap-3">
              <div className="flex-1"><ColorField label="Transparent bg" value={opts.background} onChange={(background) => set({ background })} /></div>
            </div>
          </div>
          <Button size="sm" variant="ghost" className="mt-3" icon={<RotateCcw size={14} />} onClick={() => setOpts((o) => ({ ...o, adjust: NO_ADJUST, colors: 0, background: 0 }))}>
            Reset adjustments
          </Button>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="16×16 result">
          <div className="rounded-lg bg-black p-2">
            <MatrixCanvas frame={preview ?? new Array(256).fill(0)} look="led" grid={false} />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {src?.gif && frames.length > 1 ? (
              <>
                <LiveButton source="import" label="Play GIF on matrix" />
                <Button
                  icon={<Clapperboard size={16} />}
                  onClick={() => { ed().replaceAll(frames, gifFps); flash(`${frames.length} frames loaded into Animate`); }}
                >
                  Open in Animation Studio
                </Button>
                <Button
                  variant="ghost"
                  icon={<Plus size={16} />}
                  onClick={() => { ed().appendFrames(frames); flash(`Appended ${frames.length} frames`); }}
                >
                  Append to timeline
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" disabled={!preview} onClick={() => { if (gifLive) stopLive(); showStatic(preview!, "Image"); }}>
                  Show on matrix
                </Button>
                <Button
                  icon={<PenLine size={16} />}
                  disabled={!preview}
                  onClick={() => { ed().setCurrentFrame(preview!); flash("Sent to the editor (current frame)"); }}
                >
                  Edit in Draw
                </Button>
                <Button
                  variant="ghost"
                  icon={<Plus size={16} />}
                  disabled={!preview}
                  onClick={() => { ed().appendFrames([preview!]); flash("Added as a new animation frame"); }}
                >
                  Add as animation frame
                </Button>
              </>
            )}
            {done && <p className="text-xs text-ok">{done}</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
