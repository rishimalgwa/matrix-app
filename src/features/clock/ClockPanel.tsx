import { LocateFixed, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { CLOCK_THEMES, renderClock, type ClockLayout, type InfoLine } from "@/core/clock";
import { toCss } from "@/core/color";
import { LiveButton } from "@/components/LiveButton";
import { MatrixCanvas } from "@/components/MatrixCanvas";
import { Button, cx, Panel, Segmented, Toggle } from "@/components/ui";
import { useAnimatedFrame } from "@/hooks/useAnimatedFrame";
import { browserLocation, geocode } from "@/services/weather";
import { displayWeather, useClock } from "@/store/clock";

const LAYOUTS: { id: ClockLayout; name: string }[] = [
  { id: "compact", name: "Compact" },
  { id: "stacked", name: "Big" },
  { id: "ring", name: "Ring" },
  { id: "seconds", name: "Seconds" },
  { id: "analog", name: "Analog" },
];

const SAMPLE = new Date(2026, 9, 11, 10, 42, 27, 100);

export function ClockPanel() {
  const { opts, set, weatherEnabled, fahrenheit, place, weather, weatherError, setWeather, refreshWeather } = useClock();
  const frame = useAnimatedFrame(() => renderClock(new Date(), useClock.getState().opts, displayWeather()), 8);
  const [query, setQuery] = useState("");
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setGeoBusy(true);
    setGeoErr(null);
    try {
      const r = await geocode(query.trim());
      if (!r) throw new Error("Place not found");
      setWeather({ place: { name: [r.name, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude }, weatherEnabled: true });
      await refreshWeather();
    } catch (e) { setGeoErr((e as Error).message); }
    finally { setGeoBusy(false); }
  };

  const locate = async () => {
    setGeoBusy(true);
    setGeoErr(null);
    try {
      const { lat, lon } = await browserLocation();
      setWeather({ place: { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon }, weatherEnabled: true });
      await refreshWeather();
    } catch (e) { setGeoErr((e as Error).message); }
    finally { setGeoBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Layout">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => set({ layout: l.id })}
                aria-pressed={opts.layout === l.id}
                className={cx(
                  "rounded-lg border-2 bg-bg p-1.5 text-xs transition",
                  opts.layout === l.id ? "border-accent-2 text-fg" : "border-line text-muted hover:border-line-strong"
                )}
              >
                <MatrixCanvas frame={renderClock(SAMPLE, { ...opts, layout: l.id, blinkColon: false }, displayWeather())} grid={false} />
                <span className="mt-1 block">{l.name}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Theme">
          <div className="flex flex-wrap gap-2">
            {CLOCK_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => set({ themeId: t.id })}
                aria-pressed={opts.themeId === t.id}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition",
                  opts.themeId === t.id ? "border-accent-2 bg-accent-2/10" : "border-line hover:border-line-strong"
                )}
                style={{ background: opts.themeId === t.id ? undefined : toCss(t.bg) }}
              >
                <span className="flex -space-x-1">
                  {(t.id === "rainbow" ? [0xff0000, 0x00ff00, 0x0000ff] : [t.primary, t.secondary, t.accent]).map((c, i) => (
                    <span key={i} className="size-3.5 rounded-full border border-black/40" style={{ background: toCss(c) }} />
                  ))}
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Options">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Toggle label="12-hour format" checked={opts.hour12} onChange={(hour12) => set({ hour12 })} />
            <Toggle label="Show seconds" checked={opts.showSeconds} onChange={(showSeconds) => set({ showSeconds })} />
            <Toggle label="Blinking colon" checked={opts.blinkColon} onChange={(blinkColon) => set({ blinkColon })} />
            <Toggle label="Leading zero" checked={opts.leadingZero} onChange={(leadingZero) => set({ leadingZero })} />
          </div>
          <div className="mt-3">
            <span className="label mb-1.5 block">Info line (compact layout)</span>
            <Segmented<InfoLine>
              value={opts.info}
              onChange={(info) => set({ info })}
              options={[
                { value: "none", label: "None" },
                { value: "date", label: "Date" },
                { value: "weekday", label: "Day" },
                { value: "weather", label: "Weather" },
                { value: "cycle", label: "Rotate" },
              ]}
            />
          </div>
        </Panel>

        <Panel
          title="Weather"
          actions={weatherEnabled && place && (
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void refreshWeather()}>Refresh</Button>
          )}
        >
          <Toggle label="Show weather" hint="Free data from Open-Meteo, no API key needed" checked={weatherEnabled} onChange={(v) => { setWeather({ weatherEnabled: v }); if (v) void refreshWeather(); }} />
          {weatherEnabled && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="City, e.g. Mumbai"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                />
                <Button disabled={geoBusy} onClick={search} icon={<Search size={14} />} aria-label="Search city" />
                <Button disabled={geoBusy} onClick={locate} icon={<LocateFixed size={14} />} aria-label="Use my location" title="Use my location" />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  {place ? place.name : "No location set"}
                  {weather && place && (
                    <span className="ml-2 text-fg">
                      {Math.round(fahrenheit ? weather.tempC * 1.8 + 32 : weather.tempC)}°{fahrenheit ? "F" : "C"} · {weather.kind}
                    </span>
                  )}
                </span>
                <Segmented size="sm" value={fahrenheit ? "f" : "c"} onChange={(v) => setWeather({ fahrenheit: v === "f" })} options={[{ value: "c", label: "°C" }, { value: "f", label: "°F" }]} />
              </div>
              {(geoErr || weatherError) && <p className="text-xs text-err">{geoErr ?? weatherError}</p>}
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Preview">
          <div className="rounded-lg bg-black p-2">
            <MatrixCanvas frame={frame} look="led" grid={false} />
          </div>
          <LiveButton source="clock" label="Show clock on matrix" className="mt-3" />
          <p className="mt-2 text-xs text-muted">The clock keeps running on the matrix while you use other tabs.</p>
        </Panel>
      </div>
    </div>
  );
}
