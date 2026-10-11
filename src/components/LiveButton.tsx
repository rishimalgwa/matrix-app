import { Radio, Square } from "lucide-react";
import { useState } from "react";
import { toggleLive, useIsLive } from "@/engine/sources";
import { Button } from "./ui";

/** "Show on matrix" toggle for a live source. */
export function LiveButton({ source, label = "Show on matrix", className }: { source: string; label?: string; className?: string }) {
  const live = useIsLive(source);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        variant={live ? "live" : "primary"}
        className="w-full"
        disabled={busy}
        icon={live ? <Square size={14} fill="currentColor" /> : <Radio size={16} />}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try { await toggleLive(source); } catch (e) { setErr((e as Error).message); }
          finally { setBusy(false); }
        }}
      >
        {live ? "On air — stop" : label}
      </Button>
      {err && <p className="mt-1.5 text-xs text-err">{err}</p>}
    </div>
  );
}
