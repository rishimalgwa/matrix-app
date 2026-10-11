/** Weather via Open-Meteo (free, no API key, CORS-enabled). */
import { wmoToKind, type WeatherInfo } from "@/core/clock";

export interface GeoResult { name: string; country?: string; latitude: number; longitude: number }

export async function geocode(query: string): Promise<GeoResult | null> {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  return data.results?.[0] ?? null;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherInfo> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed");
  const { current } = await res.json();
  return {
    tempC: current.temperature_2m,
    kind: wmoToKind(current.weather_code),
    isDay: !!current.is_day,
    updated: Date.now(),
  };
}

export const browserLocation = () =>
  new Promise<{ lat: number; lon: number }>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.message)),
      { timeout: 10000 }
    );
  });
