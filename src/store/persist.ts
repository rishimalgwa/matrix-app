import { createJSONStorage } from "zustand/middleware";

/** localStorage that never throws (private mode, quota, disabled storage). */
export const safeStorage = createJSONStorage(() => ({
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore quota */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
}));
