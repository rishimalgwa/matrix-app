import { ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Badge, Button, ColorField, Field, Segmented, Slider, Toggle } from "@/components/ui";
import { useAnimatedFrame } from "@/hooks/useAnimatedFrame";
import { LED_ENHANCE, NO_ENHANCE } from "@/core/image";
import { redirectUri } from "./auth";
import { connectSpotify, disconnectSpotify, refreshSpotify, renderSpotifyFrame, rerenderCover } from "./service";
import { progressNow, useSpotify, type SpotifyFallback } from "./store";

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function SpotifyPanel() {
  const s = useSpotify();
  const frame = useAnimatedFrame(renderSpotifyFrame, 2);
  const [err, setErr] = useState<string | null>(null);
  const uri = redirectUri();
  const insecure = !window.isSecureContext || location.hostname === "localhost";

  // re-render cover when image settings change
  useEffect(() => { void rerenderCover(); }, [s.resample, s.adjust, s.colors, s.enhance]);

  if (!s.connected) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted marker:text-faint">
          <li>
            Open the{" "}
            <a className="inline-flex items-center gap-1 text-accent-2 hover:underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
              Spotify Developer Dashboard <ExternalLink size={12} />
            </a>{" "}
            and create an app (select “Web API”).
          </li>
          <li>
            Add this exact Redirect URI:
            <code className="mt-1 block select-all rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs text-fg">{uri}</code>
          </li>
          <li>Copy the app’s Client ID below and connect. No secret needed — it uses PKCE in the browser.</li>
        </ol>
        {insecure && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">
            Spotify only accepts loopback redirects as <b>http://127.0.0.1</b>, not “localhost”. Open the app at{" "}
            <a className="underline" href={`http://127.0.0.1:${location.port || 5173}/`}>http://127.0.0.1:{location.port || 5173}</a>.
          </p>
        )}
        <Field label="Client ID">
          <input className="input font-mono" value={s.clientId} placeholder="32-character client id" onChange={(e) => s.set({ clientId: e.target.value.trim() })} />
        </Field>
        <Button
          variant="spotify"
          disabled={s.clientId.length < 16}
          onClick={async () => { setErr(null); try { await connectSpotify(); } catch (e) { setErr((e as Error).message); } }}
        >
          Connect Spotify
        </Button>
        {(err || s.error) && <p className="text-xs text-err">{err ?? s.error}</p>}
      </div>
    );
  }

  const t = s.track;
  const art = t?.images[0]?.url;

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-4">
          {art ? (
            <img src={art} alt="" className="size-24 shrink-0 rounded-lg object-cover shadow-lg" />
          ) : (
            <div className="grid size-24 shrink-0 place-items-center rounded-lg bg-panel-3 text-xs text-faint">No cover</div>
          )}
          <div className="min-w-0 flex-1">
            {t ? (
              <>
                <Badge tone={t.isPlaying ? "ok" : "default"}>{t.isPlaying ? "Playing" : "Paused"}</Badge>
                <div className="mt-1 truncate font-semibold">{t.name}</div>
                <div className="truncate text-sm text-muted">{t.artists}</div>
                <div className="truncate text-xs text-faint">{t.album}</div>
                <Progress />
              </>
            ) : (
              <p className="text-sm text-muted">Nothing playing right now. Start a song in any Spotify app.</p>
            )}
          </div>
        </div>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle label="Auto-show cover" hint="Switch the matrix to the cover when a song starts" checked={s.autoShow} onChange={(autoShow) => s.set({ autoShow })} />
          <Toggle label="Progress bar" hint="Track progress on the bottom row" checked={s.showProgress} onChange={(showProgress) => s.set({ showProgress })} />
        </div>
        {s.showProgress && <ColorField label="Progress color" value={s.progressColor} onChange={(progressColor) => s.set({ progressColor })} />}
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <span className="label mb-1.5 block">Downsampling</span>
            <Segmented value={s.resample} onChange={(resample) => s.set({ resample })} options={[{ value: "sharp", label: "Sharp" }, { value: "smooth", label: "Smooth" }, { value: "nearest", label: "Nearest" }]} />
          </div>
          <div>
            <span className="label mb-1.5 block">Colors</span>
            <Segmented value={s.colors} onChange={(colors) => s.set({ colors })} options={[0, 32, 16, 8].map((v) => ({ value: v, label: v ? String(v) : "Full" }))} />
          </div>
          <div className="sm:col-span-2">
            <Toggle
              label="Enhance for LEDs"
              hint="Auto-levels, shadow lift and sharpening so covers read clearly on the panel"
              checked={s.enhance.autoLevels}
              onChange={(on) => s.set({ enhance: on ? { ...LED_ENHANCE, sharpen: 25 } : NO_ENHANCE })}
            />
          </div>
          <Slider label="Saturation" value={s.adjust.saturation} min={-100} max={100} onChange={(saturation) => s.set({ adjust: { ...s.adjust, saturation } })} />
          <Slider label="Contrast" value={s.adjust.contrast} min={-100} max={100} onChange={(contrast) => s.set({ adjust: { ...s.adjust, contrast } })} />
          <Slider label="Brightness" value={s.adjust.brightness} min={-100} max={100} onChange={(brightness) => s.set({ adjust: { ...s.adjust, brightness } })} />
          <Slider label="Check every" value={s.pollSeconds} min={1} max={15} onChange={(pollSeconds) => s.set({ pollSeconds })} format={(v) => `${v}s`} />
        </div>
        <div>
          <span className="label mb-1.5 block">When playback stops</span>
          <Segmented<SpotifyFallback>
            value={s.fallback}
            onChange={(fallback) => s.set({ fallback })}
            options={[{ value: "keep", label: "Keep cover" }, { value: "clock", label: "Show clock" }, { value: "off", label: "Turn off" }]}
          />
        </div>
        {s.error && <p className="text-xs text-err">{s.error}</p>}
      </div>

      <div>
        <div className="rounded-lg bg-black p-2">
          <MatrixCanvas frame={frame} look="led" grid={false} />
        </div>
        <LiveButton source="spotify" label="Show on matrix" className="mt-3" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="ghost" className="flex-1" icon={<RefreshCw size={14} />} onClick={() => void refreshSpotify()}>Refresh</Button>
          <Button size="sm" variant="ghost" className="flex-1" icon={<LogOut size={14} />} onClick={disconnectSpotify}>Disconnect</Button>
        </div>
      </div>
    </div>
  );
}

function Progress() {
  const t = useSpotify((s) => s.track);
  const [, force] = useState(0);
  useEffect(() => {
    const h = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);
  if (!t || !t.durationMs) return null;
  const p = progressNow();
  return (
    <div className="mt-2">
      <div className="h-1 overflow-hidden rounded-full bg-panel-3">
        <div className="h-full bg-spotify" style={{ width: `${(p / t.durationMs) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>{fmt(p)}</span>
        <span>{fmt(t.durationMs)}</span>
      </div>
    </div>
  );
}
