import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CLOCK, type ClockOptions, type WeatherInfo } from "@/core/clock";
import { fetchWeather } from "@/services/weather";
import { safeStorage } from "./persist";

interface ClockState {
  opts: ClockOptions;
  weatherEnabled: boolean;
  fahrenheit: boolean;
  place: { name: string; lat: number; lon: number } | null;
  weather: WeatherInfo | null;
  weatherError: string | null;
  set: (p: Partial<ClockOptions>) => void;
  setWeather: (p: Partial<Pick<ClockState, "weatherEnabled" | "fahrenheit" | "place">>) => void;
  refreshWeather: () => Promise<void>;
}

export const useClock = create<ClockState>()(
  persist(
    (set, get) => ({
      opts: DEFAULT_CLOCK,
      weatherEnabled: false,
      fahrenheit: false,
      place: null,
      weather: null,
      weatherError: null,
      set: (p) => set({ opts: { ...get().opts, ...p } }),
      setWeather: (p) => set(p),
      refreshWeather: async () => {
        const { place, weatherEnabled } = get();
        if (!weatherEnabled || !place) return;
        try {
          set({ weather: await fetchWeather(place.lat, place.lon), weatherError: null });
        } catch (e) {
          set({ weatherError: (e as Error).message });
        }
      },
    }),
    {
      name: "pm.clock",
      storage: safeStorage,
      partialize: (s) => ({ opts: s.opts, weatherEnabled: s.weatherEnabled, fahrenheit: s.fahrenheit, place: s.place, weather: s.weather }),
      merge: (p, c) => ({ ...c, ...(p as object), opts: { ...DEFAULT_CLOCK, ...((p as Partial<ClockState>)?.opts ?? {}) } }),
    }
  )
);

/** Weather in the unit the user picked (renderer just prints the number). */
export function displayWeather(): WeatherInfo | null {
  const { weather, weatherEnabled, fahrenheit } = useClock.getState();
  if (!weatherEnabled || !weather) return null;
  return fahrenheit ? { ...weather, tempC: weather.tempC * 1.8 + 32 } : weather;
}
