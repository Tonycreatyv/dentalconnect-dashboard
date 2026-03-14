import { getCalendarProvider, type CalendarProvider } from "./provider.ts";
import {
  CreateCalendarEventInput,
  CreateCalendarEventResult,
} from "./types.ts";

export type CalendarSyncResult = {
  success: boolean;
  provider: string | null;
  event_id?: string;
  error?: string;
  sync_status: "synced" | "pending" | "skipped" | "error";
};

type CalendarProviderFactory = (provider: string) => CalendarProvider;
let calendarProviderFactory: CalendarProviderFactory = getCalendarProvider;

export function overrideCalendarProviderFactory(fn: CalendarProviderFactory) {
  calendarProviderFactory = fn;
}

export function resetCalendarProviderFactory() {
  calendarProviderFactory = getCalendarProvider;
}

export async function syncCalendarEvent(input: CreateCalendarEventInput & { provider?: string }) {
  if (!input.provider || !input.calendar_id) {
    return {
      success: false,
      provider: input.provider ?? null,
      sync_status: "skipped" as const,
    };
  }

  try {
    const provider = calendarProviderFactory(input.provider);
    const result: CreateCalendarEventResult = await provider.createEvent(input);
    if (!result.success) {
      return {
        success: false,
        provider: result.provider,
        error: result.error,
        sync_status: "error",
      };
    }
    return {
      success: true,
      provider: result.provider,
      event_id: result.event_id,
      sync_status: "synced",
    };
  } catch (err) {
    return {
      success: false,
      provider: input.provider ?? null,
      error: err instanceof Error ? err.message : String(err),
      sync_status: "error",
    };
  }
}
