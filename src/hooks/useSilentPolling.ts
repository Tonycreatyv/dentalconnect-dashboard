import { useEffect, useRef } from "react";

// Demo-safe frontend polling: re-invokes an existing load/reload function on
// an interval, without ever running two at once, without touching data on a
// failed tick, and pausing while the tab is hidden. Deliberately not
// Supabase Realtime — just a thin wrapper around whatever fetch a screen
// already has, so it stays reversible with zero backend/schema involvement.
export function useSilentPolling(reload: () => Promise<unknown> | unknown, intervalMs: number, enabled = true) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const tick = async () => {
      if (inFlightRef.current || document.visibilityState !== "visible") return;
      inFlightRef.current = true;
      try {
        await reloadRef.current();
      } catch {
        // Silent by design — a failed background refresh must never clear
        // or replace data already on screen.
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = window.setInterval(() => { void tick(); }, intervalMs);

    // Coming back to the tab should feel instant rather than waiting for
    // the next tick, which could be up to intervalMs away.
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
