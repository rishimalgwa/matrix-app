import {
  Brush, Eraser, FlipHorizontal2, FlipVertical2, Grid3x3, Layers, Minus, PaintBucket, Pipette, Redo2,
  RotateCw, Square, SquareSplitHorizontal, Trash2, Undo2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toCss } from "@/core/color";
import { flipH, flipV, idx, line, rotateCW, shift, W, type Frame } from "@/core/matrix";
import { MatrixCanvas, type CellPhase } from "@/components/MatrixCanvas";
import { cx, IconButton } from "@/components/ui";
import { useEditor, type Tool } from "@/store/editor";
import { ColorPanel } from "./ColorPanel";

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: "pencil", label: "Pencil (B)", key: "b", icon: <Brush size={18} /> },
  { id: "eraser", label: "Eraser (E)", key: "e", icon: <Eraser size={18} /> },
  { id: "fill", label: "Paint bucket (G)", key: "g", icon: <PaintBucket size={18} /> },
  { id: "picker", label: "Eyedropper (I)", key: "i", icon: <Pipette size={18} /> },
  { id: "line", label: "Line (L)", key: "l", icon: <Minus size={18} className="-rotate-45" /> },
  { id: "rect", label: "Rectangle (R) — Shift to fill", key: "r", icon: <Square size={18} /> },
];

function shapeCells(tool: Tool, a: { x: number; y: number }, b: { x: number; y: number }, filled: boolean) {
  const cells: [number, number][] = [];
  if (tool === "line") line(a.x, a.y, b.x, b.y, (x, y) => cells.push([x, y]));
  else {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (filled || x === x0 || x === x1 || y === y0 || y === y1) cells.push([x, y]);
  }
  return cells;
}

interface EditorProps {
  /** show this frame instead of the editable one (animation preview playback) */
  displayFrame?: Frame | null;
  showOnion?: boolean;
  belowCanvas?: React.ReactNode;
  sidebar?: React.ReactNode;
}

export function Editor({ displayFrame, showOnion = false, belowCanvas, sidebar }: EditorProps) {
  const ed = useEditor();
  const frame = ed.frames[ed.current];
  const onion = showOnion && ed.onion && ed.current > 0 ? ed.frames[ed.current - 1] : null;
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [shape, setShape] = useState<{ a: { x: number; y: number }; b: { x: number; y: number }; color: number; filled: boolean } | null>(null);

  const overlay = useMemo(() => {
    if (!shape) return null;
    const o: (number | null)[] = new Array(W * W).fill(null);
    for (const [x, y] of shapeCells(ed.tool, shape.a, shape.b, shape.filled)) {
      o[idx(x, y)] = shape.color;
      if (ed.mirror) o[idx(W - 1 - x, y)] = shape.color;
    }
    return o;
  }, [shape, ed.tool, ed.mirror]);

  const onCell = (x: number, y: number, phase: CellPhase, e: { button: number; shiftKey: boolean }) => {
    if (displayFrame) return;
    const s = useEditor.getState();
    const erase = e.button === 2 || s.tool === "eraser";
    const c = erase ? 0 : s.color;
    switch (s.tool) {
      case "pencil":
      case "eraser":
        if (phase === "down") s.checkpoint();
        if (phase !== "up") s.paint(x, y, c);
        break;
      case "fill":
        if (phase === "down") s.fill(x, y, c);
        break;
      case "picker":
        if (phase === "down") {
          s.setColor(s.frames[s.current][idx(x, y)]);
          s.setTool("pencil");
        }
        break;
      case "line":
      case "rect":
        if (phase === "down") setShape({ a: { x, y }, b: { x, y }, color: c, filled: e.shiftKey });
        else if (phase === "move") setShape((sh) => (sh ? { ...sh, b: { x, y }, filled: e.shiftKey } : sh));
        else if (phase === "up" && shape) {
          s.checkpoint();
          for (const [px, py] of shapeCells(s.tool, shape.a, { x, y }, e.shiftKey)) s.paint(px, py, shape.color);
          setShape(null);
        }
        break;
    }
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(); return; }
      if (mod) return;
      const tool = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (tool) { s.setTool(tool.id); return; }
      if (e.key === "m") s.set({ mirror: !s.mirror });
      if (e.key === "[") s.select(s.current - 1);
      if (e.key === "]") s.select(s.current + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const transform = (fn: (f: Frame) => Frame) => ed.setCurrentFrame(fn(frame));
  const shown = displayFrame ?? frame;
  const hoverColor = hover ? shown[idx(hover.x, hover.y)] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_300px]">
      {/* tools */}
      <div className="panel flex gap-1 overflow-x-auto p-1.5 scroll-thin lg:flex-col lg:self-start lg:overflow-visible">
        {TOOLS.map((t) => (
          <IconButton key={t.id} label={t.label} active={ed.tool === t.id} onClick={() => ed.setTool(t.id)}>
            {t.icon}
          </IconButton>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-auto" />
        <IconButton label="Mirror drawing (M)" active={ed.mirror} onClick={() => ed.set({ mirror: !ed.mirror })}>
          <SquareSplitHorizontal size={18} />
        </IconButton>
        <IconButton label="Grid overlay" active={ed.grid} onClick={() => ed.set({ grid: !ed.grid })}>
          <Grid3x3 size={18} />
        </IconButton>
        {showOnion && (
          <IconButton label="Onion skin" active={ed.onion} onClick={() => ed.set({ onion: !ed.onion })}>
            <Layers size={18} />
          </IconButton>
        )}
        <span className="mx-1 w-px shrink-0 bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-auto" />
        <IconButton label="Undo (Ctrl+Z)" disabled={!ed.past.length} onClick={ed.undo}><Undo2 size={18} /></IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!ed.future.length} onClick={ed.redo}><Redo2 size={18} /></IconButton>
        <IconButton label="Clear canvas" onClick={ed.clear}><Trash2 size={18} /></IconButton>
      </div>

      {/* canvas */}
      <div className="min-w-0">
        <div className="panel mx-auto max-w-[620px] p-2 sm:p-3">
          <MatrixCanvas
            frame={shown}
            onion={displayFrame ? null : onion}
            overlay={displayFrame ? null : overlay}
            grid={ed.grid}
            interactive={!displayFrame}
            onCell={onCell}
            onHover={setHover}
            label="Drawing canvas"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
            <span className="font-mono tabular-nums">
              {hover ? (
                <>
                  x <span className="text-fg">{String(hover.x).padStart(2, "0")}</span> · y{" "}
                  <span className="text-fg">{String(hover.y).padStart(2, "0")}</span> · #{" "}
                  <span className="inline-block size-2.5 rounded-sm align-middle" style={{ background: toCss(hoverColor ?? 0) }} />{" "}
                  <span className="text-fg uppercase">{toCss(hoverColor ?? 0).slice(1)}</span>
                </>
              ) : (
                <span className="text-faint">Right-click erases · Shift+drag fills rectangles</span>
              )}
            </span>
            <span className="flex items-center gap-0.5">
              <IconButton label="Flip horizontal" className="size-7" onClick={() => transform(flipH)}><FlipHorizontal2 size={15} /></IconButton>
              <IconButton label="Flip vertical" className="size-7" onClick={() => transform(flipV)}><FlipVertical2 size={15} /></IconButton>
              <IconButton label="Rotate 90°" className="size-7" onClick={() => transform(rotateCW)}><RotateCw size={15} /></IconButton>
              <IconButton label="Shift left" className="size-7" onClick={() => transform((f) => shift(f, -1, 0))}><ArrowLeft size={15} /></IconButton>
              <IconButton label="Shift right" className="size-7" onClick={() => transform((f) => shift(f, 1, 0))}><ArrowRight size={15} /></IconButton>
              <IconButton label="Shift up" className="size-7" onClick={() => transform((f) => shift(f, 0, -1))}><ArrowUp size={15} /></IconButton>
              <IconButton label="Shift down" className="size-7" onClick={() => transform((f) => shift(f, 0, 1))}><ArrowDown size={15} /></IconButton>
            </span>
          </div>
        </div>
        {belowCanvas && <div className={cx("mx-auto mt-4 max-w-[620px]")}>{belowCanvas}</div>}
      </div>

      {/* side */}
      <div className="flex flex-col gap-4">
        <ColorPanel />
        {sidebar}
      </div>
    </div>
  );
}
