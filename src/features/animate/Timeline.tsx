import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { cx, IconButton } from "@/components/ui";
import { useEditor } from "@/store/editor";

export function Timeline({ playing }: { playing: number | null }) {
  const { frames, current, select, addFrame, duplicateFrame, deleteFrame, moveFrame } = useEditor();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const strip = useRef<HTMLOListElement>(null);

  // keep the selected frame in view
  useEffect(() => {
    const el = strip.current?.children[playing ?? current] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, playing]);

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">
          Timeline · frame {current + 1}/{frames.length}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton label="Move frame left" className="size-8" disabled={current === 0} onClick={() => moveFrame(current, current - 1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton label="Move frame right" className="size-8" disabled={current === frames.length - 1} onClick={() => moveFrame(current, current + 1)}>
            <ChevronRight size={16} />
          </IconButton>
          <IconButton label="Duplicate frame" className="size-8" onClick={() => duplicateFrame()}>
            <Copy size={16} />
          </IconButton>
          <IconButton label="Delete frame" className="size-8 hover:!text-err" onClick={() => deleteFrame(current)}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Add frame" className="size-8 text-accent-2" onClick={addFrame}>
            <Plus size={18} />
          </IconButton>
        </div>
      </div>
      <ol ref={strip} className="flex gap-2 overflow-x-auto pb-1 scroll-thin">
        {frames.map((f, i) => (
          <li
            key={i}
            draggable
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) moveFrame(drag, i); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            className="shrink-0"
          >
            <button
              type="button"
              onClick={() => select(i)}
              aria-label={`Frame ${i + 1}`}
              aria-current={i === current}
              className={cx(
                "relative block w-16 rounded-lg border-2 p-0.5 transition",
                i === current ? "border-accent-2" : "border-line hover:border-line-strong",
                playing === i && "border-accent",
                over === i && drag !== i && "translate-x-1 border-dashed border-accent",
                drag === i && "opacity-40"
              )}
            >
              <MatrixCanvas frame={f} grid={false} />
              <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-muted">{i + 1}</span>
            </button>
          </li>
        ))}
        <li className="shrink-0">
          <button
            type="button"
            onClick={addFrame}
            aria-label="Add frame"
            className="grid size-16 place-items-center rounded-lg border-2 border-dashed border-line text-faint hover:border-accent-2 hover:text-accent-2"
          >
            <Plus size={20} />
          </button>
        </li>
      </ol>
    </div>
  );
}
