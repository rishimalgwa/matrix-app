import { Send } from "lucide-react";
import { LibraryPanel } from "@/components/LibraryPanel";
import { Button, Panel, Toggle } from "@/components/ui";
import { showStatic } from "@/engine/sources";
import { currentFrame, useEditor } from "@/store/editor";
import { Editor } from "../editor/Editor";

export function DrawView() {
  const liveSync = useEditor((s) => s.liveSync);
  return (
    <Editor
      sidebar={
        <>
          <Panel title="Matrix">
            <Button variant="primary" className="w-full" icon={<Send size={16} />} onClick={() => showStatic(currentFrame(), "Drawing")}>
              Push to display
            </Button>
            <div className="mt-3">
              <Toggle
                label="Live draw"
                hint="Every stroke appears on the matrix instantly"
                checked={liveSync}
                onChange={(v) => {
                  useEditor.getState().set({ liveSync: v });
                  if (v) showStatic(currentFrame(), "Drawing");
                }}
              />
            </div>
          </Panel>
          <LibraryPanel />
        </>
      }
    />
  );
}
