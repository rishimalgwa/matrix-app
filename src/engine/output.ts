/**
 * Output engine: the single path from "a frame the app wants to show" to the
 * physical matrix. It coalesces frames (latest wins), caps fps, applies the
 * wiring layout and delegates to the selected transport.
 */
import { create } from "zustand";
import { blankFrame, framesEqual, toPhysical, type Frame } from "@/core/matrix";
import { createTransport, type Transport } from "@/services/transports";
import { useDevice } from "@/store/device";

interface OutputStats {
  /** logical frame currently on the matrix (or that would be, in preview mode) */
  frame: Frame;
  sentFps: number;
  error: string | null;
  sending: boolean;
}

export const useOutputStats = create<OutputStats>(() => ({
  frame: blankFrame(),
  sentFps: 0,
  error: null,
  sending: false,
}));

class OutputEngine {
  private transport: Transport | null = null;
  private transportKey = "";
  private pending: Frame | null = null;
  private pendingWake = false;
  private inflight = false;
  private lastSent: Frame | null = null;
  private lastAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sentTimes: number[] = [];

  constructor() {
    // rebuild the transport whenever connection settings change
    useDevice.subscribe((s) => {
      const key = [s.transport, s.host, s.segId, s.chunk, s.bridgeUrl, s.udpPort, s.udpTimeout].join("|");
      if (key !== this.transportKey) this.resetTransport();
    });
  }

  private resetTransport() {
    this.transport?.close();
    this.transport = null;
    this.transportKey = "";
    this.lastSent = null;
  }

  private getTransport(): Transport | null {
    const s = useDevice.getState();
    if (!s.host) return null;
    const key = [s.transport, s.host, s.segId, s.chunk, s.bridgeUrl, s.udpPort, s.udpTimeout].join("|");
    if (!this.transport || key !== this.transportKey) {
      this.transport?.close();
      this.transport = createTransport(s.transport, {
        host: s.host, segId: s.segId, chunk: s.chunk, bridgeUrl: s.bridgeUrl, udpPort: s.udpPort, udpTimeout: s.udpTimeout,
      });
      this.transportKey = key;
    }
    return this.transport;
  }

  /** Queue a frame. `wake` turns the light on and forces a full resend. */
  push(frame: Frame, wake = false) {
    useOutputStats.setState({ frame });
    if (!wake && this.pending === null && this.lastSent && framesEqual(frame, this.lastSent)) return;
    this.pending = frame;
    this.pendingWake ||= wake;
    this.pump();
  }

  /** Forces the next frame to be sent in full (e.g. after loading a WLED preset). */
  invalidate() {
    this.lastSent = null;
    this.transport?.invalidate();
  }

  private pump() {
    if (this.inflight || !this.pending || this.timer) return;
    const { maxFps } = useDevice.getState();
    const wait = this.lastAt + 1000 / Math.max(1, maxFps) - performance.now();
    if (wait > 0) {
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
      return;
    }
    void this.flush();
  }

  private async flush() {
    const frame = this.pending!;
    const wake = this.pendingWake;
    this.pending = null;
    this.pendingWake = false;

    const dev = useDevice.getState();
    const transport = dev.outputEnabled ? this.getTransport() : null;
    if (!transport) { this.lastSent = frame; return; }

    this.inflight = true;
    this.lastAt = performance.now();
    if (wake) transport.invalidate();
    try {
      await transport.send(toPhysical(frame, dev.layout), { wake });
      this.lastSent = frame;
      const now = performance.now();
      this.sentTimes = this.sentTimes.filter((t) => now - t < 2000);
      this.sentTimes.push(now);
      useOutputStats.setState({ error: null, sentFps: this.sentTimes.length / 2 });
      if (wake && !dev.on) useDevice.setState({ on: true });
      if (dev.status !== "online") useDevice.setState({ status: "online" });
    } catch (e) {
      this.lastSent = null;
      useOutputStats.setState({ error: (e as Error).message, sentFps: 0 });
      useDevice.setState({ status: "offline", lastError: (e as Error).message });
      // back off a little so a dead device doesn't spin the CPU
      this.lastAt = performance.now() + 1000;
    } finally {
      this.inflight = false;
      this.pump();
    }
  }
}

export const output = new OutputEngine();
