import { Check, Loader2, Radar, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { discoverDevices, type DiscoverProgress, type FoundDevice } from "@/services/discovery";
import { useDevice } from "@/store/device";

/** Scans the network for WLED devices and lets the user pick one. */
export function DeviceFinder({ autoStart }: { autoStart: boolean }) {
  const host = useDevice((s) => s.host);
  const [found, setFound] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DiscoverProgress | null>(null);
  const [searched, setSearched] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const select = async (d: FoundDevice) => {
    ctrl.current?.abort();
    useDevice.getState().set({ host: d.host, mac: d.mac });
    await useDevice.getState().check();
  };

  const scan = async (auto = false) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setFound([]);
    setScanning(true);
    setSearched(true);
    const list: FoundDevice[] = [];
    try {
      await discoverDevices({
        hint: useDevice.getState().host,
        signal: c.signal,
        onProgress: setProgress,
        onFound: (d) => {
          if (list.some((x) => x.mac === d.mac)) return;
          list.push(d);
          setFound([...list]);
        },
      });
    } finally {
      if (ctrl.current === c) {
        setScanning(false);
        setProgress(null);
      }
    }
    // first run with exactly one device on the network → just connect to it
    if (auto && list.length === 1 && !useDevice.getState().host) void select(list[0]);
  };

  useEffect(() => {
    if (autoStart) void scan(true);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const pct = progress && progress.total > 1 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          icon={scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          onClick={() => (scanning ? ctrl.current?.abort() : void scan())}
        >
          {scanning ? "Stop searching" : "Find devices on Wi-Fi"}
        </Button>
        {scanning && (
          <span className="truncate text-xs text-muted">
            {progress?.phase === "browser" ? `Scanning ${progress.subnet ?? ""} · ${pct}%` : "Searching the network…"}
          </span>
        )}
      </div>

      {found.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {found.map((d) => {
            const current = d.host === host;
            const fits = !d.matrix || (d.matrix.w === 16 && d.matrix.h === 16);
            return (
              <li key={d.mac}>
                <button
                  type="button"
                  onClick={() => void select(d)}
                  className={cx("flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-panel-3", current && "bg-accent-2/10")}
                >
                  <Wifi size={16} className={current ? "text-accent-2" : "text-muted"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block truncate font-mono text-xs text-muted">
                      {d.host} · {d.leds} LEDs{d.matrix ? ` · ${d.matrix.w}×${d.matrix.h}` : ""} · v{d.ver}
                    </span>
                  </span>
                  {!fits && <span className="text-[11px] text-warn">not 16×16</span>}
                  {current && <Check size={16} className="text-accent-2" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {searched && !scanning && found.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          No WLED found. Make sure this device and the ESP32 are on the same Wi-Fi (not a guest network), or type the IP shown in the WLED app.
        </p>
      )}
    </div>
  );
}
