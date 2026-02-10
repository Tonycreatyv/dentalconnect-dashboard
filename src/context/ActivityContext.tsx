import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ActivityLevel = "info" | "success" | "warn" | "error";

export type ActivityEvent = {
  id: string;
  ts: string; // ISO
  level: ActivityLevel;
  title: string;
  detail?: string;
};

type ActivityContextValue = {
  events: ActivityEvent[];
  push: (e: Omit<ActivityEvent, "id" | "ts"> & { ts?: string }) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

function safeId() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const STORAGE_KEY = "dc_activity_log_v1";
const STORAGE_UI_KEY = "dc_activity_ui_v1";

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [open, setOpen] = useState(true);

  // Restore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const ui = localStorage.getItem(STORAGE_UI_KEY);
      if (raw) setEvents(JSON.parse(raw));
      if (ui) setOpen(JSON.parse(ui)?.open ?? true);
    } catch {
      // ignore
    }
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, 30)));
    } catch {
      // ignore
    }
  }, [events]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_UI_KEY, JSON.stringify({ open }));
    } catch {
      // ignore
    }
  }, [open]);

  const value = useMemo<ActivityContextValue>(() => {
    return {
      events,
      open,
      setOpen,
      push: (e) => {
        const ts = e.ts ?? new Date().toISOString();
        const next: ActivityEvent = {
          id: safeId(),
          ts,
          level: e.level,
          title: e.title,
          detail: e.detail,
        };

        setEvents((prev) => {
          // Dedup simple: si el último tiene mismo title+detail, no spamear
          const last = prev[0];
          if (last && last.title === next.title && (last.detail ?? "") === (next.detail ?? "")) {
            return prev;
          }
          return [next, ...prev].slice(0, 30);
        });
      },
      clear: () => setEvents([]),
    };
  }, [events, open]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity debe usarse dentro de <ActivityProvider />");
  return ctx;
}
