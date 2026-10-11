import { Download, Play, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WiringOrder } from "@/core/matrix";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Badge, Button, cx, Field, IconButton, Segmented, Slider, Toggle } from "@/components/ui";
import { output, useOutputStats } from "@/engine/output";
import { showStatic } from "@/engine/sources";
import { TRANSPORT_INFO, type TransportKind } from "@/services/transports";
import { normalizeHost, WledClient, type WledPresets } from "@/services/wled";
import { useDevice } from "@/store/device";
import { DeviceFinder } from "./DeviceFinder";
import { testPattern } from "./testPattern";

const WIRING: { value: WiringOrder; label: string }[] = [
  { value: "rows", label: "Rows (WLED 2D handles mapping)" },
  { value: "serpentine-rows", label: "Serpentine rows" },
  { value: "columns", label: "Columns" },
  { value: "serpentine-columns", label: "Serpentine columns" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4 first:border-t-0">
      <h3 className="label mb-3">{title}</h3>
      {children}
    </section>
  );
}

export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useDevice();
  const stats = useOutputStats();
  const [host, setHost] = useState(d.host);
  const [presets, setPresets] = useState<WledPresets | null>(null);
  const [presetErr, setPresetErr] = useState<string | null>(null);
  const [psId, setPsId] = useState(1);
  const [psName, setPsName] = useState("Pixel art");

  useEffect(() => { if (open) setHost(d.host); }, [open, d.host]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const connect = async () => {
    d.set({ host: normalizeHost(host), mac: "" });
    await useDevice.getState().check();
  };

  const loadPresets = async () => {
    setPresetErr(null);
    try {
      const p = await new WledClient(d.host).presets();
      delete p["0"];
      setPresets(p);
      const used = Object.keys(p).map(Number);
      setPsId(Array.from({ length: 250 }, (_, i) => i + 1).find((i) => !used.includes(i)) ?? 1);
    } catch (e) { setPresetErr((e as Error).message); }
  };

  const savePreset = async () => {
    setPresetErr(null);
    try {
      await new WledClient(d.host).savePresetFrame(psId, psName, useOutputStats.getState().frame, d.segId);
      await loadPresets();
    } catch (e) { setPresetErr((e as Error).message); }
  };

  const https = location.protocol === "https:";
  const info = d.info;
  const matrixOk = !info?.leds.matrix || (info.leds.matrix.w === 16 && info.leds.matrix.h === 16);

  return (
    <div className={cx("fixed inset-0 z-50 transition", open ? "visible" : "invisible")} aria-hidden={!open}>
      <div className={cx("absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity", open ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <aside
        role="dialog"
        aria-label="Device settings"
        className={cx(
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">Device</h2>
          <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin">
          <Section title="WLED connection">
            {https && (
              <p className="mb-3 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">
                This page is served over HTTPS, so the browser will block requests to your ESP32 (http). Run the app locally (npm run dev) or over plain http.
              </p>
            )}
            <div className="flex gap-2">
              <input
                className="input font-mono"
                placeholder="192.168.1.100 or wled.local"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void connect()}
              />
              <Button variant="primary" onClick={connect} disabled={d.status === "checking"}>
                {d.status === "checking" ? "…" : "Connect"}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Badge tone={d.status === "online" ? "ok" : d.status === "offline" ? "err" : "default"}>
                {d.status === "online" ? "Online" : d.status === "offline" ? "Offline" : d.status === "checking" ? "Checking" : "Not set"}
              </Badge>
              {info && d.status === "online" && (
                <span className="truncate text-muted">
                  {info.name} · v{info.ver} · {info.leds.count} LEDs
                  {info.leds.matrix && ` · ${info.leds.matrix.w}×${info.leds.matrix.h}`}
                  {info.wifi?.signal !== undefined && ` · Wi-Fi ${info.wifi.signal}%`}
                </span>
              )}
            </div>
            <DeviceFinder autoStart={open && !d.host} />
            {d.status === "offline" && d.lastError && <p className="mt-1 text-xs text-err">{d.lastError} — same Wi-Fi? correct IP?</p>}
            {info && !matrixOk && (
              <p className="mt-2 text-xs text-warn">WLED reports a {info.leds.matrix!.w}×{info.leds.matrix!.h} matrix. Set it to 16×16 in WLED → Config → 2D.</p>
            )}
          </Section>

          <Section title="Light">
            <Toggle label="Power" checked={d.on} onChange={(on) => void d.setPower(on)} />
            <div className="mt-2">
              <Slider label="Brightness" value={d.bri} min={1} max={255} onChange={(bri) => void d.setBrightness(bri)} format={(v) => `${Math.round((v / 255) * 100)}%`} />
            </div>
          </Section>

          <Section title="Streaming">
            <Toggle
              label="Send to device"
              hint="Off = preview-only mode (great for designing without the panel)"
              checked={d.outputEnabled}
              onChange={(outputEnabled) => { d.set({ outputEnabled }); output.invalidate(); }}
            />
            <div className="mt-3">
              <Segmented<TransportKind>
                value={d.transport}
                onChange={(transport) => d.set({ transport, maxFps: TRANSPORT_INFO[transport].fps })}
                options={(Object.keys(TRANSPORT_INFO) as TransportKind[]).map((k) => ({ value: k, label: TRANSPORT_INFO[k].label }))}
              />
              <p className="mt-1.5 text-xs text-muted">{TRANSPORT_INFO[d.transport].hint}</p>
            </div>
            <div className="mt-3 space-y-3">
              <Slider label="Max frame rate" value={d.maxFps} min={1} max={60} onChange={(maxFps) => d.set({ maxFps })} format={(v) => `${v} fps`} />
              {d.transport === "bridge" && (
                <>
                  <Field label="Bridge URL" hint="Start it with: npm run bridge">
                    <input className="input font-mono" value={d.bridgeUrl} onChange={(e) => d.set({ bridgeUrl: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="UDP port"><input type="number" className="input font-mono" value={d.udpPort} onChange={(e) => d.set({ udpPort: Number(e.target.value) || 21324 })} /></Field>
                    <Field label="Timeout (s)"><input type="number" min={1} max={255} className="input font-mono" value={d.udpTimeout} onChange={(e) => d.set({ udpTimeout: Math.max(1, Math.min(255, Number(e.target.value) || 2)) })} /></Field>
                  </div>
                </>
              )}
              {d.transport === "http" && (
                <div>
                  <span className="label mb-1.5 block">Pixels per request</span>
                  <Segmented value={d.chunk} onChange={(chunk) => d.set({ chunk })} options={[{ value: 0, label: "All 256" }, { value: 128, label: "128" }, { value: 64, label: "64" }]} />
                  <p className="mt-1.5 text-xs text-muted">Lower this if an older ESP8266/ESP32 build drops large JSON payloads. After the first frame only changed pixels are sent.</p>
                </div>
              )}
              <Field label="WLED segment id">
                <input type="number" min={0} max={31} className="input w-24 font-mono" value={d.segId} onChange={(e) => d.set({ segId: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
            </div>
            <p className="mt-3 font-mono text-xs text-faint">
              {stats.sentFps ? `${stats.sentFps.toFixed(1)} fps sent` : "idle"}
              {stats.error && <span className="text-err"> · {stats.error}</span>}
            </p>
          </Section>

          <Section title="Panel wiring">
            <p className="mb-3 text-xs text-muted">
              If WLED's 2D matrix is set up (16×16, serpentine), keep “Rows”. Use the test pattern: red should be top-left and the arrow should point up.
            </p>
            <select
              className="input"
              value={d.layout.order}
              onChange={(e) => { d.setLayout({ order: e.target.value as WiringOrder }); output.invalidate(); }}
            >
              {WIRING.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-x-6">
              <Toggle label="Flip X" checked={d.layout.flipX} onChange={(flipX) => { d.setLayout({ flipX }); output.invalidate(); }} />
              <Toggle label="Flip Y" checked={d.layout.flipY} onChange={(flipY) => { d.setLayout({ flipY }); output.invalidate(); }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Segmented
                size="sm"
                value={d.layout.rotate}
                onChange={(rotate) => { d.setLayout({ rotate }); output.invalidate(); }}
                options={[0, 90, 180, 270].map((r) => ({ value: r as 0 | 90 | 180 | 270, label: `${r}°` }))}
              />
              <Button size="sm" onClick={() => showStatic(testPattern(), "Test pattern")}>Test pattern</Button>
            </div>
          </Section>

          <Section title="WLED presets">
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<RefreshCw size={14} />} onClick={loadPresets} disabled={!d.host}>Load presets</Button>
            </div>
            {presets && (
              <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line scroll-thin">
                {Object.entries(presets).length === 0 && <li className="p-2 text-xs text-muted">No presets saved yet.</li>}
                {Object.entries(presets).map(([id, p]) => (
                  <li key={id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm">
                    <span className="truncate"><span className="font-mono text-faint">{id}</span> {p.n || "Unnamed"}</span>
                    <span className="flex shrink-0">
                      <IconButton label="Apply preset" className="size-7" onClick={async () => { await new WledClient(d.host).loadPreset(Number(id)); output.invalidate(); }}>
                        <Play size={14} />
                      </IconButton>
                      <IconButton label="Delete preset" className="size-7 hover:!text-err" onClick={async () => { if (confirm(`Delete preset ${id}?`)) { await new WledClient(d.host).deletePreset(Number(id)); void loadPresets(); } }}>
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 rounded-lg border border-line p-3">
              <div className="flex gap-3">
                <div className="w-16 shrink-0"><MatrixCanvas frame={stats.frame} grid={false} /></div>
                <div className="grid flex-1 grid-cols-[64px_1fr] gap-2">
                  <input type="number" min={1} max={250} aria-label="Preset slot" className="input px-2 font-mono" value={psId} onChange={(e) => setPsId(Math.max(1, Math.min(250, Number(e.target.value) || 1)))} />
                  <input className="input" aria-label="Preset name" value={psName} onChange={(e) => setPsName(e.target.value)} />
                  <Button size="sm" className="col-span-2" icon={<Save size={14} />} disabled={!d.host} onClick={savePreset}>
                    Save what's on the matrix as preset
                  </Button>
                </div>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[11px] text-faint"><Download size={11} /> Stored on the ESP32 — works without this app (buttons, schedules, Home Assistant).</p>
            </div>
            {presetErr && <p className="mt-2 text-xs text-err">{presetErr}</p>}
          </Section>
        </div>
      </aside>
    </div>
  );
}
