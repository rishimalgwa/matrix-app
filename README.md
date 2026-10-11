# Pixel Matrix

A pixel art studio and live controller for a DIY **16×16 WS2812B matrix running WLED** on an ESP32.
It runs fully in the browser with no backend, and it's installable as a PWA.

| Tab | What it does |
| --- | --- |
| **Draw** | Pencil, eraser, bucket fill, eyedropper, line and rectangle tools, mirror mode, undo/redo, flip/rotate/shift, palettes and recent colors, live draw, and a local library |
| **Animate** | Frame timeline (add, duplicate, delete, drag to reorder), onion skin, 1–24 fps preview, play on the matrix, GIF/JSON export, JSON import |
| **Import** | Photos and animated GIFs: a 1:1 crop box, smooth or nearest downsampling, brightness/contrast/saturation, and 32/16/8/4-color quantization |
| **Clock/Text** | Five clock layouts (compact, big, seconds ring, seconds, analog), six themes, 12/24h, date/day/weather info line. A scrolling ticker with 5×7 and 3×5 fonts, solid/gradient/rainbow color, speed and direction |
| **Music** | Microphone or tab-audio FFT split into 16 log-spaced bands, with peak VU, equalizer, center split, dots and radial styles |
| **Connect** | Spotify: shows the cover of whatever is playing, switches automatically when the song changes, and draws a progress bar |
| Device sheet | WLED IP, status heartbeat, power and brightness, transport choice, panel wiring/orientation, a test pattern, and WLED presets (load, save, delete) |

## Run it

```bash
npm install
npm run dev          # → http://127.0.0.1:5173
```

Open the app on a computer or phone that's **on the same Wi-Fi as the ESP32**.
On first launch it **finds WLED devices automatically**, like the official WLED app does. If it finds exactly one, it connects to it.
To use the app from your phone, open the "Network" URL that `npm run dev` prints, e.g. `http://192.168.1.20:5173`.

### How auto-discovery works

Browsers can't do mDNS or find out the machine's own IP, so there are two layers:

1. **Dev/preview server** (`server/discovery.ts`, served at `/api/discover`): browses Bonjour/mDNS for `_wled._tcp` and sweeps every local /24 subnet for `/json/info`. This takes about 3–4 seconds.
2. **Browser fallback**, used when the app is hosted as plain static files: it tries `wled.local`, then sweeps common home-router subnets (`192.168.1.x`, `192.168.0.x`, `192.168.29.x`, …) directly from the browser.

The device's MAC address is saved. If the router later gives the ESP32 a new IP, the app notices it's offline, finds the same MAC again and switches over.

> **Run it over plain http.** If the page is served over https, the browser blocks requests to `http://<esp32>`.
> `npm run build && npm run preview` serves a production build on your LAN-facing machine.

### No hardware yet?

```bash
npm run mock         # fake WLED on 127.0.0.1:8080, draws the matrix in your terminal
HOST=0.0.0.0 PORT=80 npm run mock   # discoverable on your LAN, advertised over mDNS
```

Use `127.0.0.1:8080` as the device IP.

## WLED setup

1. WLED → Config → LED Preferences: 256 LEDs.
2. WLED → Config → 2D Configuration: Matrix, 1 panel, 16×16, serpentine to match your wiring.
3. In the app, keep **Panel wiring → Rows** and press **Test pattern**. Red should appear top-left and the arrow should point up. If it doesn't, use Flip X/Y or Rotate.
   If you skipped WLED's 2D setup, choose "Serpentine rows" in the app instead.

## Transports

| Transport | How | Typical fps | Use for |
| --- | --- | --- | --- |
| HTTP JSON | `POST /json/state` with `seg.i` | ~12 | static art, clock |
| WebSocket | `ws://<ip>/ws`, same JSON | ~25 | animations, ticker, music |
| UDP Bridge | `npm run bridge`, then DRGB UDP on :21324 | 40+ | music, smooth video-like animation |

After the first frame, the HTTP and WebSocket transports send **only the pixels that changed**, using `[start, "RRGGBB", …]` runs.
A clock tick usually costs a few dozen bytes.

## Spotify

1. Create an app at <https://developer.spotify.com/dashboard> and select "Web API".
2. Add the redirect URI shown in the Connect tab. It's exactly `http://127.0.0.1:5173/` when you run `npm run dev`.
   Spotify rejects `localhost`, so open the app at **127.0.0.1**.
3. Paste the Client ID and click Connect. Login uses PKCE, so no client secret or server is involved.

With **Auto-show cover** on, the matrix switches to the album art whenever a new song starts.
You can choose what happens when playback stops: keep the cover, show the clock, or turn off.

> Spotify apps in "development mode" only work for users you add under the app's *User Management*. Add your own account.

## Architecture

```
src/
  core/          pure logic, no React: matrix math, color, image pipeline, GIF, fonts, clock, ticker, visualizer
  services/      I/O: WLED client, transports (http/ws/bridge), audio engine, weather
  engine/
    output.ts    the one path to the hardware: coalesce → fps cap → wiring map → transport
    sources.ts   live sources; only one is "on air" at a time and it keeps running across tabs
  store/         zustand stores (persisted to localStorage)
  integrations/  outside services (Spotify); each one registers sources and a panel
  features/      one folder per tab
  components/    MatrixCanvas, UI primitives
server/          Vite plugin: /api/discover (mDNS + subnet scan)
bridge/          Node websocket → UDP bridge
dev/             mock WLED device
```

Everything is a **Frame**: a flat, row-major `number[]` of `0xRRGGBB` colors.

### Adding a new mode or integration

Anything that produces frames over time is a `FrameSource`:

```ts
registerSource({
  id: "stocks",
  label: "Stock ticker",
  start(emit) {
    const h = setInterval(() => emit(renderSomething()), 1000);
    return () => clearInterval(h);
  },
});
// anywhere: goLive("stocks")
```

For an outside service, add an entry to `src/integrations/index.tsx` with an `init()` for background polling and a settings `Panel`.
It then appears in the Connect tab automatically.
Spotify is the reference implementation: `src/integrations/spotify/`.

Ideas that fit this model: YouTube Music or Apple Music through a desktop bridge, Home Assistant notifications, calendar countdowns, Discord/Slack pings, game stats, or a multi-panel 32×32 build (change `W`/`H` in `core/matrix.ts`).

The original single-file prototype is kept in `legacy/index.html`.
