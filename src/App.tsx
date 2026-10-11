import { AudioLines, Clapperboard, Clock, ImageDown, Pencil, Plug } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Header } from "@/components/Header";
import { cx } from "@/components/ui";
import { useLiveSync } from "@/engine/useLiveSync";
import { AnimateView } from "@/features/animate/AnimateView";
import { ConnectView } from "@/features/connect/ConnectView";
import { DeviceSheet } from "@/features/device/DeviceSheet";
import { DrawView } from "@/features/draw/DrawView";
import { ImportView } from "@/features/import/ImportView";
import { MusicView } from "@/features/music/MusicView";
import { TextClockView } from "@/features/text/TextClockView";
import { useClock } from "@/store/clock";
import { useDevice } from "@/store/device";

type TabId = "draw" | "animate" | "import" | "clock" | "music" | "connect";

const TABS: { id: TabId; label: string; icon: ReactNode; view: () => ReactNode }[] = [
  { id: "draw", label: "Draw", icon: <Pencil size={18} />, view: () => <DrawView /> },
  { id: "animate", label: "Animate", icon: <Clapperboard size={18} />, view: () => <AnimateView /> },
  { id: "import", label: "Import", icon: <ImageDown size={18} />, view: () => <ImportView /> },
  { id: "clock", label: "Clock/Text", icon: <Clock size={18} />, view: () => <TextClockView /> },
  { id: "music", label: "Music", icon: <AudioLines size={18} />, view: () => <MusicView /> },
  { id: "connect", label: "Connect", icon: <Plug size={18} />, view: () => <ConnectView /> },
];

const tabFromHash = (): TabId => {
  const h = location.hash.slice(1) as TabId;
  return TABS.some((t) => t.id === h) ? h : "draw";
};

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const host = useDevice((s) => s.host);
  useLiveSync();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // heartbeat
  useEffect(() => {
    if (!host) return;
    void useDevice.getState().check();
    const h = setInterval(() => void useDevice.getState().check(), 10_000);
    return () => clearInterval(h);
  }, [host]);

  // weather refresh every 15 min
  useEffect(() => {
    void useClock.getState().refreshWeather();
    const h = setInterval(() => void useClock.getState().refreshWeather(), 15 * 60_000);
    return () => clearInterval(h);
  }, []);

  // first run: open device settings
  useEffect(() => { if (!useDevice.getState().host) setDeviceOpen(true); }, []);

  const go = (id: TabId) => { history.replaceState(null, "", `#${id}`); setTab(id); };
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-full pb-20 md:pb-8">
      <Header onDevice={() => setDeviceOpen(true)} />

      <nav className="sticky top-[57px] z-30 hidden border-b border-line bg-bg/85 backdrop-blur-md md:block" aria-label="Modes">
        <div className="mx-auto flex max-w-[1400px] gap-1 px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cx(
                "relative flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition",
                tab === t.id ? "text-fg" : "text-muted hover:text-fg"
              )}
            >
              {t.icon}
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-[1400px] px-4 py-4 md:py-6">{active.view()}</main>

      {/* mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Modes"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cx("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", tab === t.id ? "text-accent" : "text-muted")}
          >
            {t.icon}
            <span className="max-w-full truncate px-0.5">{t.label}</span>
          </button>
        ))}
      </nav>

      <DeviceSheet open={deviceOpen} onClose={() => setDeviceOpen(false)} />
    </div>
  );
}
