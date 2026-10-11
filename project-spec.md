Here is the comprehensive specification document and prompt ready to copy-paste directly into Claude Code.

---

### Copy the Prompt Below into Claude Code

```markdown
# MISSION & PROJECT SPECIFICATION: DIY Pixel Art Matrix Web Controller (WLED 16x16)

## 1. Project Overview & Objective
We are building a clean, modern, zero-backend Progressive Web App (PWA) to control a custom DIY 16x16 RGB LED Matrix running **WLED firmware on an ESP32**.

The app replicates the full software feature set of commercial pixel art displays (such as the Apex Pixel Display / Divoom Pixoo):
- Interactive pixel-by-pixel canvas
- Multi-frame frame-by-frame animation studio
- Photo & Animated GIF to 16x16 converter
- Live Scrolling Text Marquee
- Sound Visualizer / Music Equalizer mode
- Digital Clock & Smart HUD widgets
- Direct local-network sync to WLED via JSON HTTP API and UDP live streaming

---

## 2. Hardware Context & Constraints
- **Controller:** ESP32 running standard WLED firmware (v0.14+ / v0.15+) connected to local 2.4GHz Wi-Fi.
- **Display:** WS2812B 16x16 flexible RGB LED panel (256 addressable LEDs total).
- **Physical Layout:** Configured in WLED as 2D Matrix (16 width x 16 height), serpentine layout.
- **Communication Protocols:**
  1. **HTTP JSON API:** `POST http://<ESP32_IP>/json/state` with payload:
     `{"on": true, "bri": 128, "seg": {"i": [index, "RRGGBB", index, "RRGGBB", ...]}}`
     (Used for static frames, clock updates, and preset saving).
  2. **Real-time UDP Stream (WARLS/DRGB):** Target port `21324` on ESP32.
     Format for DRGB (protocol byte 2):
     `[2, timeout_in_sec, r0, g0, b0, r1, g1, b1, ..., r255, g255, b255]`
     (Can be triggered via local Node/Electron bridge or optimized high-frequency JSON chunking in pure browser).

---

## 3. Comprehensive Feature List to Implement

### Module A: Pixel-by-Pixel Editor
- 16x16 interactive grid with smooth desktop mouse click-and-drag and mobile touch support.
- Color Picker with recent color history, custom palette presets, and eye-dropper tool.
- Drawing Tools: Pencil, Eraser, Paint Bucket (flood fill), and Clear Canvas.
- Grid overlay toggle and coordinate HUD.

### Module B: Animation Studio & GIF Engine
- Multi-frame timeline: Add frame, Duplicate frame, Delete frame, Reorder.
- Play/Pause preview with variable FPS controller (1 FPS to 24 FPS).
- Onion skinning (ghosting previous frame for easier animation drawing).
- GIF Import: Parse uploaded `.gif` files frame-by-frame, downsample each frame to 16x16, quantize colors, and populate the animation timeline.
- Frame export/import as JSON and animated GIF download.

### Module C: Media Converter (Photo to Pixel Art)
- Upload any image format (`.png`, `.jpg`, `.webp`).
- Processing Pipeline:
  - Interactive crop tool (1:1 square aspect ratio).
  - Downsampling to 16x16 using nearest-neighbor or bicubic interpolation.
  - Contrast, Brightness, and Saturation tuning sliders before pushing to the matrix.
  - Color palette quantization (e.g., limit to 16 or 32 colors for authentic retro look).

### Module D: Scrolling Message Board (Text Ticker)
- Text input field with character limit.
- 5x7 or 3x5 monospaced retro bitmap font generator.
- Text color and background color controls.
- Speed slider and scroll direction (Left-to-Right, Right-to-Left).
- Preview simulator showing the marquee running on the 16x16 virtual grid before pushing.

### Module E: Digital Clock & Information HUD
- Modern retro clock rendering (HH:MM or HH:MM:SS) that fits the 16x16 grid.
- Dynamic color themes (Cyberpunk, Amber CRT, Matrix Green, Pastel).
- Toggle 12h/24h format.
- Optional display of local date or weather icons.

### Module F: Music Mode (Audio Visualizer)
- Browser-based microphone input via the HTML5 Web Audio API (`AudioContext`, `AnalyserNode`).
- Real-time Fast Fourier Transform (FFT) analysis grouped into 16 frequency bands.
- Maps the 16 frequency bands to the 16 vertical columns of the display.
- Visualizer styles: Equalizer bar graph, Center-split spectrum, Peak-decay vu-meter.
- Real-time push stream to the WLED matrix.

### Module G: WLED Integration & Device Manager
- ESP32 IP address management with `localStorage` persistence.
- Connection status indicator (Ping / Heartbeat via `/json/info`).
- Brightness slider (`bri`: 0 to 255) and Power toggle (`on`: true/false).
- Direct preset saving to WLED storage.

---

## 4. Recommended Tech Stack & Architecture
- **Framework:** Next.js (App Router) or Vite + React with TypeScript.
- **Styling:** Tailwind CSS + Radix UI / Lucide React icons (dark retro dashboard aesthetic).
- **Image/GIF Processing:** `omggif` or `gifuct-js` for client-side GIF decoding.
- **Audio Processing:** Native Web Audio API (`AnalyserNode`).
- **State Management:** Zustand or React Context for canvas state, frame timeline, and active tool.

---

## 5. Execution Instructions for Claude Code
Please structure the application as follows:
1. Initialize a clean TypeScript project with Tailwind CSS.
2. Build the core Canvas and Matrix coordinate engine (`src/components/Canvas`, `src/utils/matrix.ts`).
3. Implement the WLED API Client (`src/services/wled.ts`) supporting the JSON API and payload builders.
4. Add the Animation Timeline and GIF parser.
5. Add the Media Converter and Scrolling Text Generator.
6. Add the Web Audio Visualizer and Clock Engine.
7. Wrap everything in a responsive, mobile-friendly dark UI with tabbed views for **Draw**, **Animate**, **Import**, **Clock/Text**, and **Music**.

```