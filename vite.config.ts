import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { wledDiscovery } from "./server/discovery";

// host: true → reachable from phones on the same Wi-Fi (http://<computer-ip>:5173).
// Open it as http://127.0.0.1:5173 on the computer itself — Spotify only accepts
// loopback IP redirect URIs over plain http.
export default defineConfig({
  plugins: [react(), tailwindcss(), wledDiscovery()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173 },
});
