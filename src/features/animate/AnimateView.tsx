import { FileDown, FileJson, FileUp, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { encodeGif } from "@/core/gif";
import { LibraryPanel } from "@/components/LibraryPanel";
import { LiveButton } from "@/components/LiveButton";
import { Button, Panel, Slider } from "@/components/ui";
import { downloadBlob, pickFile } from "@/lib/download";
import { useEditor } from "@/store/editor";
import { fromPixelFile, toPixelFile } from "@/store/library";
import { Editor } from "../editor/Editor";
import { Timeline } from "./Timeline";

export function AnimateView() {
  const { frames, fps, set } = useEditor();
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setTick((t) => t + 1), 1000 / fps);
    return () => clearInterval(h);
  }, [playing, fps]);

  const playIndex = playing ? tick % frames.length : null;

  const exportJson = () =>
    downloadBlob(new Blob([JSON.stringify(toPixelFile(frames, fps))], { type: "application/json" }), "animation.pixel.json");

  const importJson = async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const { frames: f, fps: r } = fromPixelFile(JSON.parse(await file.text()));
      useEditor.getState().replaceAll(f, r);
      setMsg(`Imported ${f.length} frame${f.length > 1 ? "s" : ""}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Editor
      showOnion
      displayFrame={playIndex !== null ? frames[playIndex] : null}
      belowCanvas={<Timeline playing={playIndex} />}
      sidebar={
        <>
          <Panel title="Playback">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                icon={playing ? <Pause size={16} /> : <Play size={16} />}
                onClick={() => { setTick(useEditor.getState().current); setPlaying(!playing); }}
              >
                {playing ? "Pause" : "Preview"}
              </Button>
            </div>
            <div className="mt-3">
              <Slider label="Speed" value={fps} min={1} max={24} onChange={(v) => set({ fps: v })} format={(v) => `${v} fps`} />
            </div>
            <LiveButton source="animation" label="Play on matrix" className="mt-3" />
          </Panel>
          <Panel title="Files">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" icon={<FileDown size={14} />} onClick={() => downloadBlob(encodeGif(frames, fps), "animation.gif")}>
                Export GIF
              </Button>
              <Button size="sm" icon={<FileJson size={14} />} onClick={exportJson}>
                Export JSON
              </Button>
              <Button size="sm" className="col-span-2" icon={<FileUp size={14} />} onClick={importJson}>
                Import JSON
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">{msg ?? "Import animated GIFs from the Import tab."}</p>
          </Panel>
          <LibraryPanel />
        </>
      }
    />
  );
}
