import { useRef } from "react";
import type { Crop } from "@/core/image";

/** Draggable 1:1 crop square over an image/canvas preview. */
export function CropBox({
  src, width, height, crop, onChange,
}: {
  src: string; width: number; height: number; crop: Crop; onChange: (c: Crop) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const minSide = Math.min(width, height);
  const side = minSide * crop.size;
  // percentages of the displayed box
  const wPct = (side / width) * 100;
  const hPct = (side / height) * 100;
  const left = Math.min(100 - wPct, Math.max(0, crop.cx * 100 - wPct / 2));
  const top = Math.min(100 - hPct, Math.max(0, crop.cy * 100 - hPct / 2));

  const clampCenter = (cx: number, cy: number, size = crop.size) => {
    const hw = (minSide * size) / width / 2;
    const hh = (minSide * size) / height / 2;
    return { cx: Math.min(1 - hw, Math.max(hw, cx)), cy: Math.min(1 - hh, Math.max(hh, cy)) };
  };

  return (
    <div
      ref={wrap}
      className="relative mx-auto max-h-[420px] touch-none select-none overflow-hidden rounded-lg bg-[repeating-conic-gradient(#151a26_0_25%,#0d111a_0_50%)] bg-[length:16px_16px]"
      style={{ aspectRatio: `${width} / ${height}`, maxWidth: `min(100%, ${(420 * width) / height}px)` }}
      onWheel={(e) => {
        const size = Math.min(1, Math.max(0.05, crop.size * (e.deltaY > 0 ? 1.08 : 0.92)));
        onChange({ ...crop, size, ...clampCenter(crop.cx, crop.cy, size) });
      }}
    >
      <img src={src} alt="Source" className="absolute inset-0 size-full object-fill [image-rendering:pixelated]" draggable={false} />
      <div
        className="absolute cursor-move border-2 border-accent-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
        style={{ left: `${left}%`, top: `${top}%`, width: `${wPct}%`, height: `${hPct}%` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !wrap.current) return;
          const r = wrap.current.getBoundingClientRect();
          onChange({ ...crop, ...clampCenter(d.cx + (e.clientX - d.x) / r.width, d.cy + (e.clientY - d.y) / r.height) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {/* 16x16 guide */}
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,#22d3ee_1px,transparent_1px),linear-gradient(to_bottom,#22d3ee_1px,transparent_1px)] [background-size:6.25%_6.25%]" />
      </div>
    </div>
  );
}
