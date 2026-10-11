import { useState } from "react";
import { Clock, Type } from "lucide-react";
import { Segmented } from "@/components/ui";
import { ClockPanel } from "../clock/ClockPanel";
import { TextPanel } from "./TextPanel";

export function TextClockView() {
  const [mode, setMode] = useState<"text" | "clock">(() => {
    try { return (localStorage.getItem("pm.tc") as "text" | "clock") || "clock"; } catch { return "clock"; }
  });
  const pick = (m: "text" | "clock") => {
    setMode(m);
    try { localStorage.setItem("pm.tc", m); } catch { /* ignore */ }
  };
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        className="self-start"
        value={mode}
        onChange={pick}
        options={[
          { value: "clock", label: <span className="inline-flex items-center gap-1.5"><Clock size={14} /> Clock & HUD</span> },
          { value: "text", label: <span className="inline-flex items-center gap-1.5"><Type size={14} /> Scrolling text</span> },
        ]}
      />
      {mode === "clock" ? <ClockPanel /> : <TextPanel />}
    </div>
  );
}
