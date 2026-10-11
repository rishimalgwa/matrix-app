import { useEffect } from "react";
import { useEditor } from "@/store/editor";
import { updateStatic, useLive } from "./sources";

/** Mirrors editor edits to the matrix while "Live draw" is on. Mounted once in App. */
export function useLiveSync() {
  useEffect(() => {
    const offEditor = useEditor.subscribe((s, p) => {
      if (!s.liveSync) return;
      const f = s.frames[s.current];
      if (f !== p.frames[p.current]) updateStatic(f, "Drawing");
    });
    // something else went on air → stop live drawing so we don't hijack it
    const offLive = useLive.subscribe((s) => {
      const a = s.onAir;
      if (useEditor.getState().liveSync && !(a?.kind === "static" && a.label === "Drawing"))
        useEditor.getState().set({ liveSync: false });
    });
    return () => { offEditor(); offLive(); };
  }, []);
}
