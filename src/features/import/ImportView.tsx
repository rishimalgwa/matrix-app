import { Clapperboard, Crosshair, Eye, ImagePlus, PenLine, Plus, RotateCcw, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeGif, sampleGif, type DecodedGif } from "@/core/gif";
import {
  autoCrop, DEFAULT_RASTER, FULL_CROP, LED_ENHANCE, loadImage, looksLikePixelArt, NO_ENHANCE, PIXEL_ART_RASTER,
  sampleCells, toneCells, type Cells, type RasterOptions,
} from "@/core/image";
import { NO_ADJUST } from "@/core/color";
import { blankFrame, type Frame } from "@/core/matrix";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Button, ColorField, Panel, Segmented, Slider, Toggle, cx } from "@/components/ui";
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
  pixelArt: boolean;
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

const sourcesOf = (src: Loaded) => (src.gif ? src.gif.canvases : [src.image!]);

/** What the old pipeline did: plain average of the whole image — used for the before/after compare. */
const BASIC: RasterOptions = { crop: FULL_CROP, resample: "smooth", adjust: NO_ADJUST, colors: 0, background: 0, enhance: NO_ENHANCE };

export function ImportView() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [opts, setOpts] = useState<RasterOptions>(DEFAULT_RASTER);
  const [cells, setCells] = useState<Cells[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [basic, setBasic] = useState<Frame[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const gifLive = useIsLive("import");

  const set = (p: Partial<RasterOptions>) => setOpts((o) => ({ ...o, ...p }));
  const setAdj = (p: Partial<RasterOptions["adjust"]>) => setOpts((o) => ({ ...o, adjust: { ...o.adjust, ...p } }));
  const setEnh = (p: Partial<RasterOptions["enhance"]>) => setOpts((o) => ({ ...o, enhance: { ...o.enhance, ...p } }));

  const load = async (file: File) => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (src) URL.revokeObjectURL(src.url);
      const url = URL.createObjectURL(file);
      let loaded: Loaded;
      if (file.type === "image/gif") {
        const gif = await decodeGif(await file.arrayBuffer());
        if (!gif.canvases.length) throw new Error("GIF has no frames");
        loaded = { name: file.name, url: gif.canvases[0].toDataURL(), width: gif.width, height: gif.height, image: null, gif, pixelArt: looksLikePixelArt(gif.canvases[0]) };
      } else {
        const image = await loadImage(url);
        loaded = { name: file.name, url, width: image.naturalWidth, height: image.naturalHeight, image, gif: null, pixelArt: looksLikePixelArt(image) };
      }
      // pixel art is kept pixel-exact; everything else gets the LED pipeline and is cropped to its subject
      setOpts(
        loaded.pixelArt
          ? { ...DEFAULT_RASTER, ...PIXEL_ART_RASTER, crop: FULL_CROP }
          : { ...DEFAULT_RASTER, crop: autoCrop(sourcesOf(loaded)) }
      );
      setBasic(null);
      setSrc(loaded);
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

  // sampling (slow-ish for long GIFs) only reruns when crop / sampling options change
  const { crop, resample } = opts;
  const { removeBg, bgTolerance } = opts.enhance;
  useEffect(() => {
    if (!src) return;
    const h = setTimeout(() => {
      const o = { crop, resample, enhance: { ...LED_ENHANCE, removeBg, bgTolerance } };
      setCells(src.gif ? sampleGif(src.gif, o) : [sampleCells(src.image!, o)]);
    }, 60);
    return () => clearTimeout(h);
  }, [src, crop, resample, removeBg, bgTolerance]);

  // tone changes are instant
  const frames = useMemo(() => (cells.length ? toneCells(cells, opts) : []), [cells, opts]);
  importFrames = frames;

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

  const startCompare = () => {
    if (!src) return;
    if (!basic) setBasic(sourcesOf(src).map((s) => toneCells([sampleCells(s, BASIC)], BASIC)[0]));
    setComparing(true);
  };

  const shown = comparing && basic ? basic : frames;
  const preview = shown.length ? shown[tick % shown.length] : null;
  const ed = useEditor.getState;
  const flash = (m: string) => { setDone(m); setTimeout(() => setDone(null), 2500); };
  const isPixel = opts.resample === "nearest";

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
                    onChange={(v) => set({ crop: { ...opts.crop, size: 1 / v } })}
                  />
                </div>
                <Button size="sm" icon={<Crosshair size={14} />} onClick={() => set({ crop: autoCrop(sourcesOf(src)) })} title="Zoom in on the main subject">
                  Auto crop
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => set({ crop: FULL_CROP })}>
                  Full image
                </Button>
                <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => input.current?.click()}>
                  Replace
                </Button>
              </div>
              <p className="mt-2 truncate text-xs text-muted">
                {src.name} · {src.width}×{src.height}
                {src.gif && ` · ${src.gif.canvases.length} frames @ ~${gifFps} fps`}
                {src.pixelArt ? " · pixel art detected, kept pixel-exact" : " · auto-cropped to the subject"} · drag to move, scroll to zoom
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
              <span className="max-w-sm text-center text-xs text-faint">
                Tip: simple subjects (logos, icons, faces, pixel-art GIFs) on plain backgrounds look best on 16×16.
              </span>
            </button>
          )}
          {error && <p className="mt-2 text-sm text-err">{error}</p>}
        </div>

        <Panel
          title={<span className="inline-flex items-center gap-1.5"><Sparkles size={12} /> Enhance for LEDs</span>}
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              onClick={() => setOpts((o) => ({ ...o, ...(src?.pixelArt ? PIXEL_ART_RASTER : { resample: DEFAULT_RASTER.resample, enhance: LED_ENHANCE, adjust: DEFAULT_RASTER.adjust }) }))}
            >
              Defaults
            </Button>
          }
        >
          <span className="label mb-1.5 block">Downscaling</span>
          <Segmented
            value={opts.resample}
            onChange={(resample) => set({ resample })}
            options={[
              { value: "sharp", label: "Sharp", title: "Each LED takes the dominant colour of its area — crisp edges" },
              { value: "smooth", label: "Smooth", title: "Average colour — softer, good for gradients" },
              { value: "nearest", label: "Pixel art", title: "Keep source pixels exactly — for images that already are pixel art" },
            ]}
          />
          <div className={cx("mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2", isPixel && "opacity-90")}>
            <Toggle label="Auto levels" hint="Use the full brightness range" checked={opts.enhance.autoLevels} onChange={(autoLevels) => setEnh({ autoLevels })} />
            <Toggle
              label="Remove background"
              hint="Blacks out the plain area around the subject"
              checked={opts.enhance.removeBg}
              onChange={(removeBg) => setEnh({ removeBg })}
            />
            <Slider label="Shadow lift" value={opts.enhance.shadows} min={0} max={100} onChange={(shadows) => setEnh({ shadows })} format={(v) => `${v}%`} />
            <Slider label="Sharpen" value={opts.enhance.sharpen} min={0} max={100} onChange={(sharpen) => setEnh({ sharpen })} format={(v) => `${v}%`} />
            {opts.enhance.removeBg && (
              <Slider label="Background tolerance" value={opts.enhance.bgTolerance} min={0} max={100} onChange={(bgTolerance) => setEnh({ bgTolerance })} format={(v) => `${v}%`} />
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            WLED gamma-corrects colours (2.2 by default), which darkens mid-tones a lot on the LEDs — shadow lift keeps that detail visible.
          </p>
        </Panel>

        <Panel title="Color">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Slider label="Brightness" value={opts.adjust.brightness} min={-100} max={100} onChange={(brightness) => setAdj({ brightness })} />
            <Slider label="Contrast" value={opts.adjust.contrast} min={-100} max={100} onChange={(contrast) => setAdj({ contrast })} />
            <Slider label="Saturation" value={opts.adjust.saturation} min={-100} max={100} onChange={(saturation) => setAdj({ saturation })} />
            <div>
              <span className="label mb-1.5 block">Color limit</span>
              <Segmented
                value={opts.colors}
                onChange={(colors) => set({ colors })}
                options={[0, 32, 16, 8, 4].map((v) => ({ value: v, label: v ? String(v) : "Full" }))}
              />
            </div>
            <ColorField label="Background" value={opts.background} onChange={(background) => set({ background })} />
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel
          title={comparing ? "Before (plain shrink)" : "16×16 result"}
          actions={
            src && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Eye size={14} />}
                onPointerDown={startCompare}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                title="Hold to see the image without enhancement"
              >
                Hold to compare
              </Button>
            )
          }
        >
          <div className="rounded-lg bg-black p-2">
            <MatrixCanvas frame={preview ?? blankFrame()} look="led" grid={false} />
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
                <Button variant="primary" disabled={!frames[0]} onClick={() => { if (gifLive) stopLive(); showStatic(frames[0], "Image"); }}>
                  Show on matrix
                </Button>
                <Button
                  icon={<PenLine size={16} />}
                  disabled={!frames[0]}
                  onClick={() => { ed().setCurrentFrame(frames[0]); flash("Sent to the editor (current frame)"); }}
                >
                  Edit in Draw
                </Button>
                <Button
                  variant="ghost"
                  icon={<Plus size={16} />}
                  disabled={!frames[0]}
                  onClick={() => { ed().appendFrames([frames[0]]); flash("Added as a new animation frame"); }}
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
