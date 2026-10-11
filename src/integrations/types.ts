import type { ComponentType, ReactNode } from "react";

/**
 * An integration connects an outside service to the matrix (Spotify, weather,
 * Home Assistant, calendars, notifications...). It typically:
 *   1. keeps its own zustand store,
 *   2. registers one or more live sources with `registerSource`,
 *   3. may run an app-wide background task from `init` (polling, sockets),
 *   4. renders a settings/status panel in the Connect tab.
 */
export interface Integration {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  /** called once at app start */
  init?: () => void | Promise<void>;
  Panel: ComponentType;
  /** small status hook shown on the card header */
  useStatus?: () => { label: string; tone: "ok" | "warn" | "err" | "default" };
}
