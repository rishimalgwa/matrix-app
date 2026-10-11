/**
 * Audio engine: owns the AudioContext/AnalyserNode and one band processor.
 * The Music tab preview and the live "music" source both subscribe to it, so
 * the analysis runs exactly once per tick.
 */
import { create } from "zustand";
import { BandProcessor, bandRanges } from "@/core/visualizer";
import { useMusic } from "@/store/music";

export type AudioInput = "mic" | "tab";

interface AudioStatus {
  running: boolean;
  input: AudioInput | null;
  error: string | null;
  level: number;
}

export const useAudioStatus = create<AudioStatus>(() => ({ running: false, input: null, error: null, level: 0 }));

type Listener = (levels: Float32Array, peaks: Float32Array) => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private freq = new Uint8Array(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  readonly bands = new BandProcessor();

  get running() {
    return !!this.ctx;
  }

  async start(input: AudioInput) {
    this.stop();
    try {
      let stream: MediaStream;
      if (input === "tab") {
        // Chrome/Edge: share a tab (e.g. Spotify Web Player) or the whole screen with "share audio" ticked
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) throw new Error("No audio shared — tick “Share tab audio” in the picker.");
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(analyser);
      stream.getAudioTracks()[0].addEventListener("ended", () => this.stop());

      this.ctx = ctx;
      this.analyser = analyser;
      this.stream = stream;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.timer = setInterval(() => this.tick(), 1000 / 40);
      useAudioStatus.setState({ running: true, input, error: null });
    } catch (e) {
      const msg = (e as Error).name === "NotAllowedError" ? "Permission denied" : (e as Error).message;
      useAudioStatus.setState({ running: false, input: null, error: msg });
      throw new Error(msg);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.bands.levels.fill(0);
    this.bands.peaks.fill(0);
    useAudioStatus.setState({ running: false, input: null, level: 0 });
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private tick() {
    if (!this.analyser || !this.ctx) return;
    const o = useMusic.getState().opts;
    this.analyser.getByteFrequencyData(this.freq);
    const ranges = bandRanges(this.analyser.fftSize, this.ctx.sampleRate, 16, o.minHz, o.maxHz);
    this.bands.update(this.freq, ranges, o);
    let sum = 0;
    for (const l of this.bands.levels) sum += l;
    useAudioStatus.setState({ level: sum / 16 });
    for (const fn of this.listeners) fn(this.bands.levels, this.bands.peaks);
  }
}

export const audio = new AudioEngine();
