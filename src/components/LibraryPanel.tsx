import { Download, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { MatrixCanvas } from "./MatrixCanvas";
import { Button, IconButton, Panel } from "./ui";
import { showStatic } from "@/engine/sources";
import { playArtwork } from "@/engine/registerSources";
import { useEditor } from "@/store/editor";
import { useLibrary } from "@/store/library";

export function LibraryPanel() {
  const { items, save, remove } = useLibrary();
  const [name, setName] = useState("");

  const saveCurrent = () => {
    const { frames, fps } = useEditor.getState();
    save(name || `Art ${items.length + 1}`, frames, fps);
    setName("");
  };

  return (
    <Panel title={`Library · ${items.length}`}>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Name this artwork"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
        />
        <Button onClick={saveCurrent}>Save</Button>
      </div>
      {items.length > 0 ? (
        <ul className="mt-3 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto scroll-thin">
          {items.map((a) => (
            <li key={a.id} className="group relative rounded-lg border border-line bg-bg p-1">
              <button
                type="button"
                className="block w-full"
                title={`Load “${a.name}” into the editor`}
                onClick={() => useEditor.getState().replaceAll(a.frames, a.fps)}
              >
                <MatrixCanvas frame={a.frames[0]} grid={false} />
              </button>
              <div className="mt-1 truncate px-0.5 text-[11px] text-muted" title={a.name}>
                {a.name}
                {a.frames.length > 1 && <span className="text-faint"> · {a.frames.length}f</span>}
              </div>
              <div className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-panel/90 group-hover:flex group-focus-within:flex">
                <IconButton
                  label="Show on matrix"
                  className="size-6"
                  onClick={() => (a.frames.length > 1 ? void playArtwork(a) : showStatic(a.frames[0], a.name))}
                >
                  <Play size={12} />
                </IconButton>
                <IconButton label="Load into editor" className="size-6" onClick={() => useEditor.getState().replaceAll(a.frames, a.fps)}>
                  <Download size={12} />
                </IconButton>
                <IconButton label="Delete" className="size-6 hover:!text-err" onClick={() => confirm(`Delete “${a.name}”?`) && remove(a.id)}>
                  <Trash2 size={12} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted">Saved drawings and animations live here, on this device.</p>
      )}
    </Panel>
  );
}
