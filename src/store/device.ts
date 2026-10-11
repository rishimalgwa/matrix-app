import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LAYOUT, type Layout } from "@/core/matrix";
import type { TransportKind } from "@/services/transports";
import { findByMac } from "@/services/discovery";
import { WledClient, type WledInfo } from "@/services/wled";
import { safeStorage } from "./persist";

export type ConnStatus = "unknown" | "checking" | "online" | "offline";

interface DeviceSettings {
  host: string;
  /** remembered so the device can be re-found if its IP changes */
  mac: string;
  segId: number;
  transport: TransportKind;
  bridgeUrl: string;
  udpPort: number;
  udpTimeout: number;
  /** 0 = send whole frame in one request */
  chunk: number;
  maxFps: number;
  layout: Layout;
  /** when false the app runs in preview-only mode */
  outputEnabled: boolean;
  bri: number;
  on: boolean;
}

interface DeviceState extends DeviceSettings {
  status: ConnStatus;
  info: WledInfo | null;
  lastError: string | null;
  set: (p: Partial<DeviceSettings>) => void;
  setLayout: (p: Partial<Layout>) => void;
  check: () => Promise<boolean>;
  setPower: (on: boolean) => Promise<void>;
  setBrightness: (bri: number) => Promise<void>;
}

export const useDevice = create<DeviceState>()(
  persist(
    (set, get) => ({
      host: localStorageLegacyIp(),
      mac: "",
      segId: 0,
      transport: "http",
      bridgeUrl: "ws://127.0.0.1:8787",
      udpPort: 21324,
      udpTimeout: 2,
      chunk: 0,
      maxFps: 12,
      layout: DEFAULT_LAYOUT,
      outputEnabled: true,
      bri: 128,
      on: true,

      status: "unknown",
      info: null,
      lastError: null,

      set: (p) => set(p),
      setLayout: (p) => set({ layout: { ...get().layout, ...p } }),

      check: async () => {
        const { host } = get();
        if (!host) { set({ status: "unknown", info: null }); return false; }
        if (get().status !== "online") set({ status: "checking" });
        try {
          const client = new WledClient(host);
          const [info, state] = await Promise.all([client.info(), client.state()]);
          set({ status: "online", info, lastError: null, on: state.on, bri: state.bri, mac: info.mac ?? get().mac });
          failures = 0;
          return true;
        } catch (e) {
          set({ status: "offline", lastError: (e as Error).message });
          failures++;
          void relocate();
          return false;
        }
      },

      setPower: async (on) => {
        set({ on });
        const { host } = get();
        if (!host) return;
        try { await new WledClient(host).setPower(on); }
        catch (e) { set({ lastError: (e as Error).message }); }
      },

      setBrightness: async (bri) => {
        set({ bri });
        const { host } = get();
        if (!host) return;
        try { await new WledClient(host).setBrightness(bri); }
        catch (e) { set({ lastError: (e as Error).message }); }
      },
    }),
    {
      name: "pm.device",
      storage: safeStorage,
      partialize: (s) => ({
        host: s.host, mac: s.mac, segId: s.segId, transport: s.transport, bridgeUrl: s.bridgeUrl,
        udpPort: s.udpPort, udpTimeout: s.udpTimeout, chunk: s.chunk, maxFps: s.maxFps,
        layout: s.layout, outputEnabled: s.outputEnabled, bri: s.bri,
      }),
    }
  )
);

let failures = 0;
let lastRelocate = 0;

/**
 * Like the WLED app: if the saved device stops answering (router handed it a
 * new IP), quietly search the network for the same MAC and switch to it.
 */
async function relocate() {
  const { mac, host } = useDevice.getState();
  if (!mac || failures < 2 || Date.now() - lastRelocate < 120_000) return;
  lastRelocate = Date.now();
  const found = await findByMac(mac, host);
  if (found && found.host !== useDevice.getState().host) {
    useDevice.setState({ host: found.host });
    await useDevice.getState().check();
  }
}

/** Picks up the IP saved by the original single-file prototype. */
function localStorageLegacyIp() {
  try { return localStorage.getItem("wled_ip") ?? ""; } catch { return ""; }
}
