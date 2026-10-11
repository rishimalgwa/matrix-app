/** Registers every built-in live source. Integrations register their own. */
import { renderClock } from "@/core/clock";
import { renderTicker, tickerStrip } from "@/core/ticker";
import { renderVisualizer } from "@/core/visualizer";
import { audio } from "@/services/audio";
import { displayWeather, useClock } from "@/store/clock";
import { useEditor } from "@/store/editor";
import type { Artwork } from "@/store/library";
import { useMusic } from "@/store/music";
import { useText } from "@/store/text";
import type { Frame } from "@/core/matrix";
import { goLive, intervalSource, registerSource, type FrameSource } from "./sources";

/** Plays a list of frames at a (possibly changing) fps. */
function playback(id: string, label: string, get: () => { frames: Frame[]; fps: number }): FrameSource {
  return {
    id,
    label,
    start(emit) {
      let i = 0;
      let timer: ReturnType<typeof setTimeout>;
      const step = () => {
        const { frames, fps } = get();
        if (!frames.length) return;
        i %= frames.length;
        emit(frames[i]);
        i++;
        timer = setTimeout(step, 1000 / Math.max(1, fps));
      };
      step();
      return () => clearTimeout(timer);
    },
  };
}

let artwork: Artwork | null = null;

/** Plays a saved artwork from the library on the matrix. */
export function playArtwork(a: Artwork) {
  artwork = a;
  const src = playback("artwork", a.name, () => ({ frames: artwork?.frames ?? [], fps: artwork?.fps ?? 8 }));
  registerSource(src);
  return goLive("artwork");
}

export function registerBuiltInSources() {
  registerSource(intervalSource("clock", "Clock", 8, () => renderClock(new Date(), useClock.getState().opts, displayWeather())));

  let cachedKey = "";
  let strip: number[] = [];
  registerSource(
    intervalSource("ticker", "Scrolling text", 30, (t) => {
      const o = useText.getState().opts;
      const key = `${o.text}|${o.fontId}|${o.spacing}`;
      if (key !== cachedKey) { cachedKey = key; strip = tickerStrip(o); }
      return renderTicker(t, o, strip);
    })
  );

  registerSource(playback("animation", "Animation", () => useEditor.getState()));

  registerSource({
    id: "music",
    label: "Music visualizer",
    async start(emit) {
      if (!audio.running) await audio.start(useMusic.getState().input);
      const t0 = performance.now();
      return audio.subscribe((levels, peaks) =>
        emit(renderVisualizer(levels, peaks, useMusic.getState().opts, (performance.now() - t0) / 1000))
      );
    },
  });

}
