import { useEffect, useRef } from "react";
import { H, W, line, type Frame } from "@/core/matrix";
import { cx } from "./ui";

export type CellPhase = "down" | "move" | "up";

interface Props {
  frame: Frame;
  /** ghost frame drawn behind empty pixels (onion skin) */
  onion?: Frame | null;
  /** sparse overlay (shape tool preview); null entries are transparent */
  overlay?: (number | null)[] | null;
  grid?: boolean;
  /** "led" draws round, glowing pixels like the real panel */
  look?: "pixel" | "led";
  interactive?: boolean;
  onCell?: (x: number, y: number, phase: CellPhase, e: { button: number; shiftKey: boolean }) => void;
  onHover?: (cell: { x: number; y: number } | null) => void;
  className?: string;
  label?: string;
}

const OFF = "#0b0f17";

const css = (c: number) => "#" + c.toString(16).padStart(6, "0");

export function MatrixCanvas({
  frame, onion, overlay, grid = true, look = "pixel", interactive = false, onCell, onHover, className, label,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const button = useRef(0);
  const size = useRef({ w: 0, h: 0 });

  // keep canvas resolution in sync with its CSS box
  useEffect(() => {
    const c = ref.current!;
    const ro = new ResizeObserver(([e]) => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(e.contentRect.width * dpr);
      const h = Math.round(e.contentRect.height * dpr);
      if (w && h && (w !== size.current.w || h !== size.current.h)) {
        size.current = { w, h };
        c.width = w;
        c.height = h;
        draw();
      }
    });
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const c = ref.current;
    if (!c || !c.width) return;
    const ctx = c.getContext("2d")!;
    const cw = c.width / W;
    const ch = c.height / H;
    const gap = grid ? Math.max(1, Math.round(cw * 0.08)) : 0;
    ctx.fillStyle = look === "led" ? "#030406" : grid ? "#05070b" : OFF;
    ctx.fillRect(0, 0, c.width, c.height);

    if (look === "led") {
      // glow pass first, so the crisp LED pass below covers any bleed onto dark neighbours
      const r = Math.min(cw, ch) * 0.42;
      ctx.shadowBlur = r * 1.2;
      for (let i = 0; i < W * H; i++) {
        const v = overlay?.[i] ?? frame[i];
        if (!v) continue;
        ctx.shadowColor = ctx.fillStyle = css(v);
        ctx.beginPath();
        ctx.arc((i % W) * cw + cw / 2, Math.floor(i / W) * ch + ch / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const ov = overlay?.[i];
        const v = ov ?? frame[i];
        const px = x * cw;
        const py = y * ch;
        if (look === "led") {
          const r = Math.min(cw, ch) * 0.42;
          ctx.beginPath();
          ctx.arc(px + cw / 2, py + ch / 2, r, 0, Math.PI * 2);
          ctx.fillStyle = v ? css(v) : "#0d1119";
          ctx.fill();
          continue;
        }
        if (!v && onion && onion[i]) {
          ctx.fillStyle = OFF;
          ctx.fillRect(px + gap / 2, py + gap / 2, cw - gap, ch - gap);
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = css(onion[i]);
          ctx.fillRect(px + gap / 2, py + gap / 2, cw - gap, ch - gap);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = v ? css(v) : OFF;
        ctx.fillRect(px + gap / 2, py + gap / 2, cw - gap, ch - gap);
      }

    // emphasize the center lines for symmetry work
    if (grid && interactive) {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(c.width / 2 - gap / 2, 0, gap, c.height);
      ctx.fillRect(0, c.height / 2 - gap / 2, c.width, gap);
    }
  };

  useEffect(draw);

  const cellAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * H);
    return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
  };

  const handlers = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          ref.current!.setPointerCapture(e.pointerId);
          button.current = e.button;
          const p = cellAt(e);
          last.current = p;
          onCell?.(p.x, p.y, "down", { button: e.button, shiftKey: e.shiftKey });
        },
        onPointerMove: (e: React.PointerEvent) => {
          const p = cellAt(e);
          onHover?.(p);
          const l = last.current;
          if (!l || (l.x === p.x && l.y === p.y)) return;
          // interpolate so fast strokes don't leave gaps
          let first = true;
          line(l.x, l.y, p.x, p.y, (x, y) => {
            if (first) { first = false; return; }
            onCell?.(x, y, "move", { button: button.current, shiftKey: e.shiftKey });
          });
          last.current = p;
        },
        onPointerUp: (e: React.PointerEvent) => {
          const l = last.current;
          last.current = null;
          if (l) onCell?.(l.x, l.y, "up", { button: button.current, shiftKey: e.shiftKey });
        },
        onPointerCancel: () => { last.current = null; },
        onPointerLeave: () => onHover?.(null),
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {};

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label ?? "16 by 16 pixel matrix"}
      className={cx("block aspect-square w-full touch-none select-none", interactive && "cursor-crosshair", className)}
      {...handlers}
    />
  );
}
